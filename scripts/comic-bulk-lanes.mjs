import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, openSync, closeSync, unlinkSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { acquireLock } from './campus-comic-lock.mjs'

const root = resolve('artifacts/full-scene-artwork')
const laneRoot = resolve('artifacts/comic-bulk-production')
const assignments = [
  { name: 'ghost-033-066', book: 'ghost-ledger', first: 33, last: 66 },
  { name: 'ghost-067-100', book: 'ghost-ledger', first: 67, last: 100 },
  { name: 'cold-001-032', book: 'cold-command', first: 1, last: 32 },
  { name: 'cold-033-065', book: 'cold-command', first: 33, last: 65 },
]
const save = (path, data) => {
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`)
  renameSync(temporary, path)
}
const planPath = join(root, 'plan.json'), ledgerPath = join(root, 'ledger.json')
const plan = JSON.parse(readFileSync(planPath, 'utf8'))
const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'))
if (process.argv.includes('--init')) {
  assert.ok(!existsSync(join(root, 'generation.lock')) && !existsSync(join(root, 'publication.lock')), 'Canonical production is still active')
  const claims = new Set()
  for (const lane of assignments) {
    const directory = join(laneRoot, lane.name)
    mkdirSync(directory, { recursive: true })
    const entries = plan.entries.filter(e => e.bookDir === lane.book && e.chapterNumber >= lane.first && e.chapterNumber <= lane.last)
    assert.equal(entries.length, (lane.last - lane.first + 1) * 5)
    for (const entry of entries) { assert.ok(!claims.has(entry.id)); claims.add(entry.id) }
    if (!existsSync(join(directory, 'plan.json'))) save(join(directory, 'plan.json'), { ...plan, entries })
    if (!existsSync(join(directory, 'ledger.json'))) save(join(directory, 'ledger.json'), { ...ledger, entries: Object.fromEntries(entries.filter(e => ledger.entries[e.id]).map(e => [e.id, ledger.entries[e.id]])) })
    for (const entry of entries) entry.productionLane = lane.name
  }
  save(planPath, plan)
  save(join(laneRoot, 'assignments.json'), { createdAt: new Date().toISOString(), endpoint: 'https://api.tu-zi.com/coding', model: 'gpt-image-2', assignments })
  console.log(JSON.stringify({ lanes: assignments, assignedMaterials: claims.size }))
} else if (process.argv.includes('--merge')) {
  assert.ok(!existsSync(join(root, 'generation.lock')), 'Canonical generation is still active')
  assert.ok(!existsSync(join(root, 'publication.lock')), 'Canonical publication is still active')
  const release = acquireLock(join(root, 'bulk-merge.lock'))
  const held = []
  try {
    for (const name of ['generation.lock', 'publication.lock']) {
      const path = join(root, name)
      const fd = openSync(path, 'wx')
      held.push({ fd, path })
      writeFileSync(fd, String(process.pid))
    }
    const canonicalPlan = JSON.parse(readFileSync(planPath, 'utf8'))
    const canonicalLedger = JSON.parse(readFileSync(ledgerPath, 'utf8'))
    const index = new Map(canonicalPlan.entries.map(e => [e.id, e]))
    let merged = 0
    for (const lane of assignments) {
      const directory = join(laneRoot, lane.name)
      if (!existsSync(join(directory, 'plan.json'))) continue
      if (existsSync(join(directory, 'generation.lock')) || existsSync(join(directory, 'publication.lock'))) continue
      const lanePlan = JSON.parse(readFileSync(join(directory, 'plan.json'), 'utf8'))
      const laneLedger = JSON.parse(readFileSync(join(directory, 'ledger.json'), 'utf8'))
      for (const entry of lanePlan.entries) {
        assert.ok(entry.bookDir === lane.book && entry.chapterNumber >= lane.first && entry.chapterNumber <= lane.last)
        const current = index.get(entry.id)
        assert.ok(current)
        if (current.chapterTextHash) assert.equal(entry.chapterTextHash, current.chapterTextHash)
        const state = laneLedger.entries[entry.id]
        if (!state) continue
        const previous = canonicalLedger.entries[entry.id]
        if (previous?.status === 'published' && state.status !== 'published') continue
        Object.assign(current, entry)
        canonicalLedger.entries[entry.id] = state
        merged++
      }
    }
    save(planPath, canonicalPlan)
    save(ledgerPath, canonicalLedger)
    console.log(JSON.stringify({ merged }))
  } finally {
    for (const lock of held.reverse()) { closeSync(lock.fd); unlinkSync(lock.path) }
    release()
  }
} else {
  const totals = {}
  const lanes = assignments.map(lane => {
    const file = join(laneRoot, lane.name, 'ledger.json')
    const states = existsSync(file) ? Object.values(JSON.parse(readFileSync(file, 'utf8')).entries) : []
    const counts = {}
    for (const state of states) { counts[state.status] = (counts[state.status] || 0) + 1; totals[state.status] = (totals[state.status] || 0) + 1 }
    return { ...lane, counts, active: existsSync(join(laneRoot, lane.name, 'generation.lock')) }
  })
  console.log(JSON.stringify({ lanes, totals }))
}
