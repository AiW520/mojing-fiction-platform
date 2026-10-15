import { ensureSession, request } from '../../utils/api'
import { CreativeAsset, CreativeSettings, TextReview, TextJobResult, ModelAttempt, creatorInsets, displayAssets } from '../../utils/creator'

Page({
  pollId: 0,
  visible: true,
  jobFinished: false,
  data: {
    ...creatorInsets(), saved: true, saving: false, loading: true, error: '', selected: 0, workId: 'work_demo', title: '', words: 0, readOnly: false,
    blocks: [] as string[], blockIds: [] as string[], sceneTitles: [] as string[], tools: ['续写', '改写', '润色', '配图'],
    lockedBlocks: [] as boolean[],
    textReady: false, imageReady: false, settings: {} as CreativeSettings, assets: [] as CreativeAsset[], blockAssets: [] as Array<CreativeAsset | null>,
    illustrationOpen: false, imageKind: 'scene', imageTitle: '', imageSubject: '', imagePlace: '', imageShot: '', imageSource: '', imageConfirmed: false,
    imageBusy: false, imageError: '', imageJobId: '', imageIndex: 0,
    generating: false, generationError: '', generatedText: '', generatedAction: '', generatedIndex: 0, originalText: '', jobId: '',
    originalContext: '', generatedReview: null as TextReview | null, reviewLabel: '', modelAttempts: [] as ModelAttempt[],
  },
  async onLoad(options: Record<string, string>) {
    this.setData({ workId: options.workId || 'work_demo' })
    try {
      await ensureSession()
      const [result, status, settings] = await Promise.all([
        request<{ work: { title: string; words: number; status: string; format: string }; items: Array<{ id: string; content: string; sceneTitle: string; locked: number }> }>(`/api/works/${this.data.workId}/blocks`),
        request<{textReady: boolean; imageReady: boolean}>('/api/creator/status'), request<{settings: CreativeSettings}>(`/api/works/${this.data.workId}/creative-settings`),
      ])
      const blockIds = result.items.length ? result.items.map(item => item.id) : [`${this.data.workId}_block_${Date.now()}`]
      const selected = Math.max(0, blockIds.indexOf(options.blockId))
      this.setData({ ...status, settings: settings.settings, title: result.work.title, words: result.work.words, blocks: result.items.length ? result.items.map(item => item.content) : [''], blockIds, lockedBlocks: result.items.map(item => Boolean(item.locked)), sceneTitles: result.items.map(item => item.sceneTitle || ''), selected, loading: false, readOnly: result.work.status === 'published' || result.work.format === 'longform' })
      await this.loadImages()
    } catch (error) { this.setData({ loading: false, error: (error as Error).message }) }
  },
  onUnload() { this.visible = false; this.pollId++ },
  onHide() { this.visible = false; this.pollId++; this.setData({ generating: false, imageBusy: false }) },
  onShow() {
    this.visible = true
    if (this.data.jobId && !this.jobFinished) this.checkJob()
    else if (this.data.imageJobId) this.checkImageJob()
  },
  onResize() { this.setData(creatorInsets()) },
  back() {
    const exit = () => wx.navigateBack({ fail: () => wx.redirectTo({ url: `/pages/workbench/index?workId=${this.data.workId}` }) })
    if (this.data.saved) { exit(); return }
    wx.showModal({ title: '尚未保存', content: '退出会丢失本次编辑，确认退出？', success: result => { if (result.confirm) exit() } })
  },
  selectBlock(e: WechatMiniprogram.TouchEvent) { this.setData({ selected: Number(e.currentTarget.dataset.index) }) },
  editBlock(e: WechatMiniprogram.Input) {
    if (this.data.readOnly || this.data.saving || this.data.lockedBlocks[Number(e.currentTarget.dataset.index)]) return
    const blocks = [...this.data.blocks]
    blocks[Number(e.currentTarget.dataset.index)] = e.detail.value
    this.setData({ [`blocks[${Number(e.currentTarget.dataset.index)}]`]: e.detail.value, saved: false, words: blocks.join('').replace(/\s/g,'').length })
    this.markReviewStale()
  },
  async save() {
    if (this.data.error || this.data.saving || this.data.readOnly) return
    this.setData({ saving: true })
    try {
      await ensureSession()
      const items = this.data.blocks.map((content,index) => ({ id: this.data.blockIds[index], content, sceneId: this.data.sceneTitles[index] || '', locked: !!this.data.lockedBlocks[index] }))
      await request(`/api/works/${this.data.workId}/blocks`, { method: 'PUT', data: { items } })
      await request(`/api/works/${this.data.workId}/versions`, { method: 'POST', idempotent: true, idempotencyScope: JSON.stringify(items), data: { label: '编辑器手动保存' } })
      this.setData({ saved: true, blockIds: items.map(item => item.id), ...(this.data.generatedReview ? { generatedReview: { ...this.data.generatedReview, stale: true }, reviewLabel: '正文版本已改变，报告已失效' } : {}) })
      await this.loadImages()
      wx.showToast({ title: '版本已保存', icon: 'none' })
    } catch (error) { wx.showToast({ title: (error as Error).message || '保存失败', icon: 'none' }) } finally { this.setData({ saving: false }) }
  },
  async tool(e: WechatMiniprogram.TouchEvent) {
    if (this.data.generating || this.data.imageBusy || (this.data.jobId && !this.jobFinished) || this.data.error || this.data.readOnly || this.data.saving) return
    const name = e.currentTarget.dataset.name
    if (name === '配图') { this.openIllustration(); return }
    if (!this.data.textReady) { wx.showToast({ title: '请先在管理台配置文本模型', icon: 'none' }); return }
    if (name === '审查') {
      if (!this.data.saved) { wx.showToast({ title: '请先保存正文', icon: 'none' }); return }
      try { await request(`/api/works/${this.data.workId}/review`, { method: 'POST', data: {} }); wx.showToast({ title: '已提交基础结构检查', icon: 'none' }) }
      catch (error) { wx.showToast({ title: (error as Error).message, icon: 'none' }) }
      return
    }
    const actionMap: Record<string,string> = { '续写':'continue', '改写':'rewrite', '润色':'polish' }
    if (!actionMap[name]) return
    if (this.data.lockedBlocks[this.data.selected] && name !== '续写') { wx.showToast({ title: '此段已锁定', icon: 'none' }); return }
    this.jobFinished = false
    this.setData({ generating: true, generationError: '', generatedText: '', generatedReview: null, reviewLabel: '', modelAttempts: [], generatedAction: actionMap[name], generatedIndex: this.data.selected, originalText: this.data.blocks[this.data.selected] || '', originalContext: this.data.blocks.join('\n\n') })
    try {
      const result = await request<{ jobId: string }>(`/api/works/${this.data.workId}/text-jobs`, { method: 'POST', idempotent: true, data: { action: actionMap[name], selected: this.data.originalText, context: this.data.blocks.join('\n\n') } })
      this.setData({ jobId: result.jobId })
      if (this.visible) await this.waitForJob(result.jobId)
    } catch (error) { if (this.visible) this.setData({ generating: false, generationError: (error as Error).message }) }
  },
  async waitForJob(jobId: string) {
    const id = ++this.pollId
    for (let attempt = 0; attempt < 400; attempt++) {
      await new Promise(resolve => setTimeout(resolve, Math.min(6000, 1500 + attempt * 250)))
      if (id !== this.pollId) return
      const payload = await request<{ job: { status: string; result?: TextJobResult; errorCode?: string } }>(`/api/jobs/${jobId}`)
      if (id !== this.pollId || !this.visible) return
      if (payload.job.result?.content) {
        const review = payload.job.result.review || null
        const labels: Record<string,string> = { pending: '审查中', success: '审查完成', stale: '报告已失效', unknown: '审查结果未知', failed: '审查失败', unconfigured: '未配置审查模型' }
        this.setData({ generatedText: payload.job.result.content, generatedReview: review, reviewLabel: review ? labels[review.status] || review.status : '', modelAttempts: payload.job.result.attempts || [] })
        this.markReviewStale()
        if (['success','failed'].includes(payload.job.status)) { this.jobFinished = true; this.setData({ generating: false }); return }
      }
      if (payload.job.status === 'failed') { this.jobFinished = true; throw new Error(`生成失败：${payload.job.errorCode || '供应商错误'}`) }
    }
    throw new Error('任务仍在处理中，请检查任务状态')
  },
  checkJob() { if (this.data.jobId && !this.jobFinished && !this.data.imageBusy && !this.data.generating) { const version = this.pollId + 1; this.setData({ generating: true, generationError: '' }); this.waitForJob(this.data.jobId).catch((error: Error) => { if (this.visible && version === this.pollId) this.setData({ generating: false, generationError: error.message }) }) } },
  markReviewStale() {
    if (this.data.generatedReview && (this.data.blocks.join('\n\n') !== this.data.originalContext || this.data.generatedReview.stale)) this.setData({ generatedReview: { ...this.data.generatedReview, stale: true }, reviewLabel: '正文已改变，报告已失效' })
  },
  applyGenerated() {
    if (!this.data.generatedText || this.data.generating) return
    const blocks = [...this.data.blocks]
    const index = this.data.generatedIndex
    if (blocks[index] !== this.data.originalText) { wx.showToast({ title: '原段落已修改，请先核对结果', icon: 'none' }); return }
    if (this.data.generatedAction === 'continue') blocks.splice(index + 1,0,this.data.generatedText)
    else {
      if (blocks[index] !== this.data.originalText) { wx.showToast({ title: '原段落已修改，请先核对结果', icon: 'none' }); return }
      blocks[index] = this.data.generatedText
    }
    const ids = [...this.data.blockIds]
    const titles = [...this.data.sceneTitles]
    const locks = [...this.data.lockedBlocks]
    if (this.data.generatedAction === 'continue') { ids.splice(index+1,0,`${this.data.workId}_block_${Date.now()}`); titles.splice(index+1,0,''); locks.splice(index+1,0,false) }
    this.setData({ blocks, blockIds: ids, sceneTitles: titles, lockedBlocks: locks, words: blocks.join('').replace(/\s/g,'').length, saved: false, generatedText: '', generatedReview: null, modelAttempts: [], jobId: '' })
    this.mapImages()
  },
  discardGenerated() { if (this.data.jobId && !this.jobFinished) { wx.showToast({ title: '任务仍在处理中，请先检查状态', icon: 'none' }); return }; this.pollId++; this.setData({ generatedText: '', generatedReview: null, modelAttempts: [], jobId: '', generationError: '', generating: false }) },
  async loadImages() {
    const result = await request<{items: CreativeAsset[]}>(`/api/works/${this.data.workId}/assets`)
    this.setData({ assets: await displayAssets(result.items.filter(item => item.approvalStatus !== 'rejected')) }); this.mapImages()
  },
  mapImages() { this.setData({ blockAssets: this.data.blockIds.map(id => this.data.assets.find(item => item.blockId === id) || null) }) },
  addBlock() {
    if (this.data.saving || this.data.readOnly) return
    const index = this.data.blocks.length
    this.setData({ blocks: [...this.data.blocks, ''], blockIds: [...this.data.blockIds, `${this.data.workId}_block_${Date.now()}`], sceneTitles: [...this.data.sceneTitles, ''], lockedBlocks: [...this.data.lockedBlocks, false], selected: index, saved: false }); this.mapImages(); this.markReviewStale()
  },
  openIllustration() {
    const index = this.data.selected
    this.setData({ illustrationOpen: true, imageIndex: index, imageSource: (this.data.blocks[index] || '').slice(0, 220), imageConfirmed: false, imageError: '' })
  },
  closeIllustration() { this.setData({ illustrationOpen: false }) }, stopTap() {},
  chooseImageKind(e: WechatMiniprogram.TouchEvent) { this.setData({ imageKind: e.currentTarget.dataset.kind, imageConfirmed: false }) },
  imageInput(e: WechatMiniprogram.Input) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value }) },
  confirmImageCost(e: WechatMiniprogram.SwitchChange) { this.setData({ imageConfirmed: e.detail.value }) },
  async generateIllustration() {
    if (this.data.imageBusy || this.data.generating || this.data.imageJobId || this.data.readOnly || !this.data.imageReady) return
    if (!this.data.saved) { this.setData({ imageError: '请先保存正文，再生成配图' }); return }
    if (!this.data.imageConfirmed || !this.data.imageSubject.trim() || !this.data.imagePlace.trim()) { this.setData({ imageError: '请填写人物动作、场景，并确认调用费用' }); return }
    this.setData({ imageBusy: true, imageError: '' })
    try {
      const job = await request<{jobId: string}>(`/api/works/${this.data.workId}/image-jobs`, { method: 'POST', data: { kind: this.data.imageKind, blockId: this.data.blockIds[this.data.imageIndex], title: this.data.imageTitle || '场景插图', prompt: `主体与动作：${this.data.imageSubject}。时间与场景：${this.data.imagePlace}。构图与镜头：${this.data.imageShot || '清晰的中远景，人物不占满画面，保留场景叙事'}。`, confirmCost: true } })
      this.setData({ imageJobId: job.jobId, imageConfirmed: false }); await this.waitForImage(job.jobId)
    } catch (error) { this.setData({ imageBusy: false, imageError: (error as Error).message }) }
  },
  async waitForImage(jobId: string) {
    const id = ++this.pollId
    for (let attempt = 0; attempt < 125; attempt++) {
      await new Promise(resolve => setTimeout(resolve, Math.min(6000, 1800 + attempt * 300)))
      if (id !== this.pollId) return
      const payload = await request<{job: {status: string; errorCode?: string}}>(`/api/jobs/${jobId}`)
      if (id !== this.pollId || !this.visible) return
      if (payload.job.status === 'success') { await this.loadImages(); this.setData({ imageBusy: false, imageError: '生成完成，素材待内容审核', imageJobId: '' }); return }
      if (payload.job.status === 'failed') throw new Error(`生成失败：${payload.job.errorCode || '服务异常'}；不会自动重试`)
    }
    throw new Error('仍在处理中，可检查原任务状态；请勿重复生成')
  },
  checkImageJob() { if (this.data.imageJobId && !this.data.imageBusy && !this.data.generating) { const version = this.pollId + 1; this.setData({ imageBusy: true, imageError: '' }); this.waitForImage(this.data.imageJobId).catch((error: Error) => { if (this.visible && version === this.pollId) this.setData({ imageBusy: false, imageError: error.message }) }) } },
  openMaterials() {
    if (!this.data.saved) { wx.showToast({ title: '请先保存正文', icon: 'none' }); return }
    wx.navigateTo({ url: `/pages/workbench/index?workId=${this.data.workId}` })
  },
})
