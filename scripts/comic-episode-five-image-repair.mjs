import assert from 'node:assert/strict'
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { readEnvFile } from '../server/src/config.mjs'
import { lockEpisode, saveEpisode } from './comic-series.mjs'

const directory = resolve('artifacts/comic-platform-production/episode-5')
const release = lockEpisode(directory)
try {
  const file = resolve(directory, 'state.json')
  const state = JSON.parse(readFileSync(file, 'utf8'))
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
  let { episode } = await api(path)
  assert.equal(episode.sourceHash, state.storyReviewAcceptance.candidateHash)
  const { items:jobs } = await api(`${path}/jobs`)
  assert.ok(!jobs.some(job => ['running','queued'].includes(job.status)))
  const marker = 'Actual-image correction 2026-10-10:'
  if (episode.panels[2].prompt.includes(marker) && episode.panels[3].prompt.includes(marker)) {
    console.log('Image repair prompts already applied')
  } else {
    assert.equal(episode.panels.length, 4)
    for (const index of [3,4]) {
      const backup = resolve(directory, `panel-${index}-before-repair-1.png`)
      assert.ok(existsSync(resolve(directory, `panel-${index}.png`)))
      if (!existsSync(backup)) copyFileSync(resolve(directory, `panel-${index}.png`), backup)
    }
    const snapshot = resolve(directory, 'before-image-repair-1.json')
    if (!existsSync(snapshot)) writeFileSync(snapshot, JSON.stringify(episode, null, 2))
    if (episode.published) {
      await api(`${path}/unpublish`, 'POST', {})
      episode = (await api(path)).episode
    }
    const fixes = {
      2:'第三格核验修复：陆燃左右手、手腕和前臂全部裸露，无任何布条、绷带、腕带或护腕。镜头为室内广角，后墙坍塌石台在左侧，完整关闭木门在右侧，两个地点分开。陆燃在后墙站立，肩背靠墙，双手自然下垂。年轻男子在坍台旁持撬棍；另外两男在右侧门边顶住同一根固定横木。女人与孩子在门旁干地，孩子独自抱唯一浅色干布，干布只出现在孩子怀里。青色长刀在右侧木门门槛旁的原盖石下，不在后墙坍塌碎石下。',
      3:'第四格核验修复：木门从门楣直到门槛整块连续严密关闭，门板底部完整触及门槛，绝无开口、断板、抬高门缝、外部通道或门外风景。三名顶门男子均清晰入镜：中央黑眼白年轻男子、左侧白发最年长男子、右侧束发成年男子，一起顶住唯一固定横木。画面左下门侧干地是女人和站立的孩子，孩子怀抱唯一浅色干布；陆燃在画面另一侧后墙，左右裸手无布无腕带。地上黑湿脚印清晰延伸到年轻男子脚后；青刀仍在门槛旁完整盖石下。'
    }
    const panels = episode.panels.map((panel,index) => ({ ...panel, approved:false, ...(fixes[index] ? { prompt:`${marker} ${fixes[index]} ${panel.prompt}` } : {}) }))
    const updated = (await api(path,'PUT',{version:episode.version,panels})).episode
    assert.ok(updated.panels[0].imageId && updated.panels[1].imageId)
    assert.ok(!updated.panels[2].imageId && !updated.panels[3].imageId)
    state.visualReviewed = false
    state.status = 'storyboard_approved'
    state.visualRepairs ||= []
    state.visualRepairs.push({ version:updated.version, panels:[3,4], reasons:['Unexpected left-hand bandage','Door bottom incorrectly open'], authorization:'User authorized quality revisions through completion', requestedAt:new Date().toISOString() })
    saveEpisode(file,state)
    writeFileSync(resolve(directory,'image-repair-1.json'),JSON.stringify(updated,null,2))
    console.log(JSON.stringify({episodeId:updated.id,version:updated.version,preservedPanels:[1,2],repairPanels:[3,4],published:updated.published}))
  }
} finally { release() }
