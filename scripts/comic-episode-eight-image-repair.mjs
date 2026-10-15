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
  if (episode.panels.length !== 4) throw new Error('EXPECTED_FOUR_PANELS')
  const marker = '第八话实际图片修复一：'
  if (episode.panels[0].prompt.includes(marker)) {
    console.log('Episode eight image repair already applied')
  } else {
   for (const index of [1, 2]) {
    const source = resolve(directory, `panel-${index}.png`)
    const backup = resolve(directory, `panel-${index}-before-repair-1.png`)
    if (existsSync(source) && !existsSync(backup)) copyFileSync(source, backup)
   }
  if (!existsSync(resolve(directory, 'before-image-repair-1.json'))) {
    writeFileSync(resolve(directory, 'before-image-repair-1.json'), JSON.stringify(episode, null, 2))
  }
  const fixes = [
    '第八话实际图片修复一：此刻尚未拔刀，陆燃背后和腰侧绝对没有刀、刀柄、刀鞘、蓝色刀身或任何武器轮廓；暗红残布也不可出现，因为它只缠在不可见的刀柄上。陆燃左臂只穿破损黑色袖口，左手骨折无力自然下垂，绝对没有白色绷带、布条、护腕或额外包扎。右手虎口有小范围裂伤但没有夸张血腥。孩子在女人护臂内双手抱住唯一浅色干布，陆燃空手伸右手要求接布，门保持完整关闭。',
    '第八话实际图片修复一：此刻刚完成交接、尚未拔刀，画面中陆燃的背后和腰侧绝对不可出现刀、刀柄、刀鞘、蓝色刀身或任何武器；暗红残布不可单独悬浮。陆燃左臂只有破损黑色袖口，左手骨折无力下垂，绝对没有白色绷带、布条、护腕或额外包扎。陆燃用受伤右手三指接住干布并把它压到右靴下，女人护着已松手的孩子退后，门保持完整关闭。'
  ]
  const panels = episode.panels.map((panel, index) => ({
    ...panel,
    approved: false,
    ...(index < 2 ? { imageId: null, prompt: `${marker}${fixes[index]} ${panel.prompt}` } : {})
  }))
  const { episode: updated } = await api(path, 'PUT', { version: episode.version, panels })
  if (updated.panels[0].imageId || updated.panels[1].imageId) throw new Error('REPAIR_PANELS_NOT_CLEARED')
  if (!updated.panels[2].imageId || !updated.panels[3].imageId) throw new Error('PRESERVED_PANELS_LOST')
  state.visualReviewed = false
  state.status = 'storyboard_approved'
  state.visualRepairs ||= []
  state.visualRepairs.push({ version: updated.version, panels: [1, 2], reasons: ['Blade visible before narrative draw', 'Unwritten left-arm bandage'], authorization: 'User authorized continued quality revisions through completion', requestedAt: new Date().toISOString() })
  saveEpisode(file, state)
  writeFileSync(resolve(directory, 'image-repair-1.json'), JSON.stringify(updated, null, 2))
   console.log(JSON.stringify({ episodeId: updated.id, version: updated.version, preservedPanels: [3, 4], repairPanels: [1, 2] }))
  }
} finally {
  release()
}
