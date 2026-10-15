import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { readEnvFile } from '../server/src/config.mjs'
import { lockEpisode, saveEpisode } from './comic-series.mjs'

const directory = resolve('artifacts/comic-platform-production/episode-9')
const file = resolve(directory, 'state.json')
const state = JSON.parse(readFileSync(file, 'utf8'))
const release = lockEpisode(directory)
try {
  const env = { ...readEnvFile(resolve('server/.env')), ...process.env }
  const login = await fetch(`${state.apiBase}/admin-api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ account: 'admin@mojing.local', password: env.DEV_ADMIN_PASSWORD || 'mojing-dev-only' }) })
  if (!login.ok) throw new Error(`LOGIN_HTTP_${login.status}`)
  const { token } = await login.json()
  async function api(path, method = 'GET', input) {
    const response = await fetch(`${state.apiBase}${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, ...(input ? { body: JSON.stringify(input) } : {}) })
    const result = await response.json()
    if (!response.ok) throw new Error(`HTTP_${response.status}: ${result.error?.code || ''}`)
    return result
  }
  const path = `/admin-api/comics/${state.episodeId}`
  const { episode } = await api(path)
  if (episode.published) throw new Error('EPISODE_ALREADY_PUBLISHED')
  const marker = '第九话第四格视觉修复二：'
  if (!episode.panels[3].prompt.includes(marker)) {
    const source = resolve(directory, 'panel-4.png')
    const backup = resolve(directory, 'panel-4-before-repair-2.png')
    if (existsSync(source) && !existsSync(backup)) copyFileSync(source, backup)
    const snapshot = resolve(directory, 'before-image-repair-2.json')
    if (!existsSync(snapshot)) writeFileSync(snapshot, JSON.stringify(episode, null, 2))
    const panels = episode.panels.map((panel, index) => index === 3 ? {
      ...panel,
      imageId: null,
      approved: false,
      prompt: `${marker}重点是刀锋被黑线拉回右腕的危险，而不是向外挥刀。陆燃裸露右手仍扣着唯一刀柄，右腕被黑线绞紧，青色直刃近端与右腕横向贴近，锐利刀刃距离右腕仅一指宽，尚未切入皮肤；刀尖朝画面左后方，不得朝镜头、地面或门内伸出。画面清楚显示刀刃与右腕的危险邻近关系，黑线形成拉扯弧线，陆燃表情紧张克制。保持左臂悬垂、右靴踩线、地下黑石室、门内黑影提着唯一干布另一端、母亲怀中真孩子和门内孩子异象；不增加伤口，不画断肢。${panel.prompt}`
    } : panel)
    const { episode: updated } = await api(path, 'PUT', { version: episode.version, panels })
    if (updated.panels[3].imageId || updated.panels.slice(0, 3).some(panel => !panel.imageId)) throw new Error('INVALID_REPAIR_STATE')
    state.visualReviewed = false
    state.status = 'storyboard_approved'
    state.visualRepairs ||= []
    state.visualRepairs.push({ version: updated.version, panels: [4], reasons: ['Blade was pointing outward rather than turning toward the right wrist'], authorization: 'User authorized continued quality revisions through completion', requestedAt: new Date().toISOString() })
    saveEpisode(file, state)
    writeFileSync(resolve(directory, 'image-repair-2.json'), JSON.stringify(updated, null, 2))
    console.log(JSON.stringify({ episodeId: updated.id, version: updated.version, repairPanel: 4, preservedPanels: [1, 2, 3] }))
  } else console.log('Episode nine panel four repair already applied')
} finally {
  release()
}
