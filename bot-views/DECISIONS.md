# Decisions

Things that are settled, and why. If a PR argues with one of these, the PR is not wrong — but
it needs to argue with the reason rather than work around it.

Written down because the same questions kept arriving one PR at a time, and answering them
per-PR was producing a codebase with three answers to each.

## Habitat Control never writes to a harness

Never into a harness's own records — not a transcript, not a session file, not one flag. That
rule is absolute and predates this section.

It is no longer true that `data/colony.json` is the *only* file this project ever writes,
though: `/api/new-project` creates a plain empty folder under its own configured projects root
when you explicitly ask it to add a new hex space (see the README's "Adding one"). That folder
is not a harness's territory — nothing is being read from or altered inside Claude Code's, or
any other harness's, own store — so the rule above still holds. What changed is narrower: this
project can now cause a *new* project to exist on disk, at a location you named, because you
asked it to. It cannot write anywhere else, and it still cannot touch anything a harness already
owns.

It used to write one flag — `isArchived` on Claude Code's own session record. That write landed
on disk, and still looked broken: the desktop app serves from the copy of its records it loaded
at launch, so a thread you archived here stayed put in its own list until the app restarted, and
the app rewrote the record from memory the next time it touched the thread. Holding that
together took a re-assert on every scan, a `ps` sweep to guess whether the app had re-read the
file, and a *pending* state for the gap between them.

So archiving is the colony's own bookkeeping now. The astronaut walks back to the ship exactly
as before, and archiving in the harness's own UI still sends it home too, because the scan reads
that flag. `setArchived` is not part of the adapter interface and adding one back is a bug.

## Nothing is read from or executed inside another application's bundle

Only files under the user's own home directory.

This is not a style preference. An adapter that fell back to
`/Applications/ChatGPT.app/Contents/Resources/codex` and ran it set off a Gatekeeper malware
alert on the maintainer's machine and moved both Codex.app and ChatGPT.app to the Trash —
nothing was wrong with either, but OpenAI's macOS signing certificate had been revoked after the
Axios npm compromise, and macOS's answer to *executing* a binary under a revoked cert is to
block it and bin the app. It also cost five seconds on the first scan while macOS decided.

`claude-code.mjs` used to mention `/Claude.app/Contents/MacOS/Claude`, but that was matching a
string in `ps` output to spot a running process, never launching anything. That code is gone
now anyway; the scan starts no subprocess at all.

## Opening a thread may run a command; nothing else may

Opening is the one place a subprocess is allowed, because there is no other way to hand a
session back on a machine with no desktop app. It goes through a URL the OS resolves, or a
binary the user already has on `PATH` — never a path we guessed inside an app.

## There is one way for an adapter to say "open this"

`openThread(ref)` and `newSession(dir)` return `{ ok, url, command }`, either may be async, and
the server decides what to do with it:

- **macOS and Windows** — the URL goes to the OS opener. A scheme the harness's app registers is
  always answered there, so nothing is probed.
- **Linux** — the scheme is checked with `xdg-mime` first, because `xdg-open` on a scheme nobody
  claims exits quietly and used to reach the page as "Opened". Failing that, `command` runs in a
  terminal. Failing that, the page is told the truth.

`command` is `{ argv, cwd }` with an absolute `argv[0]`. No harness knowledge reaches
`launch()` — that seam is the reason `server/harnesses/` is swappable at all.

## `sizeBytes` is bytes

Every harness has a transcript file; not all of them report tokens, and a CLI-only session
often has no token count at all. The field is a shared log scale across the whole map, so
mixing units would make one harness's buildings taller than another's for the same work.

## Thread ids are prefixed

`claude-code:<uuid>`, `codex:<uuid>`. Two UUIDs will not collide, but the colony keys its
archive list and saved layout on this string, and it is worth being unambiguous rather than
merely lucky. `colony.json` v1 files are migrated on read — only Claude Code ever wrote a bare
id, so the rewrite is unambiguous.

## A harness that cannot read its own store says so

Optional `diagnostic()` on an adapter returns a sentence, or `''`. Without it the failure mode
is a harness that reports `detected: true`, throws inside `scanThreads` on every poll, and looks
perfectly healthy in the HUD while contributing nothing.

## Pull requests are treated as feature requests

Contributions are read closely and their intent is usually implemented directly, rather than
merged branch-by-branch. Nine adapters and fixes arriving at once produced five mutually
incompatible widenings of the same interface; taking the intent and writing one version keeps
the codebase coherent and is faster than negotiating each PR to a common shape.

That means a PR can be closed unmerged and still be the reason something shipped. Where that
happens the commit says so and the contributor is credited by name. It is a worse deal for
contributors than merging their commit, and it is written down here so nobody has to discover
it from a closed tab.

## High-stakes confirmation stays a browser flag; the remote defense is a token

The `confirmed: true` gate on a high-stakes invocation is a flag the page sets, and it stays
one. Its job is to stop a *reflexive click* by the person at the keyboard, and for that it is
enough. It is deliberately **not** hardened against a malicious or compromised page in the
user's own browser — that page satisfies the same-origin check and could set the flag itself.

Out-of-band confirmation — the server printing a one-time code the user has to echo back — was
considered and rejected (ADR-001, Option C). It defends a threat outside the decided bar (a
compromised local browser) at the cost of friction on every legitimate high-stakes call, and it
does nothing for the problem that actually motivated the review: an unauthenticated *remote*
caller once the tool is served beyond localhost. That problem is answered by a shared-secret
bearer token on state-changing routes, mandatory once bound off-loopback — see
[`../ADR-001-trust-model.md`](../ADR-001-trust-model.md), which is Accepted. If a PR proposes
re-hardening the confirm step, it needs to argue with this reason, not work around it.
