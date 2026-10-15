import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { readEnvFile } from '../server/src/config.mjs'

const base = process.env.COMIC_SMOKE_API || 'http://127.0.0.1:3012'
const output = resolve('artifacts/comic-live-smoke')
mkdirSync(output, { recursive:true })
const env = { ...readEnvFile(resolve('server/.env')), ...process.env }
let token = ''
async function api(path, method='GET', input, authenticated=true) {
  const response = await fetch(`${base}${path}`, { method,
    headers:{ 'Content-Type':'application/json', ...(authenticated && token ? { Authorization:`Bearer ${token}` } : {}) },
    ...(input ? { body:JSON.stringify(input) } : {}) })
  const result = await response.json()
  if (!response.ok) throw new Error(`${path}: ${response.status} ${result.error?.code || ''}`)
  return result
}
const login = await api('/admin-api/auth/login','POST',{ account:'admin@mojing.local',password:env.DEV_ADMIN_PASSWORD || 'mojing-dev-only' })
token = login.token
const manifestPath=resolve(output,'manifest.json')
if (process.argv.includes('--verify-draft')) {
  const manifest=JSON.parse(readFileSync(manifestPath,'utf8'))
  const path=`/admin-api/comics/${manifest.episodeId}`
  const episode=(await api(path)).episode
  assert.equal(episode.published,false)
  assert.ok(episode.panels.every(panel=>panel.imageId && !panel.approved))
  const denied=await fetch(`${base}${path}/publish`,{ method:'POST',headers:{ 'Content-Type':'application/json',Authorization:`Bearer ${token}` },body:JSON.stringify({ version:episode.version }) })
  assert.equal(denied.status,409)
  assert.equal((await denied.json()).error.code,'COMIC_REVIEW_REQUIRED')
  const options=await api('/admin-api/comics/options')
  const model=options.models.find(model=>model.kind==='image' && model.model==='gpt-image-2')
  const before=(await api(`${path}/jobs`)).items.length
  const noOp=await fetch(`${base}${path}/images`,{ method:'POST',headers:{ 'Content-Type':'application/json',Authorization:`Bearer ${token}` },body:JSON.stringify({ version:episode.version,modelId:model.id }) })
  assert.equal(noOp.status,400)
  assert.equal((await noOp.json()).error.code,'COMIC_PANELS_REQUIRED')
  assert.equal((await api(`${path}/jobs`)).items.length,before,'Completed panels must not be billed again by generate-missing')
  for (const panel of episode.panels) {
    assert.equal((await fetch(`${base}/api/comic-media/${panel.imageId}`)).status,404)
    assert.equal((await fetch(`${base}/api/comic-media/${panel.imageId}/original`)).status,404)
  }
  assert.equal((await fetch(`${base}/api/comics/${episode.id}`)).status,404)
  console.log(JSON.stringify({ verified:'review gate, private draft media, completed-panel deduplication',newJobs:0 }))
} else if (process.argv.includes('--review-publish')) {
  const manifest=JSON.parse(readFileSync(manifestPath,'utf8'))
  const path=`/admin-api/comics/${manifest.episodeId}`
  let episode=(await api(path)).episode
  assert.ok(episode.panels.every(panel=>panel.imageId))
  episode=(await api(path,'PUT',{ version:episode.version,panels:episode.panels.map(panel=>({ ...panel,approved:true })) })).episode
  await api(`${path}/publish`,'POST',{ version:episode.version })
  const publicEpisode=(await api(`/api/comics/${episode.id}`,'GET',undefined,false)).episode
  assert.equal(publicEpisode.panels.length,3)
  for (const panel of publicEpisode.panels) {
    const response=await fetch(`${base}/api/comic-media/${panel.imageId}`)
    assert.equal(response.status,200); assert.equal(response.headers.get('content-type'),'image/webp')
    assert.ok((await response.arrayBuffer()).byteLength>1000)
    const privateResponse=await fetch(`${base}/api/comic-media/${panel.imageId}/original`)
    assert.equal(privateResponse.status,404)
  }
  manifest.published=true; manifest.readerUrl=`${base}/comics/${episode.id}`
  writeFileSync(manifestPath,JSON.stringify(manifest,null,2))
  console.log(JSON.stringify({ verified:'review, publication, public images, private original',readerUrl:manifest.readerUrl }))
} else if (process.argv.includes('--retry-missing')) {
  const manifest=JSON.parse(readFileSync(manifestPath,'utf8'))
  const path=`/admin-api/comics/${manifest.episodeId}`
  const episode=(await api(path)).episode
  const options=await api('/admin-api/comics/options')
  const model=options.models.find(model=>model.kind==='image' && model.model==='gpt-image-2')
  const result=await api(`${path}/images`,'POST',{ version:episode.version,modelId:model.id })
  console.log(JSON.stringify({ retried:result.jobIds,skipped:result.skipped }))
} else if (process.argv.includes('--start')) {
  assert.ok(!process.argv.includes('--review-publish'))
  const title='赤潮 · 守住最后一盏灯'
  const source='暴风夜，海水越过城堤。陆燃站在破碎的城门前，身后是最后一盏仍亮着的灯。红色长巾被风扯向海面，他听见门后孩子的哭声。浪峰突然升起。他将长刀横在身前，脚下的石板裂开，青色光焰沿刀锋奔涌。陆燃没有后退。他冲向浪峰，斩开一道通往天亮的缝隙。身后城门尚在，灯也尚在。'
  const style='高完成度彩色国漫热血，手绘锐利线条与精细数字绘景，强烈电影光影，黑青海浪与暖金城灯形成对比，材质真实，色彩克制但明亮，画面焦点清晰，具备单独作为手机壁纸的精度。'
  const characters='唯一主角陆燃，22岁成年东亚男性，清瘦结实，短乱黑发，狭长琥珀色眼睛，左眉尾一道小旧疤，左耳单枚银色耳钉。黑色短立领战斗外套、银灰肩甲、暗红长围巾、黑色手套和长靴。武器是一把直刃长刀，刀锋青色能量。三格保持同一个脸型、同一个发型、同一身服装，不添加其他主角。'
  const work=(await api('/api/works','POST',{ title,summary:source,type:'短篇小说' })).work
  await api(`/api/works/${work.id}/blocks`,'PUT',{ items:[{ id:randomUUID(),content:source,blockType:'text' }] })
  let episode=(await api('/admin-api/comics','POST',{ workId:work.id,title,style,characters,rightsNote:'本次测试原创故事，用于本地真实链路与视觉评审。',rightsConfirmed:true })).episode
  const panels=[
    { prompt:'独立全幅竖构图，无分格边框。低角度半身至全身的英雄镜头：陆燃站在古城破损城门外的石桥，脸正对镜头略偏三分之一侧面，琥珀眼清晰，红围巾迎风飞扬，右手垂握直刃长刀，背后高耸城门漏出金色灯光，前景海浪与雨丝。蓝青雨夜中脸部有暖色光。压迫感、克制的愤怒和保护欲，人物轮廓完整。',narration:'暴风夜。城里，只剩最后一盏灯。',dialogue:'' },
    { prompt:'独立全幅竖构图，无分格边框。同一陆燃全身动作镜头，三分之一侧脸露出同一眼睛和旧疤；他双脚扎地、双手横握长刀蓄力，青色光沿直刃刀锋燃起，暗红长围巾向左飞扬；巨大海浪在背后如高墙，身后古城灯火极小但仍温暖。镜头略倾斜但解剖准确，前景石板碎裂，雨滴冻结，动作有重量与清晰空间，不夸张肌肉，不改变衣装。',narration:'门后，还有人等着天亮。',dialogue:'陆燃：这一步，我不退。' },
    { prompt:'独立全幅竖构图，无分格边框。热血高潮远中景：同一陆燃由画面右下向左上跃出，双手持直刃长刀斩开巨大海浪，青色弧形能量贯穿竖画面，飞散水珠、暗红围巾形成动势，脸的侧面仍可辨认，不背对镜头。古城门与金色灯光完整位于下方背景，被分开的浪潮露出第一道清晨金光。主角全身不得裁切，强烈层次、壮阔尺度、精细水浪材质，情绪是为了守护而爆发的决绝。',narration:'他劈开的，不只是浪潮。',dialogue:'陆燃：灯还在，城就还在。' }
  ]
  episode=(await api(`/admin-api/comics/${episode.id}`,'PUT',{ version:episode.version,panels })).episode
  const options=await api('/admin-api/comics/options')
  const model=options.models.find(model=>model.kind==='image' && model.model==='gpt-image-2')
  assert.ok(model,'Tuzi image model required')
  const result=await api(`/admin-api/comics/${episode.id}/images`,'POST',{ version:episode.version,modelId:model.id })
  const manifest={ title,workId:work.id,episodeId:episode.id,jobIds:result.jobIds,apiBase:base,published:false,createdAt:new Date().toISOString() }
  writeFileSync(manifestPath,JSON.stringify(manifest,null,2)); console.log(JSON.stringify(manifest))
} else {
  const manifest=JSON.parse(readFileSync(manifestPath,'utf8'))
  const jobs=(await api(`/admin-api/comics/${manifest.episodeId}/jobs`)).items
  const episode=(await api(`/admin-api/comics/${manifest.episodeId}`)).episode
  for (const [index,panel] of episode.panels.entries()) {
    if (!panel.imageId) continue
    const response=await fetch(`${base}/api/comic-media/${panel.imageId}/original`,{ headers:{ Authorization:`Bearer ${token}` } })
    assert.equal(response.status,200)
    writeFileSync(resolve(output,`panel-${index+1}.png`),Buffer.from(await response.arrayBuffer()))
  }
  writeFileSync(resolve(output,'results.json'),JSON.stringify({ episode,jobs },null,2))
  console.log(JSON.stringify({ jobs:jobs.map(job=>({ id:job.id,status:job.status,errorCode:job.errorCode,attempts:job.result?.attempts })),images:episode.panels.map(panel=>Boolean(panel.imageId)) }))
}
