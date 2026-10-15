import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const [id, reason] = process.argv.slice(2)
assert.ok(id && reason, 'Pass an explicitly reviewed material ID and rejection reason')
const root = resolve(process.env.SCENE_ARTWORK_ROOT || 'artifacts/full-scene-artwork')
assert.ok(!existsSync(resolve(root, 'generation.lock')), 'Wait for the current generation batch to finish')
const path = resolve(root, 'ledger.json')
const ledger = JSON.parse(readFileSync(path, 'utf8'))
const state = ledger.entries[id]
assert.equal(state?.status, 'generated')
assert.ok(!state.visualApprovedAt, 'Do not silently withdraw a published approval')
Object.assign(state, { status: 'visual_rejected', visualRejectedAt: new Date().toISOString(), visualRejectionReason: reason })
writeFileSync(path + '.tmp', JSON.stringify(ledger, null, 2) + '\n', 'utf8')
renameSync(path + '.tmp', path)
console.log(JSON.stringify({ id, state: 'visual_rejected', reason }))
