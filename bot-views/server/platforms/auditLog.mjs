// server/platforms/auditLog.mjs
//
// Every invoke gets one line here, append-only — who asked, which agent,
// which zone, and whether it succeeded. Deliberately the same shape you'd
// want for a portable agent-trust/observability record: "an agent did
// something, on request from X, at time Y, with this outcome" that isn't
// locked into any one cloud's own logging. Point your registry project at
// this file, or replace appendInvocationLog with a call into it directly.

import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.BOT_CROSSING_DATA || path.join(here, '..', '..', 'data');
const LOG_PATH = path.join(DATA_DIR, 'invocations.log.jsonl');

export async function appendInvocationLog(entry) {
  await mkdir(path.dirname(LOG_PATH), { recursive: true });
  await appendFile(LOG_PATH, JSON.stringify(entry) + '\n');
}
