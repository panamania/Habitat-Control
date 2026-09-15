// server/platforms/invocationBus.mjs
//
// In-process pub/sub between invoke.mjs (the one writer, running an
// adapter's call in the background) and the SSE route in apiRoutes.mjs
// (potentially several readers — a reconnect after a dropped connection,
// or two tabs watching the same astronaut). SQLite is the source of truth
// invocationStore.mjs persists to; this is just what wakes an open
// response stream up without polling the database.
//
// Deliberately in-memory: an invocation started before a restart has no
// listener left to notify anyway, and a reconnecting client always gets
// the current row from invocationStore first (see streamInvocationHandler
// in apiRoutes.mjs), so nothing is lost — just not replayed mid-stream.

import { EventEmitter } from 'node:events';

const bus = new EventEmitter();
bus.setMaxListeners(0);

export function publish(invocationId, event) {
  bus.emit(invocationId, event);
}

/** Returns an unsubscribe function. */
export function subscribe(invocationId, listener) {
  bus.on(invocationId, listener);
  return () => bus.off(invocationId, listener);
}
