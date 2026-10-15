import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import sharp from 'sharp'
import { createHash } from 'node:crypto'
import { createComics, validatePanels } from '../src/comics.mjs'
import { createJobQueue } from '../src/production.mjs'

function setup(transport, queueSchedule) {
  const db = new DatabaseSync(':memory:')
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO users VALUES ('admin'),('reader');
    CREATE TABLE works(id TEXT PRIMARY KEY,title TEXT,owner_id TEXT,updated_at TEXT); INSERT INTO works VALUES ('novel','Original','admin','now');
    CREATE TABLE story_chapters(id TEXT PRIMARY KEY,work_id TEXT,content TEXT,title TEXT,word_count INTEGER,chapter_number INTEGER);
    CREATE TABLE content_blocks(id TEXT PRIMARY KEY,work_id TEXT,content TEXT,block_type TEXT,sort_order INTEGER); INSERT INTO content_blocks VALUES ('source','novel','Original text must remain intact','text',1);
    CREATE TABLE model_configs(id TEXT PRIMARY KEY,name TEXT,model TEXT,endpoint TEXT,kind TEXT,enabled INTEGER,encrypted_key TEXT,is_default INTEGER);
    INSERT INTO model_configs VALUES ('text','Text','text-1','https://vendor.test/chat/completions','text',1,'secret',1),('image','Image','image-1','https://vendor.test/images/generations','image',1,'secret',1);
    CREATE TABLE generation_jobs(id TEXT PRIMARY KEY,owner_id TEXT,work_id TEXT,job_type TEXT,status TEXT DEFAULT 'queued',request_json TEXT,model_snapshot TEXT,result_json TEXT,error_code TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,finished_at TEXT);`)
  class HttpError extends Error { constructor(status,code,message) { super(message); this.status=status; this.code=code } }
  const scheduled = []; const logs = []
  const comics = createComics({ db, HttpError, body: req => req.input || {}, json: (_res,status,payload) => ({ status,payload }),
    requirePermission: req => { if (req.actor !== 'admin') throw new HttpError(403,'FORBIDDEN','Forbidden'); return { id:'admin' } },
    userFromRequest: req => req.actor ? { id:req.actor } : null, can: actor => actor?.id === 'admin', audit: (...args) => logs.push(args),
    generationBudget: () => {}, decryptSecret: () => 'test-key', validateModel: () => {}, validateProviderHost: async () => {},
    boundedResponse: async response => Buffer.from(await response.text()), schedule: (id, modelId) => {
      scheduled.push(id)
      if (queueSchedule) return queueSchedule(db, id, modelId)
      if (!db.prepare('SELECT model_snapshot FROM generation_jobs WHERE id=?').get(id).model_snapshot) {
        db.prepare('UPDATE generation_jobs SET model_snapshot=? WHERE id=?').run(JSON.stringify(db.prepare('SELECT * FROM model_configs WHERE id=?').get(modelId)), id)
      }
    }, fetchTransport: transport })
  const api = (path,method='GET',input,actor='admin') => comics.handle({ method,input,actor }, {},path)
  const create = async () => (await api('/admin-api/comics','POST',{ workId:'novel',style:'color',rightsNote:'owned',rightsConfirmed:true })).payload.episode
  const run = async id => { const job=db.prepare('SELECT job_type FROM generation_jobs WHERE id=?').get(id); db.prepare("UPDATE generation_jobs SET status='running' WHERE id=?").run(id); await comics.runners[job.job_type](id) }
  return { db,api,create,run,scheduled,comics,logs }
}

test('comic input rejects empty, unbounded and malformed panels', () => {
  for (const panels of [[], Array(61).fill({ prompt:'x' }), [{ prompt:'' }], [{ prompt:'x',dialogue:{} }]]) assert.throws(() => validatePanels(panels))
  assert.equal(validatePanels([{ prompt:'scene' }])[0].narration,'')
})

test('a continuing comic series stays attached to its original novel', async () => {
  const state = setup(async () => { throw new Error('unexpected provider call') })
  try {
    const first = await state.create()
    state.db.exec("INSERT INTO works VALUES ('other-novel','Other','admin','now')")
    state.db.exec("INSERT INTO content_blocks VALUES ('other-source','other-novel','Another source text','text',1)")
    await assert.rejects(state.api('/admin-api/comics','POST',{ workId:'other-novel', seriesId:first.seriesId, seriesTitle:'Ignored', style:'color', rightsNote:'owned', rightsConfirmed:true }), error => error.code === 'COMIC_SERIES_WORK_MISMATCH')
    assert.equal(state.db.prepare('SELECT COUNT(*) AS n FROM comic_episodes').get().n, 1)
  } finally { state.db.close() }
})

test('comic storyboard uses queue snapshots and generation fallback, excluding reviewers', async () => {
  let queue
  const calls = []
  const state = setup(async (_endpoint, options) => {
    const payload = JSON.parse(options.body); calls.push(payload.model)
    return payload.model === 'text-1' ? new Response('', { status: 503 }) : Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ panels: [{ prompt: 'A clear scene' }] }) } }] })
  }, (db, id, modelId) => {
    queue ||= createJobQueue({ db, env: {}, runners: state.comics.runners })
    queue.update({ paused: true }); queue.schedule(id, modelId)
  })
  const { db, api, create } = state
  try {
    db.exec("ALTER TABLE model_configs ADD COLUMN text_role TEXT DEFAULT 'generation'; ALTER TABLE model_configs ADD COLUMN review_default INTEGER DEFAULT 0; ALTER TABLE generation_jobs ADD COLUMN started_at TEXT; CREATE TABLE model_config_order(model_id TEXT PRIMARY KEY,priority INTEGER); CREATE TABLE production_settings(id INTEGER PRIMARY KEY,settings_json TEXT)")
    db.exec("INSERT INTO model_configs(id,name,model,endpoint,kind,enabled,encrypted_key,is_default,text_role) VALUES ('review','Reviewer','review-only','https://vendor.test/chat/completions','text',1,'secret',0,'reviewer'),('backup','Backup','text-backup','https://vendor.test/chat/completions','text',1,'secret',0,'generation'); INSERT INTO model_config_order VALUES ('review',0),('backup',1),('text',2)")
    const episode = await create(); const path = `/admin-api/comics/${episode.id}`
    const { jobId } = (await api(`${path}/storyboard`, 'POST', { version: 1, modelId: 'text', panelCount: 1 })).payload
    const frozen = JSON.parse(db.prepare('SELECT model_snapshot FROM generation_jobs WHERE id=?').get(jobId).model_snapshot)
    assert.deepEqual(frozen.fallbackModels.map(m => m.id), ['backup'])
    db.exec("UPDATE model_configs SET model='edited-after-enqueue' WHERE id='backup'")
    queue.update({ paused: false })
    for (let i = 0; i < 100 && db.prepare('SELECT status FROM generation_jobs WHERE id=?').get(jobId).status !== 'success'; i++) await new Promise(resolve => setImmediate(resolve))
    await queue.stop()
    assert.deepEqual(calls, ['text-1', 'text-backup'])
    assert.equal((await api(path)).payload.episode.panels.length, 1)
    assert.equal(JSON.parse(db.prepare('SELECT result_json FROM generation_jobs WHERE id=?').get(jobId).result_json).attempts.length, 2)
  } finally { await queue?.stop(); db.close() }
})

test('comic fixed-model images never retry even after timeout, and reject unknown policies', async () => {
  let calls = 0
  const state = setup(async () => { calls++; throw new DOMException('Timed out', 'TimeoutError') })
  const { db, api, create, run } = state
  try {
    db.exec("INSERT INTO model_configs VALUES ('backup','Backup','image-2','https://backup.test/images/generations','image',1,'secret',0)")
    let episode = await create(); const path = `/admin-api/comics/${episode.id}`
    episode = (await api(path, 'PUT', { version: 1, panels: [{ prompt: 'A quiet shore' }] })).payload.episode
    await assert.rejects(api(`${path}/images`, 'POST', { version: episode.version, modelId: 'image', retryPolicy: 'unknown' }), e => e.code === 'COMIC_RETRY_POLICY_INVALID')
    const { jobIds } = (await api(`${path}/images`, 'POST', { version: episode.version, modelId: 'image', retryPolicy: 'never' })).payload
    await run(jobIds[0])
    const job = (await api(`${path}/jobs`)).payload.items[0]
    assert.equal(calls, 1); assert.equal(job.status, 'failed'); assert.equal(job.result.attempts[0].resultUnknown, true)
  } finally { db.close() }
})

test('storyboard with the wrong panel count is retained as failure without changing the draft', async () => {
  const state = setup(async () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ panels: [{ prompt: 'Only one scene' }] }) } }] }))
  try {
    const episode = await state.create(); const path = `/admin-api/comics/${episode.id}`
    const { jobId } = (await state.api(`${path}/storyboard`, 'POST', { version: 1, modelId: 'text', panelCount: 2 })).payload
    await state.run(jobId)
    assert.equal((await state.api(`${path}/jobs`)).payload.items[0].errorCode, 'COMIC_PANEL_COUNT_MISMATCH')
    assert.equal((await state.api(path)).payload.episode.version, 1)
  } finally { state.db.close() }
})

test('comic generation, human review, immutable publication, media access and history preserve source', async () => {
  const png = await sharp({ create:{ width:24,height:32,channels:3,background:'#f08877' } }).png().toBuffer()
  const calls=[]
  const state=setup(async (endpoint,options) => {
    calls.push({ endpoint,payload:JSON.parse(options.body) })
    return Response.json(endpoint.endsWith('/chat/completions')
      ? { choices:[{ finish_reason:'stop',message:{ content:JSON.stringify({ panels:[{ prompt:'A character in daylight',narration:'Narration <img src=x onerror=alert(1)>',dialogue:'Hello' },{ prompt:'Another view',dialogue:'Goodbye' }] }) } }] }
      : { data:[{ b64_json:png.toString('base64') }] })
  })
  const { db,api,run,create }=state
  try {
    await assert.rejects(api('/admin-api/comics','POST',{ workId:'novel',style:'color',rightsConfirmed:false }), e=>e.code==='COMIC_RIGHTS_REQUIRED')
    const episode=await create(); const path=`/admin-api/comics/${episode.id}`
    await assert.rejects(api(path,'GET',undefined,'reader'),e=>e.status===403)
    const story=(await api(`${path}/storyboard`,'POST',{ version:1,modelId:'text',panelCount:2 })).payload.jobId
    await run(story)
    let draft=(await api(path)).payload.episode
    assert.equal(draft.version,2); assert.equal(draft.panels.length,2)
    const imageJobs=(await api(`${path}/images`,'POST',{ version:2,modelId:'image' })).payload.jobIds
    assert.equal(imageJobs.length,2)
    assert.equal((await api(`${path}/images`,'POST',{ version:2,modelId:'image' })).payload.skipped.length,2)
    await Promise.all(imageJobs.map(run))
    draft=(await api(path)).payload.episode
    assert.ok(draft.panels.every(p=>p.imageId && !p.approved))
    await assert.rejects(api(`${path}/publish`,'POST',{ version:draft.version }),e=>e.code==='COMIC_REVIEW_REQUIRED')
    draft=(await api(path,'PUT',{ version:draft.version,panels:draft.panels.map(p=>({ ...p,approved:true })) })).payload.episode
    await api(`${path}/publish`,'POST',{ version:draft.version })
    const published=(await api(`/api/comics/${episode.id}`)).payload.episode
    assert.ok(published.panels.every(panel => panel.imageWidth === 24 && panel.imageHeight === 32))
    assert.ok(!JSON.parse(db.prepare('SELECT published_json FROM comic_episodes WHERE id=?').get(episode.id).published_json).panels[0].imageWidth, 'legacy publication remains immutable while read API supplies dimensions')
    let readerHeaders, readerHtml
    await state.comics.handle({ method:'GET' }, {
      writeHead(status,headers) { assert.equal(status,200); readerHeaders=headers },
      end(html) { readerHtml=html },
    }, `/comics/${episode.id}`)
    assert.ok(readerHtml.includes('&lt;img src=x onerror=alert(1)&gt;'))
    assert.ok(!readerHtml.includes('<img src=x'))
    const readerScript=readerHtml.match(/<script>([\s\S]*?)<\/script>/)[1]
    const expectedHash=createHash('sha256').update(readerScript).digest('base64')
    assert.ok(readerHeaders['Content-Security-Policy'].includes(`script-src 'sha256-${expectedHash}'`))
    assert.ok(!readerHeaders['Content-Security-Policy'].includes("script-src 'unsafe-inline'"))
    assert.ok(readerHtml.includes('aspect-ratio:24/32'))
    assert.ok(readerHtml.includes('aria-label="返回漫画话目"'))
    let libraryHtml
    await state.comics.handle({ method:'GET' }, { writeHead(status) { assert.equal(status,200) }, end(html) { libraryHtml=html } }, '/comics')
    const book = (await api('/api/comic-series')).payload.items[0]
    assert.ok(libraryHtml.includes(`/comics/series/${book.id}`))
    let seriesHtml
    await state.comics.handle({ method:'GET' }, { writeHead(status) { assert.equal(status,200) }, end(html) { seriesHtml=html } }, `/comics/series/${book.id}`)
    assert.ok(seriesHtml.includes(`/comics/${episode.id}`))
    assert.match(seriesHtml, /1 话 · 2 格/)
    assert.match(readerHtml, new RegExp(`href="/comics/series/${book.id}"`))
    const edited=structuredClone(draft.panels); edited[0].dialogue='<script>alert(1)</script>'
    await api(path,'PUT',{ version:draft.version,panels:edited })
    assert.deepEqual((await api(`/api/comics/${episode.id}`)).payload.episode,published)
    const revision=(await api(`${path}/revisions`)).payload.items.find(r=>r.version===draft.version)
    const restored=(await api(`${path}/restore`,'POST',{ version:draft.version+1,revisionId:revision.id })).payload.episode
    assert.equal(restored.panels[0].imageId,published.panels[0].imageId)
    assert.ok(restored.panels.every(p=>!p.approved))
    await assert.rejects(api(path,'PUT',{ version:1,panels:edited }),e=>e.code==='COMIC_VERSION_CONFLICT')
    assert.equal(db.prepare('SELECT content FROM content_blocks').get().content,'Original text must remain intact')
    assert.equal(calls.length,3)
    assert.ok(calls.every(c=>c.payload.model && c.payload.messages || c.payload.prompt))
    await assert.rejects(api(`/api/comic-media/${published.panels[0].imageId}/original`,'GET',undefined,'reader'),e=>e.status===404)
    await api(`${path}/unpublish`,'POST',{})
    await assert.rejects(api(`/api/comics/${episode.id}`),e=>e.code==='COMIC_NOT_FOUND')
  } finally { db.close() }
})

test('late image output is retained and can be adopted without overwriting a manual edit', async () => {
  const png=await sharp({ create:{ width:10,height:10,channels:3,background:'#00aa88' } }).png().toBuffer()
  let resolveProvider; let signalStarted
  const started=new Promise(resolve=>{ signalStarted=resolve })
  const state=setup(async () => { signalStarted(); return await new Promise(resolve=>{ resolveProvider=()=>resolve(Response.json({ data:[{ b64_json:png.toString('base64') }] })) }) })
  const { db,api,create,run }=state
  try {
    let episode=await create(); const path=`/admin-api/comics/${episode.id}`
    episode=(await api(path,'PUT',{ version:1,panels:[{ prompt:'Original scene' }] })).payload.episode
    const jobId=(await api(`${path}/images`,'POST',{ version:episode.version,modelId:'image' })).payload.jobIds[0]
    const running=run(jobId); await started
    episode=(await api(path,'PUT',{ version:episode.version,panels:episode.panels.map(p=>({ ...p,prompt:'Edited scene' })) })).payload.episode
    resolveProvider(); await running
    const saved=(await api(path)).payload.episode
    assert.equal(saved.panels[0].prompt,'Edited scene'); assert.equal(saved.panels[0].imageId,null)
    assert.equal(JSON.parse(db.prepare('SELECT result_json FROM generation_jobs WHERE id=?').get(jobId).result_json).stale,true)
    const adopted=(await api(`${path}/adopt`,'POST',{ version:episode.version,jobId })).payload.episode
    assert.ok(adopted.panels[0].imageId); assert.equal(adopted.panels[0].approved,false)
    assert.equal(adopted.panels[0].prompt,'Edited scene')
  } finally { db.close() }
})

test('comic image generation falls back to the next configured image model', async () => {
  const png = await sharp({ create:{ width:10,height:10,channels:3,background:'#224466' } }).png().toBuffer()
  const state = setup(async (endpoint, options) => {
    if (endpoint.includes('primary')) return new Response('upstream failure', { status: 503 })
    return Response.json({ data:[{ b64_json: png.toString('base64') }] })
  })
  const { db, api, create, run } = state
  try {
    db.prepare('INSERT INTO model_configs VALUES (?,?,?,?,?,?,?,?)').run('backup-image','Backup','image-2','https://backup.test/images/generations','image',1,'secret',0)
    db.prepare("UPDATE model_configs SET endpoint='https://primary.test/images/generations' WHERE id='image'").run()
    let episode = await create(); const path = `/admin-api/comics/${episode.id}`
    episode = (await api(path, 'PUT', { version: 1, panels: [{ prompt: 'consistent hero portrait' }] })).payload.episode
    const jobId = (await api(`${path}/images`, 'POST', { version: episode.version, modelId: 'image' })).payload.jobIds[0]
    await run(jobId)
    const job = db.prepare('SELECT status,result_json FROM generation_jobs WHERE id=?').get(jobId)
    assert.equal(job.status, 'success')
    const result = JSON.parse(job.result_json)
    assert.equal(result.modelId, 'backup-image')
    assert.deepEqual(result.attempts.map(attempt => attempt.status), ['failed', 'success'])
  } finally { db.close() }
})

test('timeout falls back with immutable prompt and model snapshots, without exposing credentials', async () => {
  const png = await sharp({ create:{ width:10,height:10,channels:3,background:'#224466' } }).png().toBuffer()
  const calls = []
  const state = setup(async (endpoint, options) => {
    calls.push({ endpoint, payload: JSON.parse(options.body) })
    if (endpoint.includes('vendor.test')) throw new DOMException('Timeout contained a private credential', 'TimeoutError')
    return Response.json({ data:[{ b64_json: png.toString('base64') }] })
  })
  const { db, api, create, run } = state
  try {
    db.prepare('INSERT INTO model_configs VALUES (?,?,?,?,?,?,?,?)').run('backup','Backup','image-2','https://backup.test/images/generations','image',1,'private-credential',0)
    let episode = await create(); const path = `/admin-api/comics/${episode.id}`
    episode = (await api(path, 'PUT', { version: 1, panels: [{ prompt: 'consistent hero portrait' }] })).payload.episode
    const jobId = (await api(`${path}/images`, 'POST', { version: episode.version, modelId: 'image' })).payload.jobIds[0]
    db.prepare("UPDATE model_configs SET endpoint='https://changed.test/images/generations',model='changed' WHERE id='backup'").run()
    await run(jobId)
    const result = (await api(`${path}/jobs`)).payload.items[0]
    assert.equal(result.status, 'success')
    assert.equal(result.result.attempts[0].resultUnknown, true)
    assert.equal(result.result.attempts[0].errorCode, 'PROVIDER_TIMEOUT')
    assert.equal(result.result.model, 'image-2')
    assert.equal(calls[1].endpoint, 'https://backup.test/images/generations')
    assert.equal(calls[0].payload.prompt, calls[1].payload.prompt)
    assert.ok(!JSON.stringify(result).includes('private-credential'))
    assert.ok(!JSON.stringify(result).includes('Timeout contained'))
  } finally { db.close() }
})

test('all candidates fail within the three-attempt cap, using manual order and excluding disabled models', async () => {
  const calls = []
  const state = setup(async (_endpoint, options) => { calls.push(JSON.parse(options.body).model); return Response.json({ data: [] }) })
  const { db, api, create, run } = state
  try {
    db.exec('CREATE TABLE model_config_order(model_id TEXT PRIMARY KEY,priority INTEGER)')
    for (let i=2; i<=5; i++) {
      db.prepare('INSERT INTO model_configs VALUES (?,?,?,?,?,?,?,?)').run(`b${i}`,`Backup ${i}`,`image-${i}`,`https://backup${i}.test/images/generations`,'image',i===4 ? 0 : 1,'secret',0)
    }
    db.exec("INSERT INTO model_config_order VALUES ('b2',30),('b3',10),('b4',0),('b5',20)")
    let episode = await create(); const path = `/admin-api/comics/${episode.id}`
    episode = (await api(path, 'PUT', { version: 1, panels: [{ prompt: 'hero' }] })).payload.episode
    const jobId = (await api(`${path}/images`, 'POST', { version: episode.version, modelId: 'image' })).payload.jobIds[0]
    await run(jobId)
    assert.deepEqual(calls, ['image-1','image-3','image-5'])
    const job = (await api(`${path}/jobs`)).payload.items[0]
    assert.equal(job.status, 'failed'); assert.equal(job.result.attempts.length, 3)
    assert.equal(job.result.retryExhausted, true)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM comic_media').get().n, 0)
  } finally { db.close() }
})

