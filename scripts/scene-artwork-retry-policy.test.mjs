import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isProviderBlocked, shouldRetryGeneration, retryDelay } from './scene-artwork-retry-policy.mjs'

test('timeout wording permits the user-authorized retry despite mentioning billing', () => {
  assert.equal(shouldRetryGeneration('Generation failed or timed out. It was not retried to avoid duplicate billing.'), true)
  for (const status of [408, 429, 500, 502, 503, 504]) assert.equal(shouldRetryGeneration(`Tuzi API ${status}: unavailable`), true)
})

test('rejections, exhausted quota, invalid credentials and local errors stop requests', () => {
  for (const message of ['Tuzi API 400: rejected by the safety system', 'Tuzi API 401: unauthorized', 'Tuzi API 429: insufficient quota', 'Output file already exists', 'Returned model does not match the authorized selection', 'Could not start Tuzi skill process']) {
    assert.equal(shouldRetryGeneration(message), false)
  }
  assert.equal(isProviderBlocked('Tuzi API 429: insufficient quota'), true)
})

test('retry backoff reaches a stable one-minute interval', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 100].map(retryDelay), [2000, 4000, 8000, 16000, 32000, 60000, 60000])
})
