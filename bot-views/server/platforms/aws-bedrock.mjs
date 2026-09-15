// server/platforms/aws-bedrock.mjs
//
// Maps Amazon Bedrock Agents onto bot-crossing's Thread shape.
//
// Two Bedrock APIs are involved:
//  - @aws-sdk/client-bedrock-agent          control plane: ListAgents — the
//    agent *definitions* you've deployed. The agent's name feeds
//    classifyZone() in zones.mjs, which is what actually claims a hex.
//  - @aws-sdk/client-bedrock-agent-runtime  ListSessions / ListInvocations —
//    the actual conversations/runs. These become astronauts.
//
// CAVEAT — read before wiring this up: ListSessions returns every session
// in the account, and its summaries carry no agent reference at all — only
// sessionId/sessionArn/sessionStatus/createdAt/lastUpdatedAt. Joining a
// session to the agent that owns it means one extra GetSession call per
// session (below), reading back the sessionMetadata you set yourself when
// you called CreateSession — Bedrock doesn't do this join for you. Tag
// sessions with an agentId in sessionMetadata at creation time or every
// session lands in "unassigned". If you're actually on Bedrock AgentCore
// (the newer hosted-runtime product) rather than classic Agents-for-Bedrock,
// you want ListAgentRuntimes / ListAgentRuntimeVersions from the AgentCore
// control plane instead — the shapes differ enough that it's a different
// adapter, not a tweak to this one.

import { BedrockAgentClient, ListAgentsCommand } from '@aws-sdk/client-bedrock-agent';
import {
  BedrockAgentRuntimeClient,
  ListSessionsCommand,
  ListInvocationsCommand,
  GetSessionCommand,
  InvokeAgentCommand,
} from '@aws-sdk/client-bedrock-agent-runtime';
import { createPolledCache } from './cache.mjs';
import { classifyZone } from './zonesStore.mjs';

// Maps agentId -> agentAliasId. Bedrock's InvokeAgent call requires an
// alias, and there's no cheap way to discover "the alias you want" from
// session/agent list data alone — you decide that per agent. Set it here
// as JSON, e.g. AWS_BEDROCK_AGENT_ALIASES='{"AGENT123":"ALIAS456"}'.
const AGENT_ALIASES = JSON.parse(process.env.AWS_BEDROCK_AGENT_ALIASES || '{}');

const REGION = process.env.AWS_REGION || 'ap-southeast-2';

const agentClient = new BedrockAgentClient({ region: REGION });
const runtimeClient = new BedrockAgentRuntimeClient({ region: REGION });

