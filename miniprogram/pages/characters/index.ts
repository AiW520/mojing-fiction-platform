import { ensureDevSession, request } from '../../utils/api'

type Character = { id: string; name: string; role: string; relation: string; art: string; image: string; status: string; intro: string; traits: string[]; displayIntro?: string; displayTraits?: string[] }

Page({
  data: { mode: 'reader', canEdit: false, workId: '', workTitle: '人物图鉴', characters: [] as Character[], loading: true },
  onLoad(options: Record<string, string>) {
    const canEdit = options.mode === 'creator'
    const mode = canEdit ? 'creator' : 'reader'
    this.setData({ canEdit, workId: options.workId || '', mode })
    this.refreshCharacters(mode)
  },
  async refreshCharacters(mode: 'reader' | 'creator') {
    try {
      await ensureDevSession()
      const [result, detail, assets] = await Promise.all([
        request<{ items: any[] }>(`/api/works/${this.data.workId}/characters?view=${mode}`),
        request<{ work: any }>(`/api/works/${this.data.workId}`),
        request<{ items: Array<{ type: string; characterId: string | null; url: string }> }>(`/api/works/${this.data.workId}/assets`),
      ])
      const arts = ['art-mist', 'art-river', 'art-city']
      const portraits = new Map(assets.items.filter(item => item.type === 'character').map(item => [item.characterId, item.url]))
      const characters = result.items.map((item, index) => ({ id: item.id, name: item.name, role: item.role, relation: item.relation, art: arts[index % arts.length], image: portraits.get(item.id) || '', status: item.privateProfile ? '已解锁' : '待解锁', intro: item.publicSummary, traits: item.privateProfile ? Object.values(item.privateProfile).slice(0, 3).map(value => String(value)) : ['继续阅读'], displayIntro: item.publicSummary, displayTraits: item.privateProfile ? Object.values(item.privateProfile).slice(0, 3).map(value => String(value)) : ['？？？'] }))
      this.setData({ characters, workTitle: detail.work.title, loading: false })
    } catch (error) {
      this.setData({ loading: false })
      wx.showToast({ title: (error as Error).message || '人物加载失败', icon: 'none' })
    }
  },
  back() { wx.navigateBack() },
  openDetail(e: WechatMiniprogram.TouchEvent) { wx.navigateTo({ url: `/pages/characters/detail?id=${e.currentTarget.dataset.id}&workId=${this.data.workId}&mode=${this.data.mode}` }) },
  switchMode(e: WechatMiniprogram.TouchEvent) { const mode = e.currentTarget.dataset.mode as 'reader' | 'creator'; if (!this.data.canEdit && mode === 'creator') { wx.showToast({ title: '只有作品所有者可查看完整设定', icon: 'none' }); return } this.setData({ mode, loading: true }); this.refreshCharacters(mode) },
  toast() { wx.showModal({ title: '人物关系图', content: `${this.data.workTitle}的人物关系会随阅读进度逐步解锁。`, showCancel: false }) },
})
