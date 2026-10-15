import test from 'node:test'
import assert from 'node:assert/strict'
import { planRevisionRequest } from '../../scripts/campus-plan-request.mjs'

test('plan revision preserves original and all review issues without duplicating input or provider metadata', () => {
  const content = '{"title":"test-plan"}'
  const request = planRevisionRequest({ content, review: { model: 'reviewer', attempts: [{ private: 'metadata' }], issues: [{ severity: 'severe', location: 'ending', reason: 'cause missing', suggestion: 'add cause' }] } }, 'writer')
  assert.equal(request.context, content)
  assert.ok(!request.selected.includes(content))
  assert.ok(request.selected.includes('cause missing') && request.selected.includes('add cause'))
  assert.ok(!request.selected.includes('metadata'))
  assert.equal(request.maxTokens, 2200)
  assert.throws(() => planRevisionRequest({ content:'x'.repeat(8001),review:{issues:[]} },'writer'))
  assert.throws(() => planRevisionRequest({ content,review:{issues:[{severity:'severe',reason:'x'.repeat(8001)}]} },'writer'))
})
