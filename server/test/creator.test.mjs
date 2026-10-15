import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'

const root = resolve(import.meta.dirname, '..')
async function start(data) {
  const child = spawn(process.execPath, ['--experimental-sqlite', 'src/server.mjs'], { cwd: root, env: { ...process.env, PORT: '0', HOST: '127.0.0.1', DATA_DIR: data, NODE_ENV: 'test', ALLOW_DEV_AUTH: '1', TUZI_CODING_API_KEY: '', DEV_ADMIN_PASSWORD: 'test-admin-password-strong', MODEL_CONFIG_ENCRYPTION_KEY: 'test-encryption-secret-separate-32chars' }, stdio: ['ignore', 'pipe', 'pipe'] })
  const base = await new Promise((resolve, reject) => {
    let output = ''; let errors = ''
    child.stderr.on('data', chunk => { errors += chunk })
    const timer = setTimeout(() => { child.kill(); reject(new Error('API startup timeout')) }, 15000)
    child.stdout.on('data', chunk => { output += chunk; const match = output.match(/listening on (http:\/\/[^\s]+)/); if (match) { clearTimeout(timer); resolve(match[1]) } })
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`API exited: ${code}: ${errors}`)) })
  })
  const api = async (path, method = 'GET', data, token) => {
    const response = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: data === undefined ? undefined : JSON.stringify(data) })
    return { status: response.status, body: method === 'GET' && path.startsWith('/api/assets/') ? new Uint8Array(await response.arrayBuffer()) : await response.json() }
  }
  return { api, child, close: async () => { const ended = once(child, 'exit'); child.kill(); await ended } }
}

