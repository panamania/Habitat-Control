# Habitat Control — Product Spec (PRD)

> **Status:** Draft v1 · Whole-product vision · Primary user: the solo developer
> **Companion docs:** [`HABITAT_CONTROL_ARCHITECTURE.md`](HABITAT_CONTROL_ARCHITECTURE.md) (invocation flow) ·
> [`bot-views/DECISIONS.md`](bot-views/DECISIONS.md) (settled decisions) ·
> [`bot-views/BACKLOG.md`](bot-views/BACKLOG.md) (engineering backlog) ·
> [`bot-views/INTEGRATION_NOTES.md`](bot-views/INTEGRATION_NOTES.md) (what the fork adds)

This spec describes Habitat Control end-to-end: the local colony **viewer** it started as,
the cross-platform **visibility** layer that sees cloud-deployed agents, and the
**control plane** that lets you invoke them. It is written for the person the tool is
actually for today — **one developer, watching and steering their own agents**, on their
own machine and a few cloud deployments — while marking where the design must not
foreclose a future team/fleet version.

---

## Problem Statement

A developer now runs coding agents in many places at once — several Claude Code and Codex
threads on the laptop, a Cursor session or two, and increasingly an agent or three deployed
to AWS Bedrock or a Kubernetes cluster. **There is no single place to see all of them, know
which ones need you, or hand one a task.** Each harness has its own list, its own window, and
its own idea of "recent"; cloud agents have no ambient presence at all. The cost is missed
`?`-state threads (an agent stopped and waited, you never saw), context-switch tax from
hunting across five UIs, and cloud agents that are effectively invisible between the times you
deliberately go looking for them.

Who feels it: the solo/indie developer or small-team maintainer running enough concurrent
agent work that a flat list stops being legible. How often: continuously, during any working
session with more than a handful of live threads.

---

## Goals

Outcomes, not outputs. Each answers "how would we know it worked?"

1. **One glance answers "who needs me?"** — Across every connected harness and platform, a
   user can identify every thread waiting on them (`?`), erroring (`!`), or running (`⚒`)
   within ~2 seconds of looking, without clicking. Success: in usability sessions, users
   locate all attention-needing threads on first look, no per-harness hunting.
2. **The map is learnable and stays learned.** A repo's zone occupies the same ground across
   reloads, growth, and shrink-then-regrow, so spatial memory pays off. Success: a returning
   user points to a known repo's zone before reading its label.
3. **A cloud agent has the same ambient presence as a local thread.** A Bedrock or K8s agent
   shows up in the colony, carries state, and is openable/invokable through the same gestures
   as a local session — no separate "cloud panel." Success: users cannot tell from the
   interaction model whether a given astronaut is local or cloud.
4. **You can act, not just watch — safely.** From the colony, a user can invoke an agent and
   watch its result stream back, with an explicit confirmation gate before any high-stakes
   action, and **zero writes into any harness's own records**. Success: an invocation
   round-trips (queue → stream → done/error) visibly, and the "never writes to a harness"
   invariant holds under audit.
5. **Trust is legible.** The user always knows what the tool can touch (local files it reads,
   the one colony file it writes, the new-project folder it can create, the cloud endpoints it
   can call) and nothing exceeds that. Success: the trust boundary is stated in-product and
   matches the code.

---

## Non-Goals

Explicitly out of scope, each with a reason.

- **Multi-user / multi-tenant operation.** The whole design assumes one process, one user,
  localhost. In-memory pub/sub and a lazy-singleton SQLite connection encode that assumption
  on purpose ([`BACKLOG.md`](bot-views/BACKLOG.md) "single-process assumptions"). Team/fleet
  operation is a separate initiative, not a v1 setting.
- **Writing into a harness's records.** Never a transcript, session file, or flag
  ([`DECISIONS.md`](bot-views/DECISIONS.md)). Archiving is the colony's own bookkeeping. This
  is a permanent non-goal, not a v1 deferral.
- **Being a general cloud console.** Habitat Control is not a replacement for the AWS console
  or `kubectl`. It shows *agents as colony citizens* and invokes them; it does not manage
  infra, billing, scaling, or arbitrary cloud resources.
- **Executing arbitrary code we guessed at.** Opening a thread may run an OS-resolved deep
  link or a binary already on `PATH` — never a path probed inside an application bundle
  ([`DECISIONS.md`](bot-views/DECISIONS.md), the Gatekeeper incident). No general "run this
  command" surface.
