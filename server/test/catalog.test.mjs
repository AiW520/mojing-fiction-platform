import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadLongformCatalog } from '../src/longform.mjs'
import { editorialCatalog, catalogMeta } from '../src/catalog.mjs'

test('all longform covers and bundled story assets resolve to real mini program files', () => {
  const root = resolve(import.meta.dirname, '../..')
  const books = loadLongformCatalog(resolve(root, 'server/content'))
  assert.ok(books.length >= 3)
  for (const book of books) {
    for (const url of [book.cover, ...(book.assets || []).map(asset => asset.url)]) {
      if (!url?.startsWith('/assets/')) continue
      assert.ok(existsSync(resolve(root, 'miniprogram', url.slice(1))), `${book.id}: missing asset ${url}`)
    }
  }
  assert.equal(books.find(book => book.id === 'work_ghost_ledger').cover, '/assets/books/ghost-ledger/cover-ink-v2.webp')
})

test('all editorial works have generated optimized covers', () => {
  const root = resolve(import.meta.dirname, '../..')
  for (const work of editorialCatalog) {
    const url = catalogMeta(work).coverImage
    assert.ok(url.startsWith('/assets/books/editorial/'))
    assert.ok(existsSync(resolve(root,'miniprogram',url.slice(1))),work.id)
  }
})

test('cold command chapters remain sequential, readable and within the editorial length limits', () => {
  const root = resolve(import.meta.dirname, '../..')
  const book = loadLongformCatalog(resolve(root, 'server/content')).find(item => item.id === 'work_cold_command')
  assert.ok(book)
  assert.ok(book.chapters.length >= 12)
  assert.equal(book.currentWords, book.chapters.reduce((sum, item) => sum + item.wordCount, 0))
  for (const [index, chapter] of book.chapters.entries()) {
    assert.equal(chapter.number, index + 1)
    assert.ok(chapter.wordCount >= 2500 && chapter.wordCount <= 3500, `chapter ${chapter.number}: ${chapter.wordCount}`)
    assert.equal(chapter.wordCount, chapter.content.replace(/\s/g, '').length)
    assert.equal(chapter.volumeId, book.volumes[Math.floor(index / 15)].id)
  }
})
