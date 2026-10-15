import test from 'node:test'
import assert from 'node:assert/strict'
import { productionIssues, isPublicOrigin, imageEndpoint, textRequestTimeoutMs } from '../src/config.mjs'

const valid = { WECHAT_APPID: 'wx1234567890abcdef', WECHAT_SECRET: 'test-secret', DEV_ADMIN_PASSWORD: 'admin-password-strong', MODEL_CONFIG_ENCRYPTION_KEY: 'encryption-key-separate-32-characters', CORS_ORIGIN: 'https://admin.mojing.test' }
test('text request deadline defaults to 150 seconds and rejects invalid configuration', () => {
  assert.equal(textRequestTimeoutMs({}), 150000)
  assert.equal(textRequestTimeoutMs({ TEXT_REQUEST_TIMEOUT_MS: '240000' }), 240000)
  for (const value of ['0', '999', '600001', 'NaN', '2.5', '']) {
    assert.throws(() => textRequestTimeoutMs({ TEXT_REQUEST_TIMEOUT_MS: value }))
    assert.ok(productionIssues({ ...valid, TEXT_REQUEST_TIMEOUT_MS: value }).some(i => i.startsWith('TEXT_REQUEST_TIMEOUT_MS:')))
  }
})
test('production config rejects missing, placeholder, shared and weak secrets without revealing them', () => {
  assert.deepEqual(productionIssues(valid), [])
  assert.ok(productionIssues({}).length >= 5)
  const issues = productionIssues({ ...valid, WECHAT_SECRET: 'replace-with-secret', MODEL_CONFIG_ENCRYPTION_KEY: valid.DEV_ADMIN_PASSWORD })
  assert.ok(issues.some(item => item.includes('independent')))
  assert.ok(!issues.join().includes(valid.DEV_ADMIN_PASSWORD))
})
test('public deployment origins must be HTTPS domains without paths, credentials or placeholders', () => {
  for (const url of ['http://admin.mojing.test', 'https://admin.example.com', 'https://127.0.0.1', 'https://localhost', 'https://admin.mojing.test/api', 'https://user:secret@admin.mojing.test']) assert.equal(isPublicOrigin(url), false, url)
  assert.equal(isPublicOrigin(valid.CORS_ORIGIN), true)
})
test('image provider supports public compatible endpoints and invalid limits are rejected', () => {
  assert.deepEqual(productionIssues({ ...valid, TUZI_IMAGE_ENDPOINT: imageEndpoint, MAX_CONCURRENT_GENERATION_JOBS: '4' }), [])
  for (const value of ['0', '-1', 'NaN', '2.5']) assert.ok(productionIssues({ ...valid, MAX_GENERATION_JOBS_PER_DAY: value }).length)
  assert.deepEqual(productionIssues({ ...valid, TUZI_IMAGE_ENDPOINT: 'https://other.test/images/generations' }), [])
  for (const endpoint of ['http://other.test/images/generations', 'https://localhost/images/generations', 'https://other.test/chat/completions', 'https://user:pass@other.test/images/generations']) assert.ok(productionIssues({ ...valid, TUZI_IMAGE_ENDPOINT: endpoint }).length)
})
