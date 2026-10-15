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
  const login = await fetch(`${state.apiBase}/admin-api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: 'admin@mojing.local', password: env.DEV_ADMIN_PASSWORD || 'mojing-dev-only' })
  })
  if (!login.ok) throw new Error(`LOGIN_HTTP_${login.status}`)
  const { token } = await login.json()
  async function api(path, method = 'GET', input) {
    const response = await fetch(`${state.apiBase}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      ...(input ? { body: JSON.stringify(input) } : {})
    })
    const result = await response.json()
    if (!response.ok) throw new Error(`HTTP_${response.status}: ${result.error?.code || ''}`)
    return result
  }

  const path = `/admin-api/comics/${state.episodeId}`
  const { episode } = await api(path)
  if (episode.published) throw new Error('EPISODE_ALREADY_PUBLISHED')
  const marker = '第九话视觉连续性修复一：'
  if (episode.panels.every(panel => panel.prompt.includes(marker))) {
    console.log('Episode nine visual repair already applied')
  } else {
    for (const index of [1, 2, 3, 4]) {
      const source = resolve(directory, `panel-${index}.png`)
      const backup = resolve(directory, `panel-${index}-before-repair-1.png`)
      if (existsSync(source) && !existsSync(backup)) copyFileSync(source, backup)
    }
    const snapshot = resolve(directory, 'before-image-repair-1.json')
    if (!existsSync(snapshot)) writeFileSync(snapshot, JSON.stringify(episode, null, 2))
    const shared = '封闭的地下黑色石室与湿冷石阶，黑门和门槛在画面深处；绝对禁止城市、海岸、桥梁、天空、山景、街灯、现代建筑或开放户外背景。只用冷黑与青色能量光照明，所有人物和道具都位于同一座地下石室内。保持陆燃短乱黑发、琥珀色眼睛、左眉尾旧疤、左耳银钉、黑色短立领外套、银灰肩甲；左臂骨折无力垂落，右腕黑丝缠勒，右手虎口裂伤。保持唯一青色直刃长刀、暗红残布、唯一干布、黑门和石阶的连续位置。'
    const panels = episode.panels.map(panel => ({
      ...panel,
      imageId: null,
      approved: false,
      prompt: `${marker}${shared} ${panel.prompt}`
    }))
    const { episode: updated } = await api(path, 'PUT', { version: episode.version, panels })
    if (updated.panels.some(panel => panel.imageId)) throw new Error('REPAIR_IMAGES_NOT_CLEARED')
    state.visualReviewed = false
    state.status = 'storyboard_approved'
    state.visualRepairs ||= []
    state.visualRepairs.push({
      version: updated.version,
      panels: [1, 2, 3, 4],
      reasons: ['Open city/coastal backgrounds broke the enclosed underground continuity'],
      authorization: 'User authorized continued quality revisions through completion',
      requestedAt: new Date().toISOString()
    })
    saveEpisode(file, state)
    writeFileSync(resolve(directory, 'image-repair-1.json'), JSON.stringify(updated, null, 2))
    console.log(JSON.stringify({ episodeId: updated.id, version: updated.version, repairPanels: [1, 2, 3, 4] }))
  }
} finally {
  release()
}
