---
title: "teat-progress · progressMatch"
---

> **版本核对：** 本地文件存在差异。本页行号对应已审阅的本地快照。 引用片段与远端一致：[固定提交源码](https://github.com/AiW520/mojing-fiction-platform/blob/ec4fa9c01417c37cfd8cad05de74707d70c92401/server/src/server.mjs#L970-L980)（远端行 970–980；私有仓库需要访问权限）。


## 结论

进度需有限数字、作品可见性、章节归属校验，范围裁剪后按用户/作品 upsert。

## 源码定位

- 项目：`teat1`
- 相对路径：`server/src/server.mjs`
- 符号：`progressMatch`
- 行号：1032–1042
- 文件 SHA-256：`5e5d14bfc20c7d168ea609362e17838d684e9486f6888978d7b48fe5bb901468`

工作区可能有未提交修改；以本页文件哈希为精确依据。提交版本和范围见[覆盖报告](../../coverage/)。

## 核对片段

以下是已审阅的必要片段，不包含完整文件。代码仅作为文本展示。起始行：1032。

````js
  const progressMatch = path.match(/^\/api\/works\/([^/]+)\/reading-progress$/)
  if (req.method === 'GET' && progressMatch) { const user = requireUser(req); const row = db.prepare('SELECT * FROM reading_progress WHERE user_id = ? AND work_id = ?').get(user.id, progressMatch[1]); return json(res, 200, { progress: row || { progress: 0, block_id: null, scroll_ratio: 0 } }) }
  if (req.method === 'POST' && progressMatch) {
    const user = requireUser(req); const input = await body(req)
    const work = db.prepare('SELECT * FROM works WHERE id = ?').get(progressMatch[1])
    if (!work || (work.status !== 'published' && !isOwner(user, work.id))) throw new HttpError(404, 'WORK_NOT_FOUND', '作品不存在')
    if (![Number(input.progress || 0), Number(input.scrollRatio || 0)].every(Number.isFinite)) throw new HttpError(400, 'PROGRESS_INVALID', '阅读进度必须是有效数字')
    if (input.blockId && !db.prepare('SELECT id FROM story_chapters WHERE id = ? AND work_id = ? UNION ALL SELECT id FROM content_blocks WHERE id = ? AND work_id = ?').get(input.blockId, work.id, input.blockId, work.id)) throw new HttpError(400, 'PROGRESS_CHAPTER_INVALID', '阅读章节不属于此作品')
    const ratio = Math.max(0, Math.min(1, Number(input.scrollRatio || 0)))
    db.prepare('INSERT INTO reading_progress(user_id, work_id, block_id, progress, scroll_ratio, updated_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(user_id, work_id) DO UPDATE SET block_id = excluded.block_id, progress = excluded.progress, scroll_ratio = excluded.scroll_ratio, updated_at = CURRENT_TIMESTAMP').run(user.id, work.id, input.blockId || null, Math.max(0, Math.min(100, Number(input.progress || 0))), ratio)
    return json(res, 200, { ok: true })
````
