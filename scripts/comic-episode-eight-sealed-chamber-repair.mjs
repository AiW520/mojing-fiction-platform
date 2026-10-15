import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { readEnvFile } from '../server/src/config.mjs'
import { lockEpisode, saveEpisode } from './comic-series.mjs'

const directory = resolve('artifacts/comic-platform-production/episode-8')
const file = resolve(directory, 'state.json')
const state = JSON.parse(readFileSync(file, 'utf8'))
const release = lockEpisode(directory)
try {
  const env = { ...readEnvFile(resolve('server/.env')), ...process.env }
  const login = await fetch(`${state.apiBase}/admin-api/auth/login`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({account:'admin@mojing.local',password:env.DEV_ADMIN_PASSWORD || 'mojing-dev-only'})})
  assert.equal(login.status, 200)
  const {token} = await login.json()
  async function api(path, method='GET', input) {
    const response=await fetch(`${state.apiBase}${path}`,{method,headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},...(input ? {body:JSON.stringify(input)} : {})})
    const result=await response.json(); assert.ok(response.ok,`HTTP_${response.status}: ${result.error?.code || ''}`); return result
  }
  const path=`/admin-api/comics/${state.episodeId}`
  const {episode}=await api(path)
  const jobs=(await api(`${path}/jobs`)).items
  assert.ok(!jobs.some(job=>['queued','running'].includes(job.status)),'Image task is active')
  assert.equal(episode.panels.length,4)
  writeFileSync(resolve(directory,'before-sealed-chamber-repair.json'),JSON.stringify(episode,null,2))
  const constraints='封闭的地下石室与狭窄石阶，四周只有湿石壁和石门，画面不能出现天空、海岸、城市、城堡、桥梁、远景建筑、户外景观或金色城市灯光；只保留石室内冷青能量光和极弱火光。人物和道具必须严格服从正文，不新增真人、武器、围巾、长布或现代物件。'
  const panels=episode.panels.map(panel=>({...panel,prompt:`${constraints} ${panel.prompt}` ,imageId:null,approved:false}))
  const updated=(await api(path,'PUT',{version:episode.version,panels})).episode
  assert.ok(updated.panels.every(panel=>!panel.imageId && !panel.approved))
  state.visualReviewed=false;state.status='storyboard_approved'
  state.visualRepairs ||= []
  state.visualRepairs.push({version:updated.version,panels:[1,2,3,4],reasons:['Open city/sea environment contradicted sealed underground chamber; panel 2 had an oversized remnant cloth'],authorization:'User authorized continued quality revisions through completion',requestedAt:new Date().toISOString()})
  saveEpisode(file,state)
  writeFileSync(resolve(directory,'sealed-chamber-repair.json'),JSON.stringify(updated,null,2))
  console.log(JSON.stringify({episodeId:updated.id,version:updated.version,panels:[1,2,3,4]}))
} finally {release()}
