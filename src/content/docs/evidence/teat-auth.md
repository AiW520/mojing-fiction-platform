---
title: "teat-auth · userFromRequest / requireUser / requireWorkOwner"
---

> **版本核对：** 本地文件存在差异。本页行号对应已审阅的本地快照。 引用片段与远端一致：[固定提交源码](https://github.com/AiW520/mojing-fiction-platform/blob/ec4fa9c01417c37cfd8cad05de74707d70c92401/server/src/server.mjs#L295-L311)（远端行 295–311；私有仓库需要访问权限）。


## 结论

服务端从 Bearer 会话找用户，再验证角色或作品归属。

## 源码定位

- 项目：`teat1`
- 相对路径：`server/src/server.mjs`
- 符号：`userFromRequest / requireUser / requireWorkOwner`
- 行号：311–327
- 文件 SHA-256：`5e5d14bfc20c7d168ea609362e17838d684e9486f6888978d7b48fe5bb901468`

工作区可能有未提交修改；以本页文件哈希为精确依据。提交版本和范围见[覆盖报告](../../coverage/)。

## 核对片段

以下是已审阅的必要片段，不包含完整文件。代码仅作为文本展示。起始行：311。

````js
function userFromRequest(req) {
  const auth = req.headers.authorization || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!token) return null
  const row = db.prepare("SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND julianday(s.expires_at) > julianday('now') AND u.status = 'active'").get(createHash('sha256').update(token).digest('hex'))
  if (!row) return null
  return { ...row, roles: roleCodes(row.id) }
}
function hasRole(user, role) { return Boolean(user?.roles?.includes(role)) }
function can(user, permission) {
  if (!user) return false
  return Boolean(db.prepare('SELECT 1 FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id JOIN user_roles ur ON ur.role_id = rp.role_id WHERE ur.user_id = ? AND p.code = ?').get(user.id, permission))
}
function isOwner(user, workId) { return Boolean(user && db.prepare('SELECT 1 FROM works WHERE id = ? AND owner_id = ?').get(workId, user.id)) }
function requireUser(req) { const user = userFromRequest(req); if (!user) throw new HttpError(401, 'UNAUTHENTICATED', '请先登录'); return user }
function requirePermission(req, permission) { const user = requireUser(req); if (!can(user, permission)) throw new HttpError(403, 'FORBIDDEN', '当前角色没有此权限'); return user }
function requireWorkOwner(req, workId) { const user = requireUser(req); if (!isOwner(user, workId)) throw new HttpError(403, 'WORK_ACCESS_DENIED', '只能操作自己的作品'); return user }
````
