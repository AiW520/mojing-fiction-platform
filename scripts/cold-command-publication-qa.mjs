import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { loadLongformCatalog } from '../server/src/longform.mjs'
import { readEnvFile } from '../server/src/config.mjs'

const books = loadLongformCatalog(resolve('server/content'))
const book = books.find(item => item.id === 'work_cold_command')
const endpoint = process.env.API_URL || 'http://127.0.0.1:3000'
let requests = 0
async function get(path) {
  const response = await fetch(`${endpoint}${path}`, { signal: AbortSignal.timeout(10000) })
  assert.equal(response.status, 200, path)
  requests++
  return response.json()
}
assert.ok((await get('/api/health')).ok)
const { work } = await get(`/api/works/${book.id}`)
assert.equal(work.words, book.currentWords)
assert.equal(work.chapterCount, book.chapters.length)
const directory = await get(`/api/works/${book.id}/chapters?limit=500`)
assert.equal(directory.total, book.chapters.length)
assert.equal(directory.items.length, book.chapters.length)
for (const [index, chapter] of book.chapters.entries()) {
  const item = directory.items[index]
  assert.equal(item.id, chapter.id)
  assert.equal(item.chapterNumber, index + 1)
  assert.equal(item.volumeId, book.volumes[Math.floor(index / 15)].id)
  assert.ok(chapter.wordCount >= 2500 && chapter.wordCount <= 3500)
  const payload = await get(`/api/chapters/${chapter.id}`)
  assert.equal(payload.chapter.content, chapter.content)
  assert.equal(payload.chapter.title, chapter.title)
  assert.equal(payload.chapter.wordCount, chapter.wordCount)
  assert.equal(payload.chapter.volumeId, chapter.volumeId)
  assert.equal(payload.prev?.id || null, book.chapters[index - 1]?.id || null)
  assert.equal(payload.next?.id || null, book.chapters[index + 1]?.id || null)
}
const { items } = await get(`/api/works/${book.id}/assets`)
const scenes = items.filter(item => item.type === 'scene' && item.chapterId === `${book.id}_chapter_065`)
assert.equal(scenes.length, 5)
const paragraphs = book.chapters[64].content.split(/\n\s*\n/).map(text => text.trim()).filter(Boolean)
for (const scene of scenes) {
  const expected = book.assets.find(item => item.id === scene.id)
  assert.equal(scene.url, expected.url)
  assert.equal(scene.paragraphIndex, expected.paragraphIndex)
  assert.ok(paragraphs[scene.paragraphIndex])
  const file = resolve('miniprogram', scene.url.slice(1))
  assert.ok(statSync(file).size > 0)
}
const locked = []
for (const [id, chapters, words] of [['work_bone_lantern', 80, 220003], ['work_ghost_ledger', 100, 320000]]) {
  const source = books.find(item => item.id === id)
  const detail = (await get(`/api/works/${id}`)).work
  assert.equal(source.chapters.length, chapters)
  assert.equal(source.currentWords, words)
  assert.equal(detail.chapterCount, chapters)
  assert.equal(detail.words, words)
  locked.push({ id, chapters, words, contentHash: createHash('sha256').update(source.chapters.map(chapter => chapter.content).join('\n')).digest('hex') })
}
const env = { ...readEnvFile(resolve('server/.env')), ...process.env }
const db = new DatabaseSync(resolve(env.DATA_DIR || 'server/data', 'mojing.sqlite'), { readOnly: true })
try {
  assert.equal(db.prepare('PRAGMA quick_check').get().quick_check, 'ok')
  const progress = db.prepare('SELECT * FROM reading_progress ORDER BY user_id,work_id').all()
  const progressHash = createHash('sha256').update(JSON.stringify(progress)).digest('hex')
  assert.equal(progressHash, '0e4879c073c597b25a52d323d8662c268c054fac2a087e9fc0306024d8ba5868')
  console.log(JSON.stringify({ requests, chapters: book.chapters.length, words: book.currentWords, chapter65Words: book.chapters[64].wordCount,
    sceneAnchors: scenes.map(item => item.paragraphIndex), sceneBytes: scenes.reduce((sum, item) => sum + readFileSync(resolve('miniprogram', item.url.slice(1))).length, 0),
    progressCount: progress.length, progressHash, locked, volumeWords: book.volumes.map(volume => ({ id: volume.id, words: book.chapters.filter(chapter => chapter.volumeId === volume.id).reduce((sum, chapter) => sum + chapter.wordCount, 0) })) }, null, 2))
} finally { db.close() }
