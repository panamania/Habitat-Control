# ADR-001: Trust model for state-changing routes when exposed beyond localhost

**Status:** Proposed
**Date:** 2026-09-15
**Deciders:** Maintainer (panamania/Habitat-Control)
**Resolves:** [`bot-views/BACKLOG.md`](bot-views/BACKLOG.md) → "Write the trust-model ADR"
**Related:** [`SPEC.md`](SPEC.md) §Requirements P0.9 / P2.1 · [`HABITAT_CONTROL_ARCHITECTURE.md`](HABITAT_CONTROL_ARCHITECTURE.md) §5

## Context

Every `/api/*` request passes through one uniform gate — [`isLocalRequest()`](bot-views/server/api.mjs:397)
— before any route runs. It is three layers: bind `127.0.0.1`, check `Host` (stops DNS
rebinding), check `Origin` (stops cross-site CSRF; a state-changing request with no `Origin`
is refused). This proves exactly one thing: *the request came from this server's own page, in
a browser, on this machine.*

Three forces now pull against that gate:

1. **The write surface grew.** The gate was sized when the only state change was one
   `isArchived` flag plus a whole-file `colony.json` PUT. It now also guards
   `POST /api/invoke` — telling a real Bedrock or self-hosted K8s agent to *do something*,
   including in a zone marked `highStakes` (e.g. `asx-trading`, `banking-support`) — and
   `POST /api/new-project`, which creates a folder at a **client-named absolute path**. Nobody
   re-asked whether same-origin is the right bar for those.

2. **The high-stakes gate is browser-controlled.** The `confirmed: true` requirement for a
   high-stakes invocation is a boolean in the request body the page sets
   [unilaterally](bot-views/server/api.mjs:514). It stops a *reflexive human click*. It does
   not stop a page that satisfies same-origin and simply sets the flag itself.

3. **Exposure beyond localhost is a real goal** (decided — see SPEC §Timeline Phase 3). The
   moment the server is served over a Cloudflare Tunnel / on `HABITAT_CONTROL_HOST`, anyone who
   reaches the hostname reaches `/invoke`. The Host/Origin check was never designed for a
   tunnel forwarding a public name to the server — a request from a legitimately-served remote
   page carries a same-origin `Origin`, so same-origin alone can no longer distinguish "my
   page" from "an attacker's request to the same public origin."

### Constraints / non-functional requirements

- **Zero-config local experience must survive.** Today the tool boots clean and useful with no
  configuration; the local single-user path must not regress into a setup chore.
- **Fail closed on exposure.** If the tool is reachable off-machine, the stronger check must be
  *mandatory*, not opt-in — a misconfiguration should refuse to serve, not serve nakedly.
- **Threat bar (decided):** the high-stakes confirmation defends against *reflexive clicks by
  an honest user on an uncompromised machine* — **not** against a compromised/malicious page in
  the user's own browser. (This scopes Option C out; see below.)
- Single-maintainer, single-user tool; solutions must be cheap to operate and not assume a
  multi-user identity system (that is a separate future initiative, SPEC P2.3).

## Decision

Adopt **Option B — a shared-secret bearer token required on state-changing routes — as a hard
prerequisite for any beyond-localhost exposure.** Concretely:

- Introduce `HABITAT_CONTROL_TOKEN`. When set, every state-changing route (`POST /api/invoke`,
  `POST /api/new-project`, `PUT` of `colony.json`, `/api/archive`, and any future write route)
  requires the token, presented as `Authorization: Bearer <token>` (or an `X-Habitat-Token`
  header) **in addition to** the existing Host/Origin check.
- **Fail closed when exposed.** If the server binds anything other than a loopback address
  (i.e. `HABITAT_CONTROL_HOST` is set to a non-loopback interface, or it is fronted by a
  tunnel), the token is **mandatory**: the server refuses to enable state-changing routes
  unless `HABITAT_CONTROL_TOKEN` is set. Bound to loopback with no token, behaviour is
  unchanged (same-origin only) — the zero-config local path is preserved.
- **Keep the same-origin gate** as defense-in-depth for the browser CSRF/rebinding case. The
  token is the factor that survives a public hostname; same-origin is the factor that stops a
  drive-by cross-site POST. They are complementary, not redundant.
- **Keep `confirmed: true` as-is**, as reflexive-click protection for the already-authenticated
  user. Do **not** move high-stakes confirmation out of band (Option C) — the decided threat
  bar does not include a compromised local browser, and out-of-band confirmation would tax
  every legitimate high-stakes call for a threat we chose not to defend against.
- **Token delivery to the page:** the server injects the token into its own served page (a
  bootstrap value the SPA reads and attaches to write requests) so the local experience needs
  no manual step; a remote device (tablet on the network) is given the token once. The token
  is **never** placed in a URL or query string.
