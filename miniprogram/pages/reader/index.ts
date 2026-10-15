import { ensureSession, request } from '../../utils/api'
import { getSession } from '../../utils/access'
import { readReaderCache, writeReaderCache } from '../../utils/reader-cache'
import { defaultShare, isTimelinePreview, setShareMenu, shareContent, shareImage } from '../../utils/share'
import { creatorMedia } from '../../utils/creator'
import { illustratedParagraphs, IllustratedParagraph, ReaderAsset } from '../../utils/reader-illustrations'
import { cachedReaderMedia } from '../../utils/reader-media'

type ChapterItem = { id: string; volumeId: string; chapterNumber: number; title: string; wordCount: number; displayNumber?: string }
type LongChapter = ChapterItem & { volumeTitle: string; content: string }
type ShortChapter = { id: string; sceneTitle: string; content: string; illustration?: StoryAsset }
type ChapterLink = { id: string; title: string; chapterNumber: number } | null
type StoryAsset = ReaderAsset
type Position = { blockId?: string; progress: number; scrollRatio: number; updatedAt: number; pending?: boolean }
type ReaderSnapshot = { work: any; chapters: ChapterItem[]; assets: StoryAsset[]; shortChapters: ShortChapter[] }
type ReaderBootstrap = ReaderSnapshot & { mode: string; chapter?: LongChapter | null; prev?: ChapterLink; next?: ChapterLink; progress?: { progress: number; block_id?: string; scroll_ratio?: number; updated_at?: string } }

function positionKey(workId: string) { return `mojing_position_${getSession().userId}_${workId}` }
function paragraphs(content: string) { return content.split(/\n\s*\n/).map(text => text.trim()).filter(Boolean) }
function readerNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback
}

