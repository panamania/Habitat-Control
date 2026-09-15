// server/platforms/invocationStore.mjs
//
// The invocation record store the architecture doc's §7 left open ("SQLite
// on a PVC is enough to start... lean SQLite until there's a reason not
// to"). `node:sqlite` ships in Node 22.13+ (this project's own engines
// floor), so no new dependency is needed for it.
//
// One row per /api/invoke call: id, agent_id, zone, status, started_at,
// output — the exact shape §7 asks for, plus the fields invoke.mjs and the
// SSE route need to do their jobs (platform_id/agent_identifier to route a
// reconnect, prompt/requested_by/error for the audit trail, run_ref for
// whatever the adapter handed back).
//
// This is a local single-writer store for a localhost tool, not a shared
// service — one connection, synchronous node:sqlite calls, no pooling.

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// Opened lazily, on first actual use, rather than at import time — the same
// convention zonesStore.mjs and auditLog.mjs already follow. This module
// only gets loaded once per process (unlike server/api.mjs, which the test
// suite re-imports per test with a cache-busting query string to pick up a
// fresh HABITAT_CONTROL_DATA), so an eager open at the top of the file would
// permanently pin DB_PATH to whichever test happened to import it first —
// and on Windows, that test's own cleanup (`fs.rm` on its temp dir) then
// fails with EBUSY because the connection to a file inside it is still open.
let db = null;

function getDb() {
  if (db) return db;
  const DATA_DIR = process.env.HABITAT_CONTROL_DATA || path.join(here, '..', '..', 'data');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new DatabaseSync(path.join(DATA_DIR, 'invocations.sqlite'));
  db.exec(`
    CREATE TABLE IF NOT EXISTS invocations (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      platform_id TEXT NOT NULL,
      agent_identifier TEXT NOT NULL,
      zone TEXT NOT NULL,
      prompt TEXT NOT NULL,
      requested_by TEXT,
      status TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      output TEXT NOT NULL DEFAULT '',
      run_ref TEXT,
      error TEXT
    )
  `);
  return db;
}

function toRow(record) {
  if (!record) return null;
  return {
    id: record.id,
    agentId: record.agent_id,
    platformId: record.platform_id,
    agentIdentifier: record.agent_identifier,
    zone: record.zone,
    prompt: record.prompt,
    requestedBy: record.requested_by,
    status: record.status,
    startedAt: Number(record.started_at),
    updatedAt: Number(record.updated_at),
    output: record.output,
    runRef: record.run_ref ? JSON.parse(record.run_ref) : null,
    error: record.error,
  };
}

export function createInvocation({ id, platformId, agentIdentifier, zone, prompt, requestedBy }) {
  const now = Date.now();
  const agentId = `${platformId}:${agentIdentifier}`;
  getDb()
    .prepare(
      `INSERT INTO invocations
         (id, agent_id, platform_id, agent_identifier, zone, prompt, requested_by, status, started_at, updated_at, output)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, '')`
    )
    .run(id, agentId, platformId, agentIdentifier, zone, prompt, requestedBy ?? null, now, now);
  return getInvocation(id);
}

export function setStatus(id, status) {
  getDb().prepare('UPDATE invocations SET status = ?, updated_at = ? WHERE id = ?').run(status, Date.now(), id);
}

// Read-modify-write is fine here: one process, one writer, and a single
// invocation's output never has two chunks landing at once — the adapter
// awaits each onChunk call before asking for the next one.
export function appendOutput(id, chunk) {
  const current = getInvocation(id);
  if (!current) return;
  getDb()
    .prepare('UPDATE invocations SET output = ?, updated_at = ? WHERE id = ?')
    .run(current.output + chunk, Date.now(), id);
}

export function setRunRef(id, runRef) {
  getDb()
    .prepare('UPDATE invocations SET run_ref = ?, updated_at = ? WHERE id = ?')
    .run(runRef ? JSON.stringify(runRef) : null, Date.now(), id);
}

export function setError(id, error) {
  getDb().prepare('UPDATE invocations SET error = ?, updated_at = ? WHERE id = ?').run(String(error), Date.now(), id);
}

export function getInvocation(id) {
  return toRow(getDb().prepare('SELECT * FROM invocations WHERE id = ?').get(id));
}

export function listInvocations({ limit = 50 } = {}) {
  return getDb()
    .prepare('SELECT * FROM invocations ORDER BY started_at DESC LIMIT ?')
    .all(Math.max(1, Math.min(200, limit)))
    .map(toRow);
}

// Test-only lifecycle hook. Production code never calls this — the process
// just exits with the connection open, same as every other file in this
// project that opens something and never closes it. Tests that give
// themselves a temp HABITAT_CONTROL_DATA dir need it so the sqlite file's
// handle is released before they rm -rf that directory; Windows refuses to
// unlink a file a process still has open, POSIX just quietly allows it.
export function closeInvocationStore() {
  if (db) {
    db.close();
    db = null;
  }
}
