import { request } from '../../utils/api'
import { getEnvironment } from '../../config'
import { readReaderCache, writeReaderCache } from '../../utils/reader-cache'
import { displayComic, displaySeries, type ComicEpisode, type ComicSeries } from '../../utils/comics'
import { setShareMenu } from '../../utils/share'

type ComicPanel = { id: string; imageId: string; narration: string; dialogue: string; imageUrl?: string; imageWidth?: number; imageHeight?: number; imagePadding?: number }
type LibraryEpisode = ComicEpisode & { readingLabel: string }
Page({
  data: { loading: false, refreshing: false, error: '', libraryNotice: '', title: '漫画书库', series: [] as ComicSeries[], episodes: [] as LibraryEpisode[], selectedSeriesId: '', selectedSeries: null as ComicSeries | null, continueId: '', continueLabel: '开始阅读', previousId: '', nextId: '', episodeNumber: 0, panels: [] as ComicPanel[], episodeId: '', episodeVersion: 0, failedImages: {} as Record<string,boolean>, topInset: 44, readingProgress: 0, navigating: false },
  requestVersion: 0,
  alive: true,
  progressTimer: undefined as ReturnType<typeof setTimeout> | undefined,
  progressRenderTimer: undefined as ReturnType<typeof setTimeout> | undefined,
  scrollRange: 1,
  lastScrollTop: 0,
  onLoad(options: Record<string,string>) {
    this.alive = true
    const info = wx.getSystemInfoSync()
    const capsule = typeof wx.getMenuButtonBoundingClientRect === 'function' ? wx.getMenuButtonBoundingClientRect() : null
    this.setData({ topInset: Math.max((info.statusBarHeight || 0) + 44, (capsule?.bottom || 0) + 8) })
    this.setData({ selectedSeriesId: options.seriesId || '' })
    if (options.id) { this.setData({ episodeId: options.id }); this.loadEpisode(options.id) } else this.loadLibrary()
  },
  onShow() { setShareMenu(true); this.setData({ navigating: false }); if (!this.data.episodeId) this.setLibrary(this.data.series) },
  setLibrary(items: ComicSeries[]) {
    const series = items.map(displaySeries)
    this.setData({ series })
    const selected = series.find(item => item.id === this.data.selectedSeriesId) || series.find(item => item.episodes.some(episode => episode.id === this.data.episodeId))
    if (selected) {
      this.setData({ selectedSeriesId: selected.id, selectedSeries: selected, ...(!this.data.episodeId ? { title: selected.title } : {}) })
      this.setEpisodes(selected.episodes)
      const index = selected.episodes.findIndex(episode => episode.id === this.data.episodeId)
      this.setData({ previousId: selected.episodes[index - 1]?.id || '', nextId: index >= 0 ? selected.episodes[index + 1]?.id || '' : '', episodeNumber: index >= 0 ? selected.episodes[index].episodeNumber || index + 1 : 0 })
      const last = readReaderCache<{ episodeId: string }>(`comic-last-${selected.id}`)
      const savedIndex = selected.episodes.findIndex(episode => episode.id === last?.episodeId)
      const position = last ? readReaderCache<{ progress?: number }>(`comic-position-${last.episodeId}`) : null
      const continueIndex = savedIndex >= 0 ? position?.progress === 100 && savedIndex + 1 < selected.episodes.length ? savedIndex + 1 : savedIndex : 0
      this.setData({ continueId: selected.episodes[continueIndex]?.id || '', continueLabel: savedIndex >= 0 ? `继续阅读 · 第${selected.episodes[continueIndex].episodeNumber || continueIndex + 1}话` : '开始阅读 · 第一话' })
    }
  },
  setEpisodes(items: ComicEpisode[]) {
    this.setData({ episodes: items.map(item => {
      const position = readReaderCache<{ scrollTop: number; progress?: number }>(`comic-position-${item.id}`)
      const progress = Math.max(0, Math.min(100, Number(position?.progress) || 0))
      return { ...displayComic(item), readingLabel: progress >= 100 ? '已读完' : position && position.scrollTop > 0 ? '继续阅读' : '开始阅读' }
    }) })
  },
  async loadLibrary(force = false) {
    if (!this.alive) return
    const version = ++this.requestVersion
    const cached = readReaderCache<ComicSeries[]>('comic-series-library-v1')
    if (!this.data.series.length && Array.isArray(cached)) this.setLibrary(cached)
    this.setData({ loading: this.data.selectedSeriesId ? !this.data.episodes.length : !this.data.series.length, refreshing: true, error: '', libraryNotice: '' })
    try {
      const payload = await request<{ items: ComicSeries[]; partial?: boolean }>('/api/comic-series', { cacheTtl: 15000, noCache: force })
      if (!this.alive || version !== this.requestVersion) return
      if (!payload.partial) writeReaderCache('comic-series-library-v1', payload.items)
      this.setLibrary(payload.items)
      if (payload.partial) this.setData({ libraryNotice: '部分漫画暂时无法连接，请稍后刷新' })
      if (this.data.selectedSeriesId && !payload.items.some(item => item.id === this.data.selectedSeriesId)) this.setData({ episodes: [], error: '这本漫画暂时不可用，请返回漫画书库' })
    } catch (e) {
      if (!this.alive || version !== this.requestVersion) return
      this.setData((this.data.selectedSeriesId ? this.data.episodes.length : this.data.series.length) ? { libraryNotice: '当前显示缓存漫画，阅读需联网' } : { error: (e as Error).message })
    } finally { if (this.alive && version === this.requestVersion) this.setData({ loading: false, refreshing: false }) }
  },
  async loadEpisode(id: string) {
    if (!this.alive) return
    const version = ++this.requestVersion
    this.setData({ loading: true, error: '' })
    if (!this.data.series.length) this.loadReadingDirectory(version)
    try {
      const payload = await request<{ episode: { title: string; version: number; panels: ComicPanel[] } }>(`/api/comics/${encodeURIComponent(id)}`); const base = getEnvironment().apiBase
      if (!this.alive || version !== this.requestVersion) return
      this.setData({ loading: false, title: payload.episode.title, episodeVersion: payload.episode.version, failedImages: {}, panels: payload.episode.panels.map(p => ({ ...p, imagePadding: Number.isFinite(p.imageWidth) && Number.isFinite(p.imageHeight) && Number(p.imageWidth) > 0 && Number(p.imageHeight) > 0 ? Number(p.imageHeight) / Number(p.imageWidth) * 100 : 1600 / 9, imageUrl: `${base}/api/comic-media/${p.imageId}` })) })
      const saved = readReaderCache<{ scrollTop: number; version: number }>(`comic-position-${id}`)
      this.measurePage(saved?.version === payload.episode.version && Number.isFinite(saved.scrollTop) ? saved.scrollTop : 0)
    } catch (e) { if (this.alive && version === this.requestVersion) this.setData({ error: (e as Error).message }) } finally { if (this.alive && version === this.requestVersion) this.setData({ loading: false }) }
  },
  async loadReadingDirectory(version: number) {
    const cached = readReaderCache<ComicSeries[]>('comic-series-library-v1')
    if (Array.isArray(cached)) this.setLibrary(cached)
    try {
      const result = await request<{ items: ComicSeries[]; partial?: boolean }>('/api/comic-series', { cacheTtl: 15000 })
      if (!this.alive || version !== this.requestVersion) return
      this.setLibrary(result.items)
      if (!result.partial) writeReaderCache('comic-series-library-v1', result.items)
    } catch { /* Reading a public episode remains possible when its directory is unavailable. */ }
  },
  measurePage(restoreTop?: number) {
    wx.nextTick(() => this.createSelectorQuery().select('.comic-page').boundingClientRect(rect => {
      if (!rect || !this.alive) return
      this.scrollRange = Math.max(1, rect.height - wx.getSystemInfoSync().windowHeight)
      const scrollTop = Math.max(0, Math.min(restoreTop === undefined ? this.lastScrollTop : restoreTop, this.scrollRange))
      this.lastScrollTop = scrollTop
      this.setData({ readingProgress: Math.round(scrollTop / this.scrollRange * 100) })
      if (restoreTop !== undefined) wx.pageScrollTo({ scrollTop, duration: 0 })
    }).exec())
  },
  onResize() { if (this.data.panels.length) this.measurePage() },
  open(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id
    if (this.data.navigating || !this.data.episodes.some(item => item.id === id)) return
    this.setData({ navigating: true })
    wx.navigateTo({ url: `/pages/comics/index?id=${encodeURIComponent(id)}&seriesId=${encodeURIComponent(this.data.selectedSeriesId)}`, fail: () => { this.setData({ navigating: false }); wx.showToast({ title: '漫画暂时无法打开', icon: 'none' }) } })
  },
  continueReading() { if (this.data.continueId) this.open({ currentTarget: { dataset: { id: this.data.continueId } } } as unknown as WechatMiniprogram.TouchEvent) },
  changeEpisode(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id
    if (this.data.navigating || ![this.data.previousId, this.data.nextId].includes(id) || !id) return
    this.savePosition()
    this.setData({ navigating: true })
    wx.redirectTo({ url: `/pages/comics/index?id=${encodeURIComponent(id)}&seriesId=${encodeURIComponent(this.data.selectedSeriesId)}`, fail: () => { this.setData({ navigating: false }); wx.showToast({ title: '切换失败，请重试', icon: 'none' }) } })
  },
  preview(e: WechatMiniprogram.TouchEvent) {
    const panel = this.data.panels.find(panel => panel.id === e.currentTarget.dataset.id)
    const urls = this.data.panels.map(panel => panel.imageUrl).filter((url): url is string => Boolean(url))
    if (panel?.imageUrl) wx.previewImage({ current: panel.imageUrl, urls })
  },
  openSeries(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id
    if (this.data.navigating || !this.data.series.some(item => item.id === id)) return
    this.setData({ navigating: true })
    wx.navigateTo({ url: `/pages/comics/index?seriesId=${encodeURIComponent(id)}`, fail: () => { this.setData({ navigating: false }); wx.showToast({ title: '漫画暂时无法打开', icon: 'none' }) } })
  },
  back() { wx.navigateBack({ delta: 1, fail: () => this.data.episodeId || this.data.selectedSeriesId ? this.library() : this.home() }) },
  home() { wx.reLaunch({ url: '/pages/home/index' }) },
  retry() { if (this.data.episodeId) this.loadEpisode(this.data.episodeId); else this.loadLibrary(true) },
  coverError(e: WechatMiniprogram.TouchEvent) { this.setData({ series: this.data.series.map(item => item.id === e.currentTarget.dataset.id ? { ...item, coverUrl: '' } : item) }) },
  episodeCoverError(e: WechatMiniprogram.TouchEvent) { this.setData({ episodes: this.data.episodes.map(item => item.id === e.currentTarget.dataset.id ? { ...item, coverUrl: '' } : item) }) },
  imageError(e: WechatMiniprogram.TouchEvent) { this.setData({ failedImages: { ...this.data.failedImages, [e.currentTarget.dataset.id]: true } }) },
  reloadImage(e: WechatMiniprogram.TouchEvent) { const id = e.currentTarget.dataset.id; this.setData({ failedImages: { ...this.data.failedImages, [id]: false }, panels: this.data.panels.map(p => p.id === id ? { ...p, imageUrl: `${getEnvironment().apiBase}/api/comic-media/${p.imageId}?retry=${Date.now()}` } : p) }) },
  onPageScroll(e: { scrollTop: number }) {
    if (!this.data.episodeId || !this.data.panels.length || this.data.loading) return
    this.lastScrollTop = e.scrollTop
    const progress = Math.min(100, Math.max(0, Math.round(e.scrollTop / this.scrollRange * 100)))
    if (progress !== this.data.readingProgress && !this.progressRenderTimer) {
      this.progressRenderTimer = setTimeout(() => {
        this.progressRenderTimer = undefined
        if (!this.data.loading) this.setData({ readingProgress: Math.min(100, Math.max(0, Math.round(this.lastScrollTop / this.scrollRange * 100))) })
      }, 80)
    }
    if (this.progressTimer) clearTimeout(this.progressTimer)
    this.progressTimer = setTimeout(() => this.savePosition(), 350)
  },
  savePosition() {
    if (!this.data.episodeId || !this.data.panels.length) return
    writeReaderCache(`comic-position-${this.data.episodeId}`, { scrollTop:this.lastScrollTop, version:this.data.episodeVersion, progress: Math.min(100, Math.max(0, Math.round(this.lastScrollTop / this.scrollRange * 100))) })
    if (this.data.selectedSeriesId) writeReaderCache(`comic-last-${this.data.selectedSeriesId}`, { episodeId: this.data.episodeId })
  },
  restart() { this.lastScrollTop = 0; this.savePosition(); this.setData({ readingProgress:0 }); wx.pageScrollTo({ scrollTop:0, duration:200 }) },
  library() { this.savePosition(); wx.redirectTo({ url: this.data.episodeId && this.data.selectedSeriesId ? `/pages/comics/index?seriesId=${encodeURIComponent(this.data.selectedSeriesId)}` : '/pages/comics/index' }) },
  onShareAppMessage() { const title = this.data.episodeId && this.data.selectedSeries ? `${this.data.selectedSeries.title} · 第${this.data.episodeNumber}话` : this.data.selectedSeries?.title || this.data.title; const path = this.data.episodeId ? `/pages/comics/index?id=${encodeURIComponent(this.data.episodeId)}&seriesId=${encodeURIComponent(this.data.selectedSeriesId)}` : this.data.selectedSeriesId ? `/pages/comics/index?seriesId=${encodeURIComponent(this.data.selectedSeriesId)}` : '/pages/comics/index'; const imageUrl = this.data.selectedSeries?.coverUrl; return { title: title.slice(0, 80), path, ...(imageUrl?.startsWith('https://') ? { imageUrl } : {}) } },
  onShareTimeline() { const title = this.data.episodeId && this.data.selectedSeries ? `${this.data.selectedSeries.title} · 第${this.data.episodeNumber}话` : this.data.selectedSeries?.title || this.data.title; const query = this.data.episodeId ? `id=${encodeURIComponent(this.data.episodeId)}&seriesId=${encodeURIComponent(this.data.selectedSeriesId)}` : this.data.selectedSeriesId ? `seriesId=${encodeURIComponent(this.data.selectedSeriesId)}` : ''; const imageUrl = this.data.selectedSeries?.coverUrl; return { title: title.slice(0, 80), query, ...(imageUrl?.startsWith('https://') ? { imageUrl } : {}) } },
  onPullDownRefresh() { (this.data.episodeId ? this.loadEpisode(this.data.episodeId) : this.loadLibrary(true)).finally(() => wx.stopPullDownRefresh()) },
  onHide() { if (this.progressRenderTimer) { clearTimeout(this.progressRenderTimer); this.progressRenderTimer = undefined }; this.savePosition() },
  onUnload() { this.alive = false; this.requestVersion++; if (this.progressTimer) clearTimeout(this.progressTimer); if (this.progressRenderTimer) clearTimeout(this.progressRenderTimer); this.savePosition() },
})