async function fetchThreads() {
  const { agentSummaries = [] } = await agentClient.send(new ListAgentsCommand({}));
  const agentsById = new Map(agentSummaries.map((a) => [a.agentId, a]));

  const { sessionSummaries = [] } = await runtimeClient.send(new ListSessionsCommand({}));

  const threads = [];
  for (const session of sessionSummaries) {
    // Best-effort join — see the CAVEAT above. GetSession is the only call
    // that actually returns sessionMetadata; the list summary doesn't carry it.
    let agentId;
    try {
      const detail = await runtimeClient.send(new GetSessionCommand({ sessionIdentifier: session.sessionId }));
      agentId = detail.sessionMetadata?.agentId;
    } catch {
      // Can't read this session's metadata (throttle, or it was never set) —
      // it still gets an astronaut, just an unassigned one.
    }
    const agent = agentsById.get(agentId);

    let invocationCount = 0;
    let lastInvocationAt = session.lastUpdatedAt;
    try {
      const { invocationSummaries = [] } = await runtimeClient.send(
        new ListInvocationsCommand({ sessionIdentifier: session.sessionId })
      );
      invocationCount = invocationSummaries.length;
      if (invocationSummaries.length) {
        lastInvocationAt = invocationSummaries.at(-1).createdAt;
      }
    } catch {
      // A session with no invocations yet, or a transient throttle — the
      // session summary alone is still worth an astronaut, skip the detail.
    }

    const lastActivityMs = new Date(lastInvocationAt ?? session.lastUpdatedAt).getTime();
    const ageMs = Date.now() - lastActivityMs;

    threads.push({
      id: `aws-bedrock:${session.sessionId}`,
      title: agent?.agentName ?? 'Unassigned session',
      preview: '',
      project: await classifyZone('aws-bedrock', agent?.agentName ?? 'unassigned'),
      projectPath: '',
      worktree: REGION,
      cwd: '',
      gitBranch: '',
      model: '', // AgentSummary doesn't carry the foundation model — GetAgent does, at the cost of yet another per-agent call
      effort: '',
      createdAt: new Date(session.createdAt).getTime(),
      lastActivityAt: lastActivityMs,
      lastFocusedAt: 0,
      running: session.sessionStatus === 'ACTIVE' && ageMs < 60_000,
      unread: false, // Bedrock sessions don't natively expose a "needs a human" flag
      hasError: false, // SessionStatus is only ACTIVE/ENDED/EXPIRED — no session-level error state to read; would need per-invocation inspection
      archived: session.sessionStatus === 'ENDED' || session.sessionStatus === 'EXPIRED',
      sizeBytes: invocationCount * 4096, // rough proxy so busier sessions look more "built"
      source: 'aws-bedrock',
      canOpen: true,
      canInvoke: Boolean(agentId && AGENT_ALIASES[agentId]),
      ref: { sessionId: session.sessionId, agentId, agentAliasId: agentId ? AGENT_ALIASES[agentId] : undefined },
    });
  }
  return threads;
}

const cache = createPolledCache(fetchThreads, { ttlMs: 30_000, label: 'aws-bedrock' });

export default {
  id: 'aws-bedrock',
  name: 'AWS Bedrock Agents',
  async detect() {
    try {
      await agentClient.send(new ListAgentsCommand({ maxResults: 1 }));
      return true;
    } catch {
      return false; // no credentials, no access, or the API isn't reachable from here
    }
  },
  async scanThreads() {
    return cache.get();
  },
  openThread({ sessionId }) {
    // The console doesn't deep-link to a single session (yet) — this lands
    // on the agents list. Tighten this if/when AWS ships a session-level URL.
    void sessionId;
    return {
      ok: true,
      url: `https://${REGION}.console.aws.amazon.com/bedrock/home?region=${REGION}#/agents`,
    };
  },
  newSession() {
    return { ok: false, error: 'Starting a new Bedrock session from here is not wired up yet.' };
  },
  // New capability — not part of bot-crossing's original read-only contract.
  // Talks to a live agent and returns its text response. sessionId is
  // reused so a follow-up "ask" continues the same conversation instead of
  // starting a fresh one every time.
  //
  // Bedrock's own event stream is exactly the native stream the
  // architecture doc's §3 has in mind for this adapter — `onChunk`, when
  // the caller passes one, gets each chunk the moment it arrives rather
  // than waiting for the whole response, so invoke.mjs can relay it
  // straight through to an open SSE channel instead of the caller sitting
  // on a blocked await until Bedrock finishes the whole turn.
  async invokeAgent({ agentId, agentAliasId, sessionId }, { prompt, onChunk }) {
    if (!agentId || !agentAliasId) {
      return { ok: false, error: 'Missing agentId/agentAliasId — set AWS_BEDROCK_AGENT_ALIASES.' };
    }
    try {
      const response = await runtimeClient.send(new InvokeAgentCommand({
        agentId,
        agentAliasId,
        sessionId: sessionId ?? crypto.randomUUID(),
        inputText: prompt,
      }));
      let text = '';
      for await (const event of response.completion ?? []) {
        if (event.chunk?.bytes) {
          const piece = Buffer.from(event.chunk.bytes).toString('utf8');
          text += piece;
          onChunk?.(piece);
        }
      }
      return { ok: true, runRef: { sessionId }, output: text };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },
};
