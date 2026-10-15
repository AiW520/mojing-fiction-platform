import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { readEnvFile } from '../server/src/config.mjs'
import { lockEpisode, saveEpisode } from './comic-series.mjs'

const directory = resolve('artifacts/comic-platform-production/episode-8')
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
  const marker = '第八话实际图片修复三：'
  if (!episode.panels[1].prompt.includes(marker)) {
    const source = resolve(directory, 'panel-2.png')
    const backup = resolve(directory, 'panel-2-before-repair-3.png')
    if (existsSync(source) && !existsSync(backup)) copyFileSync(source, backup)
    if (!existsSync(resolve(directory, 'before-image-repair-3.json'))) writeFileSync(resolve(directory, 'before-image-repair-3.json'), JSON.stringify(episode, null, 2))
    const panels = episode.panels.map((panel, index) => index === 1 ? {
      ...panel,
      imageId: null,
      approved: false,
      prompt: `${marker}交接完成、尚未拔刀的单一瞬间。绝对没有任何刀、刀柄、刀鞘、剑、蓝色能量光、暗红残布、红色布条或武器轮廓。陆燃右膝和右靴承担身体重心，右手三指接住浅色干布并把布压在右靴下；左臂骨折无力，左手和左前臂完全悬垂在身体侧面，明确不接触湿地、石壁、膝盖或任何人物。左臂只有破损黑色袖口，绝对没有白色绷带、布条、护腕或额外包扎。女人护住已松手退后的孩子，厚重石门完整关闭。${panel.prompt}`
    } : panel)
    const { episode: updated } = await api(path, 'PUT', { version: episode.version, panels })
    if (updated.panels[1].imageId || !updated.panels[0].imageId || !updated.panels[2].imageId || !updated.panels[3].imageId) throw new Error('INVALID_REPAIR_STATE')
    state.visualReviewed = false
    state.status = 'storyboard_approved'
    state.visualRepairs ||= []
    state.visualRepairs.push({ version: updated.version, panels: [2], reasons: ['Left hand incorrectly supporting body on ground'], authorization: 'User authorized continued quality revisions through completion', requestedAt: new Date().toISOString() })
    saveEpisode(file, state)
    writeFileSync(resolve(directory, 'image-repair-3.json'), JSON.stringify(updated, null, 2))
    console.log(JSON.stringify({ episodeId: updated.id, version: updated.version, preservedPanels: [1, 3, 4], repairPanel: 2 }))
  } else console.log('Episode eight image repair three already applied')
} finally {
  release()
}
