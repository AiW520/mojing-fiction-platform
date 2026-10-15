import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'

const root = resolve(import.meta.dirname, '../..')
const ts = createRequire(resolve(root, 'admin-web/package.json'))('typescript')
function load(path, dependencies, globals) {
  const source = ts.transpileModule(readFileSync(resolve(root, path), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  const exports = {}
  runInNewContext(source, { exports, require: id => { if (!(id in dependencies)) throw new Error(`Unexpected dependency: ${id}`); return dependencies[id] }, ...globals })
  return exports
}
function fixture(request) {
  const storage = new Map(); const menus = []; const navigations = []
  const wx = { getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value),
    showShareMenu: options => menus.push(['show', options.menus]), hideShareMenu: options => menus.push(['hide', options.menus]),
    nextTick: fn => fn(), showToast() {}, navigateBack: options => options.fail(), reLaunch: options => navigations.push(options.url),
    getSystemInfoSync: () => ({ windowHeight: 844, screenHeight: 844, safeArea: { bottom: 810 }, statusBarHeight: 44 }) }
  const share = load('miniprogram/utils/share.ts', { '../config': { getEnvironment: () => ({ apiBase: 'https://api.mojing.test' }) } }, { wx })
  const api = { request, ensureSession: async () => { throw new Error('login unavailable') }, ensureDevSession: async () => { throw new Error('login unavailable') } }
  function page(path) {
    let definition
    load(path, { '../../utils/api': api, '../../utils/share': share, '../../config': { getEnvironment: () => ({ apiBase: 'https://api.mojing.test' }) }, '../../utils/access': { getSession: () => ({ userId: '' }) }, '../../utils/library': load('miniprogram/utils/library.ts', { '../config': { getEnvironment: () => ({ apiBase: 'https://api.mojing.test' }) } }, { wx }),
      '../../utils/reader-cache': { readReaderCache: () => undefined, writeReaderCache() {} }, '../../utils/creator': { creatorMedia: async url => url }, '../../utils/reader-media': { cachedReaderMedia: async url => url },
      '../../utils/reader-illustrations': load('miniprogram/utils/reader-illustrations.ts', {}, {}) }, { wx, Page: item => { definition = item }, setTimeout, clearTimeout })
    return { ...definition, data: { ...definition.data }, setData(values) { Object.assign(this.data, values) },
      createSelectorQuery() { return { select() { return this }, boundingClientRect(fn) { this.callback = fn; return this }, exec() { this.callback({ height: 1600 }) } } } }
  }
  return { share, storage, menus, navigations, page, wx, api }
}
const work = { id: 'book', title: '测试作品', status: 'published', format: 'longform', characters: [], coverImage: '/assets/books/ghost-ledger/cover.webp' }
test('share payloads encode identifiers, reuse covers and exclude private data', () => {
  const f = fixture()
  const result = f.share.shareContent({ ...work, token: 'secret', progress: 80 }, 'book&id=other', { id: 'chapter#1', title: '夜查' }, true)
  const params = new URLSearchParams(result.query)
  assert.equal(params.get('workId'), 'book&id=other'); assert.equal(params.get('chapterId'), 'chapter#1')
  assert.equal(params.get('shared'), '1'); assert.equal(params.size, 3)
  assert.match(result.title, /夜查/); assert.equal(result.imageUrl, work.coverImage)
  assert.equal(f.share.shareImage('/api/assets/media'), 'https://api.mojing.test/api/assets/media')
  assert.equal(f.share.shareImage('javascript:alert(1)'), undefined)
  assert.equal(f.share.shareImage('http://unsafe.test/image'), undefined)
  assert.equal(f.share.shareImage(''), undefined)
  f.share.setShareMenu(true); assert.equal(f.menus[0][1].join(','), 'shareAppMessage,shareTimeline')
})
test('detail stays readable without login and only shares a loaded published work', async () => {
  const f = fixture(async path => path.endsWith('/assets') ? { items: [] } : { work })
  const page = f.page('miniprogram/pages/book/detail.ts')
  assert.equal(page.onShareAppMessage().path, '/pages/home/index')
  await page.onLoad({ id: 'book' })
  assert.equal(page.data.error, ''); assert.equal(page.data.loading, false); assert.equal(page.data.shareReady, true)
  assert.equal(page.onShareAppMessage().path, '/pages/book/detail?id=book&shared=1')
  assert.equal(page.onShareTimeline().query, 'id=book&shared=1')
  assert.equal(page.onShareTimeline().imageUrl, work.coverImage)
  page.back(); assert.equal(f.navigations[0], '/pages/home/index')
})
test('failed and unpublished details never share placeholder or private titles', async () => {
  const failed = fixture(async () => { throw new Error('作品不存在') }).page('miniprogram/pages/book/detail.ts')
  await failed.onLoad({ id: 'missing' }); assert.equal(failed.data.shareReady, false); assert.equal(failed.data.error, '作品不存在')
  assert.equal(failed.onShareAppMessage().path, '/pages/home/index')
  const f = fixture(async path => path.endsWith('/assets') ? { items: [] } : { work: { ...work, status: 'draft' } })
  const draft = f.page('miniprogram/pages/book/detail.ts'); await draft.onLoad({ id: 'book' })
  assert.equal(draft.data.shareReady, false); assert.equal(draft.onShareAppMessage().path, '/pages/home/index')
})
test('a shared chapter opens at its start without login instead of recipient saved position', async () => {
  const chapters = [{ id: 'one', chapterNumber: 1, title: '入城' }, { id: 'two', chapterNumber: 2, title: '夜查' }]
  const f = fixture(async path => {
    if (path.endsWith('/assets')) return { items: [] }
    if (path.includes('/chapters?')) return { items: chapters, total: 2 }
    if (path === '/api/chapters/two') return { chapter: { ...chapters[1], content: '正文', workId: 'book' }, prev: chapters[0], next: null }
    if (path === '/api/works/book') return { work }
    throw new Error(`unexpected request ${path}`)
  })
  f.storage.set('mojing_position__book', { blockId: 'two', scrollRatio: .8, progress: 90, updatedAt: 1 })
  const page = f.page('miniprogram/pages/reader/index.ts'); page.data.workId = 'book'
  await page.initialize('two')
  assert.equal(page.data.chapter.id, 'two'); assert.equal(page.data.scrollTop, 0); assert.equal(page.data.shareReady, true)
  assert.match(page.onShareAppMessage().path, /chapterId=two/)
  assert.equal(new URLSearchParams(page.onShareTimeline().query).get('chapterId'), 'two')
  await page.initialize('unavailable')
  assert.match(page.data.error, /分享章节不可用/); assert.equal(page.data.shareReady, false)
  assert.equal(page.onShareAppMessage().path, '/pages/home/index')
})
test('browser links whitelist reading identifiers and use current preview origin', async () => {
  const source = readFileSync(resolve(root, 'admin-web/preview/share.js'), 'utf8')
  const { previewShareData } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
  const result = previewShareData({ title: '作品', path: '/pages/reader/index?workId=book&chapterId=two&token=secret&progress=80' }, 'https://admin.mojing.test')
  const target = new URL(result.url)
  assert.equal(target.origin, 'https://admin.mojing.test')
  assert.equal(target.searchParams.get('page'), '/pages/reader/index?workId=book&chapterId=two&shared=1')
  assert.throws(() => previewShareData({ path: '/admin-api/models' }, target.origin))
})

test('timeline single-page mode does not call login or progress APIs', async () => {
  const f = fixture(async path => {
    if (path.endsWith('/assets')) return { items: [] }
    if (path === '/api/works/book') return { work: { ...work, format: 'short' } }
    if (path.endsWith('/blocks')) return { items: [{ id: 'short-one', content: '正文', sceneTitle: '第一章' }] }
    throw new Error(`private API must not run: ${path}`)
  })
  f.wx.getLaunchOptionsSync = () => ({ scene: 1154 })
  f.api.ensureSession = f.api.ensureDevSession = () => { assert.fail('login must not run') }
  const detail = f.page('miniprogram/pages/book/detail.ts'); await detail.onLoad({ id: 'book' })
  assert.equal(detail.data.shareReady, true)
  const reader = f.page('miniprogram/pages/reader/index.ts'); reader.data.workId = 'book'; await reader.initialize('short-one')
  assert.equal(reader.data.error, ''); assert.equal(reader.data.shareReady, true)
  assert.equal(reader.data.scrollIntoView, 'short-short-one')
  await reader.persistPosition(); assert.equal(f.storage.size, 0)
})
