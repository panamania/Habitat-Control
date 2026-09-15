# Backlog

Engineering backlog for this fork. No project tracker is connected to this session (Linear,
Jira, ClickUp, Monday, and Asana all need authorization first) — this file is the tracker until
one is. Items came out of an architecture review; see each item's own reasoning rather than a
separate design doc.

Format: **Now** (do next) / **Next** (queued, not started) / **Later** (worth doing, no pressure).
No dates or owner — single-maintainer project — just what's queued and why.

## Now

### Resolve the nested git histories under `bot-views/`
**Risk if left:** Medium — a contributor working inside `bot-views/` can commit to
`Station-Sciences/bot-crossing` (its own separate remote) while believing they're committing to
`panamania/Habitat-Control`. No warning exists today.
**Effort:** Low
**Fix:** either document it loudly (one line in the top-level README) or resolve it properly —
absorb `bot-views/`'s history into the outer repo (`git subtree`/`filter-repo`) or delete its
inner `.git` now that the files are vendored as plain tracked content.

### Write the trust-model ADR
**Risk if left:** Medium-High — the localhost-bind + Host/Origin defense was sized for a
read-only viewer plus one JSON flag. The write surface has since grown to real agent invocation
and arbitrary-path folder creation (`/api/new-project`'s client-configurable `root`), and nobody
has re-asked whether the original defense still matches the current stakes.
**Effort:** Low to *write* the ADR (the fix itself is a separate, larger item once a direction is
picked — see Next).
**Options to weigh:** leave as-is and document the trust boundary louder; add a lightweight
shared-secret/bearer check in front of state-changing routes; move high-stakes confirmation out
of a body flag the browser controls unilaterally.

## Next

### Centralize scattered env-var config
**Risk if left:** Low, but real drift risk — `HABITAT_CONTROL_DATA`'s default path is
independently recomputed in four files (`api.mjs`, `auditLog.mjs`, `invocationStore.mjs`,
`zonesStore.mjs`), each via a different relative-path depth. They agree today by care, not by
construction. `HABITAT_CONTROL_HOST`, `_PROJECTS_ROOT`, and `_CURSOR_PROJECTS` repeat the same
one-off `process.env.X || default` shape elsewhere.
**Effort:** Low
**Fix:** one `server/lib/config.mjs` exporting every resolved path/host once. Bonus: becomes the
one place documenting the full env-var surface.

### Extract the duplicated test server harness
**Risk if left:** Low, mechanical — `withServer()` (mkdtemp, cache-busted import, real HTTP
server, teardown) is copy-pasted near-verbatim across `state.test.mjs`, `invoke.test.mjs`, and
`new-project.test.mjs`. It already carries one non-obvious lesson (a cleanup failure must never
clobber a real assertion error) that's only written down in one of the three copies.
**Effort:** Low
**Fix:** `test/helpers.mjs`, shared.

### Ship whatever the trust-model ADR decides
Depends on the ADR above landing first — sizing depends entirely on which option gets picked.

## Later

### Extract a route table out of `server/api.mjs`
**Risk if left:** Low today, growing — 568 lines, one `if/else` chain, and every recent feature
(invoke, invocations, new-project) added another branch to it. `platforms/apiRoutes.mjs`
already shows the alternative (handlers separated from routing) but the original routes never
moved to that shape.
**Effort:** Medium
**Trigger to actually do it:** next unrelated feature that would otherwise add a fourth or fifth
concern to the same file, or the file crossing ~700-800 lines.

### Re-check the single-process assumptions before ever scaling past one
**Risk if left:** Low today — `invocationBus.mjs` (in-memory pub/sub) and
`invocationStore.mjs`'s lazy-singleton SQLite connection both assume exactly one process,
forever, and are documented as such. Fine for a localhost single-user tool. Only becomes a
problem if this ever needs to run as more than one process.
**Effort:** Unknown until it's actually needed — no work now, just don't forget the assumption
is load-bearing.
