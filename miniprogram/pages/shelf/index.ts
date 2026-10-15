import { ensureDevSession, request } from '../../utils/api'
import { displayBook } from '../../utils/library'
import { getSession } from '../../utils/access'
import { readReaderCache, writeReaderCache } from '../../utils/reader-cache'

Page({
  data: { tabs: ['全部', '在读', '已完成'], tab: '全部', allBooks: [] as any[], books: [] as any[], loading: true, refreshing: false, error: '', offline: false },
  accountId: '',
  alive: true,
  onLoad() { this.alive = true },
  async onShow() { await this.reload() },
  async reload() {
    if (this.data.refreshing) return
    this.setData({ refreshing: true, error: '' })
    const display = (items: any[]) => {
      this.setData({ allBooks: items.map(item => ({ ...displayBook(item), chapter: item.progress ? '从上次位置继续' : (item.format === 'longform' ? `已更新 ${item.chapterCount} 章` : '尚未开始'), progress: item.progress || 0, art: item.cover || 'art-mist' })), loading: false })
      this.applyFilter(this.data.tab)
    }
    try {
      const current = getSession().userId || ''
      if (current !== this.accountId) { this.accountId = current; this.setData({ allBooks: [], books: [], loading: true }) }
      if (current) { const cached = readReaderCache<any[]>(`shelf_${current}`); if (cached) display(cached) }
      await ensureDevSession()
      if (!this.alive) return
      const userId = getSession().userId
      if (userId !== this.accountId) { this.accountId = userId; this.setData({ allBooks: [], books: [], loading: true }) }
      const result = await request<{ items: any[] }>('/api/me/shelf')
      if (!this.alive || userId !== getSession().userId) return
      writeReaderCache(`shelf_${userId}`, result.items); display(result.items)
      this.setData({ offline: false })
    } catch (error) {
      if (!this.alive) return
      const userId = getSession().userId
      const cached = userId ? readReaderCache<any[]>(`shelf_${userId}`) : undefined
      if (cached) { display(cached); this.setData({ offline: true }) }
      else this.setData({ error: (error as Error).message, loading: false })
    } finally { if (this.alive) this.setData({ refreshing: false }) }
  },
  onCoverError(e: WechatMiniprogram.TouchEvent) { this.setData({ allBooks: this.data.allBooks.map(item => item.id === e.currentTarget.dataset.id ? { ...item, coverImage: '' } : item) }); this.applyFilter(this.data.tab) },
  back() { wx.navigateBack({ fail: () => wx.reLaunch({ url: '/pages/home/index' }) }) },
  openHome() { wx.reLaunch({ url: '/pages/home/index' }) },
  openCreate() { wx.reLaunch({ url: '/pages/workbench/index' }) },
  openMe() { wx.reLaunch({ url: '/pages/me/index' }) },
  openSearch() { wx.navigateTo({ url: '/pages/search/index' }) },
  changeTab(e: any) { const tab = e.currentTarget.dataset.tab; this.setData({ tab }); this.applyFilter(tab) },
  applyFilter(tab: string) { const items = this.data.allBooks; const books = tab === '在读' ? items.filter(item => item.progress > 0 && item.progress < 100) : tab === '已完成' ? items.filter(item => item.progress >= 100) : items; this.setData({ books }) },
  openBook(e: any) { wx.navigateTo({ url: '/pages/book/detail?id=' + e.currentTarget.dataset.id }) },
  onUnload() { this.alive = false },
})
