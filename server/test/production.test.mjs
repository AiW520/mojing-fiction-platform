import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { migrateProduction, createJobQueue } from '../src/production.mjs'

function setup() {
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY);
    CREATE TABLE model_configs(id TEXT PRIMARY KEY,name TEXT,provider TEXT,kind TEXT,endpoint TEXT,model TEXT,encrypted_key TEXT,key_hint TEXT,enabled INTEGER,is_default INTEGER,created_by TEXT,created_at TEXT,updated_at TEXT,UNIQUE(provider,kind));
    CREATE TABLE generation_jobs(id TEXT PRIMARY KEY,owner_id TEXT,work_id TEXT,job_type TEXT,status TEXT DEFAULT 'queued',request_json TEXT DEFAULT '{}',result_json TEXT,error_code TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,started_at TEXT,finished_at TEXT);
    INSERT INTO model_configs VALUES ('text','Text','one','text','https://one.test/chat/completions','old-text','encrypted-key','hint',1,1,NULL,'old','old');
    INSERT INTO model_configs VALUES ('image','Image','one','image','https://one.test/images/generations','old-image','encrypted-image-key','hint',1,1,NULL,'old','old');`)
  migrateProduction(db)
  return db
}
const tick = () => new Promise(resolve => setImmediate(resolve))

test('migration preserves encrypted keys and removes vendor/type uniqueness without changing job IDs', () => {
  const db = setup()
  assert.equal(db.prepare("SELECT encrypted_key FROM model_configs WHERE id='text'").get().encrypted_key, 'encrypted-key')
  db.prepare('INSERT INTO model_configs(id,name,provider,kind,endpoint,model,encrypted_key,key_hint,enabled,is_default,created_by,created_at,updated_at) SELECT ?,name,provider,kind,endpoint,model,encrypted_key,key_hint,enabled,is_default,created_by,created_at,updated_at FROM model_configs WHERE id=?').run('second-text','text')
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM model_configs WHERE provider='one' AND kind='text'").get().n, 2)
  db.exec("INSERT INTO generation_jobs(id,job_type,status) VALUES ('wait','text_generation','queued'),('paid','text_generation','running')")
  migrateProduction(db)
  assert.equal(db.prepare("SELECT status FROM generation_jobs WHERE id='wait'").get().status, 'queued')
  assert.deepEqual({ ...db.prepare("SELECT status,error_code FROM generation_jobs WHERE id='paid'").get() }, { status: 'failed', error_code: 'SERVER_RESTARTED' })
  db.close()
})

test('queue obeys total, kind and work concurrency; keeps selected model despite edits; pause/cancel do not call provider', async () => {
  const db = setup(); const calls = []; const completions = new Map()
  const run = id => new Promise(resolve => { calls.push(id); completions.set(id, () => { db.prepare("UPDATE generation_jobs SET status='success' WHERE id=?").run(id); resolve() }) })
  const queue = createJobQueue({ db, env: {}, runners: { text_generation: run, comic_panel_image: run } })
  queue.update({ concurrency: 3, textConcurrency: 1, imageConcurrency: 2, perWorkConcurrency: 1, paused: true })
  const add = (id,type,work) => { db.prepare('INSERT INTO generation_jobs(id,job_type,work_id) VALUES (?,?,?)').run(id,type,work); queue.schedule(id) }
  add('a','text_generation','work1'); add('b','text_generation','work2'); add('c','comic_panel_image','work1'); add('d','comic_panel_image','work3'); add('cancel','comic_panel_image','work4')
  db.exec("UPDATE generation_jobs SET status='cancelled' WHERE id='cancel'; UPDATE model_configs SET model='new-text' WHERE id='text'")
  assert.equal(JSON.parse(db.prepare("SELECT model_snapshot FROM generation_jobs WHERE id='a'").get().model_snapshot).model, 'old-text')
  assert.equal(calls.length,0)
  queue.update({ paused: false }); await tick()
  assert.deepEqual(calls,['a','d'])
  completions.get('a')(); await tick()
  assert.deepEqual(calls,['a','d','b','c'])
  assert.equal(new Set(calls).size,calls.length)
  for (const finish of completions.values()) finish()
  await tick(); await queue.stop()
  assert.ok(!calls.includes('cancel'))
  const reloaded = createJobQueue({ db,env:{},runners:{} }); assert.equal(reloaded.settings().perWorkConcurrency,1)
  assert.throws(() => reloaded.update({ concurrency:0 }))
  db.close()
})

test('queued work resumes after restart and running paid requests are never reissued', async () => {
  const db = setup(); const calls = []
  const first = createJobQueue({ db,env:{},runners:{} }); first.update({ paused:true })
  db.exec("INSERT INTO generation_jobs(id,job_type,status) VALUES ('resume','text_generation','queued'),('unknown','text_generation','running')")
  first.schedule('resume','text'); await first.stop(); migrateProduction(db)
  const next = createJobQueue({ db,env:{},runners:{ text_generation: id => { calls.push(id); db.prepare("UPDATE generation_jobs SET status='success' WHERE id=?").run(id) } } })
  next.start(); await tick(); assert.deepEqual(calls,[])
  next.update({ paused:false }); await tick(); assert.deepEqual(calls,['resume'])
  assert.equal(db.prepare("SELECT status FROM generation_jobs WHERE id='unknown'").get().status,'failed')
  await next.stop(); db.close()
})

test('image fallback freezes manual order, preserves primary, caps attempts and records each failure', async () => {
  const db = setup(); const calls = []
  const insert = db.prepare('INSERT INTO model_configs(id,name,provider,kind,endpoint,model,encrypted_key,enabled,is_default) VALUES (?,?,?,\'image\',?,?,?,1,0)')
  for (let i=2; i<=4; i++) insert.run(`b${i}`,`Backup ${i}`,'one',`https://backup${i}.test/images/generations`,`backup-${i}`,'encrypted')
  db.exec("INSERT INTO model_config_order(model_id,priority) VALUES ('b2',20),('b3',10),('b4',30)")
  const queue = createJobQueue({ db,env:{},runners:{ creator_image: id => {
    const config = JSON.parse(db.prepare('SELECT model_snapshot FROM generation_jobs WHERE id=?').get(id).model_snapshot)
    calls.push(config.model)
    db.prepare("UPDATE generation_jobs SET status='failed',error_code='PROVIDER_TIMEOUT' WHERE id=?").run(id)
  } } })
  try {
    queue.update({ paused:true })
    db.exec("INSERT INTO generation_jobs(id,job_type) VALUES ('image-job','creator_image')")
    queue.schedule('image-job','image')
    db.exec("UPDATE model_configs SET model='changed' WHERE id='b3'; UPDATE model_config_order SET priority=0 WHERE model_id='b4'")
    queue.update({ paused:false }); await tick(); await queue.stop()
    assert.deepEqual(calls,['old-image','backup-3','backup-2'])
    const job = db.prepare("SELECT * FROM generation_jobs WHERE id='image-job'").get()
    const result = JSON.parse(job.result_json)
    assert.deepEqual(result.attempts.map(a=>a.modelId),['image','b3','b2'])
    assert.ok(result.attempts.every(a=>a.resultUnknown && a.status==='failed'))
    assert.equal(result.retryExhausted,true)
    assert.equal(JSON.parse(job.model_snapshot).id,'image')
  } finally { await queue.stop(); db.close() }
})

