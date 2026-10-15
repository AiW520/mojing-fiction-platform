import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'

const root = resolve(import.meta.dirname, '..')
async function start(data, production = false) {
  const child = spawn(process.execPath, ['--experimental-sqlite', 'src/server.mjs'], {
    cwd: root, env: { ...process.env, PORT: '0', HOST: '127.0.0.1', DATA_DIR: data, NODE_ENV: production ? 'production' : 'test',
      ALLOW_DEV_AUTH: '1', TRUST_PROXY: '0', TUZI_CODING_API_KEY: '', TUZI_IMAGE_ENDPOINT: '',
      DEV_ADMIN_PASSWORD: 'test-admin-password-strong', MODEL_CONFIG_ENCRYPTION_KEY: 'test-encryption-secret-separate-32chars',
      WECHAT_APPID: 'wx1234567890abcdef', WECHAT_SECRET: 'test-not-real', CORS_ORIGIN: 'https://admin.mojing.test', MAX_GENERATION_JOBS_PER_DAY: '2', MAX_CONCURRENT_GENERATION_JOBS: '2', MAX_ACTIVE_GENERATION_JOBS_PER_USER: '1', MAX_QUEUED_GENERATION_JOBS: '2' }, stdio: ['ignore', 'pipe', 'pipe']
  })
  const base = await new Promise((resolve, reject) => {
    let output = ''
    let errors = ''
    child.stderr.on('data', chunk => { errors += chunk })
    const timer = setTimeout(() => { child.kill(); reject(new Error('API startup timeout')) }, 15000)
    child.stdout.on('data', chunk => { output += chunk; const match = output.match(/listening on (http:\/\/[^\s]+)/); if (match) { clearTimeout(timer); resolve(match[1]) } })
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`API exited: ${code}: ${errors}`)) })
  })
  const api = async (path, method = 'GET', data, token, headers = {}) => {
    const response = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: data ? JSON.stringify(data) : undefined })
    return { status: response.status, body: await response.json() }
  }
  return { api, child, close: async () => { const ended = once(child, 'exit'); child.kill(); await ended } }
}

