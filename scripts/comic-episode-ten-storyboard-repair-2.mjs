import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { readEnvFile } from '../server/src/config.mjs'
import { lockEpisode, saveEpisode } from './comic-series.mjs'
const directory=resolve('artifacts/comic-platform-production/episode-10'), file=resolve(directory,'state.json')
const state=JSON.parse(readFileSync(file,'utf8')); const release=lockEpisode(directory)
try {
  const env={...readEnvFile(resolve('server/.env')),...process.env}; const login=await fetch(`${state.apiBase}/admin-api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({account:'admin@mojing.local',password:env.DEV_ADMIN_PASSWORD||'mojing-dev-only'})}); if(!login.ok) throw new Error(`LOGIN_HTTP_${login.status}`); const {token}=await login.json()
  const api=async(path,method='GET',input)=>{const r=await fetch(`${state.apiBase}${path}`,{method,headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},...(input?{body:JSON.stringify(input)}:{})});const j=await r.json();if(!r.ok)throw new Error(`HTTP_${r.status}: ${j.error?.code||''}`);return j}
  const path=`/admin-api/comics/${state.episodeId}`, {episode}=await api(path); const replacements=[['黑青海水与远处暖金城灯形成冷暖对照','冷青水光与湿黑石阶形成压迫对照'],['远处暖金城灯与黑青浪涛形成强烈对照','冷青水光与黑石和黑水形成强烈对照'],['暖金城灯','冷青石光']]
  const panels=episode.panels.map(panel=>{let prompt=panel.prompt;for(const [a,b] of replacements)prompt=prompt.replaceAll(a,b);return {...panel,prompt,imageId:null,approved:false}})
  if(panels.some((p,i)=>p.prompt!==episode.panels[i].prompt)){const {episode:updated}=await api(path,'PUT',{version:episode.version,panels});state.storyboardReviewed=false;state.status='storyboard_approved';state.storyboardRepairs ||= [];state.storyboardRepairs.push({version:updated.version,panels:[1,2,3,4],reasons:['Removed residual outdoor/city lighting language from storyboard prompts'],requestedAt:new Date().toISOString()});saveEpisode(file,state);writeFileSync(resolve(directory,'storyboard-repair-2.json'),JSON.stringify(updated,null,2));console.log(JSON.stringify({episodeId:updated.id,version:updated.version,repairedPanels:[1,2,3,4]}))} else console.log('No residual storyboard lighting found')
} finally {release()}
