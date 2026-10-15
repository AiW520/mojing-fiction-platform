import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, renameSync, openSync, closeSync, unlinkSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { readEnvFile } from '../server/src/config.mjs'
import { acquireLock } from './campus-comic-lock.mjs'

const hash = value => createHash('sha256').update(value).digest('hex')
function save(path, value) {
  writeFileSync(path + '.tmp', JSON.stringify(value, null, 2) + '\n', 'utf8')
  renameSync(path + '.tmp', path)
}

export function publishSceneArtwork({ artworkRoot, contentRoot, databasePath }) {
  assert.ok(!existsSync(join(artworkRoot, 'generation.lock')), 'Wait for the current generation batch to finish')
  const lockPath = join(artworkRoot, 'publication.lock')
  const releaseDatabaseLock = acquireLock(`${databasePath}.scene-publication.lock`)
  let lock
  try { lock = openSync(lockPath, 'wx') } catch (error) { releaseDatabaseLock(); throw error }
  writeFileSync(lock, String(process.pid))
  let db
  try {
    const plan = JSON.parse(readFileSync(join(artworkRoot, 'plan.json'), 'utf8'))
    const ledgerPath = join(artworkRoot, 'ledger.json')
    const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'))
    assert.equal(new Set(plan.entries.map(item => item.id)).size, plan.entries.length, 'Duplicate material ID')
    const groups = Map.groupBy(plan.entries, item => `${item.bookId}:${item.chapterNumber}`)
    db = new DatabaseSync(databasePath)
    db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
    const progressHash = () => hash(JSON.stringify(db.prepare('SELECT * FROM reading_progress ORDER BY user_id, work_id').all()))
    const published = []
    for (const all of groups.values()) {
      assert.equal(all.length, 5, 'Every chapter requires exactly five planned images')
      if (all.some(item => item.status !== 'existing' && (!ledger.entries[item.id]?.visualApprovedAt || !['generated', 'published'].includes(ledger.entries[item.id]?.status)))) continue
      if (all.every(item => item.status === 'existing')) continue
      const first = all[0]
      const chapterId = `${first.bookId}_chapter_${String(first.chapterNumber).padStart(3, '0')}`
      const manifestPath = resolve(contentRoot, first.bookDir, 'manifest.json')
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      assert.equal(manifest.id, first.bookId)
      const chapter = db.prepare("SELECT content FROM story_chapters WHERE id = ? AND work_id = ? AND status = 'published'").get(chapterId, first.bookId)
      assert.ok(chapter, 'Chapter must already be published')
      const paragraphs = chapter.content.split(/\n\s*\n/).map(value => value.trim()).filter(Boolean)
      const owner = db.prepare("SELECT owner_id FROM works WHERE id = ? AND status = 'published'").get(first.bookId)?.owner_id
      assert.ok(owner, 'Work must already be public')
      // Validate all media before either the database or the manifest is changed.
      const media = new Map()
      for (const item of all) {
        assert.equal(hash(chapter.content), item.chapterTextHash, 'Published chapter changed since scene review')
        assert.ok(Number.isInteger(item.paragraphIndex) && item.paragraphIndex >= 0 && item.paragraphIndex < paragraphs.length)
        if (item.status === 'existing') {
          assert.ok(manifest.assets.find(asset => asset.id === item.id), 'Existing asset missing from manifest')
          continue
        }
        const state = ledger.entries[item.id]
        const original = readFileSync(state.original)
        const mobile = readFileSync(state.mobile)
        assert.ok(original.length > 0 && mobile.length > 0)
        assert.equal(hash(original), state.visualOriginalHash, 'Original changed after visual approval')
        assert.equal(hash(mobile), state.visualMobileHash, 'Mobile image changed after visual approval')
        assert.equal(hash(item.prompt), state.promptHash, 'Prompt changed after request')
        media.set(item.id, { original, mobile })
      }
      db.exec('BEGIN IMMEDIATE')
      try {
        const progressBefore = progressHash()
        for (const item of all) {
          if (item.status === 'existing') {
            const asset = manifest.assets.find(value => value.id === item.id)
            asset.paragraphIndex = item.paragraphIndex
            db.prepare('UPDATE story_assets SET paragraph_index = ? WHERE id = ? AND work_id = ?').run(item.paragraphIndex, item.id, first.bookId)
            continue
          }
          const state = ledger.entries[item.id]
          const { original, mobile } = media.get(item.id)
          const jobId = state.publicationJobId || `${item.id}_tuzi_job${state.attempts?.length ? `_attempt_${state.attempts.length + 1}` : ''}`
          const mediaId = `${item.id}_media`
          const url = `/api/assets/${mediaId}`
          db.prepare(`INSERT INTO generation_jobs(id, owner_id, work_id, job_type, status, request_json, result_json, finished_at)
            VALUES (?, ?, ?, 'longform_scene_backfill', 'success', ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(id) DO NOTHING`)
            .run(jobId, owner, item.bookId, JSON.stringify({ model: state.model, modelConfigId: state.modelConfigId, channel: 'coding', sourceHash: item.chapterTextHash, materialKey: item.id, prompt: item.prompt }), JSON.stringify({ mediaId, assetUrl: url }))
          db.prepare(`INSERT INTO imported_media(id, work_id, chapter_id, job_id, kind, prompt, original, original_mime, webp, approved)
            VALUES (?, ?, ?, ?, 'scene', ?, ?, 'image/png', ?, 1)
            ON CONFLICT(id) DO UPDATE SET job_id = excluded.job_id, prompt = excluded.prompt,
              original = excluded.original, original_mime = excluded.original_mime, webp = excluded.webp, approved = 1
            WHERE imported_media.approved = 0 AND imported_media.work_id = excluded.work_id AND imported_media.chapter_id = excluded.chapter_id`)
            .run(mediaId, item.bookId, chapterId, jobId, item.prompt, original, mobile)
          const stored = db.prepare('SELECT original, webp, work_id, chapter_id, approved FROM imported_media WHERE id = ?').get(mediaId)
          assert.equal(stored.work_id, item.bookId)
          assert.equal(stored.chapter_id, chapterId)
          assert.equal(stored.approved, 1)
          assert.equal(hash(stored.original), state.visualOriginalHash)
          assert.equal(hash(stored.webp), state.visualMobileHash)
          db.prepare(`INSERT INTO story_assets(id, work_id, chapter_id, asset_type, title, asset_url, sort_order, paragraph_index, approval_status)
            VALUES (?, ?, ?, 'scene', ?, ?, ?, ?, 'approved')
            ON CONFLICT(id) DO UPDATE SET paragraph_index = excluded.paragraph_index, asset_url = excluded.asset_url, title = excluded.title, sort_order = excluded.sort_order, approval_status = 'approved'`)
            .run(item.id, item.bookId, chapterId, item.title, url, item.slot, item.paragraphIndex)
          const asset = { id: item.id, type: 'scene', title: item.title, url, chapterNumber: item.chapterNumber, paragraphIndex: item.paragraphIndex, sortOrder: item.slot }
          const existing = manifest.assets.find(value => value.id === item.id)
          if (existing) Object.assign(existing, asset)
          else manifest.assets.push(asset)
          Object.assign(state, { status: 'published', publishedAt: state.publishedAt || new Date().toISOString(), publicationJobId: jobId, url })
        }
        assert.equal(progressHash(), progressBefore, 'Reading progress must be preserved')
        assert.ok(db.prepare("SELECT COUNT(*) AS n FROM story_assets WHERE chapter_id = ? AND asset_type = 'scene' AND approval_status = 'approved'").get(chapterId).n >= 5)
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
      // Replaying a committed chapter repairs an interrupted manifest/ledger save.
      save(manifestPath, manifest)
      save(ledgerPath, ledger)
      published.push({ chapterId, scenes: 5, state: 'published', progressPreserved: true })
    }
    assert.equal(db.prepare('PRAGMA quick_check').get().quick_check, 'ok')
    return published
  } finally {
    db?.close()
    closeSync(lock)
    unlinkSync(lockPath)
    releaseDatabaseLock()
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const env = { ...readEnvFile(resolve('server/.env')), ...process.env }
  const result = publishSceneArtwork({ artworkRoot: resolve(process.env.SCENE_ARTWORK_ROOT || 'artifacts/full-scene-artwork'), contentRoot: resolve('server/content'), databasePath: resolve(env.DATA_DIR || 'server/data', 'mojing.sqlite') })
  console.log(JSON.stringify({ published: result }))
}
