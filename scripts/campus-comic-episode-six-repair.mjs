import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { readEnvFile } from '../server/src/config.mjs'
import { acquireLock } from './campus-comic-lock.mjs'

const root = resolve(import.meta.dirname, '..')
const output = join(root, 'artifacts/campus-rebirth-comic')
const releaseAdvance = acquireLock(join(output, '.advance.lock'))
process.once('exit', releaseAdvance)
const releaseProducer = acquireLock(join(output, '.producer.lock'))
const state = JSON.parse(readFileSync(join(output, 'state.json'), 'utf8'))
const env = { ...readEnvFile(join(root, 'server/.env')), ...process.env }
assert.equal(state.apiBase, 'http://127.0.0.1:3014')
const login = await fetch(`${state.apiBase}/admin-api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ account: 'admin@mojing.local', password: env.DEV_ADMIN_PASSWORD || 'mojing-dev-only' }) })
assert.ok(login.ok, `LOGIN_${login.status}`)
const { token } = await login.json()
async function api(path, method = 'GET', input) {
  const response = await fetch(`${state.apiBase}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(input ? { body: JSON.stringify(input) } : {}) })
  assert.ok(response.ok, `HTTP_${response.status}`)
  return response.json()
}
assert.ok(!(await api('/admin-api/production')).jobs.some(j => ['queued', 'running'].includes(j.status)), 'ACTIVE_JOBS')
const configuredModels = (await api('/admin-api/models')).items
const imageModel = configuredModels.find(model => model.kind === 'image' && model.model === 'gpt-image-2' && model.endpoint === 'https://api.tu-zi.com/coding/images/generations')
assert.ok(imageModel, 'IMAGE_MODEL_CONFIG_INVALID')
console.log(JSON.stringify({ model: imageModel.model, endpoint: imageModel.endpoint, credentialConfigured: true }))
const episode = state.episodes.find(e => e.number === 6)
assert.ok(episode && !episode.published && !episode.visualApproved)
const path = `/admin-api/comics/${episode.episodeId}`
const { episode: draft } = await api(path)
assert.ok(!(await api(`${path}/jobs`)).items.some(j => ['queued', 'running'].includes(j.status)), 'ACTIVE_JOBS')
const panels = draft.panels.map(p => ({ ...p, approved: false }))
const noBag = '陆澈不背包，背后没有包，双肩和胸前没有任何背包肩带。办公处桌面干燥，门窗外有雨痕，室内没有雨丝或积水。'
for (const number of [2, 3, 5, 6]) {
  if (!panels[number - 1].prompt.includes(noBag)) panels[number - 1].prompt += noBag
}
panels[3].dialogue = '知雨：组照另放，不占名额。沈遥：署名分开。陈屿：我重做。'
panels[4].dialogue = '老师：先验门，再登记。陆澈：请归档。'
panels[4].narration = '获批两周，每日16—18时仅用门边干燥区，每次两人。'
panels[5].prompt = panels[5].prompt.replace('显出淡淡铅笔痕和撕去一半的姓名，纸上不画文字', '显出不可辨认的淡淡铅笔线，纸张右侧有明显撕口，字迹轮廓在撕口处截断；纸上绝无人像、头像或剪影，不生成可读文字')
panels[5].narration = '学生签字仅代表申请，不代表最终同意。旁边姓名被撕去一半。'
if (JSON.stringify(panels) !== JSON.stringify(draft.panels)) await api(path, 'PUT', { version: draft.version, panels })
writeFileSync(join(output, 'episode-6/repair-request.json'), JSON.stringify({ at: new Date().toISOString(), panels: [2, 3, 5, 6], corrections: ['Remove unrequested backpacks', 'Dry office surfaces', 'Restore photo entry allocation and safety conditions', 'Restore torn written clue without portrait'] }, null, 2))
releaseProducer()
const result = spawnSync(process.execPath, [join(root, 'scripts/campus-comic-production.mjs'), '--episode=6', '--regenerate-panels=2,3,5,6'], { cwd: root, windowsHide: true, encoding: 'utf8', timeout: 180000 })
assert.equal(result.status, 0, 'REGENERATION_SUBMISSION_FAILED')
console.log(JSON.stringify({ episode: 6, status: 'repair_submitted', panels: [2, 3, 5, 6] }))
