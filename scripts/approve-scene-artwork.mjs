import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'

const root = resolve(process.env.SCENE_ARTWORK_ROOT || 'artifacts/full-scene-artwork')
assert.ok(!existsSync(resolve(root, 'generation.lock')), 'Wait for the current generation batch to finish')
const planPath = resolve(root, 'plan.json')
const ledgerPath = resolve(root, 'ledger.json')
const plan = JSON.parse(readFileSync(planPath, 'utf8'))
const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'))
const requested = process.argv.slice(2)
if (!requested.length) throw new Error('Pass the visually reviewed material IDs explicitly')
const ids = new Set(requested)
assert.equal(ids.size, requested.length, 'Duplicate material ID')
for (const id of ids) {
  const item = plan.entries.find(entry => entry.id === id)
  const state = ledger.entries[id]
  assert.ok(item && state?.status === 'generated', `Not a generated material: ${id}`)
  assert.ok(!state.visualApprovedAt, `Already approved: ${id}`)
  const original = readFileSync(state.original)
  const mobile = readFileSync(state.mobile)
  assert.ok(original.length > 0 && mobile.length > 0)
  state.visualApprovedAt = new Date().toISOString()
  state.visualOriginalHash = createHash('sha256').update(original).digest('hex')
  state.visualMobileHash = createHash('sha256').update(mobile).digest('hex')
}
for (const [path, value] of [[planPath, plan], [ledgerPath, ledger]]) {
  writeFileSync(path + '.tmp', JSON.stringify(value, null, 2) + '\n', 'utf8')
  renameSync(path + '.tmp', path)
}
console.log(JSON.stringify({ approved: [...ids] }))
