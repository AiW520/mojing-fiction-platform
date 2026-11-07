---
title: "teat-detail · load · detail / participation"
---

> **版本核对：** 本地文件存在差异。本页行号对应已审阅的本地快照。 引用片段未在远端唯一匹配，不能把本页实现当作远端版本；以本地快照哈希和课程片段为准。


## 结论

公开作品详情与素材并发加载，登录相关书架/进度失败不阻止公开阅读。

## 源码定位

- 项目：`teat1`
- 相对路径：`miniprogram/pages/book/detail.ts`
- 符号：`load · detail / participation`
- 行号：30–47
- 文件 SHA-256：`1c151c8a3016b88b82c13660a42adb8a32841789a9f649b49bd27ebee9601a58`

工作区可能有未提交修改；以本页文件哈希为精确依据。提交版本和范围见[覆盖报告](../../coverage/)。

## 核对片段

以下是已审阅的必要片段，不包含完整文件。代码仅作为文本展示。起始行：30。

````ts
  async onLoad(options: Record<string, string>) { this.setData({ workId: options.id || 'work_tide' }); await this.loadBook() },
  async loadBook() {
    this.stopMedia?.()
    const id = encodeURIComponent(this.data.workId); this.setData({ loading: true, error: '', shareReady: false }); setShareMenu(false)
    try {
      const [detail, assets] = await Promise.all([
        request<{ work: any }>(`/api/works/${id}`, { cacheTtl: 15000 }),
        request<{ items: Array<{ id: string; type: string; title: string; url: string; characterId: string | null }> }>(`/api/works/${id}/assets?view=reader`, { cacheTtl: 15000 }).catch(() => ({ items: [] })),
      ])
      const portraits = new Map(assets.items.filter(item => item.type === 'character').map(item => [item.characterId, assetUrl(item.url)]))
      const characters = (detail.work.characters || []).map((item: any) => ({ ...item, image: portraits.get(item.id) || '' }))
      const shareReady = detail.work.status === 'published'
      this.setData({ book: { ...detail.work, ...displayBook(detail.work), characters, progress: 0 }, storyImages: assets.items.filter(item => item.type === 'scene').map(item => ({ ...item, url: assetUrl(item.url) })), loading: false, shareReady }); setShareMenu(shareReady); const commentsReady = this.loadComments()
      this.cacheGalleryImages()
      if (isTimelinePreview()) return
      try { await ensureSession(); const [shelf, progress] = await Promise.all([request<{ inShelf: boolean }>(`/api/works/${id}/shelf`), request<{ progress: { progress: number } }>(`/api/works/${id}/reading-progress`)]); this.setData({ inShelf: shelf.inShelf, book: { ...this.data.book, progress: progress.progress.progress || 0 } }); await commentsReady; await this.loadComments() } catch { /* Public reading does not depend on login. */ }
    } catch (error) { this.setData({ loading: false, error: (error as Error).message || '作品加载失败' }) }
  },
````
