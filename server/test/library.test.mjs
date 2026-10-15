import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'

const root = resolve(import.meta.dirname, '../..')
const ts = createRequire(resolve(root, 'admin-web/package.json'))('typescript')
function load(path, dependencies, globals) {
  const exports = {}
  const source = ts.transpileModule(readFileSync(resolve(root, path), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  runInNewContext(source, { exports, require: id => { if (!(id in dependencies)) throw new Error(`Unexpected dependency ${id}`); return dependencies[id] }, ...globals })
  return exports
}
const long = { id: 'long', title: '长篇作品', author: '作者', format: 'longform', serializationStatus: 'complete', words: 320000, chapterCount: 100, coverImage: '/cover.webp' }
const short = { id: 'short', title: '短篇作品', author: '作者', words: 6026, readMinutes: 18, type: '悬疑 · 奇想' }
const library = load('miniprogram/utils/library.ts', { '../config': { getEnvironment: () => ({ apiBase: 'https://api.mojing.test' }) } }, {})
const comics = load('miniprogram/utils/comics.ts', { '../config': { getEnvironment: () => ({ apiBase: 'https://api.mojing.test' }) } }, {})
const comic = { id: 'series', title: '漫画第一本', episodeCount: 2, panelCount: 8, coverUrl: '/api/comic-media/cover', latestEpisodeId: 'episode', episodes: [{ id: 'episode', title: '漫画第一本 · 第1话', panelCount: 4, coverUrl: '/api/comic-media/cover' }] }
function fixture({ books = [long, short], offline = false, cached, userId = 'reader', remote, loginUnavailable = false, comicItems = [], comicOffline = false } = {}) {
  const storage = new Map(); const navigation = []; const cacheWrites = []; const requests = []
  const wx = { getStorageSync: key => storage.get(key), navigateTo: options => navigation.push(options), showToast() {}, stopPullDownRefresh() {} }
  let definition
  load('miniprogram/pages/home/index.ts', {
    '../../utils/api': { ensureSession: async () => { if (offline || loginUnavailable) throw new Error('offline') }, request: async path => {
      requests.push(path)
      if (path === '/api/works') { if (offline) throw new Error('offline'); return { items: books } }
      if (path === '/api/comic-series') { if (comicOffline) throw new Error('comic offline'); return { items: comicItems } }
      return { progress: remote || { progress: 0 } }
    } },
    '../../utils/access': { getSession: () => ({ userId }) }, '../../utils/library': library, '../../utils/comics': comics,
    '../../utils/reader-cache': { readReaderCache: key => key === 'library' ? cached : undefined, writeReaderCache: (key, value) => cacheWrites.push({ key, value }) },
  }, { wx, Page: page => { definition = page } })
  const page = { ...definition, data: { ...definition.data }, setData(values) { Object.assign(this.data, values) } }
  return { page, storage, navigation, requests, cacheWrites }
}
const event = (key, value) => ({ currentTarget: { dataset: { [key]: value } } })
const settle = () => new Promise(resolve => setImmediate(resolve))

test('library uses actual metadata and stable typographic cover tones', () => {
  assert.equal(library.displayBook(long).wordLabel, '32万字')
  assert.equal(library.displayBook(long).readingLabel, '100章')
  assert.equal(library.displayBook(short).readingLabel, '约18分钟')
  assert.equal(library.displayBook(short).genreLabel, '悬疑')
  assert.equal(library.displayBook(short).coverTone, library.displayBook(short).coverTone)
  assert.equal(library.displayBook({ ...short, coverImage: '/api/assets/import-cover' }).coverImage, 'https://api.mojing.test/api/assets/import-cover')
  assert.equal(library.boundedProgress('invalid'), 0); assert.equal(library.boundedProgress(140), 100)
})

test('a login failure does not hide the public catalog or label it offline', async () => {
  const f = fixture({ loginUnavailable: true }); await f.page.onShow(); await settle()
  assert.equal(f.page.data.allBooks.length, 2); assert.equal(f.page.data.offline, false)
  assert.equal(f.page.data.error, ''); assert.equal(f.page.data.loading, false)
})
test('library filters genres, preserves category on refresh and shows no fabricated continue card', async () => {
  const f = fixture(); await f.page.onShow(); await settle()
  assert.equal(f.page.data.longBooks.length, 1); assert.equal(f.page.data.shortBooks.length, 1)
  assert.equal(f.page.data.hasReading, false)
  f.page.chooseCategory(event('category', '短篇'))
  assert.equal(f.page.data.visibleCount, 1); assert.equal(f.page.data.longBooks.length, 0)
  await f.page.refreshLibrary(); assert.equal(f.page.data.category, '短篇'); assert.equal(f.page.data.shortBooks.length, 1)
  f.page.chooseCategory(event('category', 'invalid')); assert.equal(f.page.data.category, '短篇')
})
test('continue reading is account scoped, respects pending local progress and accepts chapter start at zero', async () => {
  const f = fixture({ remote: { progress: 90, block_id: 'other-chapter' } })
  f.storage.set('mojing_last_work', { userId: 'reader', workId: 'long' })
  f.storage.set('mojing_position_reader_long', { blockId: 'chapter-one', progress: 0, pending: true })
  await f.page.onShow(); await settle()
  assert.equal(f.page.data.hasReading, true); assert.equal(f.page.data.continueBook.progress, 0)
  f.page.openReader(); assert.equal(f.navigation[0].url, '/pages/reader/index?workId=long')
  f.page.openReader(); assert.equal(f.navigation.length, 1)
  const another = fixture()
  another.storage.set('mojing_last_work', { userId: 'someone-else', workId: 'long' })
  await another.page.onShow(); await settle()
  assert.equal(another.page.data.hasReading, false); assert.equal(another.requests.filter(path => path !== '/api/comic-series').length, 1)
})
test('remote position restores continue reading even when the local position is absent', async () => {
  const f = fixture({ remote: { progress: 45, block_id: 'chapter-middle' } })
  f.storage.set('mojing_last_work', { userId: 'reader', workId: 'long' })
  await f.page.onShow(); await settle()
  assert.equal(f.page.data.hasReading, true); assert.equal(f.page.data.continueBook.progress, 45)
})
test('offline catalog, empty category, broken cover and navigation failure recover correctly', async () => {
  const f = fixture({ offline: true, cached: [short] }); await f.page.onShow()
  assert.equal(f.page.data.offline, true); assert.equal(f.page.data.loading, false)
  f.page.chooseCategory(event('category', '长篇')); assert.equal(f.page.data.visibleCount, 0)
  f.page.chooseCategory(event('category', '全部'))
  f.page.openDetail(event('id', 'short')); assert.equal(f.navigation[0].url, '/pages/reader/index?workId=short')
  f.navigation[0].fail(); assert.equal(f.page.data.navigating, false)
  f.page.openDetail(event('id', 'nonexistent')); assert.equal(f.navigation.length, 1)
  const online = fixture(); await online.page.onShow()
  online.page.onCoverError(event('id', 'long'))
  assert.equal(online.page.data.longBooks[0].coverImage, '')
  assert.equal(online.cacheWrites.find(item => item.key === 'library').value[0].coverImage, '/cover.webp')
  const empty = fixture({ books: [] }); await empty.page.onShow(); assert.equal(empty.page.data.visibleCount, 0)
  const failed = fixture({ offline: true }); await failed.page.onShow(); assert.equal(failed.page.data.error, 'offline')
})

test('home discovers real comics independently of novels and handles category, missing covers and failures', async () => {
  const f = fixture({ offline: true, comicItems: [comic] }); await f.page.onShow(); await settle()
  assert.equal(f.page.data.error, 'offline')
  assert.equal(f.page.data.featuredComics.length, 1)
  assert.equal(f.page.data.comics[0].coverUrl, 'https://api.mojing.test/api/comic-media/cover')
  f.page.chooseCategory(event('category', '漫画'))
  assert.equal(f.page.data.visibleCount, 1); assert.equal(f.page.data.longBooks.length, 0)
  f.page.openComic(event('id', 'series')); assert.equal(f.navigation[0].url, '/pages/comics/index?seriesId=series')
  f.page.onComicCoverError(event('id', 'series')); assert.equal(f.page.data.featuredComics[0].coverUrl, '')
  const failed = fixture({ comicOffline: true }); await failed.page.onShow(); await settle()
  assert.equal(failed.page.data.allBooks.length, 2); assert.equal(failed.page.data.comicError, 'comic offline')
})
