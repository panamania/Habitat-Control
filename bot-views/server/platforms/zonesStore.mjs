// server/platforms/zonesStore.mjs
//
// Same job as the earlier zones.mjs, but the taxonomy is now data
// (data/zones.json) instead of a hardcoded object. Add, rename, retag as
// high-stakes, or delete a zone at runtime — through the /api/zones routes,
// or by hand-editing the file — and every adapter picks it up on the next
// classifyZone() call. No redeploy, no code change.
//
// classifyZone() is async now (it used to be sync in zones.mjs) because it
// reads from disk on first use. Every call site in the four adapters needs
// `await`.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Same resolution as server/api.mjs's DATA_DIR, so this lands in the same
// data/ folder as colony.json rather than wherever the process happened to
// be launched from.
const here = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.HABITAT_CONTROL_DATA || path.join(here, '..', '..', 'data');
const STORE_PATH = path.join(DATA_DIR, 'zones.json');

const DEFAULT_STATE = {
  zones: {
    'asx-trading': { label: 'ASX Trading', highStakes: true },
    'banking-support': { label: 'Banking Support', highStakes: true },
    'career-coach': { label: 'Career Coach', highStakes: false },
    'emotional-support': { label: 'Emotional Support', highStakes: false },
    'knowledge-base': { label: 'Knowledge Base', highStakes: false },
    'music': { label: 'Music', highStakes: false },
    'naughty': { label: 'Naughty Stuff', highStakes: false },
    'unclassified': { label: 'Unclassified', highStakes: false },
  },
  assignments: {
    // 'aws-bedrock:claims-triage-agent': 'banking-support',
  },
};

// "Currently working" means the colony shouldn't fill up with months of
// finished cloud sessions the way a full local transcript history would.
export const ACTIVE_WINDOW_MS = 24 * 60 * 60 * 1000;

let state = null;
let loaded = false;

async function load() {
  if (loaded) return state;
  try {
    state = JSON.parse(await readFile(STORE_PATH, 'utf8'));
  } catch {
    state = structuredClone(DEFAULT_STATE);
    await save(); // seed the file so there's something to hand-edit
  }
  loaded = true;
  return state;
}

async function save() {
  await mkdir(path.dirname(STORE_PATH), { recursive: true });
  await writeFile(STORE_PATH, JSON.stringify(state, null, 2));
}

// Best-effort only — the real source of truth is state.assignments. This
// stops a newly deployed agent from sitting silently in 'unclassified'
// until someone notices.
const KEYWORD_FALLBACKS = [
  [/asx|trading|trader|portfolio/i, 'asx-trading'],
  [/bank|loan|account|payment|claim/i, 'banking-support'],
  [/career|resume|cv|interview|job-?search/i, 'career-coach'],
  [/emotion|wellbeing|wellness|therapy|counsel/i, 'emotional-support'],
  [/kb|knowledge|faq|docs?-?bot/i, 'knowledge-base'],
  [/music|playlist|audio|dj/i, 'music'],
];

export async function classifyZone(platformId, agentIdentifier) {
  const s = await load();
  const key = `${platformId}:${agentIdentifier}`;
  if (s.assignments[key]) return s.assignments[key];
  for (const [pattern, zone] of KEYWORD_FALLBACKS) {
    if (pattern.test(agentIdentifier)) return zone;
  }
  return 'unclassified';
}

export async function getZoneForKey(key) {
  const s = await load();
  return s.assignments[key] ?? 'unclassified';
}

export async function isHighStakes(zoneId) {
  const s = await load();
  return Boolean(s.zones[zoneId]?.highStakes);
}

export async function zoneLabel(zoneId) {
  const s = await load();
  return s.zones[zoneId]?.label ?? zoneId;
}

export async function listZones() {
  const s = await load();
  return Object.entries(s.zones).map(([id, z]) => ({ id, ...z }));
}

export async function addZone(id, label, highStakes = false) {
  const s = await load();
  s.zones[id] = { label, highStakes };
  await save();
}

export async function renameZone(id, label) {
  const s = await load();
  if (!s.zones[id]) throw new Error(`No such zone: ${id}`);
  s.zones[id].label = label;
  await save();
}

export async function setHighStakes(id, highStakes) {
  const s = await load();
  if (!s.zones[id]) throw new Error(`No such zone: ${id}`);
  s.zones[id].highStakes = highStakes;
  await save();
}

export async function deleteZone(id) {
  const s = await load();
  if (id === 'unclassified') throw new Error('unclassified is the fallback zone and cannot be deleted.');
  delete s.zones[id];
  // Anything assigned to the deleted zone falls back to unclassified
  // rather than pointing at a zone that no longer exists.
  for (const key of Object.keys(s.assignments)) {
    if (s.assignments[key] === id) s.assignments[key] = 'unclassified';
  }
  await save();
}

export async function setAssignment(platformAgentKey, zoneId) {
  const s = await load();
  if (!s.zones[zoneId]) throw new Error(`No such zone: ${zoneId}`);
  s.assignments[platformAgentKey] = zoneId;
  await save();
}