Page({
  saveTimer: null as ReturnType<typeof setTimeout> | null,
  saveChain: Promise.resolve() as Promise<unknown>,
  currentScroll: 0, scrollRange: 0, restoreRatio: null as number | null,
  chapterRequest: 0, lastCacheTime: 0, pageAlive: true, initializeRequest: 0,
  failedChapterId: '', failedChapterRatio: 0,
  resumePending: false, interacted: false,
  prefetchedAt: {} as Record<string, number>,
  data: {
    loading: true, error: '', offline: false, workId: '', requestedChapter: '', shareReady: false, mode: 'short', progress: 0, scrollTop: 0, scrollIntoView: '',
    topInset: 88, bottomInset: 0, viewportHeight: 600,
    work: { title: '正在载入', author: '', type: '', summary: '', tagline: '', coverImage: '', status: '', serializationStatus: 'serializing' },
    shortChapters: [] as Array<ShortChapter & { paragraphs: string[] }>, chapters: [] as ChapterItem[],
    storyAssets: [] as StoryAsset[],
    chapter: null as LongChapter | null, chapterParagraphs: [] as IllustratedParagraph[], prev: null as ChapterLink, next: null as ChapterLink,
    directoryOpen: false, settingsOpen: false, directoryTarget: '',
    showIllustrations: wx.getStorageSync('mojing_reader_illustrations') !== false,
    theme: ['paper', 'moon', 'ink'].includes(wx.getStorageSync('mojing_reader_theme')) ? wx.getStorageSync('mojing_reader_theme') : 'paper',
    fontSize: readerNumber(wx.getStorageSync('mojing_reader_font_px') || 19, 19, 15, 26),
    lineHeight: readerNumber(wx.getStorageSync('mojing_reader_line_height') || 1.9, 1.9, 1.5, 2.4),
  },
  onLoad(options: Record<string, string>) {
    this.currentScroll = 0; this.scrollRange = 0; this.restoreRatio = null
    this.pageAlive = true; this.lastCacheTime = 0
    this.interacted = false
    this.prefetchedAt = {}
    this.updateViewport()
    this.setData({ workId: options.workId || 'work_tide', requestedChapter: options.chapterId || '' })
    this.initialize(options.chapterId)
  },
  updateViewport() {
    const info = wx.getSystemInfoSync()
    const bottomInset = Math.max(0, info.screenHeight - (info.safeArea?.bottom || info.screenHeight))
    const topInset = (info.statusBarHeight || 20) + 44
    this.setData({ topInset, bottomInset, viewportHeight: Math.max(180, info.windowHeight - topInset - 56 - 66 - bottomInset) })
  },
  onResize() {
    this.restoreRatio = this.scrollRange ? this.currentScroll / this.scrollRange : 0
    this.updateViewport()
    this.restorePosition()
  },
  async initialize(requestedChapter?: string) {
    const version = ++this.initializeRequest
    this.failedChapterId = ''
    this.setData({ loading: true, error: '', offline: false, shareReady: false })
    setShareMenu(false)
    const workId = this.data.workId
    try {
      // Public bootstrap avoids the detail -> directory -> assets waterfall on first open.
      let saved = isTimelinePreview() ? undefined : wx.getStorageSync(positionKey(workId)) as Position | undefined
      let bootstrap: ReaderBootstrap | null = null
      const resumeQuery = saved?.blockId ? `&resumeId=${encodeURIComponent(saved.blockId)}&updatedAt=${saved.updatedAt || 0}&pending=${saved.pending ? 1 : 0}` : ''
      try {
        bootstrap = await request<ReaderBootstrap>(`/api/works/${encodeURIComponent(workId)}/reader-bootstrap?${requestedChapter ? `chapterId=${encodeURIComponent(requestedChapter)}` : ''}${resumeQuery}${isTimelinePreview() ? '&public=1' : ''}`)
      } catch (error) {
        const status = (error as { status?: number }).status
        const code = (error as { code?: string }).code
        if (status && status < 500 && !(status === 404 && code === 'NOT_FOUND')) throw error
        // A cached public snapshot can open immediately when the network is down.
        if (readReaderCache<ReaderSnapshot>(`work_${workId}`)) throw error
        /* Fall back to the owner-aware legacy sequence below. */
      }
      if (version !== this.initializeRequest || !this.pageAlive) return
      if (bootstrap) {
        const remote = bootstrap.progress
        const remoteTime = remote?.updated_at ? Date.parse(remote.updated_at.replace(' ', 'T') + (remote.updated_at.includes('Z') ? '' : 'Z')) : 0
        if (remote && (!saved || (!saved.pending && remoteTime > saved.updatedAt))) saved = { blockId: remote.block_id, progress: remote.progress, scrollRatio: remote.scroll_ratio || 0, updatedAt: remoteTime }
        if (bootstrap.work.coverImage) bootstrap.work.coverImage = bootstrap.work.status === 'published' ? shareImage(bootstrap.work.coverImage) || '' : await creatorMedia(bootstrap.work.coverImage).catch(() => '')
        const assets = await Promise.all((bootstrap.assets || []).map(async item => ({ ...item, url: bootstrap?.work.status === 'published' ? shareImage(item.url) || '' : await creatorMedia(item.url).catch(() => '') })))
        if (version !== this.initializeRequest || !this.pageAlive) return
        if (bootstrap.work.status === 'published') writeReaderCache(`work_${workId}`, { work: bootstrap.work, chapters: bootstrap.chapters || [], assets, shortChapters: bootstrap.shortChapters || [] })
        const mode = bootstrap.mode === 'longform' ? 'longform' : 'short'
        this.setData({ work: bootstrap.work, mode, progress: saved?.progress || 0, chapters: (bootstrap.chapters || []).map(item => ({ ...item, displayNumber: String(item.chapterNumber).padStart(2, '0') })), storyAssets: assets.filter(item => item.type === 'scene') })
        if (mode === 'longform' && bootstrap.chapter) {
          const chapter = bootstrap.chapter
          const ratio = !requestedChapter && saved?.blockId === chapter.id ? saved.scrollRatio : 0
          this.restoreRatio = ratio; this.currentScroll = 0; this.scrollRange = 0
          const payload = { chapter, prev: bootstrap.prev || null, next: bootstrap.next || null }
          if (bootstrap.work.status === 'published') writeReaderCache(`mojing_chapter_${chapter.id}`, payload)
          this.setData({ chapter, chapterParagraphs: illustratedParagraphs(chapter.content, assets.filter(item => item.chapterId === chapter.id)), prev: payload.prev, next: payload.next, progress: Math.round((Math.max(0, bootstrap.chapters.findIndex(item => item.id === chapter.id)) + ratio) / Math.max(1, bootstrap.chapters.length) * 100), loading: false, scrollTop: 0 })
          this.restorePosition()
          if (payload.next?.id && bootstrap.work.status === 'published') this.prefetchChapter(payload.next.id)
        } else if (mode === 'short') {
          const target = (bootstrap.shortChapters || []).find(item => item.id === requestedChapter)
          this.restoreRatio = requestedChapter ? 0 : saved?.scrollRatio || 0
          this.setData({ shortChapters: (bootstrap.shortChapters || []).map(item => ({ ...item, paragraphs: paragraphs(item.content), illustration: assets.find(asset => asset.blockId === item.id && asset.url) })), loading: false })
          this.restorePosition()
          if (target) wx.nextTick(() => this.setData({ scrollIntoView: `short-${target.id}` }))
        } else this.setData({ loading: false })
        this.cacheIllustrationFiles()
        if (!isTimelinePreview()) this.syncInitialPosition(version, !!requestedChapter, !!bootstrap.progress)
        return
      }
      const detail = await request<{ work: any }>(`/api/works/${workId}`)
      if (detail.work.coverImage) detail.work.coverImage = detail.work.status === 'published' ? shareImage(detail.work.coverImage) || '' : await creatorMedia(detail.work.coverImage).catch(() => '')
      saved = wx.getStorageSync(positionKey(workId)) as Position | undefined
      if (!isTimelinePreview()) {
        try {
          await ensureSession()
          saved = wx.getStorageSync(positionKey(workId)) as Position | undefined
          const response = await request<{ progress: { progress: number; block_id?: string; scroll_ratio?: number; updated_at?: string } }>(`/api/works/${workId}/reading-progress`)
          const remote = response.progress
          const remoteTime = remote.updated_at ? Date.parse(remote.updated_at.replace(' ', 'T') + (remote.updated_at.includes('Z') ? '' : 'Z')) : 0
          if (!saved || (!saved.pending && remoteTime > saved.updatedAt)) saved = { blockId: remote.block_id, progress: remote.progress, scrollRatio: remote.scroll_ratio || 0, updatedAt: remoteTime }
        } catch { /* A cached position remains usable during a temporary sync failure. */ }
      }
      if (version !== this.initializeRequest || !this.pageAlive) return
      this.setData({ work: detail.work, mode: detail.work.format === 'longform' ? 'longform' : 'short', progress: saved?.progress || 0 })
      if (this.data.mode === 'longform') {
        const chapters: ChapterItem[] = []
        let total = 1
        while (chapters.length < total) {
          const page = await request<{ items: ChapterItem[]; total: number }>(`/api/works/${workId}/chapters?limit=100&offset=${chapters.length}`)
          chapters.push(...page.items)
          total = page.total
          if (!page.items.length) break
        }
        const assets = await request<{ items: StoryAsset[] }>(`/api/works/${workId}/assets`)
        assets.items = await Promise.all(assets.items.map(async item => ({ ...item, url: detail.work.status === 'published' ? shareImage(item.url) || '' : await creatorMedia(item.url).catch(() => '') })))
        if (!this.pageAlive || version !== this.initializeRequest) return
        if (detail.work.status === 'published') writeReaderCache(`work_${workId}`, { work: detail.work, chapters, assets: assets.items, shortChapters: [] })
        this.setData({ chapters: chapters.map(item => ({ ...item, displayNumber: String(item.chapterNumber).padStart(2, '0') })), storyAssets: assets.items.filter(item => item.type === 'scene') })
        const target = chapters.find(item => item.id === (requestedChapter || saved?.blockId)) || (requestedChapter ? undefined : chapters[0])
        if (requestedChapter && !target) throw new Error('分享章节不可用，请返回作品重新选择章节')
        if (target) await this.loadLongChapter(target.id, !requestedChapter && saved?.blockId === target.id ? saved.scrollRatio : 0)
        else this.setData({ loading: false })
      } else {
        const [story, assets] = await Promise.all([request<{ items: ShortChapter[] }>(`/api/works/${workId}/blocks`), request<{items: StoryAsset[]}>(`/api/works/${workId}/assets`)])
        const images = await Promise.all(assets.items.filter(item => item.type === 'scene' && item.blockId).map(async item => ({ ...item, url: detail.work.status === 'published' ? shareImage(item.url) || '' : await creatorMedia(item.url).catch(() => '') })))
        if (!this.pageAlive || version !== this.initializeRequest) return
        if (detail.work.status === 'published') writeReaderCache(`work_${workId}`, { work: detail.work, chapters: [], assets: images, shortChapters: story.items })
        this.restoreRatio = 0
        const target = story.items.find(item => item.id === requestedChapter)
        if (requestedChapter && !target) throw new Error('分享章节不可用，请返回作品重新选择章节')
        if (!requestedChapter) this.restoreRatio = saved?.scrollRatio || 0
        this.setData({ shortChapters: story.items.map(item => ({ ...item, paragraphs: paragraphs(item.content), illustration: images.find(asset => asset.blockId === item.id && asset.url) })), loading: false })
        this.restorePosition()
        if (target) wx.nextTick(() => this.setData({ scrollIntoView: `short-${target.id}` }))
      }
    } catch (error) {
      if (!this.pageAlive || version !== this.initializeRequest) return
      const status = (error as { status?: number }).status
      if (status && status < 500) { this.setData({ loading: false, error: (error as Error).message }); return }
      const snapshot = readReaderCache<ReaderSnapshot>(`work_${workId}`)
      if (snapshot?.work.status === 'published') {
        const saved = isTimelinePreview() ? undefined : wx.getStorageSync(positionKey(workId)) as Position | undefined
        this.setData({ work: snapshot.work, mode: snapshot.work.format === 'longform' ? 'longform' : 'short', offline: true, error: '', progress: saved?.progress || 0,
          chapters: snapshot.chapters.map(item => ({ ...item, displayNumber: String(item.chapterNumber).padStart(2, '0') })), storyAssets: snapshot.assets.filter(item => item.type === 'scene') })
        if (this.data.mode === 'longform') {
          const target = snapshot.chapters.find(item => item.id === (requestedChapter || saved?.blockId)) || (requestedChapter ? undefined : snapshot.chapters[0])
          if (requestedChapter && !target) { this.setData({ loading: false, error: '分享章节不可用，请联网后重新打开' }); return }
          if (target) await this.loadLongChapter(target.id, !requestedChapter && saved?.blockId === target.id ? saved.scrollRatio : 0, true)
          else this.setData({ loading: false })
        } else {
          const target = snapshot.shortChapters.find(item => item.id === requestedChapter)
          if (requestedChapter && !target) { this.setData({ loading: false, error: '分享章节不可用，请联网后重新打开' }); return }
          this.restoreRatio = requestedChapter ? 0 : saved?.scrollRatio || 0
          this.setData({ shortChapters: snapshot.shortChapters.map(item => ({ ...item, paragraphs: paragraphs(item.content), illustration: snapshot.assets.find(asset => asset.blockId === item.id && asset.url) })), loading: false })
          this.restorePosition()
          if (target) wx.nextTick(() => this.setData({ scrollIntoView: `short-${target.id}` }))
        }
        this.cacheIllustrationFiles()
        return
      }
      this.setData({ loading: false, error: (error as Error).message || '正文加载失败' })
    } finally { if (this.pageAlive && version === this.initializeRequest) this.updateShareAvailability() }
  },
  async syncInitialPosition(version: number, explicitChapter: boolean, hasRemote: boolean) {
    if (hasRemote || explicitChapter) { ensureSession().catch(() => undefined); return }
    this.resumePending = true
    try {
      await ensureSession()
      const local = wx.getStorageSync(positionKey(this.data.workId)) as Position | undefined
      const payload = await request<{ progress: ReaderBootstrap['progress'] }>(`/api/works/${this.data.workId}/reading-progress`)
      if (!this.pageAlive || version !== this.initializeRequest || this.interacted) return
      const remote = payload.progress
      const remoteTime = remote?.updated_at ? Date.parse(remote.updated_at.replace(' ', 'T') + (remote.updated_at.includes('Z') ? '' : 'Z')) : 0
      const saved = local && (local.pending || local.updatedAt >= remoteTime) ? local : remote ? { blockId: remote.block_id, progress: remote.progress, scrollRatio: remote.scroll_ratio || 0, updatedAt: remoteTime } : undefined
      if (!saved) return
      if (this.data.mode === 'longform' && saved.blockId && this.data.chapters.some(item => item.id === saved.blockId)) {
        if (saved.blockId !== this.data.chapter?.id) await this.loadLongChapter(saved.blockId, saved.scrollRatio)
        else { this.restoreRatio = saved.scrollRatio; this.setData({ progress: saved.progress }); this.restorePosition() }
      } else if (this.data.mode === 'short') { this.restoreRatio = saved.scrollRatio; this.setData({ progress: saved.progress }); this.restorePosition() }
    } catch { /* Reading stays available if progress sync fails. */ }
    finally { if (version === this.initializeRequest) this.resumePending = false }
  },
  retry() {
    if (this.failedChapterId) return this.loadLongChapter(this.failedChapterId, this.failedChapterRatio, false)
    return this.initialize(this.data.requestedChapter || this.data.chapter?.id)
  },
  back() { wx.navigateBack({ fail: () => wx.reLaunch({ url: '/pages/home/index' }) }) },
  async loadLongChapter(chapterId: string, ratio = 0, cachedOnly?: boolean) {
    const useCache = cachedOnly ?? this.data.offline
    if (this.data.chapter) this.persistPosition()
    const requestId = ++this.chapterRequest
    this.setData({ loading: true, directoryOpen: false, error: '', offline: false, shareReady: false })
    setShareMenu(false)
    const cacheKey = `mojing_chapter_${chapterId}`
    try {
      let payload: { chapter: LongChapter; prev: ChapterLink; next: ChapterLink }
      try {
        const savedPayload = readReaderCache<typeof payload>(cacheKey)
        if (savedPayload?.chapter && (useCache || (this.data.work.status === 'published' && Date.now() - (this.prefetchedAt[chapterId] || 0) < 30000))) {
          payload = savedPayload
          if (useCache) this.setData({ offline: true })
        }
        else {
          if (useCache) throw new Error('这一章尚未缓存，请联网后打开')
          payload = await request<typeof payload>(`/api/chapters/${chapterId}`, { cacheTtl: 30000 })
          if (this.data.work.status === 'published') writeReaderCache(cacheKey, payload)
        }
      } catch (error) {
        if (!this.pageAlive || requestId !== this.chapterRequest) return
        if ((error as { status?: number }).status && (error as { status: number }).status < 500) throw error
        payload = readReaderCache<typeof payload>(cacheKey)!
        if (!payload?.chapter) throw error
        this.setData({ offline: true })
      }
      if (requestId !== this.chapterRequest || !this.pageAlive) return
      this.currentScroll = 0
      this.scrollRange = 0
      this.restoreRatio = ratio
      const index = this.data.chapters.findIndex(item => item.id === chapterId)
      this.setData({
        chapter: payload.chapter, chapterParagraphs: illustratedParagraphs(payload.chapter.content, this.data.storyAssets.filter(item => item.chapterId === chapterId)),
        prev: payload.prev, next: payload.next,
        progress: Math.round(((Math.max(0, index) + ratio) / Math.max(1, this.data.chapters.length)) * 100),
        loading: false, scrollTop: 0,
      })
      this.failedChapterId = ''
      this.restorePosition()
      this.cacheIllustrationFiles()
      if (!useCache && payload.next?.id && this.data.work.status === 'published') this.prefetchChapter(payload.next.id)
    } catch (error) { if (this.pageAlive && requestId === this.chapterRequest) {
      this.failedChapterId = chapterId
      this.failedChapterRatio = ratio
      this.setData({ loading: false, error: (error as Error).message || '章节加载失败' })
    } }
    finally { if (this.pageAlive && requestId === this.chapterRequest) this.updateShareAvailability() }
  },
  cacheIllustrationFiles() {
    if (this.data.work.status !== 'published' || !this.data.showIllustrations) return
    const chapterId = this.data.chapter?.id
    const version = this.initializeRequest
    const assets = this.data.mode === 'longform'
      ? this.data.chapterParagraphs.reduce((all: ReaderAsset[], row) => all.concat(row.illustrations), [])
      : this.data.shortChapters.flatMap(item => item.illustration ? [item.illustration] : [])
    for (const asset of assets) cachedReaderMedia(asset.url).then(url => {
      if (!this.pageAlive || version !== this.initializeRequest || chapterId !== this.data.chapter?.id || url === asset.url) return
      if (this.data.mode === 'longform') {
        const row = this.data.chapterParagraphs.findIndex(item => item.illustrations.some(image => image.id === asset.id))
        if (row < 0) return
        const image = this.data.chapterParagraphs[row].illustrations.findIndex(item => item.id === asset.id)
        this.setData({ [`chapterParagraphs[${row}].illustrations[${image}].url`]: url })
      } else {
        const row = this.data.shortChapters.findIndex(item => item.illustration?.id === asset.id)
        if (row >= 0) this.setData({ [`shortChapters[${row}].illustration.url`]: url })
      }
    }).catch(() => undefined)
  },
  prefetchChapter(chapterId: string) {
    if (Date.now() - (this.prefetchedAt[chapterId] || 0) < 30000) return
    request<{ chapter: LongChapter; prev: ChapterLink; next: ChapterLink }>(`/api/chapters/${encodeURIComponent(chapterId)}`, { cacheTtl: 30000 }).then(payload => {
      if (this.data.work.status === 'published') { writeReaderCache(`mojing_chapter_${chapterId}`, payload); this.prefetchedAt[chapterId] = Date.now() }
    }).catch(() => undefined)
  },
  restorePosition() {
    const version = this.chapterRequest
    const initializeVersion = this.initializeRequest
    wx.nextTick(() => {
      this.createSelectorQuery().select('.reader-content').boundingClientRect(rect => {
        if (!this.pageAlive || version !== this.chapterRequest || initializeVersion !== this.initializeRequest) return
        const height = Array.isArray(rect) ? rect[0]?.height : rect?.height
        this.scrollRange = Math.max(0, Number(height || 0) - this.data.viewportHeight)
        if (this.restoreRatio !== null) {
          this.currentScroll = Math.round(this.scrollRange * this.restoreRatio)
          this.setData({ scrollTop: this.currentScroll })
          this.restoreRatio = null
        }
      }).exec()
    })
  },
  onIllustrationLoad() {
    if (this.data.loading) return
    if (this.restoreRatio === null) this.restoreRatio = this.scrollRange ? this.currentScroll / this.scrollRange : 0
    this.restorePosition()
  },
  illustrationError(e: WechatMiniprogram.TouchEvent) {
    if (this.data.mode === 'longform') this.setData({ chapterParagraphs: this.data.chapterParagraphs.map(row => ({ ...row, illustrations: row.illustrations.map(asset => asset.id === e.currentTarget.dataset.asset ? { ...asset, loadError: true } : asset) })) })
    else this.setData({ shortChapters: this.data.shortChapters.map(item => item.id === e.currentTarget.dataset.id && item.illustration ? { ...item, illustration: { ...item.illustration, loadError: true } } : item) })
  },
  retryIllustration(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.asset || this.data.shortChapters.find(item => item.id === e.currentTarget.dataset.id)?.illustration?.id
    const restore = (asset: ReaderAsset) => asset.id === id ? { ...asset, loadError: false } : asset
    if (this.data.mode === 'longform') this.setData({ chapterParagraphs: this.data.chapterParagraphs.map(row => ({ ...row, illustrations: row.illustrations.map(restore) })) })
    else this.setData({ shortChapters: this.data.shortChapters.map(item => item.illustration && item.illustration.id === id ? { ...item, illustration: restore(item.illustration) } : item) })
  },
  previewIllustration(e: WechatMiniprogram.TouchEvent) {
    const images = this.data.mode === 'longform' ? this.data.chapterParagraphs.flatMap(row => row.illustrations).filter(asset => !asset.loadError) : this.data.shortChapters.flatMap(item => item.illustration && !item.illustration.loadError ? [item.illustration] : [])
    const current = images.find(asset => asset.id === e.currentTarget.dataset.asset)
    if (current) wx.previewImage({ current: current.url, urls: images.map(asset => asset.url) })
  },
  toggleIllustrations(e: WechatMiniprogram.SwitchChange) {
    this.restoreRatio = this.scrollRange ? this.currentScroll / this.scrollRange : 0
    this.setData({ showIllustrations: e.detail.value }); wx.setStorageSync('mojing_reader_illustrations', e.detail.value); this.restorePosition(); if (e.detail.value) this.cacheIllustrationFiles()
  },
  onReaderScroll(e: WechatMiniprogram.ScrollViewScroll) {
    if (this.data.loading || this.restoreRatio !== null) return
    if (Math.abs(e.detail.scrollTop - this.currentScroll) > 1) this.interacted = true
    this.currentScroll = e.detail.scrollTop
    this.scrollRange = Math.max(0, e.detail.scrollHeight - this.data.viewportHeight)
    const ratio = this.scrollRange ? Math.min(1, Math.max(0, this.currentScroll / this.scrollRange)) : 0
    const index = this.data.chapter ? Math.max(0, this.data.chapters.findIndex(item => item.id === this.data.chapter?.id)) : 0
    const progress = Math.round((this.data.mode === 'longform' ? (index + ratio) / Math.max(1, this.data.chapters.length) : ratio) * 100)
    if (progress !== this.data.progress) this.setData({ progress })
    if (getSession().userId && !isTimelinePreview() && Date.now() - this.lastCacheTime > 500) { this.cachePosition(); this.lastCacheTime = Date.now() }
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => { this.persistPosition() }, 1200)
  },
  cachePosition(): Position {
    const position: Position = { blockId: this.data.chapter?.id, progress: this.data.progress, scrollRatio: this.scrollRange ? Math.min(1, Math.max(0, this.currentScroll / this.scrollRange)) : 0, updatedAt: Date.now(), pending: true }
    try {
      wx.setStorageSync(positionKey(this.data.workId), position)
      wx.setStorageSync('mojing_last_work', { userId: getSession().userId, workId: this.data.workId })
    } catch { /* A full device must not interrupt scrolling. */ }
    return position
  },
  persistPosition(): Promise<unknown> {
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null }
    if (this.data.loading || this.data.error || this.restoreRatio !== null || (this.resumePending && !this.interacted)) return Promise.resolve()
    if (!getSession().userId || isTimelinePreview()) return Promise.resolve()
    const position = this.cachePosition()
    const workId = this.data.workId
    const key = positionKey(workId)
    this.saveChain = this.saveChain.catch(() => undefined).then(async () => {
      await request(`/api/works/${workId}/reading-progress`, { method: 'POST', data: position })
      const latest = wx.getStorageSync(key) as Position
      if (latest?.updatedAt === position.updatedAt) wx.setStorageSync(key, { ...latest, pending: false })
    }).catch(() => undefined)
    return this.saveChain
  },
  onHide() { this.persistPosition() },
  onUnload() { this.pageAlive = false; this.chapterRequest++; this.initializeRequest++; this.persistPosition() },
  chooseChapter(e: WechatMiniprogram.TouchEvent) { this.interacted = true; this.loadLongChapter(e.currentTarget.dataset.id) },
  chooseShortChapter(e: WechatMiniprogram.TouchEvent) { this.interacted = true; this.setData({ directoryOpen: false, scrollIntoView: `short-${e.currentTarget.dataset.id}` }) },
  previousChapter() { if (this.data.prev && !this.data.loading) { this.interacted = true; this.loadLongChapter(this.data.prev.id) } },
  nextChapter() { if (this.data.next && !this.data.loading) { this.interacted = true; this.loadLongChapter(this.data.next.id) } },
  toggleDirectory() { const open = !this.data.directoryOpen; this.setData({ directoryOpen: open, settingsOpen: false, directoryTarget: '' }); if (open && this.data.chapter) wx.nextTick(() => this.setData({ directoryTarget: `directory-${this.data.chapter?.id}` })) },
  toggleSettings() { this.setData({ settingsOpen: !this.data.settingsOpen, directoryOpen: false }) },
  closePanels() { this.setData({ directoryOpen: false, settingsOpen: false }) },
  stopTap() {},
  setTheme(e: WechatMiniprogram.TouchEvent) { const theme = e.currentTarget.dataset.theme; if (!['paper', 'moon', 'ink'].includes(theme)) return; this.setData({ theme }); wx.setStorageSync('mojing_reader_theme', theme) },
  changeFont(e: WechatMiniprogram.TouchEvent) { this.restoreRatio = this.scrollRange ? this.currentScroll / this.scrollRange : 0; const fontSize = Math.max(15, Math.min(26, this.data.fontSize + Number(e.currentTarget.dataset.step))); this.setData({ fontSize }); wx.setStorageSync('mojing_reader_font_px', fontSize); this.restorePosition() },
  changeLineHeight(e: WechatMiniprogram.TouchEvent) { this.restoreRatio = this.scrollRange ? this.currentScroll / this.scrollRange : 0; const lineHeight = Math.max(1.5, Math.min(2.4, Number((this.data.lineHeight + Number(e.currentTarget.dataset.step)).toFixed(2)))); this.setData({ lineHeight }); wx.setStorageSync('mojing_reader_line_height', lineHeight); this.restorePosition() },
  bookmark() { this.persistPosition(); wx.showToast({ title: '阅读位置已保存在本机', icon: 'none' }) },
  updateShareAvailability() {
    const shareReady = !this.data.loading && !this.data.error && this.data.work.status === 'published' && (this.data.mode === 'longform' ? !!this.data.chapter : !!this.data.shortChapters.length)
    this.setData({ shareReady }); setShareMenu(shareReady)
  },
  onShareAppMessage() { return this.data.shareReady ? shareContent(this.data.work, this.data.workId, this.data.chapter, true) : defaultShare() },
  onShareTimeline() { const { title, query, imageUrl } = this.data.shareReady ? shareContent(this.data.work, this.data.workId, this.data.chapter, true) : defaultShare(); return { title, query, ...(imageUrl ? { imageUrl } : {}) } },
})
