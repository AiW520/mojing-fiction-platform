import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { resolve } from 'node:path'
import { readEnvFile } from '../server/src/config.mjs'
import { episodeArgument, episodeDirectory, lockEpisode, saveEpisode } from './comic-series.mjs'
import { assertReviewPassed, blockingReviewIssues, verifyHanLengthReview } from './comic-review-gates.mjs'

const number = episodeArgument(process.argv.slice(2))
assert.ok(number >= 2, 'Specify --episode N')
const parentDirectory = episodeDirectory('artifacts/comic-platform-production', number)
const parent = JSON.parse(readFileSync(resolve(parentDirectory, 'state.json'), 'utf8'))
assert.ok(parent.episodeId && parent.status !== 'complete', 'Only an unfinished draft can be repaired')
const output = resolve(parentDirectory, 'revision-1')
const release = lockEpisode(parentDirectory)
const file = resolve(output, 'state.json')
mkdirSync(output, { recursive:true })
const env = { ...readEnvFile(resolve('server/.env')), ...process.env }
const login = await fetch(`${parent.apiBase}/admin-api/auth/login`, { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ account:'admin@mojing.local', password:env.DEV_ADMIN_PASSWORD || 'mojing-dev-only' }) })
assert.equal(login.status, 200)
const { token } = await login.json()
async function api(path, method='GET', input) {
  const response = await fetch(`${parent.apiBase}${path}`, { method, headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${token}` }, ...(input ? { body:JSON.stringify(input) } : {}) })
  const result = await response.json()
  assert.ok(response.ok, `${path}: HTTP_${response.status} ${result.error?.code || ''}`)
  return result
}
const original = (await api(`/admin-api/comics/${parent.episodeId}`)).episode
assert.equal(original.published, false, 'Do not replace a published episode')
let state = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null
const save = () => saveEpisode(file, state)
const db = new DatabaseSync(resolve('server/data/mojing.sqlite'), { readOnly:true })
try {
  if (process.argv.includes('--start') && !state) {
    const source = db.prepare('SELECT source_text FROM comic_episodes WHERE id=?').get(parent.episodeId)?.source_text
    assert.ok(source?.trim())
    state = { apiBase:parent.apiBase, title:`${parent.title} · 修订稿`, episodeNumber:number, previousEpisodeId:parent.previousEpisodeId,
      repairedEpisodeId:parent.episodeId, sourceContext:parent.sourceContext, revisionSource:source, panelCount:parent.panelCount,
      textModelId:parent.textModelId, imageModelId:parent.imageModelId, imageModel:'gpt-image-2', imageRetryPolicy:'never',
      writingJobIds:[], storyboardJobIds:[], imageJobIds:[], storyReviewed:false, storyboardReviewed:false, visualReviewed:false, status:'preparing', createdAt:new Date().toISOString() }
    save()
  }
  assert.ok(state, 'Start the repair with --start')
  assert.equal(state.repairedEpisodeId, parent.episodeId)
  if (process.argv.includes('--start') && !state.workId) {
    const matches = db.prepare('SELECT id FROM works WHERE title=?').all(state.title)
    assert.ok(matches.length <= 1, 'Resolve duplicate repair works before continuing')
    state.workId = matches[0]?.id || (await api('/api/works','POST',{ title:state.title, summary:'原创赤潮第三话修订。延续第二话的人物伤势与位置，聚焦守护选择、行动代价和归还长刀的悬念。正文900至1400汉字。', type:'短篇小说' })).work.id
    save()
  }
  assert.ok(state.workId)
  const recorded = db.prepare("SELECT id,status FROM generation_jobs WHERE work_id=? AND job_type='text_generation' ORDER BY rowid").all(state.workId)
  if (recorded.length) { state.writingJobIds = recorded.map(job => job.id); save() }
  if (process.argv.includes('--start') && !state.writingJobIds.length) {
    const feedback = readFileSync(resolve(parentDirectory, 'repair-review-feedback.txt'), 'utf8').trim()
    assert.ok(feedback && feedback.length <= 3000)
    const queued = await api(`/api/works/${state.workId}/text-jobs`, 'POST', { action:'rewrite', modelId:state.textModelId, maxTokens:2400,
      context:`上一话正文：\n${state.sourceContext}\n\n责任编辑修订要求：\n${feedback}`, selected:state.revisionSource })
    state.writingJobIds.push(queued.jobId); state.status='writing_running'; save()
  }
  if (process.argv.includes('--revise-once') && state.writingJobIds.length === 1) {
    assert.ok(!state.episodeId, 'Do not rewrite an accepted comic')
    const previous = (await api(`/api/jobs/${state.writingJobIds[0]}`)).job
    assert.equal(previous.status, 'success', 'Only revise a completed candidate')
    assert.ok(blockingReviewIssues(previous.result?.review).length, 'This one-time revision requires a blocked review')
    const feedback = readFileSync(resolve(output, 'additional-review-feedback.txt'), 'utf8').trim()
    assert.ok(feedback && feedback.length <= 3000)
    writeFileSync(resolve(output, `story-${previous.id}.txt`), previous.result.content)
    writeFileSync(resolve(output, `review-${previous.id}.json`), JSON.stringify(previous.result.review, null, 2))
    state.additionalRevision = { authorized:true, previousJobId:previous.id, feedback, requestedAt:new Date().toISOString() }
    save()
    const queued = await api(`/api/works/${state.workId}/text-jobs`, 'POST', { action:'rewrite', modelId:state.textModelId, maxTokens:2400,
      context:`上一话正文：\n${state.sourceContext}\n\n责任编辑追加修订要求：\n${feedback}`, selected:previous.result.content })
    state.writingJobIds.push(queued.jobId); state.status='writing_running'; save()
  }
  assert.ok(state.writingJobIds.length >= 1 && state.writingJobIds.length <= (state.additionalRevision?.authorized ? 2 : 1), 'Writing task budget exhausted; do not retry automatically')
  const job = (await api(`/api/jobs/${state.writingJobIds.at(-1)}`)).job
  const candidateHash = job.result?.content ? createHash('sha256').update(job.result.content).digest('hex') : null
  let review = job.result?.review
  if (state.storyReviewAcceptance?.jobId === job.id && state.storyReviewAcceptance.candidateHash === candidateHash) review = state.storyReviewAcceptance.review
  if (process.argv.includes('--verify-length-review') && job.status === 'success') {
    review = verifyHanLengthReview(review, job.result.content)
    assert.ok(review.lengthVerification, 'No objectively disproven length issue found')
    writeFileSync(resolve(output, 'story-review-original.json'), JSON.stringify(review.originalReview, null, 2))
    state.lengthReviewVerification = { jobId:job.id, ...review.lengthVerification }
    save()
  }
  if (!state.episodeId && job.status === 'success') {
    writeFileSync(resolve(output, 'story.txt'), job.result.content)
    writeFileSync(resolve(output, 'story-review.json'), JSON.stringify(review, null, 2))
    state.storyReviewBlockingIssues = blockingReviewIssues(review)
    state.storyReviewRequired = state.storyReviewBlockingIssues.length > 0
    state.status = state.storyReviewRequired ? 'writing_review_required' : 'writing_ready'
    save()
  } else if (job.status === 'failed') {
    state.status='writing_failed'; state.lastWritingError=job.errorCode; save()
  }
  if (process.argv.includes('--accept-story') && !state.episodeId) {
    assert.equal(job.status, 'success')
    assertReviewPassed(review)
    assert.equal(review.candidateHash, candidateHash)
    state.storyReviewAcceptance = { jobId:job.id, candidateHash, review }
    save()
    const existing = (await api('/admin-api/comics')).items.find(episode => episode.workId === state.workId)
    if (!existing) {
      await api(`/api/works/${state.workId}/blocks`, 'PUT', { items:[{ id:randomUUID(), content:job.result.content, blockType:'text' }] })
    }
    const characters = '唯一主角陆燃，22岁成年东亚男性，清瘦结实，短乱黑发，狭长琥珀色眼睛，左眉尾一道小旧疤，左耳单枚银色耳钉。第三话当前状态：黑色短立领战斗外套、银灰肩甲和黑色长靴保持一致；右手裸露无手套，虎口裂伤并因麻木难以发力；左手骨折无力垂落，孩子递来的松散干布仅覆盖左手，不能握刀、抵门或支撑体重；暗红围巾已撕裂，只剩残布缠在刀柄，颈部没有完整围巾。长刀为直刃青色能量刀。不要新增吊带、绷带、新护甲或新配饰，不要恢复手套、完整围巾或左手功能，保持同一脸型、发型和伤势。'
    const episode = existing || (await api('/admin-api/comics','POST',{ workId:state.workId, title:state.title, style:original.style, characters, rightsConfirmed:true, rightsNote:'用户授权平台模型修订原创赤潮第三话；保留旧稿与付费素材。' })).episode
    assert.equal(episode.sourceHash, candidateHash)
    state.episodeId=episode.id; state.storyReviewed=true; state.storyReviewRequired=false; state.status='storyboard_pending'; save()
  }
  console.log(JSON.stringify({ output, state:{ status:state.status, workId:state.workId, episodeId:state.episodeId }, writing:{ id:job.id, status:job.status, errorCode:job.errorCode, characters:job.result?.content?.length || 0, review:job.result?.review?.status, score:job.result?.review?.score, blockingIssues:state.storyReviewBlockingIssues } }))
} finally { db.close(); release() }
