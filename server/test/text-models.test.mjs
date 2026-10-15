import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'

const root = resolve(import.meta.dirname, '..')
async function start(data, timeoutMs = '150000') {
  const calls = []
  const deadlines = []; const tokens = []
  const child = spawn(process.execPath, ['--import', pathToFileURL(join(root, 'test/fixtures/text-provider.mjs')).href, 'src/server.mjs'], {
    cwd: root, env: { ...process.env, NODE_ENV: 'test', PORT: '0', HOST: '127.0.0.1', DATA_DIR: data, ALLOW_DEV_AUTH: '1', TUZI_CODING_API_KEY: '', TEXT_REQUEST_TIMEOUT_MS: timeoutMs,
      DEV_ADMIN_PASSWORD: 'test-admin-password-strong', MODEL_CONFIG_ENCRYPTION_KEY: 'test-encryption-secret-separate-32chars', MAX_GENERATION_JOBS_PER_DAY: '200', MAX_ACTIVE_GENERATION_JOBS_PER_USER: '200' },
    stdio: ['ignore','pipe','pipe'],
  })
  const base = await new Promise((resolveBase,reject) => {
    let output = ''; let errors = ''
    const timer = setTimeout(() => { child.kill(); reject(new Error(`Startup timed out: ${errors}`)) }, 15000)
    child.stderr.on('data', chunk => { errors += chunk })
    child.stdout.on('data', chunk => {
      output += chunk
      for (const match of chunk.toString().matchAll(/MOCK_MODEL:([^\r\n]+)/g)) calls.push(match[1])
      for (const match of chunk.toString().matchAll(/MOCK_DEADLINE:(\d+)/g)) deadlines.push(Number(match[1]))
      for (const match of chunk.toString().matchAll(/MOCK_MAX_TOKENS:(\d+)/g)) tokens.push(Number(match[1]))
      const ready = output.match(/listening on (http:\/\/[^\s]+)/)
      if (ready) { clearTimeout(timer); resolveBase(ready[1]) }
    })
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited ${code}: ${errors}`)) })
  })
  return { calls, deadlines, tokens, api: async (path,method='GET',body,token) => {
    const response = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: response.status, body: await response.json() }
  }, close: async () => { const ended = once(child,'exit'); child.kill(); await ended } }
}

async function finished(api,id,token) {
  for (let i=0; i<100; i++) {
    const response = await api(`/api/jobs/${id}`,'GET',undefined,token)
    if (!['queued','running'].includes(response.body.job.status)) return response.body.job
    await new Promise(resolve => setTimeout(resolve,20))
  }
  throw new Error('Mock job did not finish')
}

test('text model API, frozen fallback/review, retained candidates, unknown billing and version invalidation', async () => {
  const data = mkdtempSync(join(tmpdir(),'mojing-text-test-')); let server; let db
  try {
    server = await start(data); const { api } = server
    const owner = (await api('/api/auth/dev-login','POST',{ account: 'wechat:1001' })).body.token
    const admin = (await api('/admin-api/auth/login','POST',{ account: 'admin@mojing.local', password: 'test-admin-password-strong' })).body.token
    const add = async (model,textRole,priority,flags={}) => {
      const response = await api('/admin-api/models','POST',{ name: model, provider: 'mock', kind: 'text', endpoint: 'https://models.example.test/v1/chat/completions', model, apiKey: 'fake-test-key', textRole, priority, isDefault: false, ...flags },admin)
      assert.equal(response.status,201,JSON.stringify(response.body)); return response.body.model.id
    }
    const primary = await add('gen-503','generation',10,{ isDefault: true })
    const backup = await add('gen-good','generation',20)
    const extra = await add('gen-extra','generation',30)
    const reviewPrimary = await add('review-503','reviewer',1,{ reviewDefault: true })
    const reviewBackup = await add('review-good','reviewer',2)
    assert.equal((await api(`/admin-api/models/${primary}`,'PUT',{ enabled: 'false' },admin)).status,400)
    assert.equal((await api(`/admin-api/models/${reviewPrimary}`,'PUT',{ isDefault: true },admin)).body.model.isDefault,false)
    assert.equal((await api(`/admin-api/models/${primary}`,'PUT',{ reviewDefault: true },admin)).body.model.reviewDefault,false)
    assert.equal((await api('/admin-api/system/status','GET',undefined,admin)).body.reviewConfigured,true)

    const workId = (await api('/api/works','POST',{ title: '独立审查测试', summary: '守夜人的信' },owner)).body.work.id
    const blocksPath = `/api/works/${workId}/blocks`
    const source = '雨夜里，他走到灯塔门前。'
    await api(blocksPath,'PUT',{ items: [{ id: 'text-block', content: source }] },owner)
    const create = async (modelId) => {
      const response = await api(`/api/works/${workId}/text-jobs`,'POST',{ action: 'continue', context: source, selected: source, maxTokens: 2200, ...(modelId ? { modelId } : {}) },owner)
      assert.equal(response.status,202,JSON.stringify(response.body)); return response.body.jobId
    }
    await api('/admin-api/production','PATCH',{ paused: true },admin)
    const firstId = await create()
    await api(`/admin-api/models/${backup}`,'PUT',{ model: 'gen-timeout' },admin)
    await api(`/admin-api/models/${reviewBackup}`,'PUT',{ model: 'review-invalid' },admin)
    await api('/admin-api/production','PATCH',{ paused: false },admin)
    const first = await finished(api,firstId,owner)
    assert.equal(first.status,'success')
    assert.equal(first.result.review.status,'success')
    assert.equal(first.result.review.score,7)
    assert.equal(first.result.review.issues[0].location,'候选第 1 段')
    assert.deepEqual(first.result.attempts.map(a=>a.modelId),[primary,backup])
    assert.deepEqual(first.result.review.attempts.map(a=>a.modelId),[reviewPrimary,reviewBackup])
    assert.equal(first.result.review.candidateHash,createHash('sha256').update(first.result.content).digest('hex'))
    assert.equal((await api(blocksPath,'GET',undefined,owner)).body.items[0].content,source)
    assert.deepEqual(server.calls,['gen-503','gen-good','review-503','review-good'])
    assert.deepEqual(server.deadlines, [150000,150000,150000,150000])
    assert.deepEqual(server.tokens, [2200,2200,3000,3000])
    for (const maxTokens of [0,127,3001,'2200',1.5]) assert.equal((await api(`/api/works/${workId}/text-jobs`,'POST',{ action:'outline',maxTokens },owner)).status,400)
    db = new DatabaseSync(join(data,'mojing.sqlite'))
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM text_generation_reviews WHERE job_id=?').get(firstId).n,1)
    assert.ok(!JSON.stringify(first.result).includes('fake-test-key'))

    await api(blocksPath,'PUT',{ items: [{ id: 'text-block', content: `${source}他敲响了门。` }] },owner)
    assert.equal((await api(`/api/jobs/${firstId}`,'GET',undefined,owner)).body.job.result.review.status,'stale')
    assert.equal((await api(`/api/works/${workId}/jobs`,'GET',undefined,owner)).body.items.find(j=>j.id===firstId).result.review.stale,true)
    assert.equal((await api('/admin-api/production','GET',undefined,admin)).body.jobs.find(j=>j.id===firstId).result.review.status,'stale')

    const unknownGeneration = await finished(api,await create(),owner)
    assert.equal(unknownGeneration.status,'failed')
    assert.equal(unknownGeneration.errorCode,'PROVIDER_TIMEOUT')
    assert.equal(unknownGeneration.result.attempts.length,2)
    assert.equal(unknownGeneration.result.attempts[1].resultUnknown,true)
    assert.ok(!server.calls.includes('gen-extra'))

    const badReview = await finished(api,await create(extra),owner)
    assert.equal(badReview.status,'success')
    assert.equal(badReview.result.review.status,'failed')
    assert.ok(badReview.result.content)
    assert.equal(badReview.result.attempts.length,1)
    assert.equal(badReview.result.review.attempts[1].errorCode,'PROVIDER_INVALID_REVIEW')

    await api(`/admin-api/models/${reviewBackup}`,'PUT',{ model: 'review-timeout', reviewDefault: true },admin)
    const unknownReview = await finished(api,await create(extra),owner)
    assert.equal(unknownReview.status,'success')
    assert.equal(unknownReview.result.review.status,'unknown')
    assert.equal(unknownReview.result.review.attempts.length,1)
    assert.ok(unknownReview.result.content)

    await api(`/admin-api/models/${reviewPrimary}`,'PUT',{ enabled: false },admin)
    await api(`/admin-api/models/${reviewBackup}`,'PUT',{ enabled: false },admin)
    const noReview = await finished(api,await create(extra),owner)
    assert.equal(noReview.status,'success'); assert.equal(noReview.result.review.status,'unconfigured')

    await api(`/admin-api/models/${reviewBackup}`,'PUT',{ enabled: true, model: 'review-hold' },admin)
    const holdingId = await create(extra)
    let candidate
    for (let i=0;i<100;i++) {
      candidate = (await api(`/api/jobs/${holdingId}`,'GET',undefined,owner)).body.job
      if (candidate.result?.content) break
      await new Promise(resolve=>setTimeout(resolve,5))
    }
    assert.equal(candidate.status,'running'); assert.ok(candidate.result.content)
    await api(blocksPath,'PUT',{ items: [{ id: 'text-block', content: '全新正文' }] },owner)
    const stale = await finished(api,holdingId,owner)
    assert.equal(stale.result.review.status,'stale'); assert.ok(stale.result.content)
    assert.equal((await api(blocksPath,'GET',undefined,owner)).body.items[0].content,'全新正文')

    // A report with a mismatched hash must not be adopted, even with identical source text.
    const txt = Buffer.from('第1章 灯塔\n他推开门。').toString('base64')
    const preview = (await api('/admin-api/imports/preview','POST',{ fileName: 'review.txt', base64: txt },admin)).body
    const imported = (await api('/admin-api/imports','POST',{ fileName: 'review.txt', base64: txt, sourceHash: preview.sourceHash, title: '导入审查测试', author: '测试', rightsConfirmed: true, rightsNote: '测试授权' },admin)).body.import
    const chapter = (await api(`/admin-api/imports/${imported.work.id}`,'GET',undefined,admin)).body.chapters[0]
    const original = db.prepare('SELECT content FROM story_chapters WHERE id=?').get(chapter.id).content
    db.prepare("INSERT INTO chapter_revisions(id,work_id,chapter_id,source_content,suggested_content,source_hash,status) VALUES ('hash-conflict',?,?,?,?,?,'suggested')").run(imported.work.id,chapter.id,original,'不同建议','incorrect-hash')
    assert.equal((await api(`/admin-api/imports/${imported.work.id}/revisions/hash-conflict/apply`,'POST',{},admin)).body.error.code,'REVISION_CONFLICT')
    assert.equal((await api(`/admin-api/imports/${imported.work.id}/chapters/${chapter.id}`,'GET',undefined,admin)).body.chapter.revision.stale,true)
    const importedJob = (await api(`/api/works/${imported.work.id}/text-jobs`,'POST',{ action:'continue',context:original,modelId:extra },admin)).body.jobId
    const importedCandidate = await finished(api,importedJob,admin)
    assert.equal(importedCandidate.result.review.stale,false)
    await api(`/admin-api/imports/${imported.work.id}/chapters/${chapter.id}`,'PUT',{ title:chapter.title,sourceContent:original,content:`${original}灯又亮了。` },admin)
    assert.equal((await api(`/api/jobs/${importedJob}`,'GET',undefined,admin)).body.job.result.review.status,'stale')
  } finally { db?.close(); if (server) await server.close(); rmSync(data,{ recursive:true,force:true }) }
})

test('configured real abort signal terminates slow text once and never calls a fallback', async () => {
  const data = mkdtempSync(join(tmpdir(),'mojing-deadline-test-')); let server
  try {
    server = await start(data, '1000'); const { api } = server
    const admin = (await api('/admin-api/auth/login','POST',{ account:'admin@mojing.local',password:'test-admin-password-strong' })).body.token
    for (const [model, isDefault] of [['gen-deadline',true],['gen-good',false]]) {
      assert.equal((await api('/admin-api/models','POST',{ name:model,provider:'mock',kind:'text',endpoint:'https://models.example.test/v1/chat/completions',model,apiKey:'fake-key',textRole:'generation',isDefault },admin)).status,201)
    }
    const workId = (await api('/api/works','POST',{ title:'timeout regression' },admin)).body.work.id
    const submitted = await api(`/api/works/${workId}/text-jobs`,'POST',{ action:'outline',maxTokens:2200 },admin)
    const job = await finished(api,submitted.body.jobId,admin)
    assert.equal(job.status,'failed'); assert.equal(job.errorCode,'PROVIDER_TIMEOUT')
    assert.equal(job.result.attempts.length,1); assert.equal(job.result.attempts[0].resultUnknown,true)
    assert.deepEqual(server.calls,['gen-deadline']); assert.deepEqual(server.deadlines,[1000])
  } finally { if (server) await server.close(); rmSync(data,{recursive:true,force:true}) }
})
