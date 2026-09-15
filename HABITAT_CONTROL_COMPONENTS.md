# Habitat Control — Architecture Component Diagram

> **Companion to:** [`SPEC.md`](SPEC.md) (product) · [`HABITAT_CONTROL_ARCHITECTURE.md`](HABITAT_CONTROL_ARCHITECTURE.md) (invocation flow)
> **Scope:** the whole running system — a single-process, localhost Node server serving a
> Three.js SPA, reading every local harness and cloud platform, and invoking cloud agents.
> Grounded in the code under [`bot-views/`](bot-views/), not an aspirational design.

This is a **C4-ish component view**: containers (browser, server process, data dir, external
systems) with the modules inside each and the calls between them. One process, one user, one
machine — the boundaries below are module seams, not network hops, except where labelled.

---

## 1. Component diagram

```mermaid
flowchart TB
    subgraph BROWSER["🌐 Browser — Three.js SPA (src/)"]
        direction TB
        MAIN["main.js<br/><i>bootstrap / loop</i>"]
        subgraph REND["Render + world"]
            CORE["core/*<br/>engine · camera · settings"]
            WORLD["world/*<br/>planet · plots · buildings · ship"]
            AGENTS["agents/*<br/>astronauts · crew · indicators"]
        end
        HUD["ui/hud.js · hud-data.js<br/><i>panels, prompts, settings</i>"]
        subgraph GAMEC["Game state + server client"]
            COLONY["game/colony.js<br/><i>zones, sticky layout, state</i>"]
            MERGE["game/merge-state.js<br/><i>optimistic-merge on 409</i>"]
            APIC["game/api.js<br/><b>HTTP + SSE client</b>"]
        end
        MAIN --> REND & HUD & COLONY
        HUD --> COLONY --> APIC
        COLONY --> MERGE
    end

    subgraph SERVER["⚙️ Node process (server/) — binds 127.0.0.1"]
        direction TB
        SERVE["serve.mjs<br/><i>static dist/ + /api/*</i>"]
        API["api.mjs · apiMiddleware<br/><b>router · Host/Origin guard</b><br/>colony.json · open · new-project"]

        subgraph DISC["Discovery (read-only)"]
            SCAN["scan.mjs<br/><i>union · disambiguate · sort</i>"]
            HREG["harnesses/index.mjs<br/><b>adapter registry</b>"]
        end

        subgraph ADAPT["Adapters — one contract: detect / scanThreads / openThread / newSession (+ invokeAgent)"]
            direction LR
            LOCAL["Local harnesses<br/>claude-code · codex · cursor"]
            CLOUD["Platforms<br/>aws-bedrock · k8s-agents<br/><i>(azure · gcp deferred)</i>"]
        end

        subgraph CTRL["Control plane (invocation)"]
            ROUTES["platforms/apiRoutes.mjs<br/><i>zones · invoke · SSE handlers</i>"]
            INVOKE["invoke.mjs<br/><b>dispatch · high-stakes gate</b><br/>fire-and-forget runner"]
            ISTORE["invocationStore.mjs<br/><i>SQLite rows</i>"]
            IBUS["invocationBus.mjs<br/><i>in-proc pub/sub</i>"]
            ZONES["zonesStore.mjs<br/><i>taxonomy · classify</i>"]
            AUDIT["auditLog.mjs<br/><i>append-only</i>"]
        end

        SERVE --> API
        API --> SCAN --> HREG --> ADAPT
        API --> ROUTES
        ROUTES --> INVOKE --> ADAPT
        INVOKE --> ISTORE & IBUS & AUDIT & ZONES
        ROUTES -->|snapshot| ISTORE
        ROUTES -->|subscribe| IBUS
        ADAPT --> ZONES
    end

    subgraph DATA["💾 data/ — the only things the tool writes"]
        COLJSON[("colony.json<br/><i>layout · archive · settings</i>")]
        ZONEJSON[("zones.json<br/><i>zones · assignments</i>")]
        SQLITE[("invocations.sqlite")]
        LOGJSONL[("invocations.log.jsonl")]
    end

    subgraph EXT["🔌 External systems"]
        direction TB
        HSTORES[["Local harness stores<br/><i>session files on disk — READ ONLY</i>"]]
        BEDROCK[["AWS Bedrock<br/>agent + runtime APIs"]]
        K8S[["Kubernetes API<br/>+ agent pods /invoke"]]
        OSOPEN[["OS opener / terminal<br/>open · rundll32 · xdg-open"]]
    end

    APIC <-->|HTTP /api/*| SERVE
    APIC <-->|SSE /invocations/:id/stream| SERVE

    LOCAL -.->|read| HSTORES
    API -->|open / new-project| OSOPEN
    CLOUD -->|list · invoke| BEDROCK
    CLOUD -->|list · invoke| K8S

    API --> COLJSON
    ZONES --> ZONEJSON
    ISTORE --> SQLITE
    AUDIT --> LOGJSONL

    classDef ext fill:#2b2b2b,stroke:#888,color:#eee;
    classDef store fill:#1f3a5f,stroke:#4a90d9,color:#eee;
    class HSTORES,BEDROCK,K8S,OSOPEN ext;
    class COLJSON,ZONEJSON,SQLITE,LOGJSONL store;
```