test('local save errors and invalid requests never trigger paid fallback', async () => {
  const png = await sharp({ create:{ width:10,height:10,channels:3,background:'#224466' } }).png().toBuffer()
  for (const failSave of [true, false]) {
    let calls = 0
    const state = setup(async () => { calls++; return failSave ? Response.json({ data:[{ b64_json: png.toString('base64') }] }) : new Response('', { status:400 }) })
    const { db, api, create, run } = state
    try {
      db.prepare('INSERT INTO model_configs VALUES (?,?,?,?,?,?,?,?)').run('backup','Backup','image-2','https://backup.test/images/generations','image',1,'secret',0)
      let episode = await create(); const path = `/admin-api/comics/${episode.id}`
      episode = (await api(path, 'PUT', { version:1, panels:[{ prompt:'hero' }] })).payload.episode
      const jobId = (await api(`${path}/images`, 'POST', { version:episode.version, modelId:'image' })).payload.jobIds[0]
      if (failSave) db.exec("CREATE TRIGGER reject_media BEFORE INSERT ON comic_media BEGIN SELECT RAISE(FAIL,'SAVE_FAILED'); END")
      await run(jobId)
      assert.equal(calls,1)
      assert.equal((await api(`${path}/jobs`)).payload.items[0].status,'failed')
    } finally { db.close() }
  }
})

