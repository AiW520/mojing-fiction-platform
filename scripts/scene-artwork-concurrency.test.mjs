import test from 'node:test'
import assert from 'node:assert/strict'
import { runConcurrentBatch, waitForRetry } from './generate-scene-artwork-batch.mjs'

const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

test('worker pool respects its limit and processes every item once', async () => {
  const items = Array.from({ length: 100 }, (_, index) => index)
  const seen = []
  let active = 0
  let maximum = 0
  await runConcurrentBatch(items, 12, async item => {
    active++
    maximum = Math.max(maximum, active)
    await new Promise(resolve => setImmediate(resolve))
    seen.push(item)
    active--
  })
  assert.equal(maximum, 12)
  assert.deepEqual(seen.sort((a, b) => a - b), items)
  assert.equal(active, 0)
})

test('fatal provider failure stops scheduling and drains in-flight work before rejecting', async () => {
  const started = []
  const fatal = deferred()
  const inflight = deferred()
  const inflightStarted = deferred()
  const blocked = new Error('Provider requires configuration or balance repair; batch stopped')
  let finished = false
  let settled = false
  const batch = runConcurrentBatch([0, 1, 2, 3], 2, async item => {
    started.push(item)
    if (item === 0) {
      await fatal.promise
      throw blocked
    }
    inflightStarted.resolve()
    await inflight.promise
    finished = true
  })
  const result = batch.then(() => { settled = true }, error => { settled = true; return error })
  await inflightStarted.promise
  fatal.resolve()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(settled, false)
  assert.deepEqual(started, [0, 1])
  inflight.resolve()
  assert.equal(await result, blocked)
  assert.equal(finished, true)
  assert.deepEqual(started, [0, 1])
})

test('provider failure wakes retry waits and prevents further requests', { timeout: 2000 }, async () => {
  const retryStarted = deferred()
  const blocked = new Error('API 401: credential invalid')
  const started = []
  let retryAllowed
  await assert.rejects(runConcurrentBatch([0, 1, 2], 2, async (item, signal) => {
    started.push(item)
    if (item === 0) {
      retryStarted.resolve()
      retryAllowed = await waitForRetry(60000, signal)
      return
    }
    await retryStarted.promise
    throw blocked
  }), error => error === blocked)
  assert.equal(retryAllowed, false)
  assert.deepEqual(started, [0, 1])
})

test('normal retry waits resolve and already aborted waits exit immediately', async () => {
  const controller = new AbortController()
  assert.equal(await waitForRetry(1, controller.signal), true)
  controller.abort()
  assert.equal(await waitForRetry(60000, controller.signal), false)
})

test('concurrency rejects invalid values without starting a request', async () => {
  for (const concurrency of [0, -1, 33, 1.5, NaN]) {
    await assert.rejects(runConcurrentBatch([0], concurrency, () => assert.fail('request started')), /from 1 to 32/)
  }
})
