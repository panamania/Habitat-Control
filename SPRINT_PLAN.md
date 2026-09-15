# Habitat Control — Multi-Sprint Plan

> **Cadence:** 2-week sprints · **Team:** 1 (maintainer) · **Capacity:** evenings/weekends,
> ~9h/week → ~18h/sprint, planned to ~75% ≈ **5 committed points + ~2 stretch** per sprint.
> **Point scale:** 1 pt ≈ 2–3h of focused solo work.
> **Sources:** [`SPEC.md`](SPEC.md) · [`bot-views/BACKLOG.md`](bot-views/BACKLOG.md) ·
> [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md) · [`ADR-001-trust-model.md`](ADR-001-trust-model.md)
> **Priority rule (locked):** UI functionality first → hygiene/enablers → breadth →
> **all exposure/beyond-localhost work last**.

## Already shipped (last session — not re-committed)

P1.2 branded confirm dialog · P1.3 streaming result panel · `.btn:focus-visible` + `aria-live`
(a11y) · ADR-001 written (Proposed) · spec reprioritized · `DESIGN_SYSTEM.md`. These are the
carryover context; the loop is half-closed (card reacts, astronaut doesn't — that's Sprint 1).

## Capacity model

| | Per sprint |
|---|---|
| Gross hours (~9h/wk × 2) | ~18h |
| Planned to ~75% | ~13–14h |
| Committed points (≈2.5h each) | **~5** |
| Stretch (cut first) | ~2 |

Solo project: **owner is the maintainer for every item** — the tables below omit an owner column.

---

## Sprint 1 — Finish the invocation loop in-world
**Dates:** Mon Sep 21 – Fri Oct 2, 2026
**Goal:** An invocation you fire is legible on the astronaut itself, not only in its card.

