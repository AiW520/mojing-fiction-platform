import assert from 'node:assert/strict'
import test from 'node:test'
import { parseSkillResult, skillFailureDiagnostic } from './campus-skill-result.mjs'

test('skill failures are parsed from stderr without leaking provider messages', () => {
  const result = parseSkillResult(2, '', JSON.stringify({ code: 429, message: 'private provider details', saved_files: [] }))
  assert.equal(result.payload.code, 429)
  assert.deepEqual(skillFailureDiagnostic(result.payload), { code: 429, category: 'provider_http', resultUnknown: true })
  assert.ok(!JSON.stringify(skillFailureDiagnostic(result.payload)).includes('private'))
})

test('successful output requires a saved file and a zero payload code', () => {
  assert.equal(parseSkillResult(0, '{"code":0,"saved_files":["image.png"]}', '').payload.saved_files[0], 'image.png')
  for (const stdout of ['', '{}', '{"code":0,"saved_files":[]}', '{"code":3,"saved_files":["image.png"]}']) {
    assert.throws(() => parseSkillResult(0, stdout, ''), /SKILL_OUTPUT_INVALID/)
  }
})
