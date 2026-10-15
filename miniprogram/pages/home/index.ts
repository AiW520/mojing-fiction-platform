import { ensureSession, request } from '../../utils/api'
import { getSession } from '../../utils/access'
import { readReaderCache, writeReaderCache } from '../../utils/reader-cache'
import { boundedProgress, displayBook, type LibraryBook, type DisplayBook } from '../../utils/library'
import { displaySeries, type ComicSeries } from '../../utils/comics'

type Position = { blockId?: string; progress?: number; pending?: boolean }
let requestVersion = 0
let lastLibraryRefresh = 0

Page({
  comicRequestVersion: 0,
  data: {
    loading: true, refreshing: false, error: '', offline: false, navigating: false,
    category: '全部', categories: ['全部', '长篇', '短篇', '漫画'], skeletons: [1, 2],
    comics: [] as ComicSeries[], featuredComics: [] as ComicSeries[], comicLoading: true, comicError: '', comicOffline: false,
    allBooks: [] as DisplayBook[], longBooks: [] as DisplayBook[], shortBooks: [] as DisplayBook[], visibleCount: 0,
    hasReading: false, continueBook: { ...displayBook({ id: '', title: '', author: '' }), progress: 0, chapter: '' },
  },
  onLoad() {
    const cached = readReaderCache<LibraryBook[]>('library')
    if (cached?.length) { this.setCatalog(cached); this.setData({ loading: false }) }
  },
  async onShow() {
    this.setData({ navigating: false }); this.updateReading()
    this.refreshComics(false)
    if (this.data.allBooks.length && lastLibraryRefresh && Date.now() - lastLibraryRefresh < 15000) { this.syncReading(requestVersion); return }
    await this.refreshLibrary(false)
  },
  openComics() { this.navigate('/pages/comics/index') },
  openComic(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id
    if (this.data.comics.some(item => item.id === id)) this.navigate(`/pages/comics/index?seriesId=${encodeURIComponent(id)}`)
  },
  async refreshComics(force = true) {
    const version = ++this.comicRequestVersion
    const forced = force !== false
    this.setData({ comicLoading: !this.data.comics.length, comicError: '' })
    try {
      const result = await request<{ items: ComicSeries[]; partial?: boolean }>('/api/comic-series', { cacheTtl: 15000, noCache: forced })
      if (version !== this.comicRequestVersion) return
      if (!result.partial) writeReaderCache('comic-series-library-v1', result.items)
      this.setData({ comics: result.items.map(displaySeries), comicLoading: false, comicOffline: false })
      if (result.partial) this.setData({ comicError: '部分漫画暂时无法连接，请稍后刷新' })
    } catch (error) {
      if (version !== this.comicRequestVersion) return
      const cached = readReaderCache<ComicSeries[]>('comic-series-library-v1')
      const comics = this.data.comics.length ? this.data.comics : Array.isArray(cached) && cached.length ? cached.map(displaySeries) : []
      this.setData({ comics, comicLoading: false, comicOffline: !!comics.length, comicError: (error as Error).message || '漫画暂时无法连接' })
    }
    this.applyCategory()
  },
  onComicCoverError(e: WechatMiniprogram.TouchEvent) {
    this.setData({ comics: this.data.comics.map(item => item.id === e.currentTarget.dataset.id ? { ...item, coverUrl: '' } : item) })
    this.applyCategory()
  },
  async refreshLibrary(force = true) {
    if (this.data.refreshing) return
    const forced = force !== false
    const version = ++requestVersion
    if (forced) this.refreshComics(true)
    this.setData({ refreshing: true, loading: !this.data.allBooks.length, error: '' })
    try {
      const result = await request<{ items: LibraryBook[] }>('/api/works', { cacheTtl: forced ? 0 : 15000, noCache: forced })
      if (version !== requestVersion) return
      lastLibraryRefresh = Date.now()
      writeReaderCache('library', result.items)
      this.setData({ offline: false, loading: false })
      this.setCatalog(result.items)
      // Catalog browsing must not wait for login or private progress synchronization.
      this.syncReading(version)
    } catch (error) {
      if (version !== requestVersion) return
      const books = readReaderCache<LibraryBook[]>('library') || this.data.allBooks
      if (books?.length) {
        this.setData({ loading: false, offline: true })
        this.setCatalog(books)
      } else this.setData({ loading: false, error: (error as Error).message || '书城暂时无法连接' })
    } finally { if (version === requestVersion) this.setData({ refreshing: false }) }
  },
  setCatalog(books: LibraryBook[]) {
    this.setData({ allBooks: books.map(displayBook) })
    this.applyCategory()
    this.updateReading()
  },
  applyCategory() {
    const longBooks = this.data.allBooks.filter(book => book.format === 'longform')
    const shortBooks = this.data.allBooks.filter(book => book.format !== 'longform')
    this.setData({
      longBooks: ['短篇', '漫画'].includes(this.data.category) ? [] : longBooks,
      shortBooks: ['长篇', '漫画'].includes(this.data.category) ? [] : shortBooks,
      featuredComics: this.data.category === '漫画' ? this.data.comics : this.data.category === '全部' ? this.data.comics.slice(0, 4) : [],
      visibleCount: this.data.category === '长篇' ? longBooks.length : this.data.category === '短篇' ? shortBooks.length : this.data.category === '漫画' ? this.data.comics.length : this.data.allBooks.length,
    })
  },
  updateReading(remote?: { progress?: number; block_id?: string }) {
    const userId = getSession().userId
    const last = wx.getStorageSync('mojing_last_work')
    const book = userId && last?.userId === userId ? this.data.allBooks.find(item => item.id === last.workId) : undefined
    if (!book) { this.setData({ hasReading: false }); return }
    const local = wx.getStorageSync(`mojing_position_${userId}_${book.id}`) as Position | undefined
    const position = !remote || local?.pending || (!remote.block_id && !remote.progress) ? local : { progress: remote.progress, blockId: remote.block_id }
    const progress = boundedProgress(position?.progress)
    const hasReading = !!position?.blockId || progress > 0
    this.setData({ hasReading, continueBook: { ...book, progress, chapter: progress === 100 ? '已读完' : this.data.offline ? '本机阅读记录' : '上次阅读位置' } })
  },
  async syncReading(version: number) {
    try {
      await ensureSession()
      if (version !== requestVersion) return
      this.updateReading()
      const last = wx.getStorageSync('mojing_last_work')
      if (last?.userId !== getSession().userId || !this.data.allBooks.some(book => book.id === last.workId)) return
      const workId = this.data.continueBook.id
      const result = await request<{ progress: { progress: number; block_id?: string } }>(`/api/works/${encodeURIComponent(workId)}/reading-progress`)
      if (version === requestVersion && this.data.continueBook.id === workId) this.updateReading(result.progress)
    } catch { /* Public books and an existing local position remain available. */ }
  },
  chooseCategory(e: WechatMiniprogram.TouchEvent) {
    const category = e.currentTarget.dataset.category
    if (!this.data.categories.includes(category)) return
    this.setData({ category }); this.applyCategory()
  },
  onCoverError(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id
    this.setData({ allBooks: this.data.allBooks.map(book => book.id === id ? { ...book, coverImage: '' } : book) })
    this.applyCategory(); this.updateReading()
  },
  navigate(url: string) {
    if (this.data.navigating) return
    this.setData({ navigating: true })
    wx.navigateTo({ url, fail: () => { this.setData({ navigating: false }); wx.showToast({ title: '页面暂时无法打开', icon: 'none' }) } })
  },
  openDetail(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id
    if (!this.data.allBooks.some(book => book.id === id)) return
    this.navigate(this.data.offline ? `/pages/reader/index?workId=${encodeURIComponent(id)}` : `/pages/book/detail?id=${encodeURIComponent(id)}`)
  },
  openReader() { if (this.data.hasReading) this.navigate(`/pages/reader/index?workId=${encodeURIComponent(this.data.continueBook.id)}`) },
  openCreate() { wx.reLaunch({ url: '/pages/workbench/index' }) },
  openMe() { wx.reLaunch({ url: '/pages/me/index' }) },
  openShelf() { wx.reLaunch({ url: '/pages/shelf/index' }) },
  openSearch() { this.navigate('/pages/search/index') },
  onPullDownRefresh() { this.refreshLibrary(true).finally(() => wx.stopPullDownRefresh()) },
  onUnload() { requestVersion++; this.comicRequestVersion++ },
})
