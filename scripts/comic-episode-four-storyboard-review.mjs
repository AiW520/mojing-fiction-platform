import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { readEnvFile } from '../server/src/config.mjs'
import { lockEpisode } from './comic-series.mjs'

const directory = resolve('artifacts/comic-platform-production/episode-4')
const release = lockEpisode(directory)
try {
  const state = JSON.parse(readFileSync(resolve(directory, 'state.json'), 'utf8'))
  assert.equal(state.episodeId, '35547b24-8887-483a-98f0-5ec585454812')
  const env = { ...readEnvFile(resolve('server/.env')), ...process.env }
  const login = await fetch(`${state.apiBase}/admin-api/auth/login`, { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ account:'admin@mojing.local', password:env.DEV_ADMIN_PASSWORD || 'mojing-dev-only' }) })
  assert.equal(login.status, 200)
  const { token } = await login.json()
  async function api(path, method = 'GET', input) {
    const response = await fetch(`${state.apiBase}${path}`, { method, headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${token}` }, ...(input ? { body:JSON.stringify(input) } : {}) })
    const result = await response.json()
    assert.ok(response.ok, `HTTP_${response.status}: ${result.error?.code}`)
    return result
  }
  const path = `/admin-api/comics/${state.episodeId}`
  const { episode } = await api(path)
  assert.equal(episode.published, false)
  assert.equal(episode.version, 2, 'Only edit the original generated storyboard once')
  assert.equal(episode.sourceHash, state.storyReviewAcceptance.candidateHash)
  assert.equal(episode.panels.length, 4)
  assert.ok(episode.panels.every(panel => !panel.imageId))
  const { items:jobs } = await api(`${path}/jobs`)
  assert.ok(!jobs.some(job => ['running','queued'].includes(job.status)))
  const panels = episode.panels.map(panel => ({ ...panel, dialogue:panel.dialogue.replaceAll('\\n', '\n') }))
  const second = '女人蹲在排水槽旁用肩推动长方形盖石，孩子被放在后墙凸出的石台上，女人一手扶稳孩子后再次俯身'
  assert.ok(panels[1].prompt.includes(second))
  panels[1].prompt = panels[1].prompt.replace(second, '女人蹲在墙根用肩推动长方形盖石，孩子已独自坐稳在后墙凸出的石台上，双脚悬空；只呈现这一时刻，不画出先前扶孩子的动作')
  const third = '陆燃旋身避开黑手，刀柄在腋下滑落，肋间剧痛使膝盖发软，他仍没有让任何伤手触地；'
  assert.ok(panels[2].prompt.includes(third))
  panels[2].prompt = panels[2].prompt.replace(third, '只呈现陆燃已经把直刃送入黑门缺口、缓缓松肩让刀柄落在槽外石地的单一时刻；右手裸露裂伤麻木下垂，左手骨折被松散干布覆盖并无力下垂，两只伤手都没有握刀或触地；不同时画旋身避让和刀柄滑落；')
  panels[2].prompt = panels[2].prompt.replace('陆燃侧移一步将直刃横送进黑门缺口，刀柄留在槽外石地', '陆燃侧身站稳，直刃已横放进黑门缺口，刀柄已留在槽外石地')
  const { episode:updated } = await api(path, 'PUT', { version:episode.version, panels })
  assert.equal(updated.version, 3)
  assert.ok(updated.panels.every((panel,index) => panel.prompt === panels[index].prompt && panel.dialogue === panels[index].dialogue))
  console.log(JSON.stringify({ episodeId:updated.id, version:updated.version, reviewedPanels:updated.panels.length }))
} finally { release() }