- **A registry someone maintains by hand.** Discovery happens live through each adapter's
  `scanThreads()`. We deliberately do *not* require a per-agent config table with
  `endpoint_ref`/`auth_ref`/`health` as the source of truth for *presence*
  ([`INTEGRATION_NOTES.md`](bot-views/INTEGRATION_NOTES.md) §2). Invocation-only metadata
  (e.g. agent→alias maps) is the narrow exception.

---

## Personas & User Stories

**Primary — "Sam", solo developer.** Runs 5–40 concurrent agent threads across Claude Code,
Codex, and Cursor locally, plus 1–3 Bedrock/K8s agents. Wants presence and control, not a
dashboard to administer. Values that the tool is local, read-mostly, and account-free.

**Secondary — "Devon", small-team maintainer** (design-toward, not v1). Same as Sam but the
agents belong to a shared project; cares that the model *could* grow to fleet operation
without a rewrite.

Ordered by priority.

### Presence & legibility
- As a developer, I want every agent thread across all my harnesses shown in one colony, so I
  have a single place to look instead of five windows.
- As a developer, I want a thread that's waiting on me to visibly stop and hold a `?`, so the
  one that needs me isn't buried under dozens that are quiet.
- As a developer, I want a repo's zone to stay in the same place across reloads and as it
  grows/shrinks, so my spatial memory of the map keeps paying off.
- As a developer, I want only attention-worthy states to carry a badge (`!` `⚒` `✓` `?`), so
  a symbol over every astronaut doesn't bury the one that matters.

### Cloud visibility
- As a developer, I want a Bedrock or K8s agent to appear as an astronaut like any local
  thread, so my whole fleet spreads across one map by agent identity, not by cloud vendor.
- As a developer, I want a clear, honest signal when a platform can't read its own state
  (e.g. Azure diagnostics off, AWS session scoping), so a broken adapter doesn't look healthy
  while contributing nothing (`diagnostic()`).
- As a developer, I want cloud credentials to be least-privilege and read-only for viewing, so
  connecting a platform can't do more than show me its agents.

### Control (invocation)
- As a developer, I want to type a prompt to an agent from its card and have it queue
  immediately, so I'm not blocked while a long task runs.
- As a developer, I want the agent's answer to stream back and land as a result I can read,
  so I get progress, not a spinner.
- As a developer, I want a mandatory confirmation before invoking a high-stakes agent (e.g. a
  trading or banking zone), so I can't fire one off by reflex.
- As a developer, I want to open any thread — local or cloud — back in its own harness with
  one click, so the colony is a launcher, not a dead end.

### Creating & organizing
- As a developer, I want to create a new hex space from the UI that spins up a fresh Claude
  Code project in a folder I choose, so starting new work doesn't mean leaving the tool.
- As a developer, I want the map layout, my zones, and my settings to persist in one colony
  file, so the map I've learned survives a reload and travels with me.

### Edge / empty / error states
- As a developer with no cloud creds set, I want the tool to boot clean with cloud platforms
  simply shown as not-detected, so it's useful on day one with zero configuration.
- As a developer, I want an invocation that errors to surface the error (not vanish), so a
  failed task is visible.
- As a developer reconnecting to a stream mid-flight, I want the current state delivered
  first (a snapshot), so I don't miss where an invocation already landed.

---

## Requirements

### Must-Have (P0) — the product isn't itself without these

**P0.1 — Multi-harness local discovery & colony render.**
Read local session files for every supported harness (Claude Code, Codex, Cursor) through the
per-harness adapter contract (`id/name/detect/scanThreads/openThread/newSession`); render the
union as one colony. Never write to a harness.
- *Acceptance:*
  - Given Claude Code, Codex, and Cursor each have sessions, when the colony loads, then every
    session appears as an astronaut tagged with its harness.
  - Given a harness isn't installed, then it contributes nothing and raises no error.
  - No harness record (transcript/session/flag) is ever modified — verified by audit.

**P0.2 — Sticky zone layout.**
A repo's zone keeps its tiles across reloads; growth claims neighbours, shrink returns the
most-recently-claimed tiles, and shrink-then-regrow returns to the exact starting shape. Zone
origin is its root tile. Layout persists to `data/colony.json`.
- *Acceptance:* Given a placed zone, when the app reloads, then the zone occupies the same
  tiles. Given a zone grows then shrinks by the same count, then its footprint is identical to
  before. Given a repo whose last thread was archived, when a new thread starts, then it
  returns to the same ground.