test('API reading, session expiry, image budgets, restart and production login', async () => {
  const data = mkdtempSync(join(tmpdir(), 'mojing-api-test-'))
  let server
  let db
  try {
    server = await start(data)
    const { api } = server
    assert.equal((await api('/api/health')).status, 200)
    const login = await api('/api/auth/dev-login', 'POST', { account: 'wechat:1001' })
    assert.equal(login.status, 200)
    const token = login.body.token
    const catalog = (await api('/api/works')).body.items
    const short = catalog.find(item => item.format !== 'longform')
    assert.ok(short)
    const search = await api(`/api/works?q=${encodeURIComponent(short.title.slice(0, 2))}&limit=1&offset=0`)
    assert.equal(search.status, 200)
    assert.ok(search.body.total >= 1)
    assert.ok(search.body.items.length <= 1)
    assert.equal((await api('/api/works?limit=0')).status, 400)
    assert.equal((await api(`/api/works/${short.id}/blocks`)).status, 200)
    assert.ok(short.coverImage)
    const reviewPath = `/api/works/${short.id}/comments`
    assert.equal((await api(reviewPath, 'POST', { kind: 'review', rating: 5, content: '测试内容', clientId: 'unauthorized-test' })).status, 401)
    const durableReview = await api(reviewPath, 'POST', { kind: 'review', rating: 4, content: 'API持久化测试书评', clientId: 'durable-review-123' }, token)
    assert.equal(durableReview.status, 201)
    assert.equal((await api(reviewPath)).body.summary.rating, 4)
    assert.equal((await api(`/api/comments/${durableReview.body.id}/like`, 'POST', {}, token)).body.likes, 1)
    assert.equal((await api('/api/works/work_demo/blocks')).status, 404)
    const work = catalog.find(item => item.format === 'longform' && item.chapterCount >= 100)
    assert.ok(work)
    const bootstrap = await api(`/api/works/${work.id}/reader-bootstrap`)
    assert.equal(bootstrap.status, 200)
    assert.equal(bootstrap.body.mode, 'longform')
    assert.ok(bootstrap.body.chapter?.content.length > 2000)
    assert.equal(bootstrap.body.chapters.length, work.chapterCount)
    const chapters = (await api(`/api/works/${work.id}/chapters?limit=100`)).body
    assert.equal(chapters.items.length, 100)
    assert.ok(chapters.total >= 100)
    const chapter = (await api(`/api/chapters/${chapters.items[50].id}`)).body
    assert.ok(chapter.chapter.content.length > 2000)
    const path = `/api/works/${work.id}/reading-progress`
    assert.equal((await api(path, 'POST', { blockId: chapter.chapter.id, progress: 51, scrollRatio: .4 }, token)).status, 200)
    const progress = (await api(path, 'GET', undefined, token)).body.progress
    assert.equal(progress.scroll_ratio, .4)
    assert.equal(progress.block_id, chapter.chapter.id)
    const backupPath = join(data, 'verified-backup.sqlite')
    const saved = spawnSync(process.execPath, ['scripts/backup.mjs', backupPath], { cwd: root, env: { ...process.env, DATA_DIR: data }, encoding: 'utf8' })
    assert.equal(saved.status, 0, saved.stderr)
    const backup = new DatabaseSync(backupPath, { readOnly: true })
    assert.equal(backup.prepare('SELECT progress FROM reading_progress WHERE work_id = ?').get(work.id).progress, 51)
    backup.close()
    const repeated = spawnSync(process.execPath, ['scripts/backup.mjs', backupPath], { cwd: root, env: { ...process.env, DATA_DIR: data }, encoding: 'utf8' })
    assert.notEqual(repeated.status, 0)
    assert.equal((await api(path, 'POST', { blockId: 'not-a-chapter' }, token)).status, 400)
    assert.equal((await api('/admin-api/system/status', 'GET', undefined, token)).status, 403)
    db = new DatabaseSync(join(data, 'mojing.sqlite'))
    db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run(new Date(Date.now() - 60000).toISOString(), createHash('sha256').update(token).digest('hex'))
    assert.equal((await api('/api/me', 'GET', undefined, token)).status, 401)
    const nextToken = (await api('/api/auth/dev-login', 'POST', {})).body.token
    const cold = (await api('/api/works/work_cold_command/chapters?limit=100')).body
    assert.ok(cold.total >= 12)
    const coldLatest = cold.items.at(-1)
    for (let index = 0; index < 5; index++) db.prepare('INSERT INTO story_assets(id,work_id,chapter_id,asset_type,title,asset_url,sort_order,paragraph_index) VALUES (?,?,?,?,?,?,?,?)')
      .run(`test-cold-art-${index}`, 'work_cold_command', coldLatest.id, 'scene', '隔离测试插图', `/test-${index}.webp`, index, index)
    const scenes = (await api('/api/works/work_cold_command/assets')).body.items.filter(item => item.id.startsWith('test-cold-art-'))
    assert.deepEqual(scenes.map(item => item.paragraphIndex), [0, 1, 2, 3, 4])
    assert.ok(scenes.every(item => item.chapterId === coldLatest.id))
    const coldDetail = (await api(`/api/chapters/${coldLatest.id}`)).body
    assert.equal(coldDetail.chapter.id, coldLatest.id)
    assert.ok(coldDetail.chapter.content.replace(/\s/g, '').length >= 2500)
    assert.equal(coldDetail.prev.id, cold.items.at(-2).id)
    const coldProgress = '/api/works/work_cold_command/reading-progress'
    assert.equal((await api(coldProgress, 'POST', { blockId: coldLatest.id, progress: 80, scrollRatio: .35 }, nextToken)).status, 200)
    const imagePath = '/api/characters/char_zhou/reference-images'
    assert.equal((await api(imagePath, 'POST', {}, nextToken)).status, 503)
    db.prepare("INSERT INTO generation_jobs(id,owner_id,job_type,status) VALUES ('test-job','u_1001','text_generation','running')").run()
    assert.equal((await api(imagePath, 'POST', {}, nextToken)).body.error.code, 'GENERATION_USER_CAPACITY')
    db.exec("UPDATE generation_jobs SET status='failed'; INSERT INTO generation_jobs(id,owner_id,job_type,status) VALUES ('test-job-2','u_1001','text_generation','failed')")
    assert.equal((await api(imagePath, 'POST', {}, nextToken)).body.error.code, 'GENERATION_LIMIT')
    db.exec("UPDATE generation_jobs SET owner_id='u_1004', status='running'")
    assert.equal((await api(imagePath, 'POST', {}, nextToken)).body.error.code, 'GENERATION_QUEUE_FULL')
    db.exec("UPDATE generation_jobs SET status='queued'")
    await server.close(); server = undefined
    db.close(); db = undefined
    server = await start(data)
    assert.equal((await server.api('/api/works/work_cold_command/assets')).body.items.filter(item => item.id.startsWith('test-cold-art-')).length, 5)
    const savedColdProgress = (await server.api('/api/works/work_cold_command/reading-progress', 'GET', undefined, nextToken)).body.progress
    assert.equal(savedColdProgress.block_id, coldLatest.id)
    assert.equal(savedColdProgress.scroll_ratio, .35)
    const durable = (await server.api(reviewPath)).body
    assert.equal(durable.items[0].id, durableReview.body.id)
    assert.equal(durable.items[0].likes, 1)
    db = new DatabaseSync(join(data, 'mojing.sqlite'))
    const jobs = db.prepare("SELECT status,error_code FROM generation_jobs WHERE id LIKE 'test-job%'").all()
    assert.ok(jobs.every(item => item.status === 'failed' && item.error_code === 'MODEL_NOT_AVAILABLE'))
    await server.close(); server = undefined
    db.close(); db = undefined
    server = await start(data, true)
    assert.equal((await server.api('/api/auth/dev-login', 'POST', {})).status, 404)
    assert.equal((await server.api('/api/auth/wechat', 'POST', {})).status, 400)
    const admin = await server.api('/admin-api/auth/login', 'POST', { account: 'admin@mojing.local', password: 'test-admin-password-strong' })
    assert.equal(admin.status, 200)
    const status = (await server.api('/admin-api/system/status', 'GET', undefined, admin.body.token)).body
    assert.equal(status.environment, 'production')
    assert.equal(status.devLoginEnabled, false)
    assert.equal(status.imageConfigured, false)
    const pending = await server.api(reviewPath, 'POST', { kind: 'discussion', content: '生产环境待审核内容', clientId: 'production-review-123' }, admin.body.token)
    assert.equal(pending.body.status, 'pending')
    assert.equal((await server.api(`${reviewPath}?kind=discussion`)).body.total, 0)
    assert.equal((await server.api('/admin-api/comments', 'GET', undefined, admin.body.token)).body.items[0].id, pending.body.id)
    assert.equal((await server.api(`/admin-api/comments/${pending.body.id}/approve`, 'POST', {}, admin.body.token)).status, 200)
    assert.equal((await server.api(`${reviewPath}?kind=discussion`)).body.total, 1)
  } finally {
    db?.close()
    if (server) await server.close()
    // Only the explicitly-created test directory is removed.
    rmSync(data, { recursive: true, force: true })
  }
})

