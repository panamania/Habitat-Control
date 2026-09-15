/**
 * POST /api/new-project — the one route in this file that makes a folder exist rather than
 * checking one that already does (see server/api.mjs's own comment on createProjectFolder).
 *
 * Deliberately not testing the full round trip through a real harness: a valid Claude Code
 * dispatch ends in present() calling launch(), which actually asks the OS to open a
 * claude:// URL — a real side effect this test suite has never triggered for /api/open or
 * /api/new-session either, for the same reason. Passing a harness id that doesn't exist lets
 * the folder-creation half run for real (and be checked on disk) while failing before
 * anything gets launched.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'

async function withServer(run) {
  const dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'habitat-control-test-'))
  const projectsRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'habitat-control-projects-'))
  process.env.HABITAT_CONTROL_DATA = dataDir
  process.env.HABITAT_CONTROL_PROJECTS_ROOT = projectsRoot
  const { apiMiddleware } = await import(`../server/api.mjs?${dataDir}`)
  const server = http.createServer((req, res) => apiMiddleware(req, res, null))
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const port = server.address().port
  const call = (p, opts) =>
    fetch(`http://127.0.0.1:${port}${p}`, {
      headers: { Origin: `http://localhost:${port}`, 'Content-Type': 'application/json' },
      ...opts,
    })
  try {
    await run({ call, projectsRoot })
  } finally {
    server.close()
    await fsp.rm(dataDir, { recursive: true, force: true })
    await fsp.rm(projectsRoot, { recursive: true, force: true })
  }
}

const post = (call, name, harness = 'not-a-real-harness') =>
  call('/api/new-project', { method: 'POST', body: JSON.stringify({ name, harness }) })

test('a valid name gets a real folder under the projects root, on disk', async () => {
  await withServer(async ({ call, projectsRoot }) => {
    const res = await post(call, 'my-new-space')
    // The unknown harness id means this never reaches present()/launch() — it fails past
    // the point that matters here, which is that the folder already exists by the time it does.
    assert.equal(res.status, 500)
    const stat = await fsp.stat(path.join(projectsRoot, 'my-new-space'))
    assert.ok(stat.isDirectory())
  })
})

test('calling it twice with the same name reuses the folder instead of erroring', async () => {
  await withServer(async ({ call, projectsRoot }) => {
    await post(call, 'same-name')
    const second = await post(call, 'same-name')
    assert.equal(second.status, 500) // unknown-harness failure, not a "folder exists" failure
    assert.match((await second.json()).error, /Unknown harness/)
    const stat = await fsp.stat(path.join(projectsRoot, 'same-name'))
    assert.ok(stat.isDirectory())
  })
})

test('a name that is only a path separator is refused before anything is created', async () => {
  await withServer(async ({ call, projectsRoot }) => {
    const res = await post(call, '../escape')
    assert.equal(res.status, 400)
    assert.match((await res.json()).error, /letters, numbers/)
    const entries = await fsp.readdir(projectsRoot).catch(() => [])
    assert.deepEqual(entries, [])
  })
})

test('an empty or missing name is refused', async () => {
  await withServer(async ({ call }) => {
    const empty = await post(call, '')
    assert.equal(empty.status, 400)
    const missing = await call('/api/new-project', { method: 'POST', body: JSON.stringify({ harness: 'x' }) })
    assert.equal(missing.status, 400)
  })
})

test('a name that collides with an existing file (not a folder) is refused', async () => {
  await withServer(async ({ call, projectsRoot }) => {
    await fsp.mkdir(projectsRoot, { recursive: true })
    await fsp.writeFile(path.join(projectsRoot, 'taken'), 'not a folder')
    const res = await post(call, 'taken')
    assert.equal(res.status, 400)
    assert.match((await res.json()).error, /already exists there and is not a folder/)
  })
})
