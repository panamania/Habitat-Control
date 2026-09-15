// server/platforms/index.mjs
//
// These four implement the exact same { id, name, detect, scanThreads,
// openThread, newSession } contract as a local harness (see
// server/harnesses/README.md), so nothing in scan.mjs, api.mjs, or
// anywhere under src/ needs to change. Either merge PLATFORMS into
// HARNESSES in server/harnesses/index.mjs, or keep the two lists separate
// and concatenate them wherever scan.mjs currently imports HARNESSES:
//
//   import { HARNESSES } from './harnesses/index.mjs'
//   import { PLATFORMS } from './platforms/index.mjs'
//   export const ALL_SOURCES = [...HARNESSES, ...PLATFORMS]

import awsBedrock from './aws-bedrock.mjs';
import k8sAgents from './k8s-agents.mjs';
// Azure and GCP adapters exist in this folder (azure-ai-foundry.mjs,
// gcp-vertex-agents.mjs) but aren't wired in for now — uncomment these two
// lines and add them to the PLATFORMS array below whenever you're ready.
// Nothing else changes.
// import azureAiFoundry from './azure-ai-foundry.mjs';
// import gcpVertexAgents from './gcp-vertex-agents.mjs';

export const PLATFORMS = [awsBedrock, k8sAgents];

// Zone-taxonomy re-exports are safe here (zonesStore.mjs doesn't import
// PLATFORMS back). invokeAgent is deliberately NOT re-exported from this
// file — invoke.mjs imports PLATFORMS from here to dispatch by platform
// id, so re-exporting invoke.mjs's own invokeAgent back out of this file
// would be a circular import (index.mjs -> invoke.mjs -> index.mjs), which
// throws "Cannot access 'PLATFORMS' before initialization" the moment
// anything imports either module. apiRoutes.mjs already imports invokeAgent
// straight from ./invoke.mjs — that's the one place that needs it.
export { listZones, zoneLabel, addZone, renameZone, deleteZone, setHighStakes, setAssignment } from './zonesStore.mjs';
