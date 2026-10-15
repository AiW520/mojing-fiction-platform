import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

const source = readFileSync(new URL('./campus-comic-advance.mjs', import.meta.url), 'utf8')
  .replace(/^import .*\r?\n/gm, '')
  .replace('import.meta.dirname', "'/workspace/scripts'")

async function advance(jobs) {
  const episode = { number: 12, workId: 'work', episodeId: 'draft', storyApproved: true, storyboardApproved: true, imageJobIds: jobs.map(job => job.id), retryHistory: [] }
  const state = { ongoingAuthorization: true, episodes: [episode], apiBase: 'http://mock' }
  const actions = []
  const messages = []
  const routes = {
    '/admin-api/auth/login': { token: 'mock' },
    '/admin-api/production': { jobs: [] },
    '/admin-api/comics/draft': { episode: { panels: [{ imageId: null }] } },
    '/admin-api/comics/draft/jobs': { items: jobs.map(({ id, status }) => ({ id, status })) },
  }
  for (const job of jobs) routes[`/api/jobs/${job.id}`] = { job }
  await runInNewContext(`(async () => { ${source} })()`, {
    assert, resolve: (...parts) => parts.join('/'),
    acquireLock: () => () => {}, readEnvFile: () => ({}),
    readFileSync: () => JSON.stringify(state), existsSync: () => false,
    spawnSync: (_node, args) => { actions.push(args); return { status: 0 } },
    process: { env: {}, argv: [], execPath: 'node', once: () => {}, exit: () => { throw new Error('Unexpected exit') } },
    console: { log: value => messages.push(JSON.parse(value)), error: () => {} },
    Date, Number, JSON, Boolean, Array, AbortSignal,
    fetch: async url => {
      const path = new URL(url).pathname
      assert.ok(Object.hasOwn(routes, path), `Unexpected request: ${path}`)
      return { ok: true, json: async () => routes[path] }
    },
  })
  return { actions, messages }
}

const failed = (id, result = {}) => ({ id, status: 'failed', errorCode: 'PROVIDER_HTTP_503', finishedAt: '2020-01-01T00:00:00Z', result })

test('an older unknown paid attempt blocks retry even when latest failure is definite', async () => {
  const { actions, messages } = await advance([failed('latest'), failed('unknown', { attempts: [{ resultUnknown: true }] })])
  assert.equal(actions.length, 0)
  assert.equal(messages.at(-1).status, 'paused_unknown_paid_result')
  assert.equal(messages.at(-1).jobId, 'unknown')
})

test('a top-level unknown result blocks retry', async () => {
  const { actions, messages } = await advance([failed('unknown', { resultUnknown: true })])
  assert.equal(actions.length, 0)
  assert.equal(messages.at(-1).status, 'paused_unknown_paid_result')
})

test('transport 502 blocks retry even when the queue lost its unknown marker', async () => {
  const job = { ...failed('transport', { attempts: [{ resultUnknown: false }] }), errorCode: 'PROVIDER_HTTP_502' }
  const { actions, messages } = await advance([job])
  assert.equal(actions.length, 0)
  assert.equal(messages.at(-1).status, 'paused_unknown_paid_result')
})

test('definite temporary failures retry after backoff', async () => {
  const { actions } = await advance([failed('known', { attempts: [{ resultUnknown: false }] })])
  assert.equal(actions.length, 1)
  assert.ok(actions[0].includes('--retry-images'))
})

test('missing job evidence does not authorize retry', async () => {
  const { actions, messages } = await advance([])
  // With no prior requests, initial generation is still allowed.
  assert.equal(actions.length, 1)
  assert.ok(actions[0].includes('--images'))
  const completed = await advance([{ id: 'success', status: 'success', result: {} }])
  assert.equal(completed.actions.length, 0)
  assert.equal(completed.messages.at(-1).status, 'retry_backoff')
})
