import { getSession } from '../../utils/access'
import { ensureSession, openAdminWeb, request } from '../../utils/api'

Page({
  data: { name: '墨境读者', initial: '墨', roleLabel: '读者', shelfCount: 0, themeLabel: '宣纸', connected: false },
  async onShow() {
    this.setData({ themeLabel: ({ paper: '宣纸', moon: '月白', ink: '墨夜' } as Record<string, string>)[wx.getStorageSync('mojing_reader_theme') || 'paper'] || '宣纸' })
    try {
      await ensureSession()
      const session = getSession()
      const shelf = await request<{ items: any[] }>('/api/me/shelf', { cacheTtl: 15000 })
      this.setData({ name: session.name, initial: session.name.slice(0,1), roleLabel: session.role === 'creator' ? '创作者' : '读者', shelfCount: shelf.items.length, connected: true })
    } catch { this.setData({ connected: false }) }
  },
  openHome() { wx.reLaunch({ url: '/pages/home/index' }) },
  openShelf() { wx.reLaunch({ url: '/pages/shelf/index' }) },
  openCreate() { wx.reLaunch({ url: '/pages/workbench/index' }) },
  openAdmin() { openAdminWeb() },
  changeTheme() {
    wx.showActionSheet({ itemList: ['宣纸', '月白', '墨夜'], success: result => {
      const themes = ['paper', 'moon', 'ink']
      wx.setStorageSync('mojing_reader_theme', themes[result.tapIndex])
      this.onShow()
    } })
  },
})
