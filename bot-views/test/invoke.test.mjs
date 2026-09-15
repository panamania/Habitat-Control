/**
 * The async invoke pipeline the architecture doc's §1/§4 asks for: a POST that only ever
 * settles validation and the high-stakes gate before answering, an invocation record a
 * client can poll or subscribe to, and a live relay of whatever an adapter streams.
 *
 * Three layers, tested separately rather than only end-to-end, because each has a way to
 * be wrong that the others can't see:
 *  - invocationStore.mjs: does a row actually hold what was written to it.
 *  - invocationBus.mjs: does a subscriber hear only its own invocation's events.
 *  - k8s-agents.mjs: does the adapter relay a real chunked HTTP response as it arrives,
 *    not just once it's fully buffered.
 * The last test drives the real HTTP server (server/api.mjs) end to end, over an actual
 * SSE connection, against a local fake agent — no cloud credentials required.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'

import { publish, subscribe } from '../server/platforms/invocationBus.mjs'
import k8sAgents from '../server/platforms/k8s-agents.mjs'
// Same module the server graph holds (no cache-busting query) — needed so
// closeInvocationStore() below reaches the exact connection the HTTP-level
// test's own request opened, not a separate instance of the module.
import { closeInvocationStore } from '../server/platforms/invocationStore.mjs'

// ── invocationStore, in isolation ─────────────────────────────────────────────

async function withStore(run) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'bot-crossing-invstore-'))
  process.env.BOT_CROSSING_DATA = dir
  // Cache-busted like server/api.mjs is in test/state.test.mjs, so each test gets its own
  // sqlite file rather than all of them sharing whichever temp dir loaded the module first.
  const store = await import(`../server/platforms/invocationStore.mjs?${dir}`)
  try {
    await run(store)
  } finally {
    store.closeInvocationStore()
    await fsp.rm(dir, { recursive: true, force: true })
  }
}

test('createInvocation seeds a queued row with empty output', async () => {
  await withStore(async (store) => {
    const row = store.createInvocation({
      id: 'inv1',
      platformId: 'aws-bedrock',
      agentIdentifier: 'agent-a',
      zone: 'career-coach',
      prompt: 'hi',
      requestedBy: 'me',
    })
    assert.equal(row.status, 'queued')
    assert.equal(row.output, '')
    assert.equal(row.agentId, 'aws-bedrock:agent-a')
    assert.equal(row.requestedBy, 'me')
  })
})

test('appendOutput accumulates rather than replacing', async () => {
  await withStore(async (store) => {
    store.createInvocation({ id: 'inv1', platformId: 'k8s-agents', agentIdentifier: 'a', zone: 'z', prompt: 'p' })
    store.appendOutput('inv1', 'Hello ')
    store.appendOutput('inv1', 'world')
    assert.equal(store.getInvocation('inv1').output, 'Hello world')
  })
})

test('setStatus/setRunRef move a row through to a terminal state', async () => {
  await withStore(async (store) => {
    store.createInvocation({ id: 'inv1', platformId: 'aws-bedrock', agentIdentifier: 'a', zone: 'z', prompt: 'p' })
    store.setStatus('inv1', 'running')
    assert.equal(store.getInvocation('inv1').status, 'running')
    store.setRunRef('inv1', { sessionId: 'sess-1' })
    store.setStatus('inv1', 'done')
    const row = store.getInvocation('inv1')
    assert.equal(row.status, 'done')
    assert.deepEqual(row.runRef, { sessionId: 'sess-1' })
  })
})

test('setError records the failure and getInvocation reports null for an unknown id', async () => {
  await withStore(async (store) => {
    store.createInvocation({ id: 'inv1', platformId: 'aws-bedrock', agentIdentifier: 'a', zone: 'z', prompt: 'p' })
    store.setError('inv1', 'boom')
    store.setStatus('inv1', 'error')
    const row = store.getInvocation('inv1')
    assert.equal(row.status, 'error')
    assert.equal(row.error, 'boom')
    assert.equal(store.getInvocation('nope'), null)
  })
})

test('listInvocations orders most-recent first and respects the limit', async () => {
  await withStore(async (store) => {
    store.createInvocation({ id: 'a', platformId: 'p', agentIdentifier: 'x', zone: 'z', prompt: '1' })
    await new Promise((r) => setTimeout(r, 5))
    store.createInvocation({ id: 'b', platformId: 'p', agentIdentifier: 'x', zone: 'z', prompt: '2' })
    const rows = store.listInvocations({ limit: 1 })
    assert.equal(rows.length, 1)
    assert.equal(rows[0].id, 'b')
  })
})

// ── invocationBus, in isolation ───────────────────────────────────────────────

test('subscribe hears only the events published for its own invocation id', () => {
  const gotA = []
  const gotB = []
  const unsubA = subscribe('inv-a', (e) => gotA.push(e))
  const unsubB = subscribe('inv-b', (e) => gotB.push(e))
  publish('inv-a', { type: 'status', status: 'running' })
  publish('inv-b', { type: 'chunk', text: 'x' })
  assert.deepEqual(gotA, [{ type: 'status', status: 'running' }])
  assert.deepEqual(gotB, [{ type: 'chunk', text: 'x' }])
  unsubA()
  unsubB()
})

test('unsubscribe stops further delivery', () => {
  const got = []
  const unsub = subscribe('inv-c', (e) => got.push(e))
  publish('inv-c', { type: 'status', status: 'running' })
  unsub()
  publish('inv-c', { type: 'status', status: 'done' })
  assert.equal(got.length, 1)
})

// ── k8s-agents.mjs: does it actually relay a streamed response? ──────────────

test('k8s adapter calls onChunk as bytes arrive, and the final output is the full body', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.write('Hello, ')
    setTimeout(() => {
      res.write('world!')
      res.end()
    }, 20)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  try {
    const chunks = []
    const result = await k8sAgents.invokeAgent(
      { invokeUrl: `http://127.0.0.1:${port}/invoke` },
      { prompt: 'hi', onChunk: (text) => chunks.push(text) }
    )
    assert.equal(result.ok, true)
    assert.equal(result.output, 'Hello, world!')
    assert.ok(chunks.length >= 2, `expected at least 2 chunks, got ${chunks.length}`)
    assert.equal(chunks.join(''), 'Hello, world!')
  } finally {
    server.close()
  }
})

test('k8s adapter fails cleanly with no agent-colony/invoke-url annotation', async () => {
  const result = await k8sAgents.invokeAgent({}, { prompt: 'hi' })
  assert.equal(result.ok, false)
  assert.match(result.error, /invoke-url/)
})

// ── end to end: POST /api/invoke → 202 → SSE → done ───────────────────────────

/** Minimal SSE line-reader: yields each parsed `data: {...}` payload as the stream sends it. */
async function* readEvents(response) {
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) return
    buf += decoder.decode(value, { stream: true })
    let idx
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const frame = buf.slice(0, idx)
      buf = buf.slice(idx + 2)
      const line = frame.split('\n').find((l) => l.startsWith('data: '))
      if (line) yield JSON.parse(line.slice('data: '.length))
    }
  }
}

