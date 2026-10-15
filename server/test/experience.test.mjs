import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { DatabaseSync } from 'node:sqlite'
import { createIdempotency } from '../src/idempotency.mjs'

const root = resolve(import.meta.dirname, '../..')
const require = createRequire(resolve(root, 'admin-web/package.json'))
const ts = require('typescript')
function load(path, dependencies, globals = {}) {
  const source = ts.transpileModule(readFileSync(resolve(root, path), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  const exports = {}
  runInNewContext(source, { exports, require: id => { assert.ok(id in dependencies, id); return dependencies[id] }, setTimeout, clearTimeout, ...globals })
  return exports
}
function transport() {
  const storage = new Map(), calls = []
  const config = { apiBase: 'https://test.mojing.local', auth: 'development' }
  const wx = { getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value), removeStorageSync: key => storage.delete(key), request: options => calls.push(options) }
  const api = load('miniprogram/utils/api.ts', { '../config': { getEnvironment: () => config } }, { wx })
  return { api, storage, calls, wx, session(userId) { storage.set('mojing_session', { userId, token: userId, environment: `${config.apiBase}:${config.auth}`, expiresAt: new Date(Date.now() + 3600000).toISOString() }) } }
}

test('GET requests deduplicate, clone cached data and isolate accounts and mutations', async () => {
  const f = transport(); f.session('one')
  const first = f.api.request('/api/works', { cacheTtl: 10000 })
  const second = f.api.request('/api/works', { cacheTtl: 10000 })
  assert.equal(f.calls.length, 1)
  f.calls[0].success({ statusCode: 200, data: { items: [{ title: 'original' }] } })
  const [a, b] = await Promise.all([first, second]); assert.deepEqual(a,b)
  a.items[0].title = 'mutated'
  assert.equal((await f.api.request('/api/works')).items[0].title, 'original')
  f.session('two')
  const other = f.api.request('/api/works'); assert.equal(f.calls.length,2)
  f.calls[1].success({ statusCode:200, data:{items:[]} }); await other
  const old = f.api.request('/api/stale', {cacheTtl:10000})
  const write = f.api.request('/api/save', {method:'PUT',data:{}})
  f.calls[3].success({statusCode:200,data:{}}); await write
  f.calls[2].success({statusCode:200,data:{old:true}}); await old
  const fresh = f.api.request('/api/stale'); assert.equal(f.calls.length,5)
  f.calls[4].success({statusCode:200,data:{fresh:true}}); await fresh
})

test('uncertain writes reuse durable keys and session renewal never loops into an inflight GET', async () => {
  const f=transport(); f.session('one')
  const input={method:'POST',data:{title:'same work'},idempotent:true}
  const attempt=f.api.request('/api/works',input)
  const key=f.calls[0].header['Idempotency-Key']
  assert.equal(f.calls[0].idempotent,undefined)
  f.calls[0].fail({errMsg:'request:fail timeout'}); await assert.rejects(attempt,/超时/)
  const replay=f.api.request('/api/works',input)
  assert.equal(f.calls[1].header['Idempotency-Key'],key)
  f.calls[1].success({statusCode:201,data:{id:'saved'}}); await replay
  const next=f.api.request('/api/works',input)
  assert.notEqual(f.calls[2].header['Idempotency-Key'],key)
  f.calls[2].success({statusCode:201,data:{id:'next'}}); await next
  const get=f.api.request('/api/me')
  f.calls[3].success({statusCode:401,data:{}})
  assert.match(f.calls[4].url,/dev-login$/)
  f.calls[4].success({statusCode:200,data:{token:'fresh',expiresAt:new Date(Date.now()+3600000).toISOString(),user:{id:'one',name:'reader',roles:['user']}}})
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(f.calls[5].header.Authorization,'Bearer fresh')
  f.calls[5].success({statusCode:200,data:{name:'reader'}})
  assert.equal((await get).name,'reader')
})

test('idempotency receipts commit with writes, replay after reinitialization and reject changed inputs', () => {
  const db=new DatabaseSync(':memory:')
  db.exec("PRAGMA foreign_keys=ON; CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO users VALUES ('a'),('b'); CREATE TABLE writes(id INTEGER PRIMARY KEY, value TEXT)")
  class HttpError extends Error { constructor(status,code,message){ super(message);this.status=status;this.code=code } }
  let run=createIdempotency(db,HttpError), count=0
  const req={headers:{'idempotency-key':'operation_123456'}}
  const operation=()=>{ count++; const row=db.prepare('INSERT INTO writes(value) VALUES (?) RETURNING id').get('value'); return {id:row.id} }
  try {
    const first=run(req,'a','/create',{title:'one'},operation)
    run=createIdempotency(db,HttpError)
    assert.deepEqual(run(req,'a','/create',{title:'one'},operation),first); assert.equal(count,1)
    assert.throws(()=>run(req,'a','/create',{title:'changed'},operation),error=>error.status===409)
    assert.notEqual(run(req,'b','/create',{title:'one'},operation).id,first.id)
    assert.throws(()=>run({headers:{'idempotency-key':'rollback_123456'}},'a','/create',{},()=>{db.exec("INSERT INTO writes(value) VALUES ('rollback')");throw new Error('failure')}),/failure/)
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM writes WHERE value='rollback'").get().n,0)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM client_operations').get().n,2)
  } finally {db.close()}
})

test('search discards a response immediately after input changes or clears', async () => {
  let definition; const pending=[]
  load('miniprogram/pages/search/index.ts', {'../../utils/api':{request:()=>new Promise(resolve=>pending.push(resolve))},'../../utils/library':{displayBook:item=>item}}, {Page:page=>definition=page,wx:{}})
  const page={...definition,data:structuredClone(definition.data),setData(values){Object.assign(this.data,values)}}
  page.data.query='old'; const old=page.submit()
  page.input({detail:{value:'new'}})
  pending[0]({items:[{id:'old'}],total:1}); await old
  assert.equal(page.data.results.length,0); assert.equal(page.data.loading,true)
  page.input({detail:{value:''}})
  assert.equal(page.data.loading,false);assert.equal(page.data.submitted,false)
  page.onUnload()
})

test('public image cache persists downloads, avoids repeat network calls and evicts by bytes', async () => {
  const storage=new Map(), files=new Set(), removed=[]; let downloads=0
  const fs={accessSync:path=>{if(!files.has(path))throw new Error('missing')},statSync:()=>({size:5*1024*1024}),saveFile:options=>{const path=`saved-${downloads}`;files.add(path);options.success({savedFilePath:path})},unlinkSync:path=>{removed.push(path);files.delete(path)}}
  const wx={getStorageSync:key=>storage.get(key),setStorageSync:(key,value)=>storage.set(key,value),getFileSystemManager:()=>fs,getImageInfo:options=>{downloads++;options.success({path:`temp-${downloads}`})}}
  const media=load('miniprogram/utils/reader-media.ts',{'../config':{getEnvironment:()=>({apiBase:'https://test'})}},{wx})
  assert.equal(await media.cachedReaderMedia('https://test/a'),'saved-1')
  assert.equal(await media.cachedReaderMedia('https://test/a'),'saved-1');assert.equal(downloads,1)
  await media.cachedReaderMedia('https://test/b');await media.cachedReaderMedia('https://test/c')
  assert.deepEqual(removed,['saved-1'])
  const reopened=load('miniprogram/utils/reader-media.ts',{'../config':{getEnvironment:()=>({apiBase:'https://test'})}},{wx})
  assert.equal(await reopened.cachedReaderMedia('https://test/c'),'saved-3');assert.equal(downloads,3)
  assert.equal(await reopened.cachedReaderMedia('/local.webp'),'/local.webp')
})

test('reader background resume protects initial progress and never moves an active reader', async () => {
  let definition, releaseLogin; const writes=[], moves=[]
  const storage=new Map()
  const wx={getStorageSync:key=>storage.get(key),setStorageSync:(key,value)=>storage.set(key,value)}
  const login=new Promise(resolve=>releaseLogin=resolve)
  load('miniprogram/pages/reader/index.ts', {
    '../../utils/api':{ensureSession:()=>login,request:async (path,options)=>{if(options?.method==='POST')writes.push(path);return {progress:{block_id:'two',progress:70,scroll_ratio:.4,updated_at:'2099-01-01 00:00:00'}}}},
    '../../utils/access':{getSession:()=>({userId:'reader'})},'../../utils/reader-cache':{readReaderCache:()=>undefined,writeReaderCache:()=>{}},
    '../../utils/share':{isTimelinePreview:()=>false},'../../utils/creator':{},'../../utils/reader-illustrations':{},'../../utils/reader-media':{}
  }, {wx,Page:page=>definition=page})
  const page={...definition,data:{...definition.data,workId:'book',loading:false,error:'',mode:'longform',chapters:[{id:'one'},{id:'two'}],chapter:{id:'one'}},setData(values){Object.assign(this.data,values)},loadLongChapter:async (id,ratio)=>moves.push([id,ratio])}
  const resume=page.syncInitialPosition(0,false,false)
  await page.persistPosition();assert.equal(writes.length,0)
  releaseLogin();await resume
  assert.deepEqual(moves,[['two',.4]])
  page.interacted=true;await page.syncInitialPosition(0,false,false)
  assert.equal(moves.length,1)
})
