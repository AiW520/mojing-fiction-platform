import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { readEnvFile } from '../server/src/config.mjs'
import { acquireLock } from './campus-comic-lock.mjs'

const root = resolve(import.meta.dirname, '..')
const output = join(root, 'artifacts/campus-rebirth-comic')
const releaseAdvance = acquireLock(join(output, '.advance.lock'))
const releaseProducer = acquireLock(join(output, '.producer.lock'))
process.once('exit', () => { releaseProducer(); releaseAdvance() })
const stateFile = join(output, 'state.json')
const state = JSON.parse(readFileSync(stateFile, 'utf8'))
const episodeState = state.episodes.find(e => e.number === 7)
assert.ok(episodeState?.published && episodeState.visualApproved)
const env = { ...readEnvFile(join(root, 'server/.env')), ...process.env }
const login = await fetch(`${state.apiBase}/admin-api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ account: 'admin@mojing.local', password: env.DEV_ADMIN_PASSWORD || 'mojing-dev-only' }) })
assert.ok(login.ok, `LOGIN_${login.status}`)
const { token } = await login.json()
async function api(path, method = 'GET', input) {
  const response = await fetch(`${state.apiBase}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(input ? { body: JSON.stringify(input) } : {}) })
  const data = await response.json()
  assert.ok(response.ok, `${path}: HTTP_${response.status} ${data.error?.code || ''}`)
  return data
}
const path = `/admin-api/comics/${episodeState.episodeId}`
const current = (await api(path)).episode
assert.ok(current.published)
await api(`${path}/unpublish`, 'POST', {})
const panels = current.panels.map(p => ({ ...p, approved: false }))
const noBag = '陆澈不背包，背后没有包，双肩和胸前没有任何背包肩带。'
for (const number of [4, 6]) {
  if (!panels[number - 1].prompt.includes(noBag)) panels[number - 1].prompt += noBag
  panels[number - 1].imageId = null
}
const updated = (await api(path, 'PUT', { version: current.version, panels })).episode
const result = await api(`${path}/images`, 'POST', { version: updated.version, modelId: state.imageModelId, retryPolicy: 'never', panelIds: [updated.panels[3].id, updated.panels[5].id] })
episodeState.published = false
episodeState.visualApproved = false
episodeState.imageRetryJobIds = result.jobIds
episodeState.imageJobIds.push(...result.jobIds)
episodeState.retryHistory ||= []
episodeState.retryHistory.push({ at: new Date().toISOString(), kind: 'visual_regeneration', panels: [4, 6], jobIds: result.jobIds, reason: 'Remove unintended backpack straps from Lu Che continuity' })
state.status = 'illustrating'
state.updatedAt = new Date().toISOString()
writeFileSync(stateFile, JSON.stringify(state, null, 2))
console.log(JSON.stringify({ episode: 7, status: 'repair_submitted', panels: [4, 6], jobIds: result.jobIds }))
