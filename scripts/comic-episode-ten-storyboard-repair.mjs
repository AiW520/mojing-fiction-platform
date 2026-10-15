import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { readEnvFile } from '../server/src/config.mjs'
import { lockEpisode, saveEpisode } from './comic-series.mjs'

const directory = resolve('artifacts/comic-platform-production/episode-10')
const file = resolve(directory, 'state.json')
const state = JSON.parse(readFileSync(file, 'utf8'))
const release = lockEpisode(directory)
try {
  const env = { ...readEnvFile(resolve('server/.env')), ...process.env }
  const login = await fetch(`${state.apiBase}/admin-api/auth/login`, { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ account:'admin@mojing.local', password:env.DEV_ADMIN_PASSWORD || 'mojing-dev-only' }) })
  if (!login.ok) throw new Error(`LOGIN_HTTP_${login.status}`)
  const { token } = await login.json()
  async function api(path, method='GET', input) {
    const response = await fetch(`${state.apiBase}${path}`, { method, headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${token}` }, ...(input ? { body:JSON.stringify(input) } : {}) })
    const result = await response.json()
    if (!response.ok) throw new Error(`HTTP_${response.status}: ${result.error?.code || ''}`)
    return result
  }
  const path = `/admin-api/comics/${state.episodeId}`
  const { episode } = await api(path)
  if (episode.published) throw new Error('EPISODE_ALREADY_PUBLISHED')
  const marker = '第十话分镜连续性修复一：'
  if (!episode.panels.every(panel => panel.prompt.includes(marker))) {
    const shared = '封闭的地下黑色石室与湿冷石阶，黑门和门槛在画面深处；禁止城市、海岸、桥梁、天空、山景、街灯、暖金城灯、海浪、开放户外或现代建筑背景。所有人物和道具始终位于同一地下石室内，只用冷黑与青色能量光照明。保持第九话连续人物、伤势、左右手、唯一青色直刃长刀、暗红残布、唯一干布、黑门和石阶位置。'
    const panels = episode.panels.map(panel => ({ ...panel, imageId:null, approved:false, prompt:`${marker}${shared} ${panel.prompt}` }))
    const { episode:updated } = await api(path, 'PUT', { version:episode.version, panels })
    state.storyboardReviewed = false
    state.status = 'storyboard_approved'
    state.storyboardRepairs ||= []
    state.storyboardRepairs.push({ version:updated.version, panels:[1,2,3,4], reasons:['Removed open coastal/city lighting that broke the enclosed underground continuity'], requestedAt:new Date().toISOString() })
    saveEpisode(file, state)
    writeFileSync(resolve(directory, 'storyboard-repair-1.json'), JSON.stringify(updated, null, 2))
    console.log(JSON.stringify({ episodeId:updated.id, version:updated.version, repairedPanels:[1,2,3,4] }))
  } else console.log('Episode ten storyboard repair already applied')
} finally { release() }
