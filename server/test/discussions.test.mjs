import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { createDiscussions } from '../src/discussions.mjs'

function fixture(production = false) {
  const db = new DatabaseSync(':memory:')
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE users(id TEXT PRIMARY KEY,display_name TEXT);
    CREATE TABLE works(id TEXT PRIMARY KEY,status TEXT,title TEXT DEFAULT '测试小说');
    INSERT INTO users VALUES ('a','甲'),('b','乙'),('admin','审核员');
    INSERT INTO works(id,status) VALUES ('book','published'),('other','published'),('draft','draft');`)
  class HttpError extends Error { constructor(status,code,message) { super(message); this.status=status; this.code=code } }
  const requireUser = req => { if (!req.user) throw new HttpError(401,'LOGIN','请登录'); return req.user }
  const requirePermission = req => { const actor=requireUser(req); if (actor.id !== 'admin') throw new HttpError(403,'FORBIDDEN','禁止'); return actor }
  const handler = createDiscussions({ db, production, HttpError, body: async req => req.input || {}, userFromRequest: req => req.user, requireUser, requirePermission, can: actor => actor?.id === 'admin', audit() {}, json: (res,status,payload) => { res.status=status; res.body=payload } })
  const call = async (path,method='GET',input,userId) => {
    const url = new URL(path,'http://test'); const res={}
    try { await handler({ method,input,user:userId ? { id:userId } : null },res,url.pathname,url); return res }
    catch (e) { if (!e.status) throw e; return { status:e.status,body:{ error:{ code:e.code,message:e.message } } } }
  }
  const post = (input,userId='a',work='book') => call(`/api/works/${work}/comments`,'POST',{ kind:'discussion',content:'讨论正文',clientId:`test_${Math.random().toString(36).slice(2,12)}`, ...input },userId)
  return { db,call,post }
}

test('discussion authorization, payload validation, hidden works and idempotent publication', async () => {
  const f=fixture()
  try {
    assert.equal((await f.post({},undefined)).status,201)
    assert.equal((await f.call('/api/works/book/comments','POST',{})).status,401)
    assert.equal((await f.post({},'a','draft')).status,404)
    assert.equal((await f.post({content:' '})).status,400)
    assert.equal((await f.post({content:'字'.repeat(1001)})).status,400)
    assert.equal((await f.post({kind:'invalid'})).status,400)
    assert.equal((await f.post({kind:'review',rating:0})).status,400)
    const input={ content:'持久化内容',clientId:'stable_id_123' }
    const first=await f.post(input)
    const duplicate=await f.post(input)
    assert.equal(first.status,201); assert.equal(duplicate.status,200); assert.equal(first.body.id,duplicate.body.id)
    assert.equal((await f.post(input,'a','other')).status,409)
    const list=await f.call('/api/works/book/comments?kind=discussion')
    assert.equal(list.body.total,2); assert.equal(list.body.items[0].mine,false)
    assert.ok(list.body.items.some(item => item.content === input.content))
  } finally { f.db.close() }
})

test('real ratings count one review per account and exclude pending, rejected or deleted content', async () => {
  const f=fixture()
  try {
    const a=await f.post({kind:'review',rating:5},'a')
    assert.equal((await f.post({kind:'review',rating:1},'a')).status,409)
    await f.post({kind:'review',rating:3},'b')
    let summary=(await f.call('/api/works/book/comments')).body.summary
    assert.equal(summary.rating,4); assert.equal(summary.ratings,2)
    assert.equal((await f.call(`/api/comments/${a.body.id}`,'DELETE',{},'b')).status,403)
    await f.call(`/api/comments/${a.body.id}`,'DELETE',{},'a')
    summary=(await f.call('/api/works/book/comments')).body.summary
    assert.equal(summary.rating,3); assert.equal(summary.ratings,1)
    assert.equal((await f.post({kind:'review',rating:4},'a')).status,201)
  } finally { f.db.close() }
})

test('likes are idempotent, removable, authenticated and survive comment list reload', async () => {
  const f=fixture()
  try {
    const item=await f.post({})
    const path=`/api/comments/${item.body.id}/like`
    assert.equal((await f.call(path,'POST')).status,401)
    await f.call(path,'POST',{},'b'); await f.call(path,'POST',{},'b')
    const list=(await f.call('/api/works/book/comments?kind=discussion','GET',undefined,'b')).body
    assert.equal(list.items[0].likes,1); assert.equal(list.items[0].liked,true)
    await f.call(path,'DELETE',{},'b')
    assert.equal((await f.call(path,'DELETE',{},'b')).body.likes,0)
  } finally { f.db.close() }
})

test('replies are one level, inherit spoilers, validate book and disappear with parent', async () => {
  const f=fixture()
  try {
    const parent=await f.post({spoiler:true})
    const reply=await f.post({parentId:parent.body.id},'b')
    assert.equal(reply.status,201)
    const list=(await f.call(`/api/comments/${parent.body.id}/replies`)).body
    assert.equal(list.items[0].spoiler,true); assert.equal(list.total,1)
    assert.equal((await f.post({parentId:reply.body.id},'b')).status,400)
    assert.equal((await f.post({parentId:parent.body.id},'b','other')).status,400)
    assert.equal((await f.post({parentId:parent.body.id,kind:'review',rating:4},'b')).status,400)
    await f.call(`/api/comments/${parent.body.id}`,'DELETE',{},'a')
    assert.equal((await f.call(`/api/comments/${reply.body.id}/like`,'POST',{},'b')).status,404)
  } finally { f.db.close() }
})

test('production moderation hides pending posts, handles reports and rejects with replies', async () => {
  const f=fixture(true)
  try {
    const item=await f.post({kind:'review',rating:5})
    assert.equal(item.body.status,'pending')
    assert.equal((await f.call('/api/works/book/comments')).body.total,0)
    const own=(await f.call('/api/works/book/comments','GET',undefined,'a')).body
    assert.equal(own.total,1); assert.equal(own.summary.ratings,0)
    assert.equal((await f.call(`/api/comments/${item.body.id}/like`,'POST',{},'a')).status,400)
    assert.equal((await f.call('/admin-api/comments','GET',undefined,'b')).status,403)
    assert.equal((await f.call('/admin-api/comments','GET',undefined,'admin')).body.items.length,1)
    await f.call(`/admin-api/comments/${item.body.id}/approve`,'POST',{},'admin')
    assert.equal((await f.call('/api/works/book/comments')).body.summary.rating,5)
    const reply=await f.post({parentId:item.body.id,kind:'review'},'b')
    assert.equal(reply.status,201)
    await f.call(`/admin-api/comments/${reply.body.id}/approve`,'POST',{},'admin')
    const report=`/api/comments/${item.body.id}/report`
    assert.equal((await f.call(report,'POST',{reason:'invalid'},'b')).status,400)
    await f.call(report,'POST',{reason:'abuse'},'b'); await f.call(report,'POST',{reason:'spam'},'b')
    assert.equal((await f.call('/admin-api/comments','GET',undefined,'admin')).body.items[0].reports,1)
    await f.call(`/admin-api/comments/${item.body.id}/reject`,'POST',{},'admin')
    assert.equal((await f.call('/api/works/book/comments')).body.summary.ratings,0)
    assert.equal((await f.call(`/api/comments/${reply.body.id}/like`,'POST',{},'b')).status,404)
  } finally { f.db.close() }
})

test('bounded pages, hot ordering and posting rate limit', async () => {
  const f=fixture()
  try {
    for (let i=0;i<5;i++) assert.equal((await f.post({content:`帖子${i}`})).status,201)
    assert.equal((await f.post({})).status,429)
    const page=(await f.call('/api/works/book/comments?kind=discussion&limit=2&offset=1')).body
    assert.equal(page.items.length,2); assert.equal(page.total,5)
    const likeId=page.items[1].id
    await f.call(`/api/comments/${likeId}/like`,'POST',{},'b')
    assert.equal((await f.call('/api/works/book/comments?kind=discussion&sort=popular')).body.items[0].id,likeId)
  } finally { f.db.close() }
})