test('image fallback handles success and never retries local execution failure', async () => {
  for (const error of ['PROVIDER_HTTP_503','ERR_SQLITE_ERROR']) {
    const db = setup(); const calls = []
    db.prepare('INSERT INTO model_configs(id,name,provider,kind,endpoint,model,encrypted_key,key_hint,enabled,is_default,created_by,created_at,updated_at) SELECT ?,name,provider,kind,endpoint,model,encrypted_key,key_hint,enabled,is_default,created_by,created_at,updated_at FROM model_configs WHERE id=?').run('backup','image')
    const queue = createJobQueue({ db,env:{},runners:{ import_image: id => {
      const config = JSON.parse(db.prepare('SELECT model_snapshot FROM generation_jobs WHERE id=?').get(id).model_snapshot)
      calls.push(config.id)
      db.prepare('UPDATE generation_jobs SET status=?,error_code=?,result_json=? WHERE id=?').run(config.id==='image' ? 'failed' : 'success',config.id==='image' ? error : null,config.id==='image' ? null : JSON.stringify({ assetId:'output' }),id)
    } } })
    try {
      db.exec("INSERT INTO generation_jobs(id,job_type) VALUES ('job','import_image')")
      queue.schedule('job','image'); await tick(); await queue.stop()
      assert.deepEqual(calls,error==='PROVIDER_HTTP_503' ? ['image','backup'] : ['image'])
      const result=JSON.parse(db.prepare("SELECT result_json FROM generation_jobs WHERE id='job'").get().result_json)
      if (error==='PROVIDER_HTTP_503') { assert.equal(result.assetId,'output'); assert.equal(result.attempts[1].status,'success') }
    } finally { await queue.stop(); db.close() }
  }
})