- **Prefer edge auth as well, not instead.** When tunneled, put Cloudflare Access (or a
  bearer/mTLS check at the tunnel) in front too. The app-level token remains the invariant so
  the app is never nakedly exposed if the edge is ever misconfigured.

## Options Considered

### Option A: Document louder, change nothing
Keep the same-origin gate; state the localhost boundary more loudly; decline to expose.

| Dimension | Assessment |
|-----------|------------|
| Complexity | Low |
| Cost | ~none |
| Scalability | None — forecloses exposure |
| Team familiarity | Full (status quo) |

**Pros:** Cheapest; keeps a small, well-understood attack surface; nothing new to operate.
**Cons:** Directly contradicts the decided goal of serving beyond localhost; leaves the grown
write surface (invoke, folder creation) behind a check that was sized for a single flag.

### Option B: Shared-secret bearer token on state-changing routes *(chosen)*
Require `HABITAT_CONTROL_TOKEN` on writes, mandatory once bound off-loopback; keep same-origin.

| Dimension | Assessment |
|-----------|------------|
| Complexity | Medium |
| Cost | Low (one env var, a header check, page bootstrap) |
| Scalability | Good enough for single-user exposure; clean upgrade path to per-user auth later |
| Team familiarity | High — standard bearer-token pattern |

**Pros:** A real second factor beyond same-origin; a leaked tunnel hostname alone is not enough
to invoke an agent; fail-closed protects against accidental exposure; preserves the zero-config
local path; composes with Cloudflare Access at the edge.
**Cons:** Token lifecycle to manage (storage, rotation); scripting the API needs the header
(already needs `Origin`); a shared secret is coarse — it authenticates *possession of the
token*, not a specific user (acceptable for single-user; revisit for multi-user).

### Option C: Move high-stakes confirmation out of band
Server prints a one-time code to its own console/log; the user echoes it back to confirm a
high-stakes invocation, so a self-confirming malicious page cannot clear the gate.

| Dimension | Assessment |
|-----------|------------|
| Complexity | Medium |
| Cost | Medium (per-invocation friction) |
| Scalability | N/A |
| Team familiarity | Medium |

**Pros:** Defends the one path (high-stakes invoke) even against a compromised local browser.
**Cons:** Defends against a threat explicitly out of the decided bar (compromised local
browser); adds friction to every legitimate high-stakes call; does nothing for the remote-
exposure problem, which is the actual driver. **Rejected**, recorded here so it is not
re-litigated.

## Trade-off Analysis

The core tension is **zero-config convenience vs. safe exposure.** Option A keeps convenience
by refusing the goal. Option B keeps convenience *for the local path* while making the exposed
path safe and fail-closed — it splits the difference along exactly the axis that matters (bound
to loopback vs. reachable off-machine). Option C solves a different problem (a compromised local
browser) than the one exposure creates (an unauthenticated remote caller), and at a cost the
decided threat bar doesn't justify.

Same-origin and the bearer token defend different attacks and are kept together: same-origin
stops a cross-site browser POST; the token stops a direct remote request to a now-public origin.
Neither subsumes the other.

## Consequences

- **Easier:** Habitat Control can be served over a tunnel or to the home network without
  leaving `/invoke` open to anyone who learns the hostname. Accidental exposure fails closed.
- **Easier:** unblocks SPEC Phase 3 / P2.1 (real deployment topology) and settles the backlog's
  trust-model ADR.
- **Harder:** there is now a token to store, deliver to the page, and rotate; the "just run it"
  story gains one step *for the exposed case only*.
- **Harder:** API scripting must send the token header as well as `Origin`.
- **To revisit:** if the tool ever goes multi-user (SPEC P2.3), a single shared secret is no
  longer the right grain — graduate to per-user identity (Cloudflare Access / OIDC). The token
  is the bridge, not the destination.
- **Unchanged:** the "never writes to a harness" invariant, the `confirmed: true` high-stakes
  flag, and the entire read path.

## Action Items

1. [ ] Add `HABITAT_CONTROL_TOKEN` support: a helper that checks `Authorization: Bearer` /
       `X-Habitat-Token` on state-changing methods, layered after `isLocalRequest()`.
2. [ ] Fail-closed gate: refuse to enable write routes when bound off-loopback with no token.
3. [ ] Inject the token into the served page bootstrap; have `src/game/api.js` attach it to
       every write request. Never in a URL/query string.
4. [ ] Update the README "Keeping it local" section and the env-var surface (fold into the
       planned `server/lib/config.mjs`, BACKLOG "Centralize scattered env-var config").
5. [ ] Tests: token required/optional by bind address; write route refused without token when
       exposed; same-origin still enforced; `confirmed: true` behaviour unchanged.
6. [ ] Document the Cloudflare Access / edge-auth recommendation alongside the tunnel setup
       (SPEC P2.1).
7. [ ] Record the rejection of Option C in [`bot-views/DECISIONS.md`](bot-views/DECISIONS.md)
       once this ADR is Accepted, so it is not reopened per-PR.
