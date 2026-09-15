# Habitat Control — Design System

> The HUD's visual language: tokens, components, and the audit that ranks what to fix next.
> Everything here lives in [`bot-views/src/ui/styles.css`](bot-views/src/ui/styles.css) and is
> built in [`bot-views/src/ui/hud.js`](bot-views/src/ui/hud.js). All chrome is dismissible with
> `H` — nothing in the HUD may ever be load-bearing for reading the colony's state; the 3D
> scene is the source of truth.

## Design tokens

Defined once on `:root`. The palette is strong; the **scale** dimensions (spacing, type,
motion) are not yet tokenized — see the audit.

| Token | Value | Role |
|---|---|---|
| `--bg` | `#0a0b0f` | Page/scene ground |
| `--panel` | `rgba(16,17,22,0.82)` | Glass panel fill (with `backdrop-filter`) |
| `--panel-solid` | `#14151b` | Opaque panel fill |
| `--line` / `--line-strong` | `rgba(255,255,255,0.09 / 0.16)` | Hairline borders |
| `--text` / `--muted` / `--dim` | `#f2f0ec` / `#9b9aa3` / `#6f6e78` | Text hierarchy |
| `--accent` | `#c96442` | The one accent — only ever the *immediate* action |
| `--green` `--blue` `--amber` `--red` `--teal` | see file | Semantic hues |
| `--radius` | `14px` | Panel radius (components use smaller one-offs) |
| `--shadow` | 2-layer | Panel elevation |

**State palette** (astronaut/thread status) is currently expressed as raw hexes, duplicated
across `.stat.*` and `.side .thread.*`: `working #7fd39a`, `waiting #8fb4ee`, `blocked #e88b8b`,
`done #e6c67f`, `idle #b6b5be`/`#7c7b86`. This should become `--state-*` tokens (see audit #4).

## Components

Buttons, toggle, select, text-input, slider, chip, planet-picker, stat pill, thread row, repo
row, toast, thread-pop card, help sheet — plus the two added to close the invocation loop,
documented below.

### Component: Confirm Dialog

The branded, focus-trapped replacement for `window.confirm()`. One reusable overlay for any
yes/no decision; today it gates high-stakes invocations.

- **API:** `hud.confirm({ title, message, prompt?, danger?, okLabel?, cancelLabel? }) → Promise<boolean>`
- **Anatomy:** title · message · optional `prompt-echo` (verbatim quote of what is about to be
  sent, accent left-border) · Cancel + Confirm.

| State | Behavior |
|---|---|
| Open | Backdrop blur; focus moves to the safe button (Cancel when `danger`, else Confirm) |
| Keyboard | `Esc` cancels; `Tab`/`Shift+Tab` trap between the two buttons; `Enter` confirms **only when not `danger`** |
| `danger` variant | Confirm button uses `.btn.danger` (red); `Enter` deliberately does **not** fire it — a high-stakes action must be reached for |
| Backdrop click | Cancels |
| Close | Restores focus to the previously focused element; resolves the promise |

**Accessibility:** `role="dialog"`, `aria-modal="true"`, `aria-labelledby` → title. Focus trap
+ focus restore implemented. **Do:** echo the exact payload for a destructive action. **Don't:**
bind `Enter` to a destructive confirm.

### Component: Result Panel (streaming reply)

Lives inside the thread-pop card. The agent's reply streams in here and **persists across
re-selecting the thread**, replacing the old fire-and-forget toast that sliced output to 140
chars and lost it.

- **API:** `hud.setResult(threadId, { status, output, error } | null)` — updates the store and
  repaints if that thread is selected. State is kept per-thread in `hud._results`.
- **Fed by:** the SSE stream (`snapshot` / `status` / `chunk` / `done` / `error`) in
  [`main.js`](bot-views/src/main.js)'s `askAgent`, accumulating `chunk.text` as it arrives.

| Status | Dot | Body |
|---|---|---|
| `queued` | muted | "Queued…" (italic, dim) |
| `running` | green, pulsing | live text, auto-scrolled to bottom |
| `done` | blue | full reply (or "Done — no output") |
| `error` | red | error message, red text |

**Accessibility:** body is `aria-live="polite"` so a screen reader announces the reply; the
`.toasts` region is now `aria-live` too. Copy button appears once there is output.

## Audit (2026-09-15)

**Components reviewed:** 12 · **Score: 68/100 → 74/100** after the result-loop work below.

The visual layer is coherent and strong; the score is held down by **missing scale tokens** and
by components the newest flow (invocation) needed. Two of those are now built.

### Token coverage
| Category | Defined | Gaps |
|---|---|---|
| Colors | ~13 | State palette hardcoded **twice** and already diverged (`idle` differs between stat pill and thread row) |
| Spacing | **0** | Every padding/gap is an arbitrary px literal |
| Typography | **0** | ~15 hardcoded `font-size` values; no weight tokens |
| Radius | 1 | 8 one-off radii |
| Motion | **0** | Durations and the shared easing repeated inline |

### Priority actions
1. ✅ **Confirm dialog** — done (replaces `window.confirm`).
2. ✅ **Streaming result panel** — done (replaces the truncated toast; `aria-live` added).
3. ⬜ **Invocation status → astronaut** (P1.1 in [`SPEC.md`](SPEC.md)) — flip the 3D astronaut
   idle→running→done on *your* prompt, and add a status chip; today the card's progress bar is
   transcript size, not invocation state.
4. ⬜ **Scale tokens + palette consolidation** — add spacing/type/motion scales and fold the
   duplicated state colors into `--state-*` tokens (fixes the `idle` divergence). The substrate
   that makes future components consistent instead of eyeballed.
5. ⬜ **Button polish** — `:focus-visible` added (a11y); still to do: hoist `:disabled` out of
   the sidebar-only scope so it applies everywhere.

### Fixed in this pass
- `.btn:focus-visible` — the primary action surface had no visible keyboard focus.
- `.toasts` + result body made `aria-live` — invocation results/errors are now announced.
