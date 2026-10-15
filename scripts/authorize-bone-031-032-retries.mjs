import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, renameSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'

const root = resolve('artifacts/full-scene-artwork')
const planPath = resolve(root, 'plan.json')
const ledgerPath = resolve(root, 'ledger.json')
const plan = JSON.parse(readFileSync(planPath, 'utf8'))
const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'))
const ids = [
  'work_bone_lantern_scene_031_05',
  'work_bone_lantern_scene_032_01',
  'work_bone_lantern_scene_032_02'
]
for (const id of ids) {
  const item = plan.entries.find(entry => entry.id === id)
  const state = ledger.entries[id]
  assert.ok(item && state?.status === 'failed', `Expected failed material: ${id}`)
  assert.ok(!state.retryAuthorization, `Retry authorization already recorded: ${id}`)
  assert.ok(item.promptReviewedAt && item.prompt)
  state.retryAuthorization = {
    authorizedAt: new Date().toISOString(),
    source: 'User reply in current chat: 授权这3张各新增一次请求',
    maxAdditionalRequests: 1,
    model: 'gpt-image-2',
    promptHash: createHash('sha256').update(item.prompt).digest('hex')
  }
}
for (const [path, value] of [[ledgerPath, ledger]]) {
  writeFileSync(path + '.tmp', JSON.stringify(value, null, 2) + '\n', 'utf8')
  renameSync(path + '.tmp', path)
}
console.log(JSON.stringify({ authorizedIds: ids, maxAdditionalRequests: 3, model: 'gpt-image-2' }))