async function withServer(run) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'bot-crossing-test-'))
  process.env.BOT_CROSSING_DATA = dir
  const { apiMiddleware } = await import(`../server/api.mjs?${dir}`)
  const server = http.createServer((req, res) => apiMiddleware(req, res, null))
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const port = server.address().port
  const call = (p, opts) =>
    fetch(`http://127.0.0.1:${port}${p}`, {
      headers: { Origin: `http://localhost:${port}`, 'Content-Type': 'application/json' },
      ...opts,
    })
  try {
    await run({ call, port })
  } finally {
    server.close()
    // Best-effort: a cleanup failure here (e.g. a lingering Windows file lock) must never
    // clobber a real assertion error from `run` — a `finally` that throws replaces whatever
    // exception was already propagating, which would hide the actual test failure.
    await fsp.rm(dir, { recursive: true, force: true }).catch((err) => {
      console.warn(`[withServer] cleanup of ${dir} failed (ignored): ${err.message}`)
    })
  }
}

test('an unknown platform is rejected synchronously, before any invocation is created', async () => {
  await withServer(async ({ call }) => {
    const res = await call('/api/invoke', {
      method: 'POST',
      body: JSON.stringify({ platformId: 'not-a-real-platform', agentIdentifier: 'x', ref: {}, prompt: 'hi' }),
    })
    assert.equal(res.status, 502)
    assert.match((await res.json()).error, /Unknown platform/)
  })
})