test('work, version and text-job submission replay across restart without dispatching a provider', async () => {
  const data = mkdtempSync(join(tmpdir(), 'mojing-idempotency-http-')); let server; let db
  try {
    server = await start(data)
    const owner = (await server.api('/api/auth/dev-login', 'POST', { account: 'wechat:1001' })).body.token
    const admin = (await server.api('/admin-api/auth/login', 'POST', { account: 'admin@mojing.local', password: 'test-admin-password-strong' })).body.token
    assert.equal((await server.api('/admin-api/production', 'PATCH', { paused: true }, admin)).status, 200)
    const header = { 'Idempotency-Key': 'create_work_123456' }
    const input = { title: '幂等测试作品', summary: '测试' }
    const created = await server.api('/api/works', 'POST', input, owner, header)
    assert.equal(created.status, 201)
    const workId = created.body.work.id
    assert.equal((await server.api('/api/works', 'POST', input, owner, header)).body.work.id, workId)
    assert.equal((await server.api('/api/works', 'POST', { ...input, title: '更改' }, owner, header)).status, 409)
    assert.notEqual((await server.api('/api/works', 'POST', input, admin, header)).body.work.id, workId)
    assert.equal((await server.api(`/api/works/${workId}/reader-bootstrap`)).status, 404)
    assert.equal((await server.api(`/api/works/${workId}/reader-bootstrap`, 'GET', undefined, owner)).status, 200)
    assert.equal((await server.api(`/api/works/${workId}/reader-bootstrap?public=1`, 'GET', undefined, owner)).status, 404)
    await server.api(`/api/works/${workId}/blocks`, 'PUT', { items: [{ id: 'idempotency-block', content: '第一段正文' }] }, owner)
    const versionPath = `/api/works/${workId}/versions`, versionHeader = { 'Idempotency-Key': 'create_version_123456' }
    const version = await server.api(versionPath, 'POST', { label: 'test' }, owner, versionHeader)
    assert.equal((await server.api(versionPath, 'POST', { label: 'test' }, owner, versionHeader)).body.versionId, version.body.versionId)
    const model = await server.api('/admin-api/models', 'POST', { provider: 'compatible', kind: 'text', name: 'paused fake model', endpoint: 'https://provider.mojing.test/v1/chat/completions', model: 'test', apiKey: 'test-fake-key', enabled: true, isDefault: true }, admin)
    assert.equal(model.status, 201)
    const jobPath = `/api/works/${workId}/text-jobs`, jobHeader = { 'Idempotency-Key': 'text_job_123456' }
    const job = await server.api(jobPath, 'POST', { action: 'outline' }, owner, jobHeader)
    assert.equal(job.status, 202)
    assert.equal((await server.api(jobPath, 'POST', { action: 'outline' }, owner, jobHeader)).body.jobId, job.body.jobId)
    await server.close(); server = await start(data)
    assert.equal((await server.api('/api/works', 'POST', input, owner, header)).body.work.id, workId)
    assert.equal((await server.api(jobPath, 'POST', { action: 'outline' }, owner, jobHeader)).body.jobId, job.body.jobId)
    db = new DatabaseSync(join(data, 'mojing.sqlite'), { readOnly: true })
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM generation_jobs WHERE work_id = ?').get(workId).n, 1)
    assert.equal(db.prepare('SELECT status FROM generation_jobs WHERE id = ?').get(job.body.jobId).status, 'queued')
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM story_versions WHERE work_id = ?').get(workId).n, 1)
  } finally { db?.close(); if (server) await server.close(); rmSync(data, { recursive: true, force: true }) }
})

