import { request } from '../../utils/api'
import { displayBook } from '../../utils/library'


Page({
  searchTimer: null as ReturnType<typeof setTimeout> | null,
  searchVersion: 0,
  data: { query: '', submitted: false, loading: false, error: '', results: [] as any[], total: 0 },
  back() { wx.navigateBack({ fail: () => wx.reLaunch({ url: '/pages/home/index' }) }) },
  input(e: any) {
    const query = e.detail.value
    this.searchVersion++
    this.setData({ query, error: '', loading: !!query.trim(), results: [], total: 0, submitted: !!query.trim() })
    if (this.searchTimer) clearTimeout(this.searchTimer)
    if (query.trim()) this.searchTimer = setTimeout(() => this.submit(), 280)
  },
  async submit() {
    if (this.searchTimer) { clearTimeout(this.searchTimer); this.searchTimer = null }
    const query = this.data.query.trim()
    if (!query) { this.searchVersion++; this.setData({ submitted: false, loading: false, error: '', results: [], total: 0 }); return }
    const version = ++this.searchVersion
    this.setData({ submitted: true, loading: true, error: '' })
    try {
      const payload = await request<{ items: any[]; total?: number }>(`/api/works?q=${encodeURIComponent(query)}&limit=20&offset=0`, { cacheTtl: 15000 })
      if (version !== this.searchVersion) return
      const results = payload.items.map(item => ({ ...item, ...displayBook(item) }))
      this.setData({ results, total: payload.total ?? results.length, loading: false })
    } catch (error) {
      if (version !== this.searchVersion) return
      this.setData({ loading: false, error: (error as Error).message || '搜索服务暂不可用' })
    }
  },
  async more() {
    if (this.data.loading || this.data.results.length >= this.data.total) return
    const version = this.searchVersion
    this.setData({ loading: true, error: '' })
    try {
      const payload = await request<{ items: any[]; total: number }>(`/api/works?q=${encodeURIComponent(this.data.query.trim())}&limit=20&offset=${this.data.results.length}`)
      if (version === this.searchVersion) this.setData({ results: this.data.results.concat(payload.items.map(displayBook)), total: payload.total, loading: false })
    } catch (error) { if (version === this.searchVersion) this.setData({ loading: false, error: (error as Error).message }) }
  },
  chooseHint(e: WechatMiniprogram.TouchEvent) { this.setData({ query: e.currentTarget.dataset.query }); this.submit() },
  onReachBottom() { this.more() },
  onCoverError(e: WechatMiniprogram.TouchEvent) { this.setData({ results: this.data.results.map(item => item.id === e.currentTarget.dataset.id ? { ...item, coverImage: '' } : item) }) },
  onUnload() { this.searchVersion++; if (this.searchTimer) clearTimeout(this.searchTimer) },
  openBook(e: any) { wx.navigateTo({ url: '/pages/book/detail?id=' + e.currentTarget.dataset.id }) }
})
