import { ensureSession, request } from '../../utils/api'
import { creatorInsets } from '../../utils/creator'
Page({
  data: { ...creatorInsets(), step: 0, title: '', idea: '', protagonist: '', world: '', genre: '历史', mood: '热血爽文', workId: '', saving: false, error: '', illustrationsEnabled: true, steps: ['灵感', '设定', '创建'], genres: ['历史', '玄幻', '都市', '悬疑', '科幻', '奇幻'], moods: ['热血爽文', '克制悬疑', '轻松日常', '史诗冒险'] },
  back() { wx.navigateBack({ fail: () => wx.reLaunch({ url: '/pages/workbench/index' }) }) },
  input(e: WechatMiniprogram.Input) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value }) },
  chooseGenre(e: WechatMiniprogram.TouchEvent) { this.setData({ genre: e.currentTarget.dataset.value }) },
  chooseMood(e: WechatMiniprogram.TouchEvent) { this.setData({ mood: e.currentTarget.dataset.value }) },
  toggleImages(e: WechatMiniprogram.SwitchChange) { this.setData({ illustrationsEnabled: e.detail.value }) },
  prev() { if (this.data.step > 0) this.setData({ step: this.data.step - 1 }) },
  async next() {
    if (this.data.saving) return
    if (!this.data.title.trim() || !this.data.idea.trim()) { this.setData({ error: '请填写作品名称和故事灵感' }); return }
    if (this.data.step < 2) { this.setData({ step: this.data.step + 1, error: '' }); return }
    this.setData({ saving: true, error: '' })
    try {
      await ensureSession()
      if (!this.data.workId) {
        const result = await request<{work: {id: string}}>('/api/works', { method: 'POST', idempotent: true, data: { title: this.data.title.trim(), summary: this.data.idea.trim(), type: this.data.genre } })
        this.setData({ workId: result.work.id })
      }
      await request(`/api/works/${this.data.workId}/creative-settings`, { method: 'PUT', data: { protagonist: this.data.protagonist, world: this.data.world, genre: this.data.genre, mood: this.data.mood, illustrationsEnabled: this.data.illustrationsEnabled } })
      wx.redirectTo({ url: `/pages/workbench/index?workId=${this.data.workId}` })
    } catch (error) { this.setData({ error: (error as Error).message }) } finally { this.setData({ saving: false }) }
  },
})
