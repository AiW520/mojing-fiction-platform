import { createHash } from 'node:crypto'

export function createIdempotency(db, HttpError) {
  db.exec(`CREATE TABLE IF NOT EXISTS client_operations (
    user_id TEXT NOT NULL REFERENCES users(id), operation_key TEXT NOT NULL,
    path TEXT NOT NULL, request_hash TEXT NOT NULL, response_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(user_id, operation_key)
  )`)
  return (req, userId, path, input, operation) => {
    const key = req.headers['idempotency-key']
    if (!key) return operation()
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
}