---

## 2. Components at a glance

| Component | File(s) | Responsibility |
| --- | --- | --- |
| **SPA bootstrap + render** | `src/main.js`, `src/core/*`, `src/world/*`, `src/agents/*` | Draw the hex colony; animate astronaut/thread state. |
| **HUD** | `src/ui/hud.js`, `hud-data.js` | Panels, prompt entry, settings, high-stakes confirm. |
| **Colony state** | `src/game/colony.js`, `merge-state.js`, `hidden-projects.js` | Sticky zone layout, archive set, settings; client-side conflict merge. |
| **Server client** | `src/game/api.js` | The only thing that talks to the backend: `fetch` for `/api/*`, `EventSource` for SSE. |
| **HTTP server / trust boundary** | `server/serve.mjs`, `server/api.mjs` | Serve `dist/`, route `/api/*`, enforce `Host`/`Origin` (`isLocalRequest`), own `colony.json`, run OS opener for open/reveal/new-project. |
| **Discovery** | `server/scan.mjs`, `server/harnesses/index.mjs` | Ask every *detected* adapter for threads; stamp source, disambiguate names, sort by recency. Never writes. |
| **Adapters** | `server/harnesses/{claude-code,codex,cursor}.mjs`, `server/platforms/{aws-bedrock,k8s-agents}.mjs` | One contract — `detect / scanThreads / openThread / newSession`, plus optional `invokeAgent`. Local = files; cloud = SDK/HTTP. |
| **Control plane** | `server/platforms/apiRoutes.mjs`, `invoke.mjs` | Zone CRUD; validate + high-stakes gate; fire-and-forget runner; SSE handler. |
| **Invocation store** | `server/platforms/invocationStore.mjs` | One SQLite row per invoke (`node:sqlite`, lazy singleton). Source of truth for status/output. |
| **Invocation bus** | `server/platforms/invocationBus.mjs` | In-process `EventEmitter` pub/sub — wakes open SSE streams without polling. |
| **Zones store** | `server/platforms/zonesStore.mjs` | Taxonomy (`zones.json`): labels, `highStakes`, agent→zone assignments, keyword `classifyZone`. |
| **Audit log** | `server/platforms/auditLog.mjs` | Append-only JSONL — every invoke, its outcome. |
| **Poll cache** | `server/platforms/cache.mjs` | TTL cache so cloud adapters don't hit AWS/K8s on every scan. |

---

## 3. Key data flows

**A. Presence (read path) — "who needs me?"**
`api.js GET /api/threads` → `apiMiddleware` → `scan.scanThreads()` → each detected adapter
(`scanThreads`) → local session files **or** Bedrock/K8s APIs (via `cache.mjs`) → union +
`disambiguateProjects` + `reconcileArchived` → JSON → SPA renders astronauts. **No writes.**

