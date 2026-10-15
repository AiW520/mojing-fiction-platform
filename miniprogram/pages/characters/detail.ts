import { ensureDevSession, request } from '../../utils/api'

type CharacterDetail = { id: string; name: string; role: string; relation: string; art: string; image: string; intro: string; unlocked: boolean; desire: string; fear: string; voice: string; arcStart: string; arcCurrent: string }

Page({
  data: { editing: false, loading: true, mode: 'reader', character: { id: '', name: '正在载入', role: '', relation: '', art: 'art-mist', image: '', intro: '', unlocked: false, desire: '—', fear: '—', voice: '—', arcStart: '—', arcCurrent: '—' } as CharacterDetail },
  async onLoad(options: Record<string, string>) {
    const mode = options.mode === 'creator' ? 'creator' : 'reader'
    this.setData({ mode })
    try {
      await ensureDevSession()
      const [result, assets] = await Promise.all([
        request<{ character: any }>(`/api/characters/${options.id}?view=${mode}`),
        request<{ items: Array<{ type: string; characterId: string | null; url: string }> }>(`/api/works/${options.workId}/assets`),
      ])
      const item = result.character
      const privateProfile = item.privateProfile || {}
      const image = assets.items.find(asset => asset.type === 'character' && asset.characterId === item.id)?.url || ''
      this.setData({ loading: false, character: { id: item.id, name: item.name, role: item.role, relation: item.relation, art: 'art-mist', image, intro: item.publicSummary, unlocked: Boolean(item.privateProfile), desire: privateProfile.desire || '—', fear: privateProfile.fear || '—', voice: privateProfile.voice || '—', arcStart: privateProfile.arcStart || '—', arcCurrent: privateProfile.arcCurrent || '—' } })
    } catch (error) {
      this.setData({ loading: false })
      wx.showToast({ title: (error as Error).message || '人物加载失败', icon: 'none' })
    }
  },
  back() { wx.navigateBack() },
  async toggleEdit() {
    if (this.data.mode !== 'creator') { wx.showToast({ title: '读者视图不可编辑人物设定', icon: 'none' }); return }
    if (!this.data.editing) { this.setData({ editing: true }); return }
    try {
      await request(`/api/characters/${this.data.character.id}`, { method: 'PATCH', data: { privateProfile: { desire: this.data.character.desire, fear: this.data.character.fear, voice: this.data.character.voice, arcStart: this.data.character.arcStart, arcCurrent: this.data.character.arcCurrent } } })
      this.setData({ editing: false })
      wx.showToast({ title: '人物设定已保存', icon: 'none' })
    } catch (error) { wx.showToast({ title: (error as Error).message || '保存失败', icon: 'none' }) }
  },
  async generate() { if (this.data.mode !== 'creator') return; try { const result = await request<{ jobId: string }>(`/api/characters/${this.data.character.id}/reference-images`, { method: 'POST', data: {} }); wx.showToast({ title: `已加入生成队列：${result.jobId.slice(0, 6)}`, icon: 'none' }) } catch (error) { wx.showToast({ title: (error as Error).message || '生成失败', icon: 'none' }) } },
})