**P0.3 — Attention-first astronaut state.**
Behaviour is strict precedence, first match wins: errored (`!`) → running (`⚒`) → PR merged
(`✓`) → unread (`?`) → idle-3-days (sleep) → pottering. Only states that want something from
you carry a badge. Zone names show only while someone there is working/waiting/stuck.
- *Acceptance:* Given a thread is both running and unread, then it shows running only. Given a
  quiet colony with one unread thread, then exactly one `?` is visible.

**P0.4 — Open any thread back in its harness.**
`openThread(ref)` returns `{ok, url, command}`; the server opens via OS deep link (macOS/
Windows) or checks the scheme then falls back to a terminal command (Linux). No path guessed
inside an app bundle.
- *Acceptance:* Given a thread, when the user clicks it, then its harness opens to that
  session (or, on Linux with no app, a terminal running the harness CLI). Given a scheme
  nobody claims, then the UI is told the truth rather than reporting a false "Opened."

**P0.5 — Cross-platform (cloud) visibility via the same contract.**
Bedrock and self-hosted K8s agents plug in as "platform" adapters honoring the same harness
contract, so cloud agents render as astronauts. One zone = one deployed agent
(`<platform>:<agent>`). Credentials for viewing are least-privilege, read-only. Boots clean
with zero cloud creds (platforms show `detected: false`).
- *Acceptance:* Given AWS creds and a Bedrock agent, when the colony loads, then that agent
  appears as its own zone. Given no cloud creds, then the app runs normally and marks those
  platforms not-detected.

**P0.6 — Async invocation with streaming.**
`POST /api/invoke` validates, clears the high-stakes gate, and returns `202 {invocationId,
status:"queued"}`, then runs the adapter call in the background. One `invocations` row per
call (`id, agent_id, zone, status, started_at, output`, + gate/audit fields) in SQLite
(`node:sqlite`). `GET /api/invocations/:id` polls; `GET /api/invocations/:id/stream` is an SSE
channel emitting `snapshot` → `status`/`chunk` → `done`/`error`.
- *Acceptance:* Given a queued invocation, when the user subscribes to its stream, then they
  receive a snapshot first, then chunks as bytes arrive, then a terminal done/error. Given a
  subscriber connects after completion, then the snapshot conveys the final state.

**P0.7 — High-stakes confirmation gate.**
Any invocation into a zone marked `highStakes` requires explicit `confirmed: true`, checked
synchronously before an invocation row exists. Every invoke is written to an audit log.
- *Acceptance:* Given a high-stakes zone, when invoked without confirmation, then the request
  is refused and nothing is queued. Given confirmation, then it proceeds and is audited.

**P0.8 — Create a new hex space.**
`POST /api/new-project` creates an empty folder under a configurable root
(`HABITAT_CONTROL_PROJECTS_ROOT`, default `~/HabitatControl/projects`; overridable per-request
via `root`, `~` expanded server-side, absolute-path required) and opens a fresh Claude Code
session there via `newSession(dir)`. This is the one place the tool causes a project to exist;
it still never writes into a harness's own store.
- *Acceptance:* Given a valid name, when the user adds a space, then an empty folder is created
  at the resolved root and Claude Code opens there; the zone appears on the next poll like any
  new thread. Given a non-absolute `root`, then the request is refused before anything is
  created.

**P0.9 — Layered trust boundary (localhost + authenticated exposure).**
Bind `127.0.0.1` by default and answer only the tool's own page (Host + Origin same-origin
check — stops DNS rebinding and cross-site CSRF). This same-origin gate is retained as
defense-in-depth. Because the write surface has grown to real agent invocation and
client-named folder creation, **and because serving beyond localhost is a decided goal** (see
§Timeline Phase 3), same-origin alone is no longer sufficient once the server is reachable
off-machine: a legitimately-served remote page and an attacker's request share the same origin.

