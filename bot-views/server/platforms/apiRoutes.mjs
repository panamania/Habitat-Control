// server/platforms/apiRoutes.mjs
//
// Plain async handlers, deliberately not tied to Express/Fastify/whatever —
// I haven't seen the actual server/api.mjs source (bot-crossing's own docs
// just say "the API lives inside the Vite dev server"), so wire these into
// however that file already routes requests rather than treating this as
// a drop-in file. Each handler takes a parsed request and returns a plain
// object; throw an Error with a `.status` property for anything that
// should come back as a non-200.
//
// Suggested routes:
//   GET    /api/zones                          -> listZonesHandler()
//   POST   /api/zones                          -> addZoneHandler(body)
//   PUT    /api/zones/:id                      -> renameZoneHandler(id, body)
//   PUT    /api/zones/:id/high-stakes           -> setHighStakesHandler(id, body)
//   DELETE /api/zones/:id                      -> deleteZoneHandler(id)
//   PUT    /api/zones/assignments/:platformAgentKey -> setAssignmentHandler(key, body)
//   POST   /api/invoke                          -> invokeHandler(body), send with 202
//   GET    /api/invocations/:id                 -> getInvocationHandler(id)
//   GET    /api/invocations/:id/stream          -> streamInvocationHandler(id, res) — the one
//                                                   handler here that writes to `res` directly
//                                                   instead of returning a plain object, because
//                                                   an SSE response has to stay open and push;
//                                                   see its own comment below.

import {
  listZones, addZone, renameZone, deleteZone, setHighStakes, setAssignment,
} from './zonesStore.mjs';
import { invokeAgent } from './invoke.mjs';
import { getInvocation } from './invocationStore.mjs';
import { subscribe } from './invocationBus.mjs';

export async function listZonesHandler() {
  return { zones: await listZones() };
}

export async function addZoneHandler({ id, label, highStakes }) {
  if (!id || !label) throw httpError(400, 'id and label are required');
  await addZone(id, label, Boolean(highStakes));
  return { ok: true };
}

export async function renameZoneHandler(id, { label }) {
  if (!label) throw httpError(400, 'label is required');
  await renameZone(id, label);
  return { ok: true };
}

export async function setHighStakesHandler(id, { highStakes }) {
  await setHighStakes(id, Boolean(highStakes));
  return { ok: true };
}

export async function deleteZoneHandler(id) {
  await deleteZone(id);
  return { ok: true };
}

export async function setAssignmentHandler(platformAgentKey, { zoneId }) {
  if (!zoneId) throw httpError(400, 'zoneId is required');
  await setAssignment(platformAgentKey, zoneId);
  return { ok: true };
}

// Body shape: { platformId, agentIdentifier, ref, prompt, confirmed }
// `ref` is the same opaque object the colony already hands back to
// openThread/archive for that astronaut — the UI doesn't need to construct
// it, just forward what it already has for the selected thread.
//
// Returns { ok: true, invocationId, status: 'queued' } — the actual call to
// the agent hasn't happened yet when this resolves. Send it with a 202, not
// a 200: the only things settled synchronously are validation and the
// high-stakes gate. Poll GET /api/invocations/:id or, better, open
// GET /api/invocations/:id/stream to watch it move to running/done/error.
export async function invokeHandler(body) {
  if (!body?.platformId || !body?.ref || !body?.prompt) {
    throw httpError(400, 'platformId, ref, and prompt are required');
  }
  const result = await invokeAgent({
    platformId: body.platformId,
    agentIdentifier: body.agentIdentifier,
    ref: body.ref,
    prompt: body.prompt,
    confirmed: Boolean(body.confirmed),
    requestedBy: body.requestedBy,
  });
  if (!result.ok && result.requiresConfirmation) {
    throw httpError(409, result.error, { requiresConfirmation: true, zoneId: result.zoneId });
  }
  if (!result.ok) throw httpError(502, result.error);
  return result;
}

export async function getInvocationHandler(id) {
  const invocation = getInvocation(id);
  if (!invocation) throw httpError(404, `No such invocation: ${id}`);
  return invocation;
}

/**
 * Writes Server-Sent Events straight to `res` rather than returning a plain
 * object like every other handler here — the whole point of an SSE
 * response is that it stays open and pushes, which the rest of this file's
 * "return a value, let the caller send()" shape can't express. api.mjs
 * calls this directly instead of wrapping the result in send().
 *
 * A reconnect (or a second tab watching the same invocation) always gets a
 * `snapshot` event first, built from invocationStore rather than replayed
 * from invocationBus — the bus only carries what happens *after* a
 * listener subscribes, so anything already on disk would otherwise be
 * silently skipped. If the snapshot is already terminal (done/error), the
 * stream ends right there; nothing more is ever going to happen.
 */
export function streamInvocationHandler(id, res) {
  const current = getInvocation(id);
  if (!current) {
    res.writeHead(404, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ error: `No such invocation: ${id}` }));
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
  });

  const write = (event) => {
    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch {
      // The client is already gone; the 'close' listener below cleans up.
    }
  };

  write({ type: 'snapshot', status: current.status, output: current.output, error: current.error });

  if (current.status === 'done' || current.status === 'error') {
    res.end();
    return;
  }

  const unsubscribe = subscribe(id, (event) => {
    write(event);
    if (event.type === 'done' || event.type === 'error') {
      unsubscribe();
      res.end();
    }
  });
  res.on('close', unsubscribe);
}

function httpError(status, message, extra = {}) {
  const err = new Error(message);
  err.status = status;
  Object.assign(err, extra);
  return err;
}