**B. Colony state (read/write) — sticky layout & settings**
`GET/PUT /api/state` ↔ `colony.json`. Browser owns the file and PUTs it whole; server does
optimistic concurrency on `baseUpdatedAt` (409 → client `merge-state.js` → retry). This is the
**one file the tool writes** for map/layout/settings.

**C. Open / new space (side-effecting, local)**
`POST /api/open` → adapter `openThread(ref)` → `present()` → `launch()` (OS deep link, or Linux
terminal fallback). `POST /api/new-project` additionally `mkdir`s a folder under
`HABITAT_CONTROL_PROJECTS_ROOT` before opening Claude Code — the one place the tool causes a
project to exist.

**D. Invocation (write path) — async + streaming**
`POST /api/invoke` → `invokeHandler` → `invokeAgent()`: look up adapter by `platformId`, resolve
zone, **high-stakes gate** (`confirmed:true` required, checked *before any row exists*), write a
`queued` row, return **202** immediately. Background `runInvocation()` (nothing awaits it) calls
`adapter.invokeAgent(ref, {prompt, onChunk})` → Bedrock native stream / K8s `/invoke` chunks →
each chunk `appendOutput` (SQLite) + `publish` (bus). Terminal `done`/`error` sets status and
writes one `auditLog` line.

**E. Streaming (read-back)**
`EventSource GET /api/invocations/:id/stream` → `streamInvocationHandler` emits a **`snapshot`
first** (from SQLite, so reconnects/late subscribers never miss where it landed), then
`subscribe`s to the bus for live `status`/`chunk`/`done`/`error`; closes on terminal.

---

## 4. Architectural properties (and where they live)

- **One adapter contract, two worlds.** Local harnesses and cloud platforms implement the *same*
  `{id,name,detect,scanThreads,openThread,newSession}` shape (`harnesses/index.mjs` concatenates
  `PLATFORMS`), so a Bedrock agent renders as an astronaut with no cloud-specific UI code. Adding
  a harness = one file + one line.
- **Read-mostly by construction.** The entire discovery path never writes a harness record;
  writes are confined to `data/` (colony/zones/sqlite/log) and to `mkdir`/OS-open side effects.
- **Trust boundary is a single choke point.** `isLocalRequest()` (Host + Origin, applied once at
  the top of `apiMiddleware`) is the whole defense — sized for a localhost read-mostly viewer.
  The write surface (invoke, new-project) rides the *same* guard, which is why any tunneled
  exposure is gated on the trust-model ADR (SPEC §P2.4).
- **Single-process assumptions are load-bearing.** In-memory `invocationBus` and the
  lazy-singleton SQLite connection encode "one process, one user." Multi-process would require
  replacing both (SPEC §P2.3) — documented so it isn't tripped over.
- **SQLite = truth, bus = notification.** The bus only carries post-subscribe events; anything
  durable comes from the store's snapshot. A restart loses listeners, never state.

---

## 5. Trade-offs worth revisiting as it grows

| Decision | Why now | Revisit when |
| --- | --- | --- |
| In-memory pub/sub | Zero deps, perfect for one process | Second process / HA → Redis/NATS or DB polling |
| Lazy-singleton SQLite | Node built-in, no server | Concurrent writers, or volume beyond one user → Postgres (arch §7) |
| Host/Origin as sole auth | Localhost-only threat model | Any exposure beyond loopback → bearer/Access + move high-stakes off a body flag |
| Live discovery as registry | No hand-maintained table | Invoking an agent `scanThreads()` never saw → real `endpoint_ref`/`auth_ref` registry |
| `HABITAT_CONTROL_DATA` resolved in 4 files | Grew organically | Now → one `config.mjs` (SPEC §P1.6, ends the drift) |

---

*Diagram renders on GitHub and any Mermaid viewer. Regenerate this doc whenever an adapter is
added or a store/route changes shape.*
