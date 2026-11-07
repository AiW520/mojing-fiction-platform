---
title: "teat-shelf · shelfMatch / me shelf"
---

> **版本核对：** 本地文件存在差异。本页行号对应已审阅的本地快照。 引用片段与远端一致：[固定提交源码](https://github.com/AiW520/mojing-fiction-platform/blob/ec4fa9c01417c37cfd8cad05de74707d70c92401/server/src/server.mjs#L982-L986)（远端行 982–986；私有仓库需要访问权限）。


## 结论

书架需要用户身份，插入忽略重复，删除按用户和作品，列表合并个人阅读进度。

## 源码定位

- 项目：`teat1`
- 相对路径：`server/src/server.mjs`
- 符号：`shelfMatch / me shelf`
- 行号：1044–1048
- 文件 SHA-256：`5e5d14bfc20c7d168ea609362e17838d684e9486f6888978d7b48fe5bb901468`

工作区可能有未提交修改；以本页文件哈希为精确依据。提交版本和范围见[覆盖报告](../../coverage/)。

## 核对片段

以下是已审阅的必要片段，不包含完整文件。代码仅作为文本展示。起始行：1044。

````js
  const shelfMatch = path.match(/^\/api\/works\/([^/]+)\/shelf$/)
  if (req.method === 'GET' && shelfMatch) { const user = requireUser(req); const item = db.prepare('SELECT 1 FROM bookshelves WHERE user_id = ? AND work_id = ?').get(user.id, shelfMatch[1]); return json(res, 200, { inShelf: Boolean(item) }) }
  if (req.method === 'POST' && shelfMatch) { const user = requireUser(req); db.prepare('INSERT OR IGNORE INTO bookshelves(user_id, work_id) VALUES (?, ?)').run(user.id, shelfMatch[1]); return json(res, 201, { inShelf: true }) }
  if (req.method === 'DELETE' && shelfMatch) { const user = requireUser(req); db.prepare('DELETE FROM bookshelves WHERE user_id = ? AND work_id = ?').run(user.id, shelfMatch[1]); return json(res, 200, { inShelf: false }) }
  if (req.method === 'GET' && path === '/api/me/shelf') { const user = requireUser(req); const rows = db.prepare('SELECT w.*, COALESCE(rp.progress, 0) AS reader_progress FROM bookshelves b JOIN works w ON w.id = b.work_id LEFT JOIN reading_progress rp ON rp.work_id = w.id AND rp.user_id = b.user_id WHERE b.user_id = ? ORDER BY b.created_at DESC').all(user.id); return json(res, 200, { items: rows.map(row => publicWork({ ...row, progress: row.reader_progress })) }) }
````
