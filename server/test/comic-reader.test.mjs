import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'

const root = resolve(import.meta.dirname, '../..')
const ts = createRequire(resolve(root, 'admin-web/package.json'))('typescript')
function load(path, dependencies, globals) {
  const source = ts.transpileModule(readFileSync(resolve(root, path), 'utf8'), { compilerOptions:{ module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2020 } }).outputText
  const exports = {}
  runInNewContext(source, { exports, require:id => dependencies[id], ...globals })
  return exports
}
function fixture() {
  const storage = new Map(); let origin = 'https://one.test'; let height = 2400; const scrolls = []; let definition
  const wx = { getStorageSync:key => storage.get(key), setStorageSync:(key,value) => storage.set(key,value), removeStorageSync:key => storage.delete(key), nextTick:fn => fn(), getSystemInfoSync:() => ({ windowHeight:800 }), pageScrollTo:options => scrolls.push(options.scrollTop) }
  const config = { getEnvironment:() => ({ apiBase:origin }) }
  const comics = load('miniprogram/utils/comics.ts', { '../config':config }, { wx })
  const cache = load('miniprogram/utils/reader-cache.ts', { '../config':config }, { wx })
  const shareMenus = []
  const sharing = { setShareMenu: value => shareMenus.push(value) }
  const episode = { title:'测试漫画', version:3, panels:[{ id:'panel', imageId:'image', narration:'旁白', dialogue:'对白', imageWidth:941, imageHeight:1672 }] }
  const catalog = [{ id:'series', title:'测试漫画', episodeCount:1, panelCount:1, coverUrl:'/api/comic-media/image', latestEpisodeId:'episode', episodes:[{ id:'episode', title:'测试漫画第一话', panelCount:1, coverUrl:'/api/comic-media/image' }] }]
  let requestFailure = false
  load('miniprogram/pages/comics/index.ts', { '../../utils/api':{ request:async path => { if (requestFailure) throw new Error('offline'); return path === '/api/comic-series' ? {items:catalog} : { episode } } }, '../../config':config, '../../utils/comics':comics, '../../utils/reader-cache':cache, '../../utils/share':sharing }, { wx, Page:page => { definition = page }, setTimeout, clearTimeout })
  const page = { ...definition, data:{ ...definition.data, episodeId:'episode', panels:[] }, setData(values) { Object.assign(this.data,values) }, createSelectorQuery() { return { select() { return this }, boundingClientRect(fn) { this.callback=fn; return this }, exec() { assert.equal(page.data.loading,false,'measure rendered panels after loading state clears'); this.callback({ height }) } } } }
  return { page,wx,cache,scrolls,episode,shareMenus,failRequests:()=>{requestFailure=true},changeOrigin:value => { origin=value },resize:value => { height=value } }
}

test('comic progress restores only matching versions and environments, clamps and measures rendered panels', async () => {
  const f=fixture()
  f.cache.writeReaderCache('comic-position-episode',{ version:3,scrollTop:900 })
  await f.page.loadEpisode('episode')
  assert.equal(f.scrolls.at(-1),900)
  assert.equal(f.page.data.readingProgress,56)
  assert.equal(f.page.data.panels[0].imagePadding,1672/941*100)
  f.resize(1000);f.page.onResize()
  assert.equal(f.page.lastScrollTop,200)
  f.cache.writeReaderCache('comic-position-episode',{ version:2,scrollTop:900 })
  await f.page.loadEpisode('episode')
  assert.equal(f.scrolls.at(-1),0)
  f.cache.writeReaderCache('comic-position-episode',{ version:3,scrollTop:100 })
  f.changeOrigin('https://two.test')
  await f.page.loadEpisode('episode')
  assert.equal(f.scrolls.at(-1),0)
})

test('comic library refreshes public entries, preserves cached failure state and returns home on direct entry', async () => {
  const f = fixture(); f.page.data.episodeId = ''; f.page.data.selectedSeriesId = 'series'
  f.cache.writeReaderCache('comic-position-episode', { version:3, scrollTop:800, progress:50 })
  await f.page.loadLibrary()
  assert.equal(f.page.data.episodes[0].readingLabel,'继续阅读')
  assert.equal(f.page.data.series[0].coverUrl,'https://one.test/api/comic-media/image')
  f.page.coverError({currentTarget:{dataset:{id:'series'}}}); assert.equal(f.page.data.series[0].coverUrl,'')
  f.failRequests(); await f.page.loadLibrary(true)
  assert.equal(f.page.data.series.length,1); assert.equal(f.page.data.error,''); assert.match(f.page.data.libraryNotice,/缓存/)
  let target; f.wx.navigateBack=options=>options.fail(); f.wx.reLaunch=options=>{target=options.url}
  f.page.data.selectedSeriesId = ''; f.page.back(); assert.equal(target,'/pages/home/index')
  f.page.onUnload()
  await f.page.loadLibrary(true)
  assert.match(f.page.data.libraryNotice,/缓存/)
})

test('comic errors keep reserved geometry, preview includes all panels, and hide flush survives unavailable storage', async () => {
  const f=fixture();await f.page.loadEpisode('episode')
  const event={ currentTarget:{ dataset:{ id:'panel' } } }
  const padding=f.page.data.panels[0].imagePadding
  f.page.imageError(event);assert.equal(f.page.data.failedImages.panel,true)
  f.page.reloadImage(event);assert.equal(f.page.data.failedImages.panel,false)
  assert.equal(f.page.data.panels[0].imagePadding,padding)
  assert.match(f.page.data.panels[0].imageUrl,/\?retry=/)
  let preview;f.wx.previewImage=options => { preview=options };f.page.preview(event)
  assert.equal(preview.current,preview.urls[0])
  f.page.onPageScroll({ scrollTop:420 });f.page.onHide()
  assert.equal(f.cache.readReaderCache('comic-position-episode').scrollTop,420)
  f.wx.setStorageSync=()=>{throw new Error('storage unavailable')}
  assert.doesNotThrow(()=>f.page.onUnload())
})

test('comic reader exposes WeChat share actions for both episode and book directory', () => {
  const f = fixture()
  f.page.onShow()
  assert.deepEqual(f.shareMenus, [true])
  f.page.data.selectedSeries = { id:'series', title:'测试漫画' }
  f.page.data.selectedSeriesId = 'series id'
  f.page.data.episodeId = 'episode id'
  f.page.data.episodeNumber = 1
  const message = f.page.onShareAppMessage()
  assert.equal(message.title, '测试漫画 · 第1话')
  assert.match(message.path, /id=episode%20id&seriesId=series%20id/)
  assert.match(f.page.onShareTimeline().query, /seriesId=series%20id/)
  const markup = readFileSync(resolve(root, 'miniprogram/pages/comics/index.wxml'), 'utf8')
  assert.match(markup, /open-type="share" aria-label="分享漫画"/)
})
