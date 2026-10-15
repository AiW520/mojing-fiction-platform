import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { readEnvFile } from '../server/src/config.mjs'
import { lockEpisode, saveEpisode } from './comic-series.mjs'
import { assertReviewPassed } from './comic-review-gates.mjs'

const root = resolve('artifacts/comic-platform-production/episode-8')
const path = resolve(root, 'state.json')
const release = lockEpisode(root)
const state = JSON.parse(readFileSync(path, 'utf8'))
const env = { ...readEnvFile(resolve('server/.env')), ...process.env }
const login = await fetch(`${state.apiBase}/admin-api/auth/login`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({account:'admin@mojing.local',password:env.DEV_ADMIN_PASSWORD || 'mojing-dev-only'}) })
assert.equal(login.status, 200)
const {token} = await login.json()
async function api(path, method='GET', input) {
  const response = await fetch(`${state.apiBase}${path}`, {method,headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},...(input ? {body:JSON.stringify(input)} : {})})
  const result = await response.json()
  assert.ok(response.ok, `HTTP_${response.status}: ${result.error?.code || ''}`)
  return result
}
const hash = value => createHash('sha256').update(value).digest('hex')
const db = new DatabaseSync(resolve('server/data/mojing.sqlite'), {readOnly:true})
try {
  const repair = state.continuityRepair
  const oldId = repair?.oldEpisodeId || state.episodeId
  const old = (await api(`/admin-api/comics/${oldId}`)).episode
  const previous = (await api(`/admin-api/comics/${state.previousEpisodeId}`)).episode
  assert.equal(previous.published, true)
  const source = db.prepare('SELECT source_text FROM comic_episodes WHERE id=?').get(oldId)?.source_text
  const previousSource = db.prepare('SELECT source_text FROM comic_episodes WHERE id=?').get(previous.id)?.source_text
  assert.equal(hash(source), old.sourceHash)
  assert.equal(hash(previousSource), previous.sourceHash)
  const comicJobs = (await api(`/admin-api/comics/${oldId}/jobs`)).items
  assert.ok(!comicJobs.some(job => ['queued','running'].includes(job.status)), 'Comic production is active')
  if (process.argv.includes('--submit') && !repair) {
    const writing = db.prepare("SELECT id,status FROM generation_jobs WHERE work_id=? AND job_type='text_generation'").all(state.workId)
    assert.ok(!writing.some(job => ['queued','running'].includes(job.status)), 'Writing is active')
    writeFileSync(resolve(root,'state-before-continuity-repair.json'), JSON.stringify(state,null,2))
    writeFileSync(resolve(root,'episode-before-continuity-repair.json'), JSON.stringify(old,null,2))
    writeFileSync(resolve(root,'story-before-continuity-repair.txt'), source)
    state.continuityRepair = {oldEpisodeId:oldId,oldSourceHash:old.sourceHash,previousSourceHash:previous.sourceHash,jobIds:[],authorization:'User authorized continuous quality revisions through natural completion',startedAt:new Date().toISOString()}
    state.status='continuity_repair_pending'
    state.storyReviewed=false; state.storyboardReviewed=false; state.visualReviewed=false
    saveEpisode(path,state)
  }
  assert.ok(state.continuityRepair, 'Start with --submit')
  if (old.published) await api(`/admin-api/comics/${oldId}/unpublish`, 'POST', {})
  const feedback = readFileSync(resolve(root,'continuity-repair-feedback.txt'),'utf8').trim()
  const context = `上一话第七话正式已发布正文（仅作连续性参考，不是修订对象）：\n${previousSource}\n\n责任编辑核对后的修订要求：\n${feedback}`
  // Recover a submitted request before issuing another paid generation.
  const recorded = db.prepare("SELECT id,request_json FROM generation_jobs WHERE work_id=? AND job_type='text_generation' ORDER BY rowid").all(state.workId)
    .filter(row => JSON.parse(row.request_json).context === context)
  for (const row of recorded) if (!state.continuityRepair.jobIds.includes(row.id)) state.continuityRepair.jobIds.push(row.id)
  saveEpisode(path,state)
  const lastRepairJob = state.continuityRepair.jobIds.length ? (await api(`/api/jobs/${state.continuityRepair.jobIds.at(-1)}`)).job : null
  if (process.argv.includes('--retry') && lastRepairJob?.status === 'failed') {
    const {jobId} = await api(`/api/works/${state.workId}/text-jobs`, 'POST', {action:'rewrite',modelId:state.textModelId,context,selected:source,maxTokens:2600})
    state.continuityRepair.jobIds.push(jobId)
    state.continuityRepair.retries ||= []
    state.continuityRepair.retries.push({jobId,previousJobId:lastRepairJob.id,errorCode:lastRepairJob.errorCode,requestedAt:new Date().toISOString(),authorization:state.continuityRepair.authorization})
    state.status='continuity_repair_running'; saveEpisode(path,state)
  } else if (process.argv.includes('--submit') && !state.continuityRepair.jobIds.length) {
    const {jobId} = await api(`/api/works/${state.workId}/text-jobs`, 'POST', {action:'rewrite',modelId:state.textModelId,context,selected:source,maxTokens:2600})
    state.continuityRepair.jobIds.push(jobId)
    state.status='continuity_repair_running'; saveEpisode(path,state)
  }
  const jobId = state.continuityRepair.jobIds.at(-1)
  assert.ok(jobId)
  const job = (await api(`/api/jobs/${jobId}`)).job
  if (job.status !== 'success') {
    state.continuityRepair.status=job.status; state.continuityRepair.errorCode=job.errorCode || null
    saveEpisode(path,state)
    console.log(JSON.stringify({jobId,status:job.status,errorCode:job.errorCode,oldPublished:false}))
  } else {
    const content=job.result.content
    const candidateHash=hash(content)
    writeFileSync(resolve(root,'continuity-repair-story.txt'),content)
    writeFileSync(resolve(root,'continuity-repair-review.json'),JSON.stringify(job.result.review,null,2))
    state.continuityRepair.status='review_required'; saveEpisode(path,state)
    if (process.argv.includes('--accept')) {
      assertReviewPassed(job.result.review)
      assert.equal(job.result.review.candidateHash,candidateHash)
      if (state.continuityRepair.newEpisodeId) {
        assert.equal(state.episodeId,state.continuityRepair.newEpisodeId)
      } else {
        await api(`/api/works/${state.workId}/blocks`, 'PUT', {items:[{id:randomUUID(),content,blockType:'text'}]})
        const existing=(await api('/admin-api/comics')).items.filter(e=>e.workId===state.workId && e.sourceHash===candidateHash && e.id!==oldId)
        assert.ok(existing.length<=1)
        const characters='陆燃，22岁成年东亚男性，清瘦结实，短乱黑发，狭长琥珀色眼睛，左眉尾小旧疤，左耳单枚银耳钉。黑色短立领战斗外套、银灰肩甲、黑色长靴。右手裸露，虎口裂伤麻木且右腕被黑丝缠勒；左臂骨折无力垂落，绝不握物或支撑。颈部没有围巾，暗红残布只缠唯一青色直刃能量刀的刀柄。唯一干布持有关系严格按本话正文，不在左手上，不新增绷带、吊带或工具。女人护着孩子，另外两名成年男子压住年轻男子，总计六名真人。黑影是门内异象，同陆燃脸型衣饰，仅眼睛漆黑。每格一个可绘制时刻，左右手、持刀、布与右靴严格按对应正文阶段。'
        const episode=existing[0] || (await api('/admin-api/comics','POST',{workId:state.workId,title:state.title,style:old.style,characters,rightsConfirmed:true,rightsNote:'用户授权平台修订第八话连续性，撤回错误分镜版本并保留全部旧稿与付费素材。'})).episode
        assert.equal(episode.sourceHash,candidateHash)
        state.continuityRepair.newEpisodeId=episode.id
        state.episodeId=episode.id
        if (!state.writingJobIds.includes(jobId)) state.writingJobIds.push(jobId)
        state.storyboardJobIds=[];state.imageJobIds=[]
        state.storyReviewAcceptance={jobId,candidateHash,review:job.result.review}
        state.storyReviewed=true;state.storyReviewRequired=false;state.storyReviewBlockingIssues=[]
        state.storyboardReviewed=false;state.visualReviewed=false;state.status='storyboard_pending'
        delete state.readerUrl
        writeFileSync(resolve(root,'story.txt'),content)
      }
      state.continuityRepair.status='accepted';saveEpisode(path,state)
    }
    console.log(JSON.stringify({jobId,status:state.continuityRepair.status,candidateHash,episodeId:state.episodeId,review:job.result.review}))
  }
} finally {db.close();release()}
