import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, renameSync, existsSync, openSync, closeSync, unlinkSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { readEnvFile } from '../server/src/config.mjs'
import { pathToFileURL } from 'node:url'

export function withdrawSceneArtwork({ artworkRoot, contentRoot, databasePath, rejectedId, reason }) {
assert.ok(rejectedId && reason, 'Pass the rejected material ID and explicit visual reason')
const root = resolve(artworkRoot)
assert.ok(!existsSync(join(root, 'generation.lock')), 'Wait for the generation batch')
const lockPath = join(root, 'publication.lock')
const lock = openSync(lockPath, 'wx')
writeFileSync(lock, String(process.pid))
let db
const save = (path, value) => {
  writeFileSync(path + '.tmp', JSON.stringify(value, null, 2) + '\n', 'utf8')
  renameSync(path + '.tmp', path)
}
try {
  const plan = JSON.parse(readFileSync(join(root, 'plan.json'), 'utf8'))
  const ledgerPath = join(root, 'ledger.json')
  const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'))
  const rejected = plan.entries.find(item => item.id === rejectedId)
  assert.ok(rejected)
  const items = plan.entries.filter(item => item.bookId === rejected.bookId && item.chapterNumber === rejected.chapterNumber)
  assert.equal(items.length, 5)
  assert.ok(items.every(item => item.status !== 'existing'), 'Do not withdraw reused illustrations')
  const manifestPath = resolve(contentRoot, rejected.bookDir, 'manifest.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  db = new DatabaseSync(databasePath)
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; BEGIN IMMEDIATE')
  try {
    const preserved = () => createHash('sha256').update(JSON.stringify([
      db.prepare('SELECT * FROM reading_progress ORDER BY user_id, work_id').all(),
      db.prepare('SELECT id, content, status FROM story_chapters ORDER BY id').all()
    ])).digest('hex')
    const before = preserved()
    for (const item of items) {
      assert.ok(['published', 'generated', 'visual_rejected'].includes(ledger.entries[item.id]?.status))
      db.prepare('DELETE FROM story_assets WHERE id = ? AND work_id = ?').run(item.id, item.bookId)
      db.prepare('UPDATE imported_media SET approved = 0 WHERE id = ? AND work_id = ?').run(`${item.id}_media`, item.bookId)
    }
    assert.equal(preserved(), before, 'Text and reading progress must be preserved')
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  const ids = new Set(items.map(item => item.id))
  manifest.assets = manifest.assets.filter(asset => !ids.has(asset.id))
  for (const item of items) {
    const state = ledger.entries[item.id]
    state.withdrawnPublication ||= { publishedAt: state.publishedAt, withdrawnAt: new Date().toISOString(), reason, url: state.url }
    delete state.publishedAt
    delete state.url
    state.status = item.id === rejectedId ? 'visual_rejected' : 'generated'
    if (item.id === rejectedId) {
      state.withdrawnApproval ||= { approvedAt: state.visualApprovedAt, originalHash: state.visualOriginalHash, mobileHash: state.visualMobileHash }
      delete state.visualApprovedAt
      delete state.visualOriginalHash
      delete state.visualMobileHash
      state.visualRejectedAt = new Date().toISOString()
      state.visualRejectionReason = reason
    }
  }
  save(manifestPath, manifest)
  save(ledgerPath, ledger)
  return { withdrawn: [...ids], rejectedId, textAndProgressPreserved: true }
} finally {
  db?.close()
  closeSync(lock)
  unlinkSync(lockPath)
}
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [rejectedId, reason] = process.argv.slice(2)
  const env = { ...readEnvFile(resolve('server/.env')), ...process.env }
  console.log(JSON.stringify(withdrawSceneArtwork({
    artworkRoot: resolve('artifacts/full-scene-artwork'), contentRoot: resolve('server/content'),
    databasePath: resolve(env.DATA_DIR || 'server/data', 'mojing.sqlite'), rejectedId, reason
  })))
}