The decided direction (full rationale in **[`ADR-001-trust-model.md`](ADR-001-trust-model.md)**):
a shared-secret bearer token (`HABITAT_CONTROL_TOKEN`) is required on every state-changing
route *in addition to* the same-origin check, and is **mandatory (fail closed)** whenever the
server binds off-loopback. The high-stakes `confirmed: true` flag is kept as reflexive-click
protection for the already-authenticated user — the threat bar deliberately excludes a
compromised local browser, so out-of-band confirmation is explicitly not built.
- *Acceptance:*
  - Given the default (loopback, no token), then behaviour is unchanged: reachable only on-host,
    a cross-origin state-changing request is rejected, no token needed — zero-config preserved.
  - Given the server bound off-loopback with no `HABITAT_CONTROL_TOKEN` set, then it refuses to
    enable state-changing routes (fails closed) rather than serving them unauthenticated.
  - Given the server exposed with a token set, when a write request arrives without the token,
    then it is rejected even if same-origin; with the token, it proceeds.
  - The token never appears in a URL or query string.

### Nice-to-Have (P1) — real improvements, core works without them

- **P1.1 — Astronaut reacts to invocation state.** Wire a live invocation's status into the
  3D astronaut's `running`/`unread`/`done` animation, so the *astronaut* flips idle → running
  → done, not only the thread card. (Today only the card reacts —
  [`INTEGRATION_NOTES.md`](bot-views/INTEGRATION_NOTES.md) §4.)
- **P1.2 — Better-than-`window.confirm` high-stakes UX.** Replace the plain browser confirm
  with an in-world confirmation that names the zone, the action, and the stakes.
- **P1.3 — Richer result surface.** Show an invocation's streamed output in an expandable panel
  on the tile/card, not only as a transient toast.
- **P1.4 — More harnesses.** OpenCode, Amp, Aider, Goose, Qwen, Amazon Q, Antigravity — each
  is one adapter file plus one line in `index.mjs`.
- **P1.5 — New-space harness choice.** Let "add a hex space" target any detected harness, not
  just hardcoded Claude Code (a one-line change in `src/game/api.js`).
- **P1.6 — Centralized config module.** One `server/lib/config.mjs` resolving every env-var/
  path once, ending the four-file drift on `HABITAT_CONTROL_DATA`
  ([`BACKLOG.md`](bot-views/BACKLOG.md)).

### Future Considerations (P2) — design so we don't foreclose these

- **P2.1 — Real deployment topology.** Control-plane as its own in-cluster Deployment/Service,
  Cloudflare Tunnel (or Tailscale Funnel) for browser exposure, Bedrock IAM secret as a K8s
  Secret. The trust-model direction for a tunneled public hostname is now decided — bearer
  token, fail-closed, plus edge auth ([`ADR-001`](ADR-001-trust-model.md)) — and is a hard
  prerequisite for this item. (Architecture doc §5; still just the doc.)
- **P2.2 — Azure AI Foundry & GCP Vertex adapters.** Same contract; existed in an earlier cut,
  deferred to keep v1 scope at AWS + K8s.
- **P2.3 — Multi-process / team operation.** Would require replacing in-memory pub/sub and the
  single-connection SQLite assumption. Explicitly not now; the assumption is load-bearing and
  documented so it isn't tripped over.
- **P2.4 — Auth in front of state-changing routes.** *Direction decided
  ([`ADR-001`](ADR-001-trust-model.md)):* shared-secret bearer token, mandatory once bound
  off-loopback; keep the `confirmed:true` flag; do not move confirmation out of band. This is
  now an implementation item (see ADR action items), not an open one.

---

## Success Metrics

Single-user tool, so metrics are observational/qualitative more than analytics dashboards.
Targets are hypotheses to validate.

### Leading indicators (days–weeks)
- **Attention-find time:** time to locate all `?`/`!` threads on first look. *Target:* < 2s,
  no per-harness clicking, in moderated sessions.
- **Invocation round-trip visibility:** % of invocations where the user sees queue → stream →
  terminal state without a dead spinner. *Target:* 100% (an error is a visible terminal state,
  not a vanish).
- **Clean-boot rate:** app boots and is useful with zero cloud creds configured. *Target:*
  100%; test suite green in that state (currently 45/45).
- **Trust-invariant holds:** automated/audit check that no harness record was written.
  *Target:* 0 violations.

### Lagging indicators (weeks–months)
- **Return-to-tool behaviour:** the colony becomes the default place the user starts a session
  from (proxy: new-space creations and thread-opens originate here).
- **Harness/platform coverage:** count of supported harnesses and platforms trending up via
  community adapters.
