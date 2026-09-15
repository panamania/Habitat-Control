// server/platforms/k8s-agents.mjs
//
// For self-hosted agents there's no single vendor API to target — this
// assumes the common convention of running each agent as a Deployment/Job
// whose Pods carry labels identifying which agent they are
// (agent-colony/agent-name) and which themed zone they belong to
// (agent-colony/zone, matching an id in zones.mjs — e.g. 'asx-trading',
// 'banking-support'), plus an `agent-colony/status` annotation that
// something in your stack keeps current (running | waiting | error | done).
// The status annotation is the one piece this file can't invent for you —
// write it from your agent's own lifecycle hooks, a sidecar, or a small
// controller that watches your existing logs/metrics and patches the pod.
//
// This is the adapter most worth treating as a starting point rather than
// a finished one — swap the label selector and the status source for
// whatever your actual convention already is.

import * as k8s from '@kubernetes/client-node';
import { createPolledCache } from './cache.mjs';
import { classifyZone } from './zonesStore.mjs';

const NAMESPACE = process.env.K8S_AGENT_NAMESPACE || 'agents';
const LABEL_SELECTOR = process.env.K8S_AGENT_LABEL_SELECTOR || 'app.kubernetes.io/component=agent';

const kc = new k8s.KubeConfig();
kc.loadFromDefault(); // in-cluster config when deployed, ~/.kube/config locally
const coreApi = kc.makeApiClient(k8s.CoreV1Api);

async function fetchThreads() {
  // v2 client: single options object, and the promise resolves to the list
  // directly — no `{ body }` wrapper the way older client-node versions had.
  const result = await coreApi.listNamespacedPod({ namespace: NAMESPACE, labelSelector: LABEL_SELECTOR });

  return Promise.all(result.items.map(async (pod) => {
    const labels = pod.metadata.labels ?? {};
    const annotations = pod.metadata.annotations ?? {};
    const agentName = labels['agent-colony/agent-name'] ?? labels.app ?? 'unknown-agent';
    const status = annotations['agent-colony/status'] ?? '';
    const phase = pod.status?.phase; // Pending / Running / Succeeded / Failed / Unknown
    const startedAt = pod.status?.startTime ? new Date(pod.status.startTime).getTime() : Date.now();

    return {
      id: `k8s:${pod.metadata.namespace}:${pod.metadata.name}`,
      title: agentName,
      preview: '',
      // Kubernetes labels are cheap to set at deploy time, so prefer an
      // explicit `agent-colony/zone` label over the guesswork fallback —
      // this is the one platform where you can just tell it the theme
      // directly instead of relying on classifyZone()'s keyword matching.
      project: labels['agent-colony/zone'] ?? (await classifyZone('k8s-agents', agentName)),
      projectPath: '',
      worktree: pod.metadata.namespace,
      cwd: '',
      gitBranch: '',
      model: labels['agent-colony/model'] ?? '',
      effort: '',
      createdAt: startedAt,
      lastActivityAt: startedAt,
      lastFocusedAt: 0,
      running: phase === 'Running' && status !== 'waiting',
      unread: status === 'waiting',
      hasError: phase === 'Failed' || status === 'error',
      archived: phase === 'Succeeded',
      sizeBytes: 0,
      source: 'k8s',
      // No console deep link for a bare cluster — point this at your own
      // dashboard (Lens, an internal tool, kubectl instructions) if you have one.
      canOpen: false,
      canInvoke: Boolean(annotations['agent-colony/invoke-url']),
      ref: {
        namespace: pod.metadata.namespace,
        podName: pod.metadata.name,
        // Whatever HTTP endpoint your agent's Service exposes for taking
        // work — this file can't discover that on its own, you set it.
        invokeUrl: annotations['agent-colony/invoke-url'],
      },
    };
  }));
}

const cache = createPolledCache(fetchThreads, { ttlMs: 15_000, label: 'k8s-agents' });

export default {
  id: 'k8s-agents',
  name: 'Self-hosted (Kubernetes)',
  async detect() {
    try {
      await coreApi.listNamespacedPod({ namespace: NAMESPACE, labelSelector: LABEL_SELECTOR, limit: 1 });
      return true;
    } catch {
      return false;
    }
  },
  async scanThreads() {
    return cache.get();
  },
  openThread({ namespace, podName }) {
    return { ok: false, error: `No dashboard configured — pod is ${namespace}/${podName}.` };
  },
  newSession() {
    return { ok: false, error: 'Not applicable for self-hosted pods.' };
  },
  // New capability. There's no universal invoke mechanism for a bare
  // cluster, so this just POSTs to whatever HTTP endpoint you've annotated
  // the pod with (agent-colony/invoke-url) — reachable in-cluster or via
  // an Ingress/LoadBalancer, whatever your setup actually is.
  //
  // There's no universal streaming convention for a self-hosted agent
  // either (that's what the architecture doc's §3 flags as this adapter
  // needing its own /status or SSE), so this relays the response body as
  // whatever chunks the fetch delivers — real progressive text if the
  // agent's own /invoke streams its reply, a single chunk holding the
  // whole thing if it doesn't. Either way onChunk sees it as it arrives
  // rather than this adapter buffering the whole body first.
  async invokeAgent({ invokeUrl }, { prompt, onChunk }) {
    if (!invokeUrl) return { ok: false, error: 'No agent-colony/invoke-url annotation on this pod.' };
    try {
      const res = await fetch(invokeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      if (!res.ok) return { ok: false, error: `${res.status} ${await res.text()}` };

      if (!res.body) {
        const text = await res.text();
        return { ok: true, runRef: { invokeUrl }, output: text };
      }
      const decoder = new TextDecoder();
      let text = '';
      for await (const bytes of res.body) {
        const piece = decoder.decode(bytes, { stream: true });
        text += piece;
        onChunk?.(piece);
      }
      text += decoder.decode();
      return { ok: true, runRef: { invokeUrl }, output: text };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },
};
