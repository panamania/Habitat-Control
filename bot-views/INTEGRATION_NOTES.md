# What's been done to this fork

This is Station-Sciences/bot-crossing with AWS Bedrock Agents and
self-hosted Kubernetes wired in as additional harnesses ("platforms"),
plus a control-plane layer the original project never had. See the git
log (`git log`) for the two commits: the untouched upstream base, then
everything below in one commit on top.

See also [`HABITAT_CONTROL_ARCHITECTURE.md`](../HABITAT_CONTROL_ARCHITECTURE.md)
(one level up) — the spec this fork is being brought in line with. The
sections below map onto its numbering.

## Get running
```
npm install
npm run dev
```
Boots clean with zero cloud credentials configured — AWS and Kubernetes
just show up as `detected: false` in the harness list until you set their
env vars (see server/platforms/*.mjs headers for what each one needs).
`npm test` passes 45/45 against this state.

## What's real vs. what's a starting point
- **AWS Bedrock adapter** (`server/platforms/aws-bedrock.mjs`) — checked
  against the actual installed SDK's type definitions, not just docs/web
  search. Known real limitation: joining a session to the agent that owns
  it costs one extra GetSession call per session (Bedrock doesn't return
  that link in the list API), and invoking an agent needs an
  agentId→agentAliasId map you maintain yourself
  (`AWS_BEDROCK_AGENT_ALIASES`).
- **Kubernetes adapter** (`server/platforms/k8s-agents.mjs`) — on
  `@kubernetes/client-node@2.0.0` (bumped from an earlier pin that pulled
  in vulnerable transitive deps — audit clean now). This is the adapter
  most worth treating as a sketch: it invents a pod-labeling convention
  (`agent-colony/agent-name`, `agent-colony/zone`, `agent-colony/status`,
  `agent-colony/invoke-url`) that nothing writes for you yet.
- **Zones** (`server/platforms/zonesStore.mjs`, `data/zones.json`) — fully
  editable at runtime via `/api/zones`, not a code change. Seeded with the
  7 themes plus `unclassified`; `asx-trading` and `banking-support` start
  marked `highStakes: true`. This is the fork's stand-in for the
  architecture doc's §2 Agent Registry — lighter than a config table with
  `endpoint_ref`/`auth_ref`/`health` per agent, because discovery already
  happens live through each adapter's own `scanThreads()` rather than a
  registry somebody has to keep in sync. Worth revisiting if an adapter
  ever needs to invoke an agent scanThreads() hasn't seen yet.
- **Invoke — now genuinely async** (`server/platforms/invoke.mjs`,
  `/api/invoke`), per the architecture doc's §1/§4. `POST /api/invoke`
  settles only validation and the high-stakes gate before answering —
  `202 { invocationId, status: 'queued' }` — then runs the adapter call in
  the background. `GET /api/invocations/:id` polls one row;
  `GET /api/invocations/:id/stream` is the SSE channel §4 asks for,
  relaying `status` → `chunk` (as an adapter streams them — both
  aws-bedrock.mjs and k8s-agents.mjs now call `onChunk` as bytes arrive
  rather than buffering the whole reply) → `done`/`error`, with a
  `snapshot` event first so a subscriber that connects after the
  invocation already moved on doesn't miss where it landed. The
  high-stakes `confirmed: true` gate is unchanged and still runs
  synchronously, before an invocation row even exists.
- **Invocation record store** (`server/platforms/invocationStore.mjs`) —
  resolves the architecture doc's §7 open decision: SQLite, via Node's
  built-in `node:sqlite` (no new dependency; this project's own engines
  floor is already 22.13+, where it shipped). One row per invoke call —
  `id, agent_id, zone, status, started_at, output`, plus the fields the
  gate/audit trail need. The connection opens lazily on first use, not at
  import — matching zonesStore.mjs/auditLog.mjs's own convention, and the
  reason being: server/api.mjs is the only module the test suite
  re-imports per test (see test/state.test.mjs's `withServer`), so
  anything else that opened its file eagerly at import time would pin
  itself to whichever test happened to load it first, and then fail that
  test's own cleanup on Windows (`EBUSY`, unlinking a file it still has
  open) — the exact bug this shipped with initially, see the fix in
  invocationStore.mjs's own comment. A `closeInvocationStore()` export
  exists purely so tests can release that handle before removing their
  temp dir; production code never calls it.
- **In-process pub/sub** (`server/platforms/invocationBus.mjs`) — what
  wakes an open SSE response up without polling the database. Intentionally
  in-memory: an invocation started before a restart has no subscriber left
  anyway, and a reconnect always gets the current row from
  invocationStore first (the `snapshot` event), so nothing is lost, just
  not replayed mid-stream.
- **UI** — the "ask this agent" input in the existing thread-card panel
  (`src/ui/hud.js`, wired through `src/game/api.js`'s `askAgent` +
  `subscribeInvocation`), shown only when `thread.canInvoke` is true. The
  ask box now clears as soon as the prompt is queued rather than staying
  disabled for however long the agent takes to answer; the answer (or an
  error) lands later as its own toast, driven by the SSE stream. Still
  minimal in the ways it always was — the high-stakes confirmation is a
  plain `window.confirm()`, and progress only ever surfaces as a toast, not
  as a change to the astronaut's own animation/behaviour the way a local
  harness's `running`/`unread`/`hasError` states do (the architecture doc's
  §4 "hex tile flips idle → running → done" is only half true right now:
  the *thread card* does, the 3D astronaut doesn't — wiring an invocation's
  live status into `thread.running`/`thread.unread` so the astronaut itself
  reacts is the natural next step, not attempted here).
- **Tests** (`test/invoke.test.mjs`) — invocationStore and invocationBus
  covered directly; the k8s adapter's new chunk-relay behaviour verified
  against a real local HTTP server (not a live cluster); and one true
  end-to-end test drives `server/api.mjs` for real — POST /api/invoke,
  read the SSE stream to completion, poll the same invocation — against
  that same local fake agent. No aws-bedrock.mjs equivalent: the AWS SDK
  client doesn't have an easy local endpoint override the way a plain
  `fetch()` does, so its streaming change is covered by code review and
  the shared pattern with k8s-agents.mjs, not by a test.
- **Add a hex space from the UI** (`POST /api/new-project`, the `+` next
  to Repos in `src/ui/hud.js`) — the one place in this fork that causes a
  project to exist rather than only discovering one that already did. It
  creates an empty folder and opens a fresh Claude Code session there
  through the same `newSession(dir)` deep link the existing "New
  conversation" button already uses — no new capability at the harness
  layer, just a folder that didn't exist a moment before. Hardcoded to
  `claude-code` rather than "whichever harness is detected," because that
  was the explicit ask; broadening it to other harnesses is a one-line
  change in `src/game/api.js`'s `newProject`. The hex itself isn't a new
  concept — there's still no such thing as an empty zone — it just shows
  up the same way every other new thread does, on the poll after Claude
  Code actually leaves a session record behind. This is also the reason
  DECISIONS.md, CONTRIBUTING.md and server/harnesses/README.md all had
  their "the only file this project writes, anywhere" language corrected:
  it's no longer literally true, though the substance of that rule (never
  writing into a harness's own records) is untouched.
  - **Where it lands is configurable two ways**, stacked: `POST
    /api/new-project`'s optional `root` (Settings → Projects → "New space
    folder" in the client, persisted in `state.settings` so it travels
    with the colony file rather than one machine's env) overrides
    `HABITAT_CONTROL_PROJECTS_ROOT` (default `~/HabitatControl/projects`)
    entirely when set. `~` and `~/…` expand server-side
    (`expandHome` in api.mjs) since the setting's own placeholder shows a
    `~/…` example. Anything given must resolve to an absolute path or the
    request is refused before anything is created.
  - Covered by `test/new-project.test.mjs` for name validation, folder
    creation, the `root` override (including `~` expansion and a
    non-absolute `root` being refused), and a blank `root` correctly
    falling back to the env-var default. Not covered end-to-end through a
    real harness launch, same reasoning as `/api/open`/`/api/new-session`
    already weren't — that would mean actually asking the OS to open a
    `claude://` URL on every test run.

## Deliberately not done
- Azure AI Foundry and GCP Vertex AI adapters exist in an earlier version
  of this work but aren't in this folder — AWS + local Kubernetes was the
  agreed scope. Same adapter contract, easy to add back later.
- No real end-to-end test against live AWS/Kubernetes — that needs actual
  credentials and a real cluster, which this sandbox doesn't have.
- The architecture doc's §5 Deployment Topology (control-plane as its own
  in-cluster Deployment/Service, Cloudflare Tunnel, IAM-secret-as-K8s-Secret
  for Bedrock) is still just the doc. This fork still runs as
  bot-crossing's original single localhost process — real infra to
  provision and no cluster/tunnel in this sandbox to verify it against.
  Doing it for real would also mean revisiting `server/api.mjs`'s
  Host/Origin same-origin check (see README's "Keeping it local"), which
  is built for a browser talking to its own localhost server, not a
  tunnel forwarding a public hostname to an in-cluster Service.
