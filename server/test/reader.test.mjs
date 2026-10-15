import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'

const root = resolve(import.meta.dirname, '../..')
const require = createRequire(resolve(root, 'admin-web/package.json'))
const ts = require('typescript')
function load(path, dependencies, globals) {
  const source = ts.transpileModule(readFileSync(resolve(root, path), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  const exports = {}
  runInNewContext(source, { exports, require: id => { if (!(id in dependencies)) throw new Error(`Unexpected dependency: ${id}`); return dependencies[id] }, ...globals })
  return exports
}
function fixture() {
  const values = new Map()
  let origin = 'https://api.mojing.test'
  const wx = { showShareMenu() {}, hideShareMenu() {}, getStorageSync: key => values.get(key), setStorageSync: (key, value) => values.set(key, value), removeStorageSync: key => values.delete(key),
    nextTick: fn => fn(), getSystemInfoSync: () => ({ windowHeight: 844, screenHeight: 844, safeArea: { bottom: 810 }, statusBarHeight: 44 }) }
  const cache = load('miniprogram/utils/reader-cache.ts', { '../config': { getEnvironment: () => ({ apiBase: origin }) } }, { wx })
  return { wx, cache, values, changeOrigin: value => { origin = value } }
}

function readerPage(f, request) {
  let definition
  load('miniprogram/pages/reader/index.ts', {
    '../../utils/api': { ensureSession: async () => {}, request },
    '../../utils/access': { getSession: () => ({ userId: 'reader' }) }, '../../utils/reader-cache': f.cache,
    '../../utils/reader-illustrations': load('miniprogram/utils/reader-illustrations.ts', {}, {}),
    '../../utils/creator': { creatorMedia: async url => url },
    '../../utils/reader-media': { cachedReaderMedia: async url => url },
    '../../utils/share': { setShareMenu() {}, isTimelinePreview: () => false },
  }, { wx: f.wx, Page: page => { definition = page }, setTimeout, clearTimeout })
  return { ...definition, data: { ...definition.data, workId: 'book' }, setData(values) { Object.assign(this.data, values) },
    createSelectorQuery() { return { select() { return this }, boundingClientRect(fn) { this.callback = fn; return this }, exec() { this.callback({ height: 1600 }) } } } }
}

test('chapter retry opens the failed target and reconnects after an offline cache miss', async () => {
  const f = fixture(), calls = []
  let connected = false
  const page = readerPage(f, async path => {
    if (path.endsWith('reading-progress')) return {}
    calls.push(path)
    if (!connected) throw new Error('network unavailable')
    return { chapter: { id: 'two', content: 'second chapter' }, prev: { id: 'one' }, next: null }
  })
  Object.assign(page.data, { loading: false, mode: 'longform', requestedChapter: 'one', work: { status: 'published' },
    chapter: { id: 'one' }, chapters: [{ id: 'one' }, { id: 'two' }], offline: true })
  await page.loadLongChapter('two')
  assert.match(page.data.error, /尚未缓存/)
  connected = true
  await page.retry()
  assert.equal(page.data.chapter.id, 'two')
  assert.equal(page.data.error, '')
  assert.equal(page.data.offline, false)
  assert.deepEqual(calls, ['/api/chapters/two'])
  page.onUnload()
})

test('invalid saved reader preferences fall back to readable defaults', () => {
  const f = fixture()
  f.values.set('mojing_reader_font_px', 'invalid')
  f.values.set('mojing_reader_line_height', {})
  f.values.set('mojing_reader_theme', 'unknown')
  const page = readerPage(f, async () => ({}))
  assert.equal(page.data.fontSize, 19)
  assert.equal(page.data.lineHeight, 1.9)
  assert.equal(page.data.theme, 'paper')
})
test('public reader cache is bounded and isolated by API environment', () => {
  const f = fixture()
  for (let i = 0; i < 50; i++) f.cache.writeReaderCache(`chapter_${i}`, { content: '内容'.repeat(10) })
  assert.equal(f.cache.readReaderCache('chapter_0'), undefined)
  assert.ok(f.cache.readReaderCache('chapter_49'))
  assert.equal([...f.values.keys()].filter(key => !key.endsWith('_index')).length, 36)
  f.cache.writeReaderCache('oversize', 'x'.repeat(3 * 1024 * 1024))
  assert.equal(f.cache.readReaderCache('oversize'), undefined)
  f.changeOrigin('https://another.mojing.test')
  assert.equal(f.cache.readReaderCache('chapter_49'), undefined)
})
test('reader reopens a saved cached chapter offline and gives a clear error for uncached chapters', async () => {
  const f = fixture()
  const work = { id: 'book', title: '测试作品', status: 'published', format: 'longform' }
  const chapters = [{ id: 'one', chapterNumber: 1 }, { id: 'two', chapterNumber: 2 }]
  f.cache.writeReaderCache('work_book', { work, chapters, assets: [], shortChapters: [] })
  f.cache.writeReaderCache('mojing_chapter_two', { chapter: { ...chapters[1], content: '第一段\n\n第二段' }, prev: { id: 'one' }, next: null })
  f.wx.setStorageSync('mojing_position_reader_book', { blockId: 'two', progress: 70, scrollRatio: .4, updatedAt: 1, pending: true })
  let definition
  let queries = 0
  load('miniprogram/pages/reader/index.ts', {
    '../../utils/api': { ensureSession: async () => { throw new Error('offline') }, request: async () => { queries++; throw new Error('offline') } },
    '../../utils/access': { getSession: () => ({ userId: 'reader' }) }, '../../utils/reader-cache': f.cache,
    '../../utils/reader-illustrations': load('miniprogram/utils/reader-illustrations.ts', {}, {}),
    '../../utils/creator': { creatorMedia: async url => url },
    '../../utils/reader-media': { cachedReaderMedia: async url => url },
    '../../utils/share': load('miniprogram/utils/share.ts', { '../config': { getEnvironment: () => ({ apiBase: 'https://api.mojing.test' }) } }, { wx: f.wx })
  }, { wx: f.wx, Page: page => { definition = page }, setTimeout, clearTimeout })
  const page = { ...definition, data: { ...definition.data, workId: 'book' }, setData(values) { Object.assign(this.data, values) },
    createSelectorQuery() { return { select() { return this }, boundingClientRect(fn) { this.callback = fn; return this }, exec() { this.callback({ height: 1600 }) } } } }
  await page.initialize()
  assert.equal(page.data.chapter.id, 'two')
  assert.equal(page.data.loading, false)
  assert.equal(page.data.error, '')
  assert.equal(page.data.offline, true)
  assert.ok(page.data.scrollTop > 0)
  assert.equal(queries, 1)
  page.toggleDirectory()
  assert.equal(page.data.directoryTarget, 'directory-two')
  const scenes = [0, 1, 2, 3, 4].map(index => ({ id: `scene-${index}`, chapterId: 'two', type: 'scene', title: '场景', url: `/art-${index}.webp`, paragraphIndex: index }))
  const { illustratedParagraphs } = load('miniprogram/utils/reader-illustrations.ts', {}, {})
  page.data.chapterParagraphs = illustratedParagraphs('一\n\n二\n\n三\n\n四\n\n五', scenes)
  let preview
  f.wx.previewImage = options => { preview = options }
  page.previewIllustration({ currentTarget: { dataset: { asset: 'scene-2' } } })
  assert.equal(preview.current, '/art-2.webp')
  assert.equal(preview.urls.length, 5)
  page.illustrationError({ currentTarget: { dataset: { asset: 'scene-2' } } })
  assert.equal(page.data.chapterParagraphs[2].text, '三')
  assert.equal(page.data.chapterParagraphs[2].illustrations.length, 1)
  assert.equal(page.data.chapterParagraphs[2].illustrations[0].loadError, true)
  assert.equal(page.data.chapterParagraphs[3].illustrations.length, 1)
  preview = undefined
  page.previewIllustration({ currentTarget: { dataset: { asset: 'scene-2' } } })
  assert.equal(preview, undefined)
  page.retryIllustration({ currentTarget: { dataset: { asset: 'scene-2' } } })
  assert.equal(page.data.chapterParagraphs[2].illustrations[0].loadError, false)
  page.previewIllustration({ currentTarget: { dataset: { asset: 'scene-2' } } })
  assert.equal(preview.current, '/art-2.webp')
  assert.equal(preview.urls.length, 5)
  page.toggleIllustrations({ detail: { value: false } })
  assert.equal(page.data.showIllustrations, false)
  assert.equal(f.values.get('mojing_reader_illustrations'), false)
  await page.loadLongChapter('one')
  assert.match(page.data.error, /尚未缓存/)
  assert.equal(page.data.chapter.id, 'two')
  page.onUnload()
})

test('reader anchors five scenes, keeps stable ordering and isolates legacy or invalid anchors', () => {
  const { illustratedParagraphs } = load('miniprogram/utils/reader-illustrations.ts', {}, {})
  const assets = [4, 3, 2, 1, 0].map(index => ({ id: `art-${index}`, chapterId: 'one', type: 'scene', title: '正文场景', url: `/scene-${index}.webp`, paragraphIndex: index, sortOrder: index }))
  const content = '开场\n\n冲突\n\n查证\n\n行动\n\n结尾'
  const rows = illustratedParagraphs(content, assets)
  assert.equal(rows.length, 5)
  assert.deepEqual(Array.from(rows, row => row.illustrations[0].id), ['art-0', 'art-1', 'art-2', 'art-3', 'art-4'])
  const legacy = illustratedParagraphs(content, [
    { ...assets[0], id: 'legacy', paragraphIndex: null, sortOrder: 1 },
    { ...assets[0], id: 'invalid', paragraphIndex: 999, sortOrder: 2 },
    { ...assets[0], id: 'broken', loadError: true },
    { ...assets[0], id: 'empty', url: '' },
  ])
  assert.deepEqual(Array.from(legacy.at(-1).illustrations, item => item.id), ['legacy', 'invalid'])
  assert.equal(illustratedParagraphs('', assets).length, 0)
  assert.equal(rows[0].text, '开场')
})