test('text chains isolate purposes, freeze reviewer configs, and cap generation attempts at three', async () => {
  const db = setup(); const calls = []
  for (let i = 1; i <= 3; i++) db.prepare("INSERT INTO model_configs(id,name,provider,kind,endpoint,model,encrypted_key,enabled,is_default,text_role,review_default) VALUES (?,?,'one','text','https://one.test/chat/completions',?,'key',1,0,?,?)")
    .run(`backup-${i}`, `Backup ${i}`, `model-${i}`, i === 1 ? 'reviewer' : 'generation', i === 1 ? 1 : 0)
  db.prepare("INSERT INTO model_configs(id,name,provider,kind,endpoint,model,encrypted_key,enabled,is_default,text_role) VALUES ('extra','Extra','one','text','https://one.test/chat/completions','extra','key',1,0,'generation')").run()
  db.exec("INSERT INTO model_config_order(model_id,priority) VALUES ('backup-1',0),('backup-2',10),('backup-3',20),('extra',30)")
  const queue = createJobQueue({ db, env: {}, runners: { text_generation: id => {
    const model = JSON.parse(db.prepare('SELECT model_snapshot FROM generation_jobs WHERE id=?').get(id).model_snapshot)
    calls.push(model)
    db.prepare("UPDATE generation_jobs SET status='failed',error_code='PROVIDER_HTTP_503' WHERE id=?").run(id)
  } } })
  try {
    queue.update({ paused: true })
    db.exec("INSERT INTO generation_jobs(id,job_type) VALUES ('text-chain','text_generation')")
    queue.schedule('text-chain')
    db.exec("UPDATE model_configs SET model='changed' WHERE id IN ('backup-1','backup-2'); UPDATE model_config_order SET priority=0 WHERE model_id='extra'")
    queue.update({ paused: false }); await tick(); await queue.stop()
    assert.deepEqual(calls.map(model => model.id), ['text','backup-2','backup-3'])
    assert.equal(calls[1].model, 'model-2')
    assert.ok(calls.every(model => model.reviewModels[0].model === 'model-1'))
    const result = JSON.parse(db.prepare("SELECT result_json FROM generation_jobs WHERE id='text-chain'").get().result_json)
    assert.equal(result.retryExhausted, true)
    assert.equal(result.attempts.length, 3)
  } finally { await queue.stop(); db.close() }
})

test('text unknown results stop without a second paid attempt; review-only models cannot generate', async () => {
  for (const errorCode of ['PROVIDER_TIMEOUT','PROVIDER_NETWORK_ERROR','PROVIDER_HTTP_408','PROVIDER_INVALID_JSON','ERR_SQLITE_ERROR']) {
    const db = setup(); let calls = 0
    db.exec("INSERT INTO model_configs(id,name,provider,kind,endpoint,model,encrypted_key,enabled,is_default,text_role) VALUES ('backup','Backup','one','text','https://one.test/chat/completions','backup','key',1,0,'generation'),('review','Review','one','text','https://one.test/chat/completions','review','key',1,0,'reviewer')")
    const queue = createJobQueue({ db, env: {}, runners: { text_generation: id => {
      calls++; db.prepare("UPDATE generation_jobs SET status='failed',error_code=? WHERE id=?").run(errorCode,id)
    } } })
    try {
      db.exec("INSERT INTO generation_jobs(id,job_type) VALUES ('job','text_generation'),('wrong','text_generation')")
      assert.throws(() => queue.schedule('wrong','review'), { code: 'MODEL_NOT_AVAILABLE' })
      queue.schedule('job'); await tick(); await queue.stop()
      assert.equal(calls, 1, errorCode)
      const result = JSON.parse(db.prepare("SELECT result_json FROM generation_jobs WHERE id='job'").get().result_json)
      assert.equal(result.attempts.length, 1)
      assert.equal(result.retryExhausted, false)
    } finally { await queue.stop(); db.close() }
  }
})

test('restart retains a completed candidate and never reissues its interrupted review', async () => {
  const db = setup(); const calls = []
  db.prepare("INSERT INTO generation_jobs(id,job_type,status,result_json) VALUES ('candidate','text_generation','running',?)").run(JSON.stringify({ content: 'Already generated', candidateHash: 'hash', review: { status: 'pending' } }))
  migrateProduction(db)
  const job = db.prepare("SELECT status,error_code,result_json FROM generation_jobs WHERE id='candidate'").get()
  assert.equal(job.status, 'success')
  assert.equal(job.error_code, 'SERVER_RESTARTED')
  assert.equal(JSON.parse(job.result_json).content, 'Already generated')
  assert.equal(JSON.parse(job.result_json).review.status, 'unknown')
  const queue = createJobQueue({ db,env:{},runners:{ text_generation: id => calls.push(id) } })
  queue.start(); await tick(); await queue.stop()
  assert.deepEqual(calls, [])
  db.close()
})
