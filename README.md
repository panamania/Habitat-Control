# Habitat Control — cross-platform agent adapters

Four `server/platforms/*.mjs` files that plug into Habitat Control's existing
harness contract (`id / name / detect / scanThreads / openThread /
newSession`, documented in `server/harnesses/README.md`) so the colony
renders agents running on AWS, Azure, GCP, and self-hosted Kubernetes
instead of local Claude Code / Codex / Cursor sessions. `scan.mjs`,
`api.mjs`, and everything under `src/` are unchanged — that's the whole
point of the seam Habitat Control already has.

## Install

```
cd server/platforms
npm install @aws-sdk/client-bedrock-agent @aws-sdk/client-bedrock-agent-runtime \
            @azure/identity @azure/monitor-query \
            google-auth-library \
            @kubernetes/client-node
```

## Wire it in

In `server/harnesses/index.mjs` (or wherever `scan.mjs` imports its source
list from):

```js
import { HARNESSES } from './harnesses/index.mjs'
import { PLATFORMS } from './platforms/index.mjs'
export const ALL_SOURCES = [...HARNESSES, ...PLATFORMS]
```

## Environment variables

| Adapter | Vars |
|---|---|
| AWS Bedrock | `AWS_REGION`, plus whatever your normal AWS SDK credential chain needs (profile, IAM role, env keys) |
| Azure AI Foundry | `AZURE_LOG_ANALYTICS_WORKSPACE_ID`, `AZURE_AI_FOUNDRY_PROJECT_ENDPOINT`, `AZURE_AI_FOUNDRY_PORTAL_URL` |
| GCP Vertex | `GCP_PROJECT_ID`, `GCP_LOCATION`, `GCP_AGENT_ENGINE_IDS` (comma-separated) |
| Kubernetes | `K8S_AGENT_NAMESPACE`, `K8S_AGENT_LABEL_SELECTOR` |

Use least-privilege, **read-only** credentials for all four — this is a
viewer, same as the original tool's "never writes" philosophy. IAM
read-only role for Bedrock, a reader role assignment for the Log Analytics
workspace, a Viewer role on the Vertex project, a Kubernetes Role scoped to
`get`/`list` on pods in one namespace.

## Zone strategy

Each adapter sets `project` to `<platform>:<agent-or-engine-name>` (e.g.
`aws:claims-triage-agent`, `k8s:invoice-parser`). That's what claims a hex
zone in Habitat Control's existing layout logic, so **one zone = one deployed
agent**, regardless of which hyperscaler runs it — your whole fleet spreads
across the map by agent identity, not by cloud vendor. Astronauts within a
zone are individual sessions/runs/invocations of that agent.

## The three honest caveats, up front

- **AWS**: `ListSessions` returns every session in the account, not scoped
  to one agent. Tag sessions with the agent id at creation time
  (`sessionMetadata`) or every session lands in one `aws:unassigned` zone.
  If you're on Bedrock AgentCore rather than classic Agents-for-Bedrock,
  this adapter's API calls are the wrong ones — AgentCore's control plane
  (`ListAgentRuntimes`) is a different shape entirely.
- **Azure**: the Assistants-compatible API has no "list every thread"
  endpoint by design — threads are only reachable by ID. This adapter reads
  run telemetry out of Log Analytics instead, which means it returns
  nothing until diagnostic export to a workspace is turned on for the
  Foundry project, and the KQL query's field names need to match whatever
  your diagnostic setting actually exports.
- **Kubernetes**: there's no universal "agent" concept in the Kubernetes
  API, so this adapter invents a labeling convention
  (`agent-colony/agent-name`, `agent-colony/status`) that something in your
  stack has to actually write. It's the adapter most worth treating as a
  sketch rather than a finished implementation.

## Polling, not local files

`cache.mjs` wraps each adapter's fetch in a 15–30s TTL cache so
`scanThreads()` never blocks on a live network call and never fires more
than one refresh at a time — that's the network equivalent of the mtime
caching the original Claude Code adapter does for a 12MB local transcript.
Widen the TTLs if you're watching a lot of engines/sessions and start
hitting rate limits.