- **Spatial-memory payoff:** returning users recognize known zones by position before reading
  labels (qualitative).

### Measurement
Moderated first-use sessions for the qualitative targets; the existing test suite plus an audit
assertion for the invariant and clean-boot targets; git/adapter count for coverage. Evaluate at
1 week (leading) and 1 quarter (lagging) after any notable release.

---

## Open Questions

Genuinely unresolved — not answerable from current context.

- **[security] Trust-model direction — RESOLVED** in [`ADR-001`](ADR-001-trust-model.md):
  shared-secret bearer token on state-changing routes, mandatory (fail closed) once bound
  off-loopback; keep the `confirmed:true` flag as reflexive-click protection; out-of-band
  confirmation explicitly not built. Remaining open sub-question: *token lifecycle* — how the
  token is rotated and, for a network device, delivered (one-time copy vs. QR vs. edge auth
  only). Non-blocking for the localhost path; resolve before P2.1 ships.
- **[engineering] Nested git histories under `bot-views/`.** Document loudly, absorb via
  subtree/filter-repo, or delete the inner `.git`? *Blocking-ish* for contributors (risk of
  committing to the wrong remote). Low effort, undecided direction.
- **[product] Does invocation ever need an agent `scanThreads()` hasn't seen?** If yes, the
  live-discovery model needs a real registry with `endpoint_ref`/`auth_ref` for those agents;
  if no, the current zones-as-registry stand-in is enough. Drives whether §2 of the
  architecture doc gets built out.
- **[design] What does a cloud agent's *running* state look like in-world** when it has no
  local transcript growing on disk? Building "finishedness" is transcript size on a log scale;
  a cloud invocation may not map to that cleanly.
- **[product] High-stakes taxonomy.** Today `highStakes` is a per-zone boolean seeded on two
  zones. Is a boolean enough, or do actions within a zone need their own stakes levels?

---

## Timeline Considerations

No contractual deadlines — single-maintainer, published-as-is project. Sequencing is by
dependency and risk, not dates.

**Phase 0 — Foundation (shipped).** Local multi-harness viewer, sticky layout, attention-first
state, open-in-harness. This is the inherited/forked base.

**Phase 1 — Fork's current line (largely shipped).** Cross-platform visibility (AWS Bedrock +
K8s), async invocation with SSE streaming, SQLite invocation store, high-stakes gate + audit
log, create-a-hex-space. Remaining polish here is P1.1–P1.3 (astronaut reacts to invocation,
better confirm UX, richer result surface).

**Phase 2 — Hardening & breadth.** Centralized config (P1.6), resolve nested git histories,
**implement the trust-model decision** ([`ADR-001`](ADR-001-trust-model.md) action items —
bearer token, fail-closed off-loopback; gates anything exposed beyond localhost), more
harnesses (P1.4), new-space harness choice (P1.5).

**Phase 3 — Beyond localhost (design-toward).** Real deployment topology (P2.1), Azure/GCP
adapters (P2.2), and only if genuinely needed, the multi-process rework (P2.3). Each of these
is explicitly *not* pulled forward; the localhost single-process assumptions are load-bearing
until a concrete reason retires them.

**Hard dependency:** Phase 3's exposure work cannot start before the trust-model decision is
*implemented* (Phase 2) — the direction is set ([`ADR-001`](ADR-001-trust-model.md)), but the
Host/Origin defense was sized for a read-only localhost viewer, and the write surface has since
grown to real invocation and folder creation, so the bearer-token/fail-closed work must land
before anything is served off-machine.

---

## Appendix — Glossary

| Term | Meaning |
| --- | --- |
| **Harness** | Whatever actually runs your threads (Claude Code, Codex, Cursor…). Read via a local adapter. |
| **Platform** | A cloud harness — Bedrock, K8s — plugged in through the same adapter contract. |
| **Zone** | One repo (or one deployed agent), occupying one or more hex tiles. |
| **Astronaut** | One session/thread/run of an agent. |
| **Thread state** | Strict precedence: errored → running → merged → unread → asleep → idle. |
| **Invocation** | One `POST /api/invoke` call and its `invocations` row, streamed over SSE. |
| **High-stakes gate** | Synchronous `confirmed:true` requirement for zones marked `highStakes`. |
| **Colony file** | `data/colony.json` — the one file the tool writes for map/layout/settings. |
