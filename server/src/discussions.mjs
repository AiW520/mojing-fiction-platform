import { randomUUID } from 'node:crypto'

export function createDiscussions({ db, body, json, userFromRequest, requireUser, requirePermission, can, HttpError, production, audit }) {
  const pageNumber = (value, fallback, min, max) => Number.isFinite(Number(value)) && value !== null ? Math.max(min, Math.min(max, Math.trunc(Number(value)))) : fallback
  db.exec(`
    CREATE TABLE IF NOT EXISTS book_comments (
      id TEXT PRIMARY KEY, work_id TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id), parent_id TEXT REFERENCES book_comments(id),
      kind TEXT NOT NULL CHECK(kind IN ('review','discussion')), content TEXT NOT NULL,
      rating INTEGER CHECK(rating BETWEEN 1 AND 5), spoiler INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending', client_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id,client_id)
    );
    CREATE INDEX IF NOT EXISTS idx_comments_work ON book_comments(work_id,kind,status,parent_id,created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_comments_user ON book_comments(user_id,created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_comments_parent ON book_comments(parent_id,status,created_at);
    CREATE INDEX IF NOT EXISTS idx_comments_moderation ON book_comments(status,created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_one_book_rating ON book_comments(work_id,user_id)
      WHERE parent_id IS NULL AND kind='review' AND status IN ('pending','published');
    CREATE TABLE IF NOT EXISTS book_comment_likes (
      comment_id TEXT NOT NULL REFERENCES book_comments(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id), PRIMARY KEY(comment_id,user_id)
    );
    CREATE TABLE IF NOT EXISTS book_comment_reports (
      comment_id TEXT NOT NULL REFERENCES book_comments(id), user_id TEXT NOT NULL REFERENCES users(id),
      reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(comment_id,user_id)
    );
  `)
  function publishedWork(id) {
    if (!db.prepare("SELECT id FROM works WHERE id=? AND status='published'").get(id)) throw new HttpError(404, 'WORK_NOT_FOUND', '作品不存在')
  }
  function visibleComment(id, user) {
    const row = db.prepare('SELECT * FROM book_comments WHERE id=?').get(id)
    if (!row || (row.status !== 'published' && !(row.status === 'pending' && row.user_id === user?.id))) throw new HttpError(404, 'COMMENT_NOT_FOUND', '内容不存在或已移除')
    publishedWork(row.work_id)
    if (row.parent_id && !db.prepare("SELECT id FROM book_comments WHERE id=? AND status='published'").get(row.parent_id)) throw new HttpError(404, 'COMMENT_NOT_FOUND', '主题已移除')
    return row
  }
  function summary(workId) {
    const score = db.prepare("SELECT COUNT(*) AS ratings, ROUND(AVG(rating),1) AS rating FROM book_comments WHERE work_id=? AND kind='review' AND parent_id IS NULL AND status='published'").get(workId)
    const counts = db.prepare("SELECT kind,COUNT(*) AS total FROM book_comments WHERE work_id=? AND parent_id IS NULL AND status='published' GROUP BY kind").all(workId)
    return { ...score, reviews: counts.find(c => c.kind === 'review')?.total || 0, discussions: counts.find(c => c.kind === 'discussion')?.total || 0 }
  }
  function items(where, params, user, order, limit, offset) {
    return db.prepare(`SELECT c.id,c.work_id AS workId,c.parent_id AS parentId,c.kind,c.content,c.rating,c.spoiler,c.status,c.created_at AS createdAt,
      u.display_name AS author, c.user_id AS authorId,
      (SELECT COUNT(*) FROM book_comment_likes l WHERE l.comment_id=c.id) AS likes,
      EXISTS(SELECT 1 FROM book_comment_likes l WHERE l.comment_id=c.id AND l.user_id=?) AS liked,
      (SELECT COUNT(*) FROM book_comments r WHERE r.parent_id=c.id AND (r.status='published' OR (r.status='pending' AND r.user_id=?))) AS replies
      FROM book_comments c JOIN users u ON u.id=c.user_id WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`)
      .all(user?.id || '', user?.id || '', ...params, limit, offset)
      .map(({ authorId, ...row }) => ({ ...row, mine: authorId === user?.id, liked: Boolean(row.liked), spoiler: Boolean(row.spoiler) }))
  }
  return async function handleDiscussions(req, res, path, url) {
    const list = path.match(/^\/api\/works\/([^/]+)\/comments$/)
    if (list) {
      const workId = list[1]; publishedWork(workId)
      const user = userFromRequest(req)
      if (req.method === 'GET') {
        const kind = url.searchParams.get('kind') || 'review'
        if (!['review','discussion'].includes(kind)) throw new HttpError(400, 'COMMENT_KIND_INVALID', '请选择书评或讨论')
        const limit = pageNumber(url.searchParams.get('limit'),10,1,20)
        const offset = pageNumber(url.searchParams.get('offset'),0,0,100000)
        const where = "c.work_id=? AND c.kind=? AND c.parent_id IS NULL AND (c.status='published' OR (c.status='pending' AND c.user_id=?))"
        const params = [workId, kind, user?.id || '']
        const total = db.prepare(`SELECT COUNT(*) AS total FROM book_comments c WHERE ${where}`).get(...params).total
        return json(res, 200, { items: items(where, params, user, url.searchParams.get('sort') === 'popular' ? 'likes DESC,c.created_at DESC,c.id DESC' : 'c.created_at DESC,c.id DESC', limit, offset), total, summary: summary(workId) })
      }
      if (req.method === 'POST') {
        const actor = requireUser(req); const input = await body(req, 16384)
        const content = typeof input.content === 'string' ? input.content.trim() : ''
        if (!content || [...content].length > 1000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(content)) throw new HttpError(400, 'COMMENT_INVALID', '请输入1至1000字的内容')
        if (!['review','discussion'].includes(input.kind)) throw new HttpError(400, 'COMMENT_KIND_INVALID', '请选择书评或讨论')
        if (typeof input.clientId !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(input.clientId)) throw new HttpError(400, 'CLIENT_ID_REQUIRED', '发布凭据无效')
        const previous = db.prepare('SELECT id,work_id,status FROM book_comments WHERE user_id=? AND client_id=?').get(actor.id,input.clientId)
        if (previous) {
          if (previous.work_id !== workId) throw new HttpError(409, 'CLIENT_ID_USED', '发布凭据已使用')
          return json(res, 200, { id: previous.id, status: previous.status })
        }
        let parent = null
        if (input.parentId != null && (typeof input.parentId !== 'string' || input.parentId.length > 80)) throw new HttpError(400,'REPLY_INVALID','回复主题无效')
        if (input.parentId) {
          parent = visibleComment(input.parentId, actor)
          if (parent.work_id !== workId || parent.parent_id || parent.status !== 'published' || parent.kind !== input.kind) throw new HttpError(400, 'REPLY_INVALID', '只能回复当前作品的已发布主题')
        }
        const rating = !parent && input.kind === 'review' ? input.rating : null
        if (!parent && input.kind === 'review' && (!Number.isInteger(rating) || rating < 1 || rating > 5)) throw new HttpError(400, 'RATING_INVALID', '请选择1至5星评分')
        if (!parent && input.kind === 'review' && db.prepare("SELECT id FROM book_comments WHERE work_id=? AND user_id=? AND parent_id IS NULL AND kind='review' AND status IN ('pending','published')").get(workId,actor.id)) throw new HttpError(409, 'REVIEW_EXISTS', '你已发表书评，可删除原书评后重新发布')
        if (db.prepare("SELECT COUNT(*) AS n FROM book_comments WHERE user_id=? AND created_at>=datetime('now','-1 minute')").get(actor.id).n >= 5) throw new HttpError(429, 'COMMENT_RATE_LIMIT', '发布过于频繁，请稍后再试')
        const id = randomUUID(); const status = production ? 'pending' : 'published'
        db.prepare('INSERT INTO book_comments(id,work_id,user_id,parent_id,kind,content,rating,spoiler,status,client_id) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id,workId,actor.id,parent?.id || null,input.kind,content,rating,input.spoiler === true || parent?.spoiler ? 1 : 0,status,input.clientId)
        audit(actor.id,'发布读者评论','book_comment',id,null,{ workId,kind:input.kind,status })
        return json(res, 201, { id, status })
      }
    }
    const comment = path.match(/^\/api\/comments\/([^/]+)(?:\/(replies|like|report))?$/)
    if (comment) {
      const user = userFromRequest(req)
      const row = visibleComment(comment[1],user); const action = comment[2]
      if (req.method === 'GET' && action === 'replies') {
        if (row.parent_id) throw new HttpError(400,'REPLY_INVALID','回复不可继续嵌套')
        const offset = pageNumber(url.searchParams.get('offset'),0,0,100000)
        const where = "c.parent_id=? AND (c.status='published' OR (c.status='pending' AND c.user_id=?))"
        const params = [row.id,user?.id || '']
        return json(res,200,{ items:items(where,params,user,'c.created_at ASC,c.id ASC',10,offset),total:db.prepare(`SELECT COUNT(*) AS total FROM book_comments c WHERE ${where}`).get(...params).total })
      }
      const actor = requireUser(req)
      if (action === 'like' && ['POST','DELETE'].includes(req.method)) {
        if (row.status !== 'published') throw new HttpError(400,'COMMENT_PENDING','待审核内容不可点赞')
        if (req.method === 'POST') db.prepare('INSERT OR IGNORE INTO book_comment_likes(comment_id,user_id) VALUES (?,?)').run(row.id,actor.id)
        else db.prepare('DELETE FROM book_comment_likes WHERE comment_id=? AND user_id=?').run(row.id,actor.id)
        return json(res,200,{ liked:req.method === 'POST',likes:db.prepare('SELECT COUNT(*) AS n FROM book_comment_likes WHERE comment_id=?').get(row.id).n })
      }
      if (action === 'report' && req.method === 'POST') {
        const input = await body(req,4096)
        if (!['spam','abuse','spoiler','other'].includes(input.reason)) throw new HttpError(400,'REPORT_INVALID','请选择举报原因')
        db.prepare('INSERT OR IGNORE INTO book_comment_reports(comment_id,user_id,reason) VALUES (?,?,?)').run(row.id,actor.id,input.reason)
        return json(res,201,{ reported:true })
      }
      if (!action && req.method === 'DELETE') {
        if (row.user_id !== actor.id && !can(actor,'content.review')) throw new HttpError(403,'FORBIDDEN','只能删除自己的内容')
        db.prepare("UPDATE book_comments SET status='deleted' WHERE id=? OR parent_id=?").run(row.id,row.id)
        audit(actor.id,'移除读者评论','book_comment',row.id,{status:row.status},{status:'deleted'})
        return json(res,200,{ deleted:true })
      }
    }
    if (path === '/admin-api/comments' && req.method === 'GET') {
      requirePermission(req,'content.review')
      const offset = pageNumber(url.searchParams.get('offset'),0,0,100000)
      const rows = db.prepare(`SELECT c.id,c.kind,c.content,c.status,c.rating,c.created_at AS createdAt,u.display_name AS author,w.title AS workTitle,
        (SELECT COUNT(*) FROM book_comment_reports r WHERE r.comment_id=c.id AND r.status='pending') AS reports
        FROM book_comments c JOIN users u ON u.id=c.user_id JOIN works w ON w.id=c.work_id
        WHERE c.status='pending' OR (c.status='published' AND EXISTS(SELECT 1 FROM book_comment_reports r WHERE r.comment_id=c.id AND r.status='pending'))
        ORDER BY c.created_at ASC,c.id ASC LIMIT 30 OFFSET ?`).all(offset)
      return json(res,200,{ items:rows })
    }
    const moderation = path.match(/^\/admin-api\/comments\/([^/]+)\/(approve|reject)$/)
    if (moderation && req.method === 'POST') {
      const actor = requirePermission(req,'content.review')
      const row = db.prepare("SELECT * FROM book_comments WHERE id=? AND status IN ('pending','published')").get(moderation[1])
      if (!row) throw new HttpError(404,'COMMENT_NOT_FOUND','内容已移除')
      if (row.parent_id && !db.prepare("SELECT id FROM book_comments WHERE id=? AND status='published'").get(row.parent_id)) throw new HttpError(409,'REPLY_INVALID','请先审核主题')
      const status = moderation[2] === 'approve' ? 'published' : 'rejected'
      db.prepare('UPDATE book_comments SET status=? WHERE id=?').run(status,row.id)
      if (status === 'rejected') db.prepare("UPDATE book_comments SET status='rejected' WHERE parent_id=?").run(row.id)
      db.prepare("UPDATE book_comment_reports SET status='resolved' WHERE comment_id=?").run(row.id)
      if (status === 'rejected') db.prepare("UPDATE book_comment_reports SET status='resolved' WHERE comment_id IN (SELECT id FROM book_comments WHERE parent_id=?)").run(row.id)
      audit(actor.id,'审核读者评论','book_comment',row.id,{status:row.status},{status})
      return json(res,200,{ status })
    }
    return false
  }
}