test('storage API restricts permissions, encrypts credentials and persists blank-key updates', async () => {
  const data = mkdtempSync(join(tmpdir(), 'mojing-storage-api-')); let server; let db
  try {
    server = await start(data)
    const admin = (await server.api('/admin-api/auth/login','POST',{ account:'admin@mojing.local', password:'test-admin-password-strong' })).body.token
    const user = (await server.api('/api/auth/dev-login','POST',{ account:'wechat:1001' })).body.token
    assert.equal((await server.api('/admin-api/storage')).status, 401)
    assert.equal((await server.api('/admin-api/storage','GET',undefined,user)).status, 403)
    assert.equal((await server.api('/admin-api/storage','PUT',{},user)).status, 403)
    assert.equal((await server.api('/admin-api/storage/test','POST',{},user)).status, 403)
    const input = { endpoint:'https://storage.vendor.test', region:'us-east-1', bucket:'comic-media', prefix:'mojing/', forcePathStyle:true, enabled:true, accessKeyId:'test-access-id', secretAccessKey:'unique-test-storage-secret' }
    const saved = await server.api('/admin-api/storage','PUT',input,admin)
    assert.equal(saved.status,200); assert.equal(saved.body.config.credentialsConfigured,true)
    assert.ok(!JSON.stringify(saved.body).includes(input.secretAccessKey))
    assert.equal((await server.api('/admin-api/storage','PUT',{ secretAccessKey:'', prefix:'new/' },admin)).status,200)
    db = new DatabaseSync(join(data,'mojing.sqlite'))
    assert.ok(!db.prepare('SELECT encrypted_credentials FROM object_storage_config').get().encrypted_credentials.includes(input.secretAccessKey))
    assert.ok(!JSON.stringify(db.prepare("SELECT * FROM audit_logs WHERE target_type='object_storage'").all()).includes(input.secretAccessKey))
    db.close(); db = null
    await server.close(); server = await start(data)
    const freshAdmin = (await server.api('/admin-api/auth/login','POST',{ account:'admin@mojing.local', password:'test-admin-password-strong' })).body.token
    const config = (await server.api('/admin-api/storage','GET',undefined,freshAdmin)).body.config
    assert.equal(config.credentialsConfigured,true); assert.equal(config.prefix,'new/')
  } finally { db?.close(); if (server) await server.close(); rmSync(data,{ recursive:true,force:true }) }
})

