import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync, cpSync, renameSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createServer } from 'node:net'
import { DatabaseSync, backup } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { publishSceneArtwork } from './publish-scene-artwork.mjs'
import { withdrawSceneArtwork } from './withdraw-scene-artwork.mjs'
import { readEnvFile } from '../server/src/config.mjs'
import { loadLongformCatalog, seedLongformCatalog } from '../server/src/longform.mjs'

const root = resolve('artifacts/full-scene-artwork/publication-qa-' + Date.now())
const artworkRoot = join(root, 'artwork')
const contentRoot = join(root, 'content')
const dataRoot = join(root, 'data')
for (const path of [artworkRoot, contentRoot, dataRoot]) mkdirSync(path, { recursive: true })
for (const name of ['plan.json', 'ledger.json']) cpSync(resolve('artifacts/full-scene-artwork', name), join(artworkRoot, name))
const plan = JSON.parse(readFileSync(join(artworkRoot, 'plan.json'), 'utf8'))
for (const bookDir of new Set(plan.entries.map(item => item.bookDir))) {
  mkdirSync(join(contentRoot, bookDir), { recursive: true })
  cpSync(resolve('server/content', bookDir, 'manifest.json'), join(contentRoot, bookDir, 'manifest.json'))
}
const env = { ...readEnvFile(resolve('server/.env')), ...process.env }
const source = new DatabaseSync(resolve(env.DATA_DIR || 'server/data', 'mojing.sqlite'), { readOnly: true })
const databasePath = join(dataRoot, 'mojing.sqlite')
try { await backup(source, databasePath) } finally { source.close() }
const options = { artworkRoot, contentRoot, databasePath }
const hash = value => createHash('sha256').update(value).digest('hex')
const snapshot = () => {
  const db = new DatabaseSync(databasePath, { readOnly: true })
  try {
    return {
      progress: hash(JSON.stringify(db.prepare('SELECT * FROM reading_progress ORDER BY user_id, work_id').all())),
      chapters: hash(JSON.stringify(db.prepare('SELECT id, content, word_count, status FROM story_chapters ORDER BY id').all())),
      media: db.prepare('SELECT COUNT(*) AS n FROM imported_media').get().n,
      assets: db.prepare('SELECT COUNT(*) AS n FROM story_assets').get().n
    }
  } finally { db.close() }
}
const ledgerPath = join(artworkRoot, 'ledger.json')
const manifestPath = join(contentRoot, 'bone-lantern/manifest.json')
const ids = [1, 2, 3, 4, 5].map(slot => `work_bone_lantern_scene_002_0${slot}`)
const fixtureLedger = JSON.parse(readFileSync(ledgerPath, 'utf8'))
fixtureLedger.entries = Object.fromEntries(ids.map(id => [id, { ...fixtureLedger.entries[id], status: 'generated' }]))
for (const state of Object.values(fixtureLedger.entries)) { delete state.publishedAt; delete state.url }
writeFileSync(ledgerPath, JSON.stringify(fixtureLedger), 'utf8')
const fixtureManifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
fixtureManifest.assets = fixtureManifest.assets.filter(item => !ids.includes(item.id))
writeFileSync(manifestPath, JSON.stringify(fixtureManifest), 'utf8')
const fixtureDb = new DatabaseSync(databasePath)
try {
  for (const id of ids) {
    fixtureDb.prepare('DELETE FROM story_assets WHERE id = ?').run(id)
    fixtureDb.prepare('DELETE FROM imported_media WHERE id = ?').run(`${id}_media`)
  }
} finally { fixtureDb.close() }
const ledgerSource = readFileSync(ledgerPath, 'utf8')
const manifestSource = readFileSync(manifestPath, 'utf8')
const before = snapshot()
const ledger = JSON.parse(ledgerSource)
delete ledger.entries[ids[4]].visualApprovedAt
writeFileSync(ledgerPath, JSON.stringify(ledger), 'utf8')
assert.deepEqual(publishSceneArtwork(options), [])
assert.deepEqual(snapshot(), before)
writeFileSync(ledgerPath, ledgerSource, 'utf8')
const published = publishSceneArtwork(options)
assert.equal(published.length, 1)
assert.equal(published[0].chapterId, 'work_bone_lantern_chapter_002')
const after = snapshot()
assert.equal(after.progress, before.progress)
assert.equal(after.chapters, before.chapters)
assert.equal(after.media, before.media + 5)
assert.equal(after.assets, before.assets + 5)
publishSceneArtwork(options)
assert.deepEqual(snapshot(), after)
writeFileSync(ledgerPath, ledgerSource, 'utf8')
writeFileSync(manifestPath, manifestSource, 'utf8')
publishSceneArtwork(options)
assert.deepEqual(snapshot(), after)
assert.equal(JSON.parse(readFileSync(manifestPath, 'utf8')).assets.filter(item => item.chapterNumber === 2).length, 5)
withdrawSceneArtwork({ ...options, rejectedId: ids[0], reason: 'Isolated visual rejection fixture' })
const withdrawn = snapshot()
assert.equal(withdrawn.progress, before.progress)
assert.equal(withdrawn.chapters, before.chapters)
assert.equal(withdrawn.assets, before.assets)
const withdrawnLedger = JSON.parse(readFileSync(ledgerPath, 'utf8'))
assert.equal(withdrawnLedger.entries[ids[0]].status, 'visual_rejected')
assert.ok(withdrawnLedger.entries[ids[0]].withdrawnApproval)
assert.ok(withdrawnLedger.entries[ids[0]].withdrawnPublication)
const replacementDb = new DatabaseSync(databasePath)
try {
  assert.equal(replacementDb.prepare('SELECT SUM(approved) AS n FROM imported_media WHERE chapter_id = ?').get('work_bone_lantern_chapter_002').n, 0)
  replacementDb.prepare('UPDATE imported_media SET original = ?, webp = ? WHERE id = ?').run(Buffer.from('rejected-original'), Buffer.from('rejected-mobile'), `${ids[0]}_media`)
} finally { replacementDb.close() }
writeFileSync(ledgerPath, ledgerSource, 'utf8')
publishSceneArtwork(options)
assert.deepEqual(snapshot(), after)
const verifyReplacement = new DatabaseSync(databasePath, { readOnly: true })
try { assert.equal(hash(verifyReplacement.prepare('SELECT original FROM imported_media WHERE id = ?').get(`${ids[0]}_media`).original), fixtureLedger.entries[ids[0]].visualOriginalHash) }
finally { verifyReplacement.close() }
const bad = JSON.parse(readFileSync(ledgerPath, 'utf8'))
bad.entries[ids[0]].visualOriginalHash = 'tampered'
writeFileSync(ledgerPath, JSON.stringify(bad), 'utf8')
assert.throws(() => publishSceneArtwork(options), /Original changed after visual approval/)
assert.deepEqual(snapshot(), after)
writeFileSync(ledgerPath, ledgerSource, 'utf8')
publishSceneArtwork(options)
const restarted = new DatabaseSync(databasePath)
try {
  seedLongformCatalog(restarted, loadLongformCatalog(resolve('server/content')))
  assert.equal(restarted.prepare("SELECT COUNT(*) AS n FROM story_assets WHERE chapter_id = 'work_bone_lantern_chapter_002'").get().n, 5)
} finally { restarted.close() }
assert.deepEqual(snapshot(), after)

