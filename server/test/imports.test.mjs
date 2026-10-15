import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'

const root = resolve(import.meta.dirname, '..')
async function start(data) {
  const child = spawn(process.execPath, ['--experimental-sqlite', 'src/server.mjs'], { cwd: root, env: { ...process.env, PORT: '0', HOST: '127.0.0.1', DATA_DIR: data, NODE_ENV: 'test', ALLOW_DEV_AUTH: '1', TRUST_PROXY: '0', TUZI_CODING_API_KEY: '', TUZI_IMAGE_ENDPOINT: '', DEV_ADMIN_PASSWORD: 'test-admin-password-strong', MODEL_CONFIG_ENCRYPTION_KEY: 'test-encryption-secret-separate-32chars', WECHAT_APPID: 'wx1234567890abcdef', WECHAT_SECRET: 'test-not-real', CORS_ORIGIN: 'https://admin.mojing.test' }, stdio: ['ignore', 'pipe', 'pipe'] })
  const base = await new Promise((resolveBase, reject) => {
    let output = ''; let errors = ''
    const timer = setTimeout(() => { child.kill(); reject(new Error(`startup timeout: ${errors}`)) }, 15000)
    child.stderr.on('data', chunk => { errors += chunk })
    child.stdout.on('data', chunk => { output += chunk; const match = output.match(/listening on (http:\/\/[^\s]+)/); if (match) { clearTimeout(timer); resolveBase(match[1]) } })
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`API exited: ${code}: ${errors}`)) })
  })
  async function api(path, method = 'GET', body, token) {
    const response = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: response.status, body: await response.json() }
  }
  return { api, close: async () => { const ended = once(child, 'exit'); child.kill(); await ended } }
}

test('TXT import keeps source, requires chapter checks, and publishes readable chapters', async () => {
  const data = mkdtempSync(join(tmpdir(), 'mojing-import-test-')); let server
  try {
    server = await start(data)
    const login = async account => (await server.api('/api/auth/dev-login', 'POST', { account })).body.token
    const reviewer = await login('shen@mojing.local'); const admin = await login('admin@mojing.local')
    const source = '序章\n雾从城门压下来。\n\n第1章 入城\n他握紧刀柄。\n\n第2章 夜查\n灯火在雨里摇晃。'
    const base64 = Buffer.from(source).toString('base64')
    const preview = await server.api('/admin-api/imports/preview', 'POST', { fileName: 'sample.txt', base64, encoding: 'auto' }, reviewer)
    assert.equal(preview.status, 200); assert.equal(preview.body.totalChapters, 3); assert.ok(preview.body.sourceHash)
    const denied = await server.api('/admin-api/imports', 'POST', { fileName: 'sample.txt', base64, sourceHash: preview.body.sourceHash, title: '未授权', rightsConfirmed: false }, reviewer)
    assert.equal(denied.status, 400)
    const imported = await server.api('/admin-api/imports', 'POST', { fileName: 'sample.txt', base64, sourceHash: preview.body.sourceHash, title: '雾城夜行', author: '测试作者', summary: '导入测试', rightsConfirmed: true, rightsNote: '作者本人授权' }, reviewer)
    assert.equal(imported.status, 201); const workId = imported.body.import.work.id
    assert.equal(imported.body.import.chapterCount, 3); assert.equal((await server.api('/admin-api/imports', 'GET', undefined, reviewer)).body.items[0].chapterCount, 3)
    const detail = await server.api(`/admin-api/imports/${workId}?limit=10`, 'GET', undefined, reviewer)
    assert.equal(detail.status, 200); assert.equal(detail.body.chapters.length, 3); assert.equal(detail.body.checked, 0)
    for (const item of detail.body.chapters) assert.equal((await server.api(`/admin-api/imports/${workId}/chapters/${item.id}/check`, 'POST', {}, reviewer)).status, 200)
    assert.equal((await server.api(`/admin-api/imports/${workId}/submit-review`, 'POST', {}, reviewer)).status, 202)
    assert.equal((await server.api('/admin-api/moderation/queue', 'GET', undefined, admin)).body.items.some(item => item.work.id === workId), true)
    assert.equal((await server.api(`/admin-api/moderation/${workId}/approve`, 'POST', {}, admin)).status, 200)
    const publicChapters = await server.api(`/api/works/${workId}/chapters?limit=10`)
    assert.equal(publicChapters.status, 200); assert.equal(publicChapters.body.total, 3)
    const chapter = await server.api(`/api/chapters/${publicChapters.body.items[1].id}`)
    assert.equal(chapter.status, 200); assert.match(chapter.body.chapter.content, /握紧刀柄/)
  } finally { if (server) await server.close(); rmSync(data, { recursive: true, force: true }) }
})
