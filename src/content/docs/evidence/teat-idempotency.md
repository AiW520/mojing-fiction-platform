---
title: "teat-idempotency · createIdempotency"
---

> **版本核对：** 本地文件存在差异。本页行号对应已审阅的本地快照。 引用片段未在远端唯一匹配，不能把本页实现当作远端版本；以本地快照哈希和课程片段为准。


## 结论

业务变化与重放回执同事务保存；同键不同路径/输入返回 409。

## 源码定位

- 项目：`teat1`
- 相对路径：`server/src/idempotency.mjs`
- 符号：`createIdempotency`
- 行号：3–38
- 文件 SHA-256：`75e96a957cc6d2b561d68c5e218d36638b25f5fd2aa4bb39c06259e799d91aac`

工作区可能有未提交修改；以本页文件哈希为精确依据。提交版本和范围见[覆盖报告](../../coverage/)。

## 核对片段

以下是已审阅的必要片段，不包含完整文件。代码仅作为文本展示。起始行：3。

````js
export function createIdempotency(db, HttpError) {
  db.exec(`CREATE TABLE IF NOT EXISTS client_operations (
    user_id TEXT NOT NULL REFERENCES users(id), operation_key TEXT NOT NULL,
    path TEXT NOT NULL, request_hash TEXT NOT NULL, response_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(user_id, operation_key)
  )`)
  return (req, userId, path, input, operation) => {
    const key = req.headers['idempotency-key']
    if (!key) {
      // Mutations can read before writing (including nested savepoints). Reserve
      // the WAL writer first, otherwise a worker heartbeat can commit between
      // those reads and writes and SQLite rejects the snapshot upgrade.
      db.exec('BEGIN IMMEDIATE')
      try {
        const result = operation()
        db.exec('COMMIT')
        return result
      } catch (error) { db.exec('ROLLBACK'); throw error }
    }
    if (typeof key !== 'string' || !/^[a-zA-Z0-9_-]{12,100}$/.test(key)) throw new HttpError(400, 'IDEMPOTENCY_KEY_INVALID', '提交凭据无效')
    const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex')
    const previous = db.prepare('SELECT * FROM client_operations WHERE user_id = ? AND operation_key = ?').get(userId, key)
    if (previous) {
      if (previous.path !== path || previous.request_hash !== hash) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', '提交内容已变化，请重新确认')
      return JSON.parse(previous.response_json)
    }
    // The write and replay receipt must commit together, including after a process restart.
    db.exec('BEGIN IMMEDIATE')
    try {
      const result = operation()
      db.prepare('INSERT INTO client_operations(user_id, operation_key, path, request_hash, response_json) VALUES (?, ?, ?, ?, ?)').run(userId, key, path, hash, JSON.stringify(result))
      db.exec('COMMIT')
      return result
    } catch (error) { db.exec('ROLLBACK'); throw error }
  }
````
