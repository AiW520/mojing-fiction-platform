---
title: "teat-front-shelf · shelf · load"
---

> **版本核对：** 本地文件存在差异。本页行号对应已审阅的本地快照。 引用片段未在远端唯一匹配，不能把本页实现当作远端版本；以本地快照哈希和课程片段为准。


## 结论

书架并行获取小说与漫画，noCache 请求重新读取。

## 源码定位

- 项目：`teat1`
- 相对路径：`miniprogram/pages/shelf/index.ts`
- 符号：`shelf · load`
- 行号：21–43
- 文件 SHA-256：`d92cbe40be89bb201abcf797e4e05196861d3c6199a5dc140a25ea71005ad1db`

工作区可能有未提交修改；以本页文件哈希为精确依据。提交版本和范围见[覆盖报告](../../coverage/)。

## 核对片段

以下是已审阅的必要片段，不包含完整文件。代码仅作为文本展示。起始行：21。

````ts
    }
    try {
      const current = getSession().userId || ''
      if (current !== this.accountId) { this.accountId = current; this.setData({ allBooks: [], books: [], loading: true }) }
      if (current) { const cached = readReaderCache<any[]>(`shelf_${current}`); if (cached) display(cached) }
      await ensureDevSession()
      if (!this.alive) return
      const userId = getSession().userId
      if (userId !== this.accountId) { this.accountId = userId; this.setData({ allBooks: [], books: [], loading: true }) }
      const [novels, comics] = await Promise.all([request<{ items: any[] }>('/api/me/shelf', { noCache: true }), request<{ items: any[]; partial?: boolean }>('/api/me/comic-shelf', { noCache: true })])
      const result = { items: [...comics.items, ...novels.items] }
      if (comics.partial) throw new Error('部分漫画暂时无法连接，请稍后重试')
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
````