test('queued comic images freeze real character profiles and request high quality portrait output', async () => {
  const png = await sharp({ create:{ width:10,height:10,channels:3,background:'#224466' } }).png().toBuffer()
  const calls = []
  const { db,api,create,run } = setup(async (_endpoint,options) => { calls.push(JSON.parse(options.body)); return Response.json({ data:[{ b64_json:png.toString('base64') }] }) })
  try {
    db.exec("CREATE TABLE characters(name TEXT,visual_profile TEXT,work_id TEXT,sort_order INTEGER)")
    db.prepare('INSERT INTO characters VALUES (?,?,?,?)').run('Hero',JSON.stringify({ prompt:'black hair, red scarf, silver earring' }),'novel',0)
    let episode = await create(); const path=`/admin-api/comics/${episode.id}`
    episode = (await api(path,'PUT',{ version:1,panels:[{ prompt:'city gate' }] })).payload.episode
    const id=(await api(`${path}/images`,'POST',{ version:episode.version,modelId:'image' })).payload.jobIds[0]
    db.exec("UPDATE characters SET visual_profile='{}'")
    await run(id)
    assert.ok(calls[0].prompt.includes('black hair, red scarf, silver earring'))
    assert.ok(!calls[0].prompt.includes('[object Object]'))
    assert.equal(calls[0].size,'1024x1536'); assert.equal(calls[0].quality,'high')
  } finally { db.close() }
})
