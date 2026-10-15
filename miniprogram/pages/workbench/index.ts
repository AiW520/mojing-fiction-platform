import { ensureSession, openAdminWeb, request } from '../../utils/api'
import { CreativeAsset, CreativeJob, CreativeSettings, CreativeWork, TextReview, creatorInsets, creatorMedia, displayAssets } from '../../utils/creator'
type CreatorComic = { id: string; title: string; seriesId: string; seriesTitle: string; episodeNumber: number; panelCount: number; missingImages: number; pendingReview: number; runningJobs: number; failedJobs: number; stage: string; published: boolean; version: number; publishedVersion: number | null; stageLabel?: string }
const comicStages: Record<string, string> = { storyboard: '待分镜', images: '待配图', generating: '制作中', review: '待审核', ready: '待发布', published: '已发布' }
Page({
  refreshTimer: null as ReturnType<typeof setTimeout> | null,
  loadVersion: 0,
  data: {
    ...creatorInsets(), loading: true, error: '', workId: '', work: null as CreativeWork | null,
    allWorks: [] as CreativeWork[], visibleWorks: [] as CreativeWork[], filter: 'writing', tab: 'overview',
    medium: 'novels', comics: [] as CreatorComic[], comicProjects: [] as Array<{ id: string; title: string; episodes: CreatorComic[] }>, comicCanManage: false,
    blocks: [] as Array<{ id: string; content: string; sceneTitle: string }>, assets: [] as CreativeAsset[], jobs: [] as CreativeJob[],
    settings: {} as CreativeSettings, settingsDirty: false, busy: false, generatedOutline: '', outlineJob: '',
    textReady: false, imageReady: false, canReview: false, coverUrl: '',
    outlineReview: null as TextReview | null,
  },
  onLoad(options: Record<string,string>) { this.setData({ workId: options.workId || '' }) },
  onShow() { this.reload() },
  visible: true,
  onHide() { this.visible = false; if (this.refreshTimer) clearTimeout(this.refreshTimer); this.loadVersion++ },
  onUnload() { if (this.refreshTimer) clearTimeout(this.refreshTimer); this.loadVersion++ },
  onResize() { this.setData(creatorInsets()) },
  async reload(polling = false) {
    const poll = polling === true
    if (!poll) this.visible = true
    if (poll && !this.visible) return
    const version = ++this.loadVersion
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
    this.setData({ error: '' })
    try {
      await ensureSession()
      if (!this.data.workId && this.data.medium === 'comics') {
        const result = await request<{ items: CreatorComic[]; canManage: boolean }>('/api/me/comics')
        if (version !== this.loadVersion || !this.visible) return
        this.setData({ comics: result.items.map(item => ({ ...item, stageLabel: comicStages[item.stage] || '草稿' })), comicCanManage: result.canManage, loading: false })
        this.filterComics()
        if (result.items.some(item => item.runningJobs > 0)) this.refreshTimer = setTimeout(() => this.reload(true), 4000)
        return
      }
      if (poll && this.data.workId) {
        const jobs = await request<{ items: CreativeJob[] }>(`/api/works/${this.data.workId}/jobs`)
        if (version !== this.loadVersion || !this.visible) return
        this.setData({ jobs: jobs.items })
        if (jobs.items.some(item => ['queued','running'].includes(item.status))) { this.refreshTimer = setTimeout(() => this.reload(true), 4000); return }
      }
      const status = await request<{ textReady: boolean; imageReady: boolean; canReview: boolean }>('/api/creator/status')
      if (version !== this.loadVersion) return
      this.setData(status)
      if (!this.data.workId) {
        const result = await request<{ items: CreativeWork[] }>('/api/me/works')
        const items = await Promise.all(result.items.map(async item => ({ ...item, coverImage: item.coverImage ? await creatorMedia(item.coverImage).catch(() => '') : '' })))
        if (version !== this.loadVersion) return
        this.setData({ allWorks: items, loading: false }); this.filterWorks(); return
      }
      const [detail, settings, assets, jobs] = await Promise.all([
        request<{work: CreativeWork}>(`/api/works/${this.data.workId}`), request<{settings: CreativeSettings}>(`/api/works/${this.data.workId}/creative-settings`),
        request<{items: CreativeAsset[]}>(`/api/works/${this.data.workId}/assets`), request<{items: CreativeJob[]}>(`/api/works/${this.data.workId}/jobs`),
      ])
      const blocks = detail.work.format === 'longform' ? [] : (await request<{items: Array<{id: string; content: string; sceneTitle: string}>}>(`/api/works/${this.data.workId}/blocks`)).items
      const images = await displayAssets(assets.items)
      const coverUrl = detail.work.coverImage ? await creatorMedia(detail.work.coverImage).catch(() => '') : ''
      if (version !== this.loadVersion) return
      this.setData({ work: detail.work, blocks, assets: images, jobs: jobs.items, loading: false, coverUrl, ...(this.data.settingsDirty ? {} : { settings: settings.settings }) })
      const outline = jobs.items.find(item => item.id === this.data.outlineJob)
      if (outline?.status === 'success') this.setData({ generatedOutline: outline.result?.content || '', outlineReview: outline.result?.review || null, busy: false, outlineJob: '' })
      if (outline?.status === 'failed') this.setData({ error: `大纲生成失败：${outline.errorCode || '服务异常'}`, busy: false, outlineJob: '' })
      if (jobs.items.some(item => ['queued','running'].includes(item.status))) this.refreshTimer = setTimeout(() => this.reload(true), 4000)
    } catch (error) { if (version === this.loadVersion) this.setData({ error: (error as Error).message, loading: false, busy: false }) }
  },
  filterWorks() { this.setData({ visibleWorks: this.data.allWorks.filter(item => this.data.filter === 'writing' ? item.status !== 'published' : item.status === 'published') }) },
  filterComics() {
    const groups = new Map<string, { id: string; title: string; episodes: CreatorComic[] }>()
    this.data.comics.filter(item => this.data.filter === 'published' ? item.published : item.stage !== 'published').forEach(item => {
      const group = groups.get(item.seriesId) || { id: item.seriesId, title: item.seriesTitle, episodes: [] }
      group.episodes.push(item); groups.set(item.seriesId, group)
    })
    this.setData({ comicProjects: [...groups.values()].map(group => ({ ...group, episodes: group.episodes.sort((a, b) => a.episodeNumber - b.episodeNumber) })) })
  },
  chooseMedium(e: WechatMiniprogram.TouchEvent) {
    if (this.data.medium === e.currentTarget.dataset.medium) return
    this.setData({ medium: e.currentTarget.dataset.medium, loading: true, filter: 'writing' }); this.reload()
  },
  chooseFilter(e: WechatMiniprogram.TouchEvent) { this.setData({ filter: e.currentTarget.dataset.filter }); this.data.medium === 'comics' ? this.filterComics() : this.filterWorks() },
  openComicStudio(e: WechatMiniprogram.TouchEvent) {
    if (!this.data.comicCanManage) { wx.showToast({ title: '当前账号暂无漫画制作权限', icon: 'none' }); return }
    openAdminWeb('comics', e.currentTarget.dataset.id || '')
  },
  changeTab(e: WechatMiniprogram.TouchEvent) { this.setData({ tab: e.currentTarget.dataset.tab }) },
  openWork(e: WechatMiniprogram.TouchEvent) { wx.navigateTo({ url: `/pages/workbench/index?workId=${e.currentTarget.dataset.id}` }) },
  createWork() { wx.navigateTo({ url: '/pages/create/wizard' }) },
  back() {
    const exit = () => wx.navigateBack({ fail: () => wx.reLaunch({ url: '/pages/workbench/index' }) })
    if (!this.data.settingsDirty) { exit(); return }
    wx.showModal({ title: '设定尚未保存', content: '放弃本次修改？', success: result => { if (result.confirm) exit() } })
  },
  openEditor(e: WechatMiniprogram.TouchEvent) {
    if (this.data.work?.status === 'published' || this.data.work?.format === 'longform') { this.openReader(); return }
    wx.navigateTo({ url: `/pages/editor/index?workId=${this.data.workId}${e.currentTarget.dataset.id ? '&blockId=' + e.currentTarget.dataset.id : ''}` })
  },
  openReader() { wx.navigateTo({ url: `/pages/reader/index?workId=${this.data.workId}` }) },
  openCharacters() { wx.navigateTo({ url: `/pages/characters/index?workId=${this.data.workId}&mode=creator` }) },
  openAssets() { this.setData({ tab: 'assets' }) }, openOutline() { this.setData({ tab: 'settings' }) },
  openHome() { wx.reLaunch({ url: '/pages/home/index' }) }, openShelf() { wx.reLaunch({ url: '/pages/shelf/index' }) }, openMe() { wx.reLaunch({ url: '/pages/me/index' }) }, openAdmin() { openAdminWeb() },
  inputSetting(e: WechatMiniprogram.Input) { this.setData({ settings: { ...this.data.settings, [e.currentTarget.dataset.field]: e.detail.value }, settingsDirty: true, ...(this.data.outlineReview ? { outlineReview: { ...this.data.outlineReview, stale: true } } : {}) }) },
  toggleIllustrations(e: WechatMiniprogram.SwitchChange) { this.setData({ settings: { ...this.data.settings, illustrationsEnabled: e.detail.value }, settingsDirty: true }) },
  async saveSettings() {
    if (this.data.busy || this.data.work?.status === 'published') return
    this.setData({ busy: true, error: '' })
    try { await request(`/api/works/${this.data.workId}/creative-settings`, { method: 'PUT', data: this.data.settings }); this.setData({ settingsDirty: false }); wx.showToast({ title: '设定已保存', icon: 'none' }) }
    catch (error) { this.setData({ error: (error as Error).message }) } finally { this.setData({ busy: false }) }
  },
  generateOutline() {
    if (!this.data.textReady || this.data.busy || this.data.outlineJob || this.data.work?.status === 'published') return
    if (this.data.settingsDirty) { wx.showToast({ title: '请先保存设定', icon: 'none' }); return }
    this.setData({ busy: true })
    wx.showModal({ title: '生成故事大纲', content: '生成后会自动监督审查。生成和审查各最多调用 3 次，超时或网络错误会停止；候选由你确认后采纳。', fail: () => this.setData({ busy: false }), success: async result => {
      if (!result.confirm) { this.setData({ busy: false }); return }
      this.setData({ error: '', generatedOutline: '', outlineReview: null })
      try { const job = await request<{jobId: string}>(`/api/works/${this.data.workId}/text-jobs`, { method: 'POST', idempotent: true, data: { action: 'outline' } }); this.setData({ outlineJob: job.jobId }); this.reload() }
      catch (error) { this.setData({ busy: false, error: (error as Error).message }) }
    } })
  },
  adoptOutline() { this.setData({ settings: { ...this.data.settings, outline: this.data.generatedOutline }, settingsDirty: true, generatedOutline: '', outlineReview: null }) }, discardOutline() { this.setData({ generatedOutline: '', outlineReview: null }) },
  async submitReview() {
    if (this.data.busy || this.data.work?.status === 'published' || this.data.work?.format === 'longform') return
    if (!this.data.blocks.some(item => item.content.trim())) { wx.showToast({ title: '请先保存正文', icon: 'none' }); return }
    this.setData({ busy: true, error: '' })
    try {
      const result = await request<{ status: string }>(`/api/works/${this.data.workId}/review`, { method: 'POST', data: {} })
      wx.showToast({ title: result.status === 'pending' ? '已提交，等待内容审核' : '基础检查未通过', icon: 'none' })
    } catch (error) { this.setData({ error: (error as Error).message }) } finally { this.setData({ busy: false }) }
  },
  async decideAsset(e: WechatMiniprogram.TouchEvent) {
    if (!this.data.canReview || this.data.busy) return
    this.setData({ busy: true, error: '' })
    try { await request(`/api/works/${this.data.workId}/assets/${e.currentTarget.dataset.id}/${e.currentTarget.dataset.decision}`, { method: 'POST', data: {} }); await this.reload() }
    catch (error) { this.setData({ error: (error as Error).message }) } finally { this.setData({ busy: false }) }
  },
  imageError(e: WechatMiniprogram.TouchEvent) { this.setData({ assets: this.data.assets.map(item => item.id === e.currentTarget.dataset.id ? { ...item, displayUrl: '', loadError: true } : item) }) },
})