test('a high-stakes zone is refused with 409 unless confirmed — and never reaches the adapter', async () => {
  await withServer(async ({ call }) => {
    // asx-trading ships seeded as highStakes: true (server/platforms/zonesStore.mjs).
    const key = 'k8s-agents:gate-test-agent'
    const assign = await call(`/api/zones/assignments/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: JSON.stringify({ zoneId: 'asx-trading' }),
    })
    assert.equal(assign.status, 200)

    const res = await call('/api/invoke', {
      method: 'POST',
      body: JSON.stringify({
        platformId: 'k8s-agents',
        agentIdentifier: 'gate-test-agent',
        // No invokeUrl — if the gate were skipped this would have to fail loudly
        // rather than quietly, since the adapter has nothing to call.
        ref: {},
        prompt: 'sell everything',
      }),
    })
    assert.equal(res.status, 409)
    const body = await res.json()
    assert.equal(body.requiresConfirmation, true)
    assert.equal(body.zoneId, 'asx-trading')
  })
})

test('a queued invoke moves through running to done over SSE, streaming a real chunked reply', async () => {
  const agent = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    setTimeout(() => res.write('Hello, '), 30)
    setTimeout(() => {
      res.write('world!')
      res.end()
    }, 60)
  })
  await new Promise((resolve) => agent.listen(0, '127.0.0.1', resolve))
  const agentPort = agent.address().port

  // agent.close() has to run even if an assertion throws, or its still-listening handle
  // keeps the process alive forever — node --test never gets to print a result at all.
  try {
    await withServer(async ({ call, port }) => {
      const invokeRes = await call('/api/invoke', {
        method: 'POST',
        body: JSON.stringify({
          platformId: 'k8s-agents',
          agentIdentifier: 'e2e-agent',
          ref: { invokeUrl: `http://127.0.0.1:${agentPort}/invoke` },
          prompt: 'hi',
        }),
      })
      assert.equal(invokeRes.status, 202)
      const { ok, invocationId, status } = await invokeRes.json()
      assert.equal(ok, true)
      assert.equal(status, 'queued')
      assert.ok(invocationId)

      const streamRes = await fetch(`http://127.0.0.1:${port}/api/invocations/${invocationId}/stream`, {
        headers: { Origin: `http://localhost:${port}` },
      })
      assert.equal(streamRes.status, 200)

      const events = []
      for await (const event of readEvents(streamRes)) {
        events.push(event)
        if (event.type === 'done' || event.type === 'error') break
      }

      const final = events.at(-1)
      assert.ok(final, 'expected at least one SSE event before the stream ended')
      assert.equal(final.type, 'done')
      assert.equal(final.output, 'Hello, world!')
      // 'running' can arrive either as a live `status` event or, if the invocation had
      // already moved past 'queued' by the time this subscriber connected, folded into the
      // initial `snapshot` event instead — both are the stream correctly reporting it.
      assert.ok(
        events.some((e) => (e.type === 'status' || e.type === 'snapshot') && e.status === 'running'),
        `expected a running status somewhere among ${JSON.stringify(events)}`
      )
      assert.ok(
        events.some((e) => e.type === 'chunk'),
        'expected at least one chunk event relayed live, not just the final done'
      )

      const polled = await (await call(`/api/invocations/${invocationId}`)).json()
      assert.equal(polled.status, 'done')
      assert.equal(polled.output, 'Hello, world!')

      // Released here, inside the callback, before withServer's own `finally` tries to
      // rm -rf this test's temp dir — otherwise Windows refuses to unlink the sqlite file
      // this invocation just wrote to while the connection to it is still open.
      closeInvocationStore()
    })
  } finally {
    agent.close()
  }
})
