import { ensureSession, request } from '../../utils/api'
import { displayBook } from '../../utils/library'
import { getSession } from '../../utils/access'
import { getEnvironment } from '../../config'
import { defaultShare, isTimelinePreview, setShareMenu, shareContent } from '../../utils/share'

type Comment = { id: string; author: string; content: string; rating: number | null; spoiler: boolean; status: string; createdAt: string; likes: number; liked: boolean; replies: number; mine: boolean; revealed?: boolean }
type CommentView = Comment & { initial: string; dateLabel: string }
type Draft = { content: string; rating: number; spoiler: boolean; clientId: string }
const viewComment = (item: Comment): CommentView => ({ ...item, initial: item.author.slice(0, 1), dateLabel: item.createdAt.slice(0, 16).replace('T', ' ') })
const emptyDraft = (): Draft => ({ content: '', rating: 0, spoiler: false, clientId: `c_${Date.now()}_${Math.random().toString(36).slice(2, 12)}` })
const assetUrl = (url: string) => displayBook({ id: '', title: '', author: '', coverImage: url }).coverImage || ''
let replyRequest = 0

Page({
  data: {
    inShelf: false, loading: true, error: '', workId: '', shareReady: false, shelfBusy: false, navigating: false,
    book: { ...displayBook({ id: '', title: '正在载入', author: '' }), progress: 0, status: '', characterCount: 0, characters: [] as any[] } as any,
    storyImages: [] as Array<{ id: string; title: string; url: string }>,
    commentTab: 'review', commentSort: 'latest', comments: [] as CommentView[], commentsTotal: 0, commentsLoading: false, commentsError: '',
    commentSummary: { rating: null as number | null, ratings: 0, reviews: 0, discussions: 0 }, commentBusy: '',
    composerOpen: false, composerTitle: '', draft: emptyDraft(), draftOwner: '', draftStorageKey: '', posting: false, composerError: '', stars: [1, 2, 3, 4, 5],
    replyTarget: null as CommentView | null, replies: [] as CommentView[], repliesTotal: 0, repliesOpen: false, repliesLoading: false, repliesError: '',
  },
  async onLoad(options: Record<string, string>) { this.setData({ workId: options.id || 'work_tide' }); await this.loadBook() },
  async loadBook() {
    const id = encodeURIComponent(this.data.workId); this.setData({ loading: true, error: '', shareReady: false }); setShareMenu(false)
    try {
      const [detail, assets] = await Promise.all([
        request<{ work: any }>(`/api/works/${id}`, { cacheTtl: 15000 }),
        request<{ items: Array<{ id: string; type: string; title: string; url: string; characterId: string | null }> }>(`/api/works/${id}/assets`, { cacheTtl: 15000 }).catch(() => ({ items: [] })),
      ])
      const portraits = new Map(assets.items.filter(item => item.type === 'character').map(item => [item.characterId, assetUrl(item.url)]))
      const characters = (detail.work.characters || []).map((item: any) => ({ ...item, image: portraits.get(item.id) || '' }))
      const shareReady = detail.work.status === 'published'
      this.setData({ book: { ...detail.work, ...displayBook(detail.work), characters, progress: 0 }, storyImages: assets.items.filter(item => item.type === 'scene').map(item => ({ ...item, url: assetUrl(item.url) })), loading: false, shareReady }); setShareMenu(shareReady); const commentsReady = this.loadComments()
      if (isTimelinePreview()) return
      try { await ensureSession(); const [shelf, progress] = await Promise.all([request<{ inShelf: boolean }>(`/api/works/${id}/shelf`), request<{ progress: { progress: number } }>(`/api/works/${id}/reading-progress`)]); this.setData({ inShelf: shelf.inShelf, book: { ...this.data.book, progress: progress.progress.progress || 0 } }); await commentsReady; await this.loadComments() } catch { /* Public reading does not depend on login. */ }
    } catch (error) { this.setData({ loading: false, error: (error as Error).message || '作品加载失败' }) }
  },
  onCoverError() { this.setData({ book: { ...this.data.book, coverImage: '' } }) },
  onPortraitError(e: WechatMiniprogram.TouchEvent) { const id = e.currentTarget.dataset.id; this.setData({ book: { ...this.data.book, characters: this.data.book.characters.map((item: any) => item.id === id ? { ...item, image: '' } : item) } }) },
  onSceneError(e: WechatMiniprogram.TouchEvent) { this.setData({ storyImages: this.data.storyImages.filter(item => item.id !== e.currentTarget.dataset.id) }) },
  previewCover() { if (this.data.book.coverImage && typeof wx.previewImage === 'function') wx.previewImage({ current: this.data.book.coverImage, urls: [this.data.book.coverImage] }) },
  back() { wx.navigateBack({ fail: () => wx.reLaunch({ url: '/pages/home/index' }) }) },
  navigate(url: string) { if (this.data.navigating) return; this.setData({ navigating: true }); wx.navigateTo({ url, complete: () => this.setData({ navigating: false }), fail: () => wx.showToast({ title: '页面暂时无法打开', icon: 'none' }) }) },
  read() { if (!this.data.loading && !this.data.error) this.navigate('/pages/reader/index?workId=' + encodeURIComponent(this.data.book.id)) },
  openCharacters() { this.navigate('/pages/characters/index?workId=' + encodeURIComponent(this.data.book.id)) },
  canParticipate() { if (!isTimelinePreview()) return true; wx.showToast({ title: '请打开完整小程序后参与', icon: 'none' }); return false },
  async toggleShelf() { if (this.data.shelfBusy || this.data.loading || this.data.error || !this.canParticipate()) return; this.setData({ shelfBusy: true }); const next = !this.data.inShelf; try { await ensureSession(); await request(`/api/works/${encodeURIComponent(this.data.book.id)}/shelf`, { method: next ? 'POST' : 'DELETE', data: {} }); this.setData({ inShelf: next }); wx.showToast({ title: next ? '已加入书架' : '已移出书架', icon: 'none' }) } catch (error) { wx.showToast({ title: (error as Error).message || '书架操作失败', icon: 'none' }) } finally { this.setData({ shelfBusy: false }) } },
  async loadComments(append = false) { if (this.data.commentsLoading) return; this.setData({ commentsLoading: true, commentsError: '' }); const offset = append ? this.data.comments.length : 0; try { const result = await request<any>(`/api/works/${encodeURIComponent(this.data.workId)}/comments?kind=${this.data.commentTab}&sort=${this.data.commentSort}&offset=${offset}`); this.setData({ comments: [...(append ? this.data.comments : []), ...result.items.map(viewComment)], commentsTotal: result.total, commentSummary: result.summary || this.data.commentSummary }) } catch (error) { this.setData({ commentsError: (error as Error).message || '讨论暂时无法加载' }) } finally { this.setData({ commentsLoading: false }) } },
  moreComments() { this.loadComments(true) },
  retryComments() { this.loadComments() },
  switchCommentTab(e: WechatMiniprogram.TouchEvent) { const tab = e.currentTarget.dataset.tab; if (!['review', 'discussion'].includes(tab) || tab === this.data.commentTab || this.data.commentsLoading) return; this.setData({ commentTab: tab, comments: [], commentsTotal: 0 }); this.loadComments() },
  switchSort(e: WechatMiniprogram.TouchEvent) { const sort = e.currentTarget.dataset.sort; if (!['latest', 'popular'].includes(sort) || sort === this.data.commentSort || this.data.commentsLoading) return; this.setData({ commentSort: sort, comments: [], commentsTotal: 0 }); this.loadComments() },
  revealSpoiler(e: WechatMiniprogram.TouchEvent) { const id = e.currentTarget.dataset.id; this.setData({ comments: this.data.comments.map(item => item.id === id ? { ...item, revealed: true } : item), replies: this.data.replies.map(item => item.id === id ? { ...item, revealed: true } : item) }) },
  draftKey() { return `mojing_comment_draft_${getEnvironment().apiBase}_${getSession().userId}_${this.data.workId}_${this.data.replyTarget?.id || this.data.commentTab}` },
  saveDraft() { if (this.data.composerOpen && this.data.draftStorageKey) { try { wx.setStorageSync(this.data.draftStorageKey, this.data.draft) } catch { /* The current draft remains in memory. */ } } },
  async openComposer() { if (!this.canParticipate() || this.data.composerOpen || this.data.commentBusy) return; this.setData({ commentBusy: 'compose' }); try { const session = await ensureSession(); const key = this.draftKey(); const saved = wx.getStorageSync(key) as Draft | undefined; this.setData({ composerOpen: true, composerError: '', draftOwner: session.userId, draftStorageKey: key, draft: saved?.clientId ? saved : emptyDraft(), composerTitle: this.data.replyTarget ? `回复 ${this.data.replyTarget.author}` : this.data.commentTab === 'review' ? '写书评' : '发起讨论' }) } catch (error) { wx.showToast({ title: (error as Error).message, icon: 'none' }) } finally { this.setData({ commentBusy: '' }) } },
  startComment() { this.setData({ replyTarget: null }); this.openComposer() }, closeComposer() { if (!this.data.posting) { this.saveDraft(); this.setData({ composerOpen: false }) } }, stopTap() {},
  onCommentInput(e: WechatMiniprogram.Input) { this.setData({ draft: { ...this.data.draft, content: e.detail.value } }); this.saveDraft() },
  setCommentRating(e: WechatMiniprogram.TouchEvent) { const rating = Number(e.currentTarget.dataset.rating); if (rating >= 1 && rating <= 5) { this.setData({ draft: { ...this.data.draft, rating } }); this.saveDraft() } },
  toggleSpoiler() { this.setData({ draft: { ...this.data.draft, spoiler: !this.data.draft.spoiler } }); this.saveDraft() },
  async submitComment() { if (this.data.posting) return; const draft = this.data.draft; if (!draft.content.trim()) { this.setData({ composerError: '请输入内容' }); return }; if (!this.data.replyTarget && this.data.commentTab === 'review' && !draft.rating) { this.setData({ composerError: '请先选择评分' }); return }; this.setData({ posting: true, composerError: '' }); try { const session = await ensureSession(); if (session.userId !== this.data.draftOwner) throw new Error('账号已变化，请关闭编辑后重新打开'); const key = this.data.draftStorageKey; const result = await request<{ status: string }>(`/api/works/${encodeURIComponent(this.data.workId)}/comments`, { method: 'POST', data: { ...draft, kind: this.data.commentTab, parentId: this.data.replyTarget?.id, rating: this.data.commentTab === 'review' ? draft.rating : undefined } }); wx.removeStorageSync(key); this.setData({ composerOpen: false, draft: emptyDraft() }); wx.showToast({ title: result.status === 'pending' ? '已提交，等待审核' : '发布成功', icon: 'none' }); await this.loadComments(); if (this.data.repliesOpen) await this.loadReplies() } catch (error) { this.setData({ composerError: (error as Error).message || '发布失败，草稿已保留' }) } finally { this.setData({ posting: false }) } },
  async toggleLike(e: WechatMiniprogram.TouchEvent) { const id = String(e.currentTarget.dataset.id || ''); const item = [...this.data.comments, ...this.data.replies].find(c => c.id === id); if (!item || this.data.commentBusy || !this.canParticipate()) return; this.setData({ commentBusy: id }); try { await ensureSession(); const result = await request<{ liked: boolean; likes: number }>(`/api/comments/${encodeURIComponent(id)}/like`, { method: item.liked ? 'DELETE' : 'POST', data: {} }); const update = (c: CommentView) => c.id === id ? { ...c, ...result } : c; this.setData({ comments: this.data.comments.map(update), replies: this.data.replies.map(update) }) } catch (error) { wx.showToast({ title: (error as Error).message, icon: 'none' }) } finally { this.setData({ commentBusy: '' }) } },
  openReplies(e: WechatMiniprogram.TouchEvent) { const item = this.data.comments.find(c => c.id === e.currentTarget.dataset.id); if (!item || item.status !== 'published' || (item.spoiler && !item.revealed)) return; replyRequest++; this.setData({ replyTarget: item, repliesOpen: true, replies: [], repliesTotal: 0, repliesLoading: false }); this.loadReplies() },
  closeReplies() { if (!this.data.composerOpen) { replyRequest++; this.setData({ repliesOpen: false, replyTarget: null, repliesLoading: false }) } },
  async loadReplies(append = false) { if (!this.data.replyTarget || this.data.repliesLoading) return; const version = ++replyRequest; this.setData({ repliesLoading: true, repliesError: '' }); try { const result = await request<any>(`/api/comments/${encodeURIComponent(this.data.replyTarget.id)}/replies?offset=${append ? this.data.replies.length : 0}`); if (version === replyRequest) this.setData({ replies: [...(append ? this.data.replies : []), ...result.items.map(viewComment)], repliesTotal: result.total }) } catch (error) { if (version === replyRequest) this.setData({ repliesError: (error as Error).message }) } finally { if (version === replyRequest) this.setData({ repliesLoading: false }) } },
  moreReplies() { this.loadReplies(true) },
  retryReplies() { this.loadReplies() },
  commentMenu(e: WechatMiniprogram.TouchEvent) { const item = [...this.data.comments, ...this.data.replies].find(c => c.id === e.currentTarget.dataset.id); if (!item || this.data.commentBusy || !this.canParticipate()) return; wx.showActionSheet({ itemList: item.mine ? ['删除这条内容'] : ['举报：广告或垃圾信息', '举报：辱骂或骚扰', '举报：未标记剧透', '举报：其他'], success: result => { if (item.mine) { wx.showModal({ title: '删除内容', content: '删除后不可恢复，主题下的回复也会移除。', success: answer => { if (answer.confirm) this.mutateComment(item.id, '', 'DELETE') } }) } else this.mutateComment(item.id, '/report', 'POST', { reason: ['spam', 'abuse', 'spoiler', 'other'][result.tapIndex] }) } }) },
  async mutateComment(id: string, action: string, method: 'POST' | 'DELETE', data = {}) { if (this.data.commentBusy) return; this.setData({ commentBusy: id }); try { await ensureSession(); await request(`/api/comments/${encodeURIComponent(id)}${action}`, { method, data }); wx.showToast({ title: action ? '举报已提交' : '已删除', icon: 'none' }); if (!action) { await this.loadComments(); if (this.data.replyTarget?.id === id) this.closeReplies(); else if (this.data.repliesOpen) await this.loadReplies() } } catch (error) { wx.showToast({ title: (error as Error).message || '操作失败', icon: 'none' }) } finally { this.setData({ commentBusy: '' }) } },
  onHide() { this.saveDraft() }, onUnload() { replyRequest++; this.saveDraft() },
  onShareAppMessage() { return this.data.shareReady ? shareContent(this.data.book, this.data.book.id) : defaultShare() }, onShareTimeline() { const { title, query, imageUrl } = this.data.shareReady ? shareContent(this.data.book, this.data.book.id) : defaultShare(); return { title, query, ...(imageUrl ? { imageUrl } : {}) } },
})
