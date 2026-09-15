// server/platforms/invoke.mjs
//
// The one entry point for "call this agent" — looks up which adapter owns
// a platform, delegates to that adapter's invokeAgent(), and enforces the
// one guardrail that has to live server-side rather than in the UI: a zone
// marked highStakes in zones.json requires the caller to pass
// `confirmed: true`, so a UI bug or a stray API call can't fire a real
// trade or a real customer-facing banking action without an explicit yes.
// The UI's job is to collect that confirmation clearly — not to be the
// only thing standing between a click and a live trading agent.
//
// Execution model (architecture doc §1/§4): fire-and-forget, not
// request/response. invokeAgent() itself only ever does the synchronous
// part — validate, gate on high-stakes, write a `queued` row — and returns
// immediately with { ok: true, invocationId, status: 'queued' }. The
// actual call to the adapter happens in runInvocation(), below, which
// nothing awaits; its progress is readable from invocationStore and
// pushed live over invocationBus to whatever's listening on
// GET /api/invocations/:id/stream.

import { randomUUID } from 'node:crypto';
import { PLATFORMS } from './index.mjs';
import { getZoneForKey, isHighStakes } from './zonesStore.mjs';
import { appendInvocationLog } from './auditLog.mjs';
import { createInvocation, setStatus, appendOutput, setRunRef, setError, getInvocation } from './invocationStore.mjs';
import { publish } from './invocationBus.mjs';

const adaptersById = new Map(PLATFORMS.map((p) => [p.id, p]));

export async function invokeAgent({ platformId, agentIdentifier, ref, prompt, confirmed, requestedBy }) {
  const adapter = adaptersById.get(platformId);
  if (!adapter) return { ok: false, error: `Unknown platform: ${platformId}` };
  if (typeof adapter.invokeAgent !== 'function') {
    return { ok: false, error: `${adapter.name} doesn't support invoking agents yet.` };
  }

  const zoneId = await getZoneForKey(`${platformId}:${agentIdentifier}`);
  if ((await isHighStakes(zoneId)) && !confirmed) {
    return {
      ok: false,
      requiresConfirmation: true,
      zoneId,
      error: `${zoneId} is marked high-stakes — resend with confirmed: true to proceed.`,
    };
  }

  const id = randomUUID();
  createInvocation({ id, platformId, agentIdentifier, zone: zoneId, prompt, requestedBy });

  // Not awaited on purpose — the caller gets the 202 the moment the row
  // exists, per §1's contract. Errors from here are terminal invocation
  // states (see runInvocation's own try/catch), never a thrown rejection.
  runInvocation(id, adapter, { platformId, agentIdentifier, zoneId, ref, prompt, requestedBy });

  return { ok: true, invocationId: id, status: 'queued' };
}

async function runInvocation(id, adapter, { platformId, agentIdentifier, zoneId, ref, prompt, requestedBy }) {
  setStatus(id, 'running');
  publish(id, { type: 'status', status: 'running' });

  let result;
  try {
    // Adapters that can stream (Bedrock's native event stream; a
    // self-hosted agent whose /invoke responds chunked) call onChunk as
    // text arrives, relayed straight through per §4. One that can't just
    // never calls it and hands the whole thing back in `result.output`.
    const onChunk = (text) => {
      if (!text) return;
      appendOutput(id, text);
      publish(id, { type: 'chunk', text });
    };
    result = await adapter.invokeAgent(ref, { prompt, onChunk });
  } catch (err) {
    result = { ok: false, error: err?.message || String(err) };
  }

  if (result.ok) {
    if (result.runRef) setRunRef(id, result.runRef);
    // An adapter that streamed already has its output in the row via
    // onChunk; one that only returns a final string needs it appended once.
    const current = getInvocation(id);
    if (result.output && !current.output) appendOutput(id, result.output);
    setStatus(id, 'done');
    publish(id, { type: 'done', output: getInvocation(id).output, runRef: result.runRef ?? null });
  } else {
    setError(id, result.error || 'Unknown error');
    setStatus(id, 'error');
    publish(id, { type: 'error', error: result.error || 'Unknown error' });
  }

  await appendInvocationLog({
    at: Date.now(),
    invocationId: id,
    platformId,
    agentIdentifier,
    zoneId,
    prompt,
    requestedBy: requestedBy ?? 'unknown',
    ok: result.ok,
    runRef: result.runRef ?? null,
    error: result.error ?? null,
  });
}