| Priority | Item | Est | Dependencies |
|---|---|---|---|
| P0 | **P1.1** — wire live invocation status into the astronaut (`idle→running→done`) + a status chip; separate invocation state from the transcript-size progress bar (`colony.js`, `main.js`) | 5 | Builds on last session's `setResult` plumbing |
| P0 | Flip **ADR-001 → Accepted**; record the Option-C rejection in `DECISIONS.md` (ADR action item #7) | 0.5 | ADR-001 |
| Stretch | Hoist `.btn:disabled` out of the sidebar-only scope so it applies everywhere (audit #5) | 0.5 | — |

**Load:** 5.5 committed + 0.5 stretch (~110% — P1.1 is the flagship functional item and worth
filling the sprint). **Risk:** touching the 3D behavior precedence — keep the strict
first-match-wins order intact; invocation-`running` must not mask a real `errored`/`unread`.

---

## Sprint 2 — Design substrate + contributor safety
**Dates:** Mon Oct 5 – Fri Oct 16, 2026
**Goal:** The design system has real scale tokens, and the repo stops being a wrong-remote footgun.

| Priority | Item | Est | Dependencies |
|---|---|---|---|
| P0 | **Audit #4** — add spacing/type/motion scale tokens; fold the duplicated state colors into `--state-*` (fixes the `idle` divergence) | 4 | — |
| P0 | **Resolve nested git histories** under `bot-views/` — decide (absorb via subtree/filter-repo, or delete the inner `.git`) and execute (BACKLOG "Now") | 2 | Decision first |
| Stretch | — (buffer; tokens carry visual-regression risk) | — | — |

**Load:** 6 committed (~120%). Tokens are incremental, so a partial carry into Sprint 3 is
acceptable — that's the buffer. **Risk:** token refactor causing visual regressions — do it
value-by-value with a screenshot pass; the git surgery is one-way, so branch and verify
`git ls-files` before/after.

---

## Sprint 3 — Config + test harness (the enablers)
**Dates:** Mon Oct 19 – Fri Oct 30, 2026
**Goal:** One config module and one shared test harness — the substrate every later feature and
the exposure work sits on.

| Priority | Item | Est | Dependencies |
|---|---|---|---|
| P0 | **P1.6 / BACKLOG** — `server/lib/config.mjs` resolving every env var/path once (ends the 4-file `HABITAT_CONTROL_DATA` drift; documents the full env surface) | 3 | Prereq for the exposure work (Sprint 5) |
| P0 | **BACKLOG** — extract the copy-pasted test server harness into `test/helpers.mjs` | 2 | Enables cleaner adapter/route tests |
| Stretch | **BACKLOG (Later)** — extract a route table out of `server/api.mjs` (568-line if/else) | 3 | Opportunistic; fits the "server internals" theme |

**Load:** 5 committed + 3 stretch. **Risk:** the SQLite/store's single-process lazy-open
convention must survive the config refactor (see `invocationStore.mjs`'s `EBUSY` lesson).

---

## Sprint 4 — Breadth: more harnesses
**Dates:** Mon Nov 2 – Fri Nov 13, 2026
**Goal:** Broaden coverage — pick the new-space harness, and land the first one or two new adapters.

| Priority | Item | Est | Dependencies |
|---|---|---|---|
| P0 | **P1.5** — let "add a hex space" target any detected harness, not hardcoded Claude Code (UI picker + `src/game/api.js`) | 2 | — |
| P0 | **P1.4** — first new adapter (suggest **OpenCode**): one file in `server/harnesses/` + one line in `index.mjs` | 3 | Test harness (Sprint 3) |
| Stretch | **P1.4** — second adapter (suggest **Amp** or **Aider**) | 3 | Same |

**Load:** 5 committed + 3 stretch. Remaining adapters (Aider/Goose/Qwen/Amazon Q/Antigravity)
go to the **backlog pool** — one or two per future sprint, demand-driven. **Risk:** an adapter
that needs to widen the harness contract — if so, stop and fix the seam (per `DECISIONS.md`),
don't work around it.

---

## Sprint 5 — Exposure ①: authenticate the write surface *(lowest-priority group begins)*
**Dates:** Mon Nov 16 – Fri Nov 27, 2026
**Goal:** Implement the ADR-001 decision so the tool *can* be exposed safely — bearer token,
fail-closed. Nothing above depends on this; it starts only now, by design.

| Priority | Item | Est | Dependencies |
|---|---|---|---|
| P0 | Resolve the open **token-lifecycle** sub-question (rotation + how a network device receives the token) | 1 | — |
| P0 | **ADR-001 #1–2** — `HABITAT_CONTROL_TOKEN` check on state-changing routes + fail-closed gate when bound off-loopback | 3 | `config.mjs` (Sprint 3) |
| P0 | **ADR-001 #3** — inject the token into the served page; client attaches it to writes (never in a URL) | 2 | Above |
| Stretch | **ADR-001 #5** — tests: token required/optional by bind address; write refused when exposed without it | 2 | Above |

**Load:** 6 committed + 2 stretch. **Risk:** breaking the zero-config localhost path — the token
must be *optional on loopback* and only mandatory off-loopback; guard with tests.

---

## Sprint 6 — Exposure ②: harden + document
**Dates:** Mon Nov 30 – Fri Dec 11, 2026
**Goal:** Finish the auth story and begin real deployment topology.

| Priority | Item | Est | Dependencies |
|---|---|---|---|
| P0 | **ADR-001 #4, #6** — update README "Keeping it local" + env surface; document Cloudflare Access / edge-auth alongside the tunnel | 2 | Sprint 5 |
| P0 | Carry any ADR-001 tests not finished in Sprint 5 | 2 | — |
| P1 | **P2.1 (begin)** — Cloudflare Tunnel + in-cluster Deployment/Service scaffolding; revisit the Host/Origin check for a tunneled hostname | 3 | Needs real infra |
| Stretch | — | — | — |

**Load:** ~4 committed + P2.1 spillover. **Risk:** P2.1 is infra/ops-heavy and needs a real
cluster + tunnel — it will span into the backlog pool; treat this sprint as *starting* it, not
finishing it.

---

## Backlog pool (not scheduled — pull when a sprint has room or a trigger fires)

| Item | Source | Why unscheduled |
|---|---|---|
| **P2.1 full deployment topology** (in-cluster control-plane, IAM-secret-as-K8s-Secret, tunnel) | SPEC / ARCH §5 | Multi-sprint, infra-heavy; begins Sprint 6, finishes here |
| **P2.2 Azure AI Foundry + GCP Vertex adapters** (~3 pts each) | SPEC | Same contract; deferred with AWS+K8s as agreed v1 scope |
| **Remaining P1.4 adapters** (Aider, Goose, Qwen, Amazon Q, Antigravity) | SPEC | Long tail; demand-driven, 1–2 per future sprint |
| **P2.3 multi-process / team operation** | SPEC / BACKLOG | Explicitly *not now* — the single-process assumption is load-bearing and documented; only when a concrete reason retires it |
| **Decision: high-stakes taxonomy** (boolean vs. per-action stakes) | SPEC open Qs | Resolve before it blocks a real high-stakes agent |
| **Decision: cloud "running" visual** (no local transcript to size a building from) | SPEC open Qs | Resolve alongside P1.1 or the first heavy cloud use |

---

## Definition of Done (every item)
- [ ] Code reviewed (self-review or `/code-review`) and merged to `main`
- [ ] `npm test` green (currently 54/54)
- [ ] Observable changes verified in the browser preview (per the repo's verification workflow)
- [ ] Relevant doc updated (`SPEC.md` / `DESIGN_SYSTEM.md` / `ADR` / `README`)
- [ ] Committed and pushed per `CLAUDE.md`

## Key dates
| Date | Event |
|---|---|
| Mon Sep 21 | Sprint 1 start |
| Fri Sep 25 | S1 mid-sprint check-in |
| Fri Oct 2 | S1 end / self-demo / retro |
| …every 2 weeks | repeat through Sprint 6 (ends Fri Dec 11) |

## Timeline at a glance
```
S1  Invocation loop in-world (P1.1)              ── functional priority
S2  Design tokens + nested-git fix
S3  Config module + test harness (enablers)
S4  New-space harness choice + first adapters
────────────────────────────────────────────────  ▲ everything above ships first
S5  Exposure ①: bearer token + fail-closed       ── lowest priority begins
S6  Exposure ②: docs + deployment topology start
pool  P2.1 full topology · Azure/GCP · more adapters · multi-process
```
~12 weeks (Sep 21 – Dec 11) covers UI, hygiene, breadth, and the exposure *auth* work; full
deployment topology and cloud adapters continue from the pool.
