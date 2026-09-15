import { mergeState } from './merge-state.js'

async function req(url, options) {
  const res = await fetch(url, options)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(body.error || `${res.status} ${res.statusText}`)
    // Purely additive — everything that already calls req()/post() only ever reads
    // `.message`. /api/invoke's 409 needs the rest of the body (requiresConfirmation,
    // zoneId) to tell "resend with confirmed: true" apart from an ordinary failure.
    err.status = res.status
    Object.assign(err, body)
    throw err
  }
  return body
}

const post = (url, payload) =>
  req(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

export const fetchThreads = () => req('/api/threads')

/**
 * The colony file, and the base every later save is measured against.
 *
 * `baseUpdatedAt` is the file version this tab last agreed with; `baseSnapshot` is the state as
 * it looked at that moment. The snapshot is the half that matters: without it a conflicted save
 * can only union the two lists, and a union can never express "I un-archived this".
 */
let baseUpdatedAt = 0
let baseSnapshot = null

function adoptBase(state, updatedAt) {
  baseUpdatedAt = Number(updatedAt ?? state?.updatedAt) || 0
  // Cloned, because the page mutates the object it holds. Sharing the reference would let
  // `local` and `base` drift into being the same thing, which reads as "this tab changed
  // nothing" and quietly turns every save back into last-writer-wins.
  baseSnapshot = structuredClone(state)
}

export const fetchState = async () => {
  const state = await req('/api/state')
  adoptBase(state)
  return state
}

/** Enough attempts to get through a burst of saves from another tab, and no more. */
const SAVE_TRIES = 3

/**
 * Save the colony, merging rather than clobbering if another tab got there first.
 *
 * The server answers 409 with what is on disk when this tab's base is stale. That is not a
 * failure to report at the user — it is the normal shape of two tabs being open — so it is
 * merged and re-sent here. The base for the next attempt is the disk state just merged against,
 * which keeps a retry from re-applying edits it has already folded in.
 *
 * Returns the state the caller should hold from now on: the *same object* when nothing
 * conflicted, so the common path never swaps the page's state out from under a click that
 * happened mid-flight, and only a real merge hands back something new.
 */
export async function saveState(state) {
  let local = state
  for (let attempt = 0; attempt < SAVE_TRIES; attempt++) {
    const res = await fetch('/api/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...local, baseUpdatedAt }),
    })
    const body = await res.json().catch(() => ({}))

    if (res.status === 409) {
      local = mergeState(baseSnapshot, local, body)
      adoptBase(body)
      continue
    }
    if (!res.ok) throw new Error(body.error || `${res.status} ${res.statusText}`)
    adoptBase(local, body.updatedAt)
    return local
  }
  // Losing three times running means the other tab is saving faster than we can merge. The
  // caller swallows this: nothing local is lost, and the next save tries again.
  throw new Error('Could not save the colony — another tab kept writing first')
}

/**
 * Hand a thread back to whichever harness owns it — the desktop app comes forward on its own.
 *
 * `ref` is opaque here on purpose: it is whatever that harness's adapter needs to find the
 * thread again, and the browser only ever passes it straight back. Nothing in the UI knows
 * what a Claude Code session id, or a Codex rollout id, actually looks like.
 */
export const openThread = (thread) => post('/api/open', { harness: thread.harness, ref: thread.ref })

/** A brand new thread in a repo, via that harness's own new-session deep link. */
export const newSession = (folder, harness) => post('/api/new-session', { folder, harness })

export const revealFolder = (folder) => post('/api/reveal', { folder })

/**
 * Create a brand-new hex space: an empty folder under the server's own projects root, with a
 * fresh Claude Code session opened in it. There's no existing thread to discover a zone from
 * here — every other zone is found, not made — so this is really "start a project"; the hex
 * itself is just what that looks like once scanThreads() finds the session it left behind.
 */
export const newProject = (name) => post('/api/new-project', { name, harness: 'claude-code' })

// ── platform zones + invoke ────────────────────────────────────────────────────────────
// Added on top of the original read-only contract above — everything above answers "what's
// out there", these answer "reorganise the taxonomy" and "tell an agent to do something".

export const fetchZones = () => req('/api/zones')

/**
 * Ask an agent to do something. `thread` is whatever the colony already has for the
 * selected astronaut — its harness id and opaque `ref` are forwarded exactly as `openThread`
 * forwards them, the caller never needs to know what a Bedrock sessionId or a pod's
 * invoke-url annotation actually looks like.
 *
 * A high-stakes zone answers 409 with `requiresConfirmation: true` instead of running the
 * prompt — that's not a normal failure, it's the server asking to be told again on purpose.
 *
 * Resolves as soon as the server has accepted the prompt, not when the agent has answered
 * it: `{ ok, invocationId, status: 'queued' }`, per the 202 the server sends. Pass
 * `invocationId` to `subscribeInvocation` to watch it move to running/done/error.
 */
export const askAgent = (thread, prompt, confirmed = false) =>
  post('/api/invoke', {
    platformId: thread.harness,
    agentIdentifier: thread.title,
    ref: thread.ref,
    prompt,
    confirmed,
  })

/**
 * Live updates for one invocation, over the server's SSE channel. `onEvent` gets called
 * for everything the server sends — `{type:'snapshot'|'status'|'chunk'|'done'|'error', ...}`
 * — including a `snapshot` first, which is what a caller sees if the invocation had already
 * moved on by the time it subscribed (queued and done can both happen inside one network
 * round trip for a fast agent). The stream closes itself once it reaches done or error, on
 * both ends; call the returned function to stop listening any earlier.
 */
export function subscribeInvocation(invocationId, onEvent) {
  const source = new EventSource(`/api/invocations/${encodeURIComponent(invocationId)}/stream`)
  source.onmessage = (e) => {
    const event = JSON.parse(e.data)
    onEvent(event)
    if (event.type === 'done' || event.type === 'error') source.close()
  }
  return () => source.close()
}
