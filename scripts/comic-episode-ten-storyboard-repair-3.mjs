import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { readEnvFile } from '../server/src/config.mjs'
import { lockEpisode, saveEpisode } from './comic-series.mjs'
const directory=resolve('artifacts/comic-platform-production/episode-10'), file=resolve(directory,'state.json')
const state=JSON.parse(readFileSync(file,'utf8')); const release=lockEpisode(directory)
try {
  const env={...readEnvFile(resolve('server/.env')),...process.env}; const login=await fetch(`${state.apiBase}/admin-api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({account:'admin@mojing.local',password:env.DEV_ADMIN_PASSWORD||'mojing-dev-only'})}); if(!login.ok) throw new Error(`LOGIN_HTTP_${login.status}`); const {token}=await login.json()
  const api=async(path,method='GET',input)=>{const r=await fetch(`${state.apiBase}${path}`,{method,headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},...(input?{body:JSON.stringify(input)}:{})});const j=await r.json();if(!r.ok)throw new Error(`HTTP_${r.status}: ${j.error?.code||''}`);return j}
  const path=`/admin-api/comics/${state.episodeId}`, {episode}=await api(path)
  const replacements=[['禁止城市、海岸、桥梁、天空、山景、街灯、冷青石光、海浪、开放户外或现代建筑背景','禁止城市、海岸、桥梁、天空、山景、街灯、海浪、开放户外或现代建筑背景'],['黑青水面与暖金远景压低饱和度','冷青水光与湿黑石面压低饱和度']]
  const panels=episode.panels.map(panel=>{let prompt=panel.prompt;for(const [a,b] of replacements)prompt=prompt.replaceAll(a,b);return {...panel,prompt,imageId:null,approved:false}})
  if(panels.some((p,i)=>p.prompt!==episode.panels[i].prompt)){const {episode:updated}=await api(path,'PUT',{version:episode.version,panels});state.storyboardReviewed=false;state.status='storyboard_approved';state.storyboardRepairs ||= [];state.storyboardRepairs.push({version:updated.version,panels:[1,2,3,4],reasons:['Removed remaining open-water and outdoor-lighting language'],requestedAt:new Date().toISOString()});saveEpisode(file,state);writeFileSync(resolve(directory,'storyboard-repair-3.json'),JSON.stringify(updated,null,2));console.log(JSON.stringify({episodeId:updated.id,version:updated.version,repairedPanels:[1,2,3,4]}))} else console.log('No residual open-water storyboard language found')
} finally {release()}
