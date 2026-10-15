import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { loadLongformCatalog } from '../server/src/longform.mjs'

const root = resolve('artifacts/full-scene-artwork')
const plan = JSON.parse(readFileSync(join(root, 'plan.json'), 'utf8'))
const ledger = JSON.parse(readFileSync(join(root, 'ledger.json'), 'utf8'))
const books = loadLongformCatalog(resolve('server/content'))
const sharp = createRequire(resolve('server/package.json'))('sharp')
const statuses = {}
const chapterKeys = new Set()
const ids = new Set()
const tiles = []
for (const entry of plan.entries) {
  assert.ok(!ids.has(entry.id), 'Material identifiers must be unique')
  ids.add(entry.id)
  chapterKeys.add(`${entry.bookId}:${entry.chapterNumber}`)
  const book = books.find(b => b.id === entry.bookId)
  const chapter = book.chapters.find(c => c.number === entry.chapterNumber)
  assert.ok(chapter)
  const paragraphs = chapter.content.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean)
  assert.ok(Number.isInteger(entry.paragraphIndex) && entry.paragraphIndex >= 0 && entry.paragraphIndex < paragraphs.length)
  if (entry.chapterTextHash) assert.equal(createHash('sha256').update(chapter.content).digest('hex'), entry.chapterTextHash)
  const state = ledger.entries[entry.id]
  const status = state?.status || entry.status
  statuses[status] = (statuses[status] || 0) + 1
  if (['generated', 'published', 'visual_rejected'].includes(status)) {
    assert.ok(statSync(state.original).size > 0 && statSync(state.mobile).size > 0)
    const image = await sharp(state.mobile).metadata()
    assert.equal(image.format, 'webp')
    assert.ok(image.width <= 900)
    if (tiles.length < 10) {
      const tile = await sharp(state.mobile).resize(512, 342, { fit: 'contain', background: '#f5f5f7' }).png().toBuffer()
      tiles.push({ input: tile, left: 0, top: tiles.length * 342 })
    }
  }
}
for (const key of chapterKeys) assert.equal(plan.entries.filter(e => `${e.bookId}:${e.chapterNumber}` === key).length, 5)
assert.equal(chapterKeys.size, 245)
assert.equal(plan.entries.length, 1225)
for (const [id, chapters, words] of [['work_bone_lantern', 80, 220003], ['work_ghost_ledger', 100, 320000], ['work_cold_command', 65, 186629]]) {
  const book = books.find(b => b.id === id)
  assert.equal(book.chapters.length, chapters)
  assert.equal(book.currentWords, words)
}
if (tiles.length) await sharp({ create: { width: 512, height: tiles.length * 342, channels: 3, background: '#f5f5f7' } }).composite(tiles).png().toFile(join(root, 'first-batch-contact.png'))
const summary = { chapters: chapterKeys.size, targetImages: plan.entries.length, statuses, generationRequests: Object.values(ledger.entries).reduce((total, entry) => total + 1 + (entry.attempts?.length || 0), 0), publishedNewImages: statuses.published || 0 }
writeFileSync(join(root, 'status.json'), JSON.stringify(summary, null, 2) + '\n', 'utf8')
console.log(JSON.stringify(summary))
