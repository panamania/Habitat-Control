# Habitat Control — Agent Invocation Flow: Architecture Spec

Scope: the UI → Bedrock/K8s invocation path for the hex-zone control-plane dashboard.
Platforms in scope: AWS Bedrock + self-hosted Kubernetes (Azure/GCP deferred).

## 1. Unified Invocation Contract

Every agent — regardless of platform — is called through the same shape, so the
hex UI never needs to know whether it's talking to Bedrock or a pod in-cluster:

```
POST /api/agents/{agentId}/invoke
{ input: string, sessionId?: string, context?: object }

→ 202 { invocationId, status: "queued" }
```

Status/results are pulled via an SSE channel keyed by `invocationId` (see §4).

## 2. Agent Registry

Central metadata table. Also drives what the hex UI renders per zone.

| field | example |
|---|---|
| `agent_id` | `career-coach-1` |
| `zone` | `Career Coach` |
| `platform` | `bedrock` \| `k8s` |
| `endpoint_ref` | Bedrock agent alias ARN, or `career-coach.agents.svc.cluster.local:8080` |
| `auth_ref` | IAM role name, or K8s service-account/secret name |
| `capabilities` | `["research", "resume-review"]` |
| `health` | last successful ping timestamp |

## 3. Adapters

Common interface: `invoke() → invocationId`, `getStatus() → {status, output}`.

- **BedrockAdapter** — `bedrock-agent-runtime` SDK, `InvokeAgentCommand`. Native
  event stream. Multi-turn continuity via Bedrock's own `sessionId`.
- **K8sAdapter** — each self-hosted agent exposes its own `/invoke` (+ `/status`
  or SSE) as a ClusterIP service (likely FastAPI). Adapter POSTs to
  `{service}.agents.svc.cluster.local` directly — same-cluster, no tunnel needed.

## 4. Execution Model: async + streaming

Long-running tasks (e.g. "research a topic") are fire-and-forget with a status
channel, not blocking request/response:

1. Control-plane writes an `invocations` row: `id, agent_id, zone, status, started_at, output`
2. Opens an SSE channel keyed by `invocationId`
3. Relays whatever the adapter streams (Bedrock's native stream, or the K8s
   agent's own stream/poll) straight through
4. Hex tile subscribes, flips `idle → running → done`, result lands in an
   expandable panel on the tile

## 5. Deployment Topology (decided: backend runs in-cluster)

- **Control-plane**: its own Deployment + Service, separate namespace from
  agent pods (room for NetworkPolicy later). Talks to agent services over
  plain ClusterIP DNS — no auth hop needed for K8s-side calls.
- **Exposing to the browser**: Cloudflare Tunnel (no port-forwarding, free TLS,
  stable public hostname) — Tailscale Funnel as the alternative if already on
  a tailnet. Put Cloudflare Access or a bearer-token check in front of it;
  single-user dashboard, but don't leave `/invoke` open on a public hostname.
- **Bedrock auth**: no IRSA (cluster isn't EKS) — scoped IAM user access
  key/secret as a K8s Secret, mounted as env vars. IAM policy limited to
  `bedrock:InvokeAgent` on the specific agent ARNs in the registry, not a
  broad Bedrock policy. Rotate periodically — it's the one credential leaving
  the network boundary.
- **Frontend**: served from the same cluster behind the same tunnel hostname
  (simplest — keeps everything in one trusted place).

## 6. Resulting Shape

```
Browser (hex UI)
   |  HTTPS via Cloudflare Tunnel
   v
control-plane Service (in-cluster)
   |-- BedrockAdapter --> AWS Bedrock (IAM secret from K8s Secret)
   `-- K8sAdapter ------> agent-*.agents.svc.cluster.local (plain ClusterIP)
```

Only Bedrock calls ever leave the network; everything K8s-side stays internal.

## 7. Open Decision

**Invocation record store**: SQLite on a PVC is enough to start (single-user,
low volume) vs. reaching for Postgres now. Lean SQLite until there's a reason
not to.

## 8. Suggested Build Order

1. Scaffold control-plane service, agent registry as config-driven table to start
2. `/api/agents/{id}/invoke` stub + invocation record model (SQLite)
3. BedrockAdapter against one real Bedrock agent
4. K8sAdapter against one self-hosted agent service
5. Wire SSE streaming from adapter → invocation channel
6. Deploy control-plane in-cluster; set up Cloudflare Tunnel + bearer-token auth
7. Wire hex UI tile to subscribe to SSE channel, render running/done states