const portProbe = createServer()
portProbe.listen(0, '127.0.0.1')
await once(portProbe, 'listening')
const port = portProbe.address().port
await new Promise((done, reject) => portProbe.close(error => error ? reject(error) : done()))
const base = `http://127.0.0.1:${port}`
const server = spawn(process.execPath, ['--experimental-sqlite', 'server/src/server.mjs'], {
  env: { ...process.env, DATA_DIR: dataRoot, PORT: String(port), HOST: '127.0.0.1' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
})
let serverFailed = false
server.on('exit', () => { serverFailed = true })
server.stdout.resume()
server.stderr.resume()
try {
  let ready = false
  for (let attempt = 0; attempt < 50; attempt++) {
    if (serverFailed) throw new Error('Isolated API server exited')
    try {
      const response = await fetch(base + '/api/health')
      if (response.ok) { ready = true; break }
    } catch {}
    await new Promise(done => setTimeout(done, 100))
  }
  assert.ok(ready, 'Isolated API must start')
  for (const id of ids) {
    const url = `${base}/api/assets/${id}_media`
    const mobile = await fetch(url)
    assert.equal(mobile.status, 200)
    assert.equal(mobile.headers.get('content-type'), 'image/webp')
    assert.ok((await mobile.arrayBuffer()).byteLength > 0)
    const original = await fetch(url + '/original')
    assert.equal(original.status, 404, 'Original must be hidden from unauthenticated visitors')
  }
} finally {
  if (server.exitCode === null) {
    const exited = once(server, 'exit')
    server.kill()
    await exited
  }
}
const report = { partialChapterSkipped: true, fiveImagesPublished: true, duplicateAndCrashReplaySafe: true, changedMediaRejected: true, visualWithdrawalPreservesHistory: true, withheldMediaReplacement: true, readingProgressPreserved: true, chaptersPreserved: true, restartPersists: true, publicMobileImages: true, originalsProtected: true, root }
writeFileSync(join(root, 'result.json'), JSON.stringify(report, null, 2) + '\n', 'utf8')
console.log(JSON.stringify(report))