test('creator settings, scoped blocks, and illustration review/publication gates', async () => {
  const data = mkdtempSync(join(tmpdir(), 'mojing-creator-test-'))
  let server; let db
  try {
    server = await start(data)
    const { api } = server
    const owner = (await api('/api/auth/dev-login', 'POST', { account: 'wechat:1001' })).body.token
    const reviewer = (await api('/admin-api/auth/login', 'POST', { account: 'admin@mojing.local', password: 'test-admin-password-strong' })).body.token
    const status = await api('/api/creator/status', 'GET', undefined, owner)
    assert.equal(status.status, 200)
    assert.equal(status.body.imageReady, false)
    assert.equal(status.body.imageModel, 'gpt-image-2')
    assert.equal(status.body.textReady, false)

    const created = await api('/api/works', 'POST', { title: '隔离测试作品', summary: '接口测试正文' }, owner)
    const workId = created.body.work.id
    const settingsPath = `/api/works/${workId}/creative-settings`
    assert.equal((await api(settingsPath, 'PUT', { illustrationsEnabled: 'false' }, owner)).status, 400)
    assert.equal((await api(settingsPath, 'PUT', { illustrationsEnabled: false, visualStyle: '克制写实' }, owner)).status, 200)
    assert.equal((await api(settingsPath, 'GET', undefined, owner)).body.settings.illustrationsEnabled, false)
    assert.equal((await api(`/api/works/${workId}/image-jobs`, 'POST', { kind: 'scene', blockId: 'missing', prompt: 'test', confirmCost: true }, owner)).status, 409)

    const firstId = 'creator-test-block'
    assert.equal((await api(`/api/works/${workId}/blocks`, 'PUT', { items: [{ id: firstId, content: '风雪夜里，守门人看见城墙上亮起了第二盏灯。' }] }, owner)).status, 200)
    const other = await api('/api/works', 'POST', { title: '另一本测试作品' }, owner)
    assert.equal((await api(`/api/works/${other.body.work.id}/blocks`, 'PUT', { items: [{ id: firstId, content: '跨作品覆盖' }] }, owner)).status, 403)
    assert.equal((await api(`/api/works/${workId}/image-jobs`, 'POST', { kind: 'scene', blockId: firstId, prompt: '风雪夜守门场景', confirmCost: true }, owner)).status, 409)
    assert.equal((await api(`/api/works/${workId}/image-jobs`, 'POST', { kind: 'scene', blockId: firstId, prompt: '风雪夜守门场景', confirmCost: false }, owner)).status, 400)
    await api(settingsPath, 'PUT', { illustrationsEnabled: true }, owner)
    assert.equal((await api(`/api/works/${workId}/image-jobs`, 'POST', { kind: 'scene', blockId: 'missing', prompt: 'test', confirmCost: true }, owner)).status, 400)
    assert.equal((await api(`/api/works/${workId}/image-jobs`, 'POST', { kind: 'scene', blockId: firstId, prompt: 'test', confirmCost: true }, owner)).status, 503)
    assert.equal((await api(`/api/works/${workId}/text-jobs`, 'POST', { action: 'outline' }, owner)).status, 503)
    const blocksPath = `/api/works/${workId}/blocks`
    assert.equal((await api(blocksPath, 'PUT', { items: [{ id: firstId, content: '重复' }, { id: firstId, content: '重复' }] }, owner)).status, 400)

    db = new DatabaseSync(join(data, 'mojing.sqlite'))
    db.exec('PRAGMA foreign_keys = ON')
    const jobId = 'creator-test-image-job'; const mediaId = 'creator-test-image'; const assetId = 'creator-test-asset'
    const original = '风雪夜里，守门人看见城墙上亮起了第二盏灯。'
    const imagePlan = { kind: 'scene', blockId: firstId, sourceHash: createHash('sha256').update(original).digest('hex'), materialKey: `${workId}:scene:${firstId}` }
    db.prepare("INSERT INTO generation_jobs(id, owner_id, work_id, job_type, status, request_json) VALUES (?, 'u_1001', ?, 'creator_image', 'success', ?)").run(jobId, workId, JSON.stringify(imagePlan))
    db.prepare("INSERT INTO imported_media(id, work_id, job_id, kind, prompt, original, original_mime, webp, approved) VALUES (?, ?, ?, 'scene', 'test', X'010203', 'image/png', X'040506', 0)").run(mediaId, workId, jobId)
    db.prepare("INSERT INTO story_assets(id, work_id, asset_type, title, asset_url, approval_status, block_id) VALUES (?, ?, 'scene', '测试插图', ?, 'pending', ?)").run(assetId, workId, `/api/assets/${mediaId}`, firstId)
    assert.equal((await api(`/api/assets/${mediaId}`)).status, 404)
    assert.equal((await api(`/api/assets/${mediaId}`, 'GET', undefined, owner)).status, 200)
    assert.equal((await api(`/admin-api/works/${workId}/assets`, 'GET', undefined, reviewer)).body.items[0].blockId, firstId)
    assert.equal((await api(`/api/works/${workId}/image-jobs`, 'POST', { kind: 'scene', blockId: firstId, prompt: 'test', confirmCost: true }, owner)).body.error.code, 'MATERIAL_ALREADY_REQUESTED')
    assert.equal((await api(`/admin-api/moderation/${workId}/approve`, 'POST', {}, reviewer)).body.error.code, 'IMAGE_REVIEW_REQUIRED')

    assert.equal((await api(`/api/works/${workId}/assets/${assetId}/approve`, 'POST', {}, owner)).status, 403)
    assert.equal((await api(`/api/works/${workId}/assets/${assetId}/approve`, 'POST', {}, reviewer)).status, 200)
    assert.equal((await api(blocksPath, 'PUT', { items: [{ id: firstId, content: original + '灯下走出一个人。' }] }, owner)).status, 200)
    assert.equal(db.prepare('SELECT approved FROM imported_media WHERE id = ?').get(mediaId).approved, 0)
    assert.equal((await api(`/api/works/${workId}/assets/${assetId}/approve`, 'POST', {}, reviewer)).body.error.code, 'IMAGE_TEXT_CHANGED')
    await api(blocksPath, 'PUT', { items: [{ id: firstId, content: original }] }, owner)
    await api(`/api/works/${workId}/assets/${assetId}/approve`, 'POST', {}, reviewer)
    db.prepare('UPDATE content_blocks SET locked = 1 WHERE id = ?').run(firstId)
    assert.equal((await api(blocksPath, 'PUT', { items: [] }, owner)).status, 409)
    assert.equal((await api(blocksPath, 'PUT', { items: [{ id: firstId, content: '改锁定正文' }] }, owner)).status, 409)
    db.prepare('UPDATE content_blocks SET locked = 0 WHERE id = ?').run(firstId)
    const publishedAsset = await api(`/api/assets/${mediaId}`)
    assert.equal(publishedAsset.status, 404)
    db.prepare("UPDATE works SET status = 'published' WHERE id = ?").run(workId)
    assert.equal((await api(`/api/assets/${mediaId}`)).status, 200)
    assert.equal((await api(settingsPath, 'PUT', { world: '修改' }, owner)).status, 409)
    assert.equal((await api(blocksPath, 'PUT', { items: [] }, owner)).status, 409)
    assert.equal((await api(`/api/assets/${mediaId}/original`)).status, 404)
    db.prepare('DELETE FROM content_blocks WHERE id = ?').run(firstId)
    assert.equal((await api(`/api/assets/${mediaId}`)).status, 404)
    assert.equal((await api(`/api/works/${workId}/assets/${assetId}/approve`, 'POST', {}, reviewer)).status, 409)
  } finally {
    db?.close()
    if (server) await server.close()
    rmSync(data, { recursive: true, force: true })
  }
})