test('model API accepts multiple image models per provider, editable endpoints and fallback priorities', async () => {
  const data = mkdtempSync(join(tmpdir(), 'mojing-model-api-test-'))
  let server
  try {
    server = await start(data)
    const { api } = server
    const login = await api('/admin-api/auth/login', 'POST', { account:'admin@mojing.local', password:'test-admin-password-strong' })
    assert.equal(login.status, 200)
    const token = login.body.token
    const base = { provider:'compatible', kind:'image', apiKey:'isolated-fake-key', enabled:false, isDefault:false }
    const primary = await api('/admin-api/models', 'POST', { ...base, name:'First image model', model:'image-custom-one', endpoint:'https://images-one.example/v1/images/generations', priority:20 }, token)
    assert.equal(primary.status, 201)
    const backup = await api('/admin-api/models', 'POST', { ...base, name:'Second image model', model:'image-custom-two', endpoint:'https://images-two.example/v1/images/generations', priority:10 }, token)
    assert.equal(backup.status, 201)
    assert.notEqual(primary.body.model.id, backup.body.model.id)
    const edited = await api(`/admin-api/models/${primary.body.model.id}`, 'PUT', { model:'image-custom-three', endpoint:'https://images-three.example/v1/images/generations', priority:5 }, token)
    assert.equal(edited.status, 200)
    assert.equal(edited.body.model.model, 'image-custom-three')
    assert.equal(edited.body.model.endpoint, 'https://images-three.example/v1/images/generations')
    assert.equal(edited.body.model.priority, 5)
    const listing = await api('/admin-api/models', 'GET', undefined, token)
    const images = listing.body.items.filter(model => model.provider === 'compatible')
    assert.deepEqual(images.map(model => model.id), [primary.body.model.id, backup.body.model.id])
    assert.ok(images.every(model => !('apiKey' in model) && !('encrypted_key' in model)))
    for (const endpoint of ['http://images-three.example/v1/images/generations', 'https://127.0.0.1/v1/images/generations', 'https://images-three.example/v1/chat/completions']) {
      assert.equal((await api(`/admin-api/models/${primary.body.model.id}`, 'PUT', { endpoint }, token)).status, 400)
    }
    await server.close(); server = undefined
    server = await start(data)
    const persisted = (await server.api('/admin-api/models', 'GET', undefined, token)).body.items.filter(model => model.provider === 'compatible')
    assert.equal(persisted.length, 2)
    assert.equal(persisted[0].model, 'image-custom-three')
    assert.equal(persisted[0].priority, 5)
  } finally {
    if (server) await server.close()
    rmSync(data, { recursive:true, force:true })
  }
})
