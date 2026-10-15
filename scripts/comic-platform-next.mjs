import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { resolve } from 'node:path'
import { readEnvFile } from '../server/src/config.mjs'
import { episodeArgument, episodeDirectory, episodeStatePath, lockEpisode, nextEpisode, saveEpisode } from './comic-series.mjs'
import { assertReviewPassed, blockingReviewIssues } from './comic-review-gates.mjs'

const base = 'http://127.0.0.1:3000'
const root = resolve('artifacts/comic-platform-production')
const number = episodeArgument(process.argv.slice(2)) || nextEpisode(root)
const outlineFile = resolve(root, 'ending-outline-task-v4.json')
const endingOutline = existsSync(outlineFile) ? JSON.parse(readFileSync(outlineFile, 'utf8')) : null
const approvedEndingOutline = endingOutline?.status === 'success' && endingOutline.result?.review?.status === 'success' && !endingOutline.result.review.issues.some(issue => ['severe', 'blocking'].includes(issue.severity))
  ? String(endingOutline.result.content || '').trim() : ''
const feedbackIndex = process.argv.indexOf('--review-feedback')
const feedback = feedbackIndex < 0 ? null : readFileSync(resolve(process.argv[feedbackIndex + 1] || ''), 'utf8').trim()
if (feedback !== null) assert.ok(feedback.length > 0 && feedback.length <= 3000, 'Review feedback must contain 1 to 3000 characters')
const additionalRetry = process.argv.includes('--additional-retry')
if (additionalRetry) assert.ok(process.argv.includes('--retry-writing'), '--additional-retry requires --retry-writing')
const authorizedRevision = process.argv.includes('--authorized-revision')
const authorizedRetry = process.argv.includes('--authorized-retry')
if (authorizedRevision) {
  assert.ok(feedback, '--authorized-revision requires --review-feedback')
  assert.ok(!additionalRetry && !process.argv.includes('--retry-writing'), 'Use authorized revisions only for completed candidates')
}
if (authorizedRetry) {
  assert.ok(process.argv.includes('--retry-writing') && !feedback, '--authorized-retry requires --retry-writing without feedback')
  assert.ok(!additionalRetry && !authorizedRevision, 'Use only one authorization mode')
}
assert.ok(number >= 2, 'Use the production script for the first episode')
const output = episodeDirectory(root, number)
const file = resolve(output, 'state.json')
const release = lockEpisode(output)
const env = { ...readEnvFile(resolve('server/.env')), ...process.env }
const response = await fetch(`${base}/admin-api/auth/login`, { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ account:'admin@mojing.local', password:env.DEV_ADMIN_PASSWORD || 'mojing-dev-only' }) })
assert.equal(response.status, 200)
const { token } = await response.json()
async function api(path, method='GET', input) {
  const response = await fetch(`${base}${path}`, { method, headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${token}` }, ...(input ? { body:JSON.stringify(input) } : {}) })
  const result = await response.json()
  if (!response.ok) throw new Error(`HTTP_${response.status}: ${result.error?.code}`)
  return result
}
let state = existsSync(file) ? JSON.parse(readFileSync(file,'utf8')) : null
const save = () => saveEpisode(file, state)
const previous = JSON.parse(readFileSync(episodeStatePath(root, number - 1),'utf8'))
assert.equal(previous.status, 'complete', 'Finish and publish the previous episode first')
const reference = (await api(`/admin-api/comics/${previous.episodeId}`)).episode
assert.equal(reference.published, true, 'The previous episode must be published')
const referenceMembership = (await api('/admin-api/comics')).items.find(item => item.id === previous.episodeId)
if (state?.episodeNumber) assert.equal(state.episodeNumber, number)
if (state?.previousEpisodeId) assert.equal(state.previousEpisodeId, reference.id, 'Previous episode changed')
if (state?.status === 'complete') {
  assert.ok(!process.argv.some(arg => ['--retry-writing','--accept-story','--review-feedback'].includes(arg)), 'Completed episodes cannot be regenerated')
  console.log(JSON.stringify({ state, writing:null }))
  release()
  process.exit(0)
}
// Recover task IDs from the durable queue if a previous script exited after submission.
function writingJobs(workId) {
  const db = new DatabaseSync(resolve('server/data/mojing.sqlite'), { readOnly:true })
  try { return db.prepare("SELECT id,status FROM generation_jobs WHERE work_id=? AND job_type='text_generation' ORDER BY rowid").all(workId) } finally { db.close() }
}
if (process.argv.includes('--start') && !state) {
  const models = (await api('/admin-api/models')).items.filter(model => model.enabled && (model.kind !== 'text' || ['generation','both'].includes(model.textRole)))
  const select = kind => models.find(model => model.kind === kind && model.isDefault) || models.find(model => model.kind === kind)
  const text = select('text'); const image = models.find(model => model.kind === 'image' && model.model === 'gpt-image-2' && model.endpoint === 'https://api.tu-zi.com/coding/images/generations')
  assert.ok(text && image)
  const sourceDb = new DatabaseSync(resolve('server/data/mojing.sqlite'), { readOnly:true })
  let source
  try { source = sourceDb.prepare('SELECT source_text FROM comic_episodes WHERE id=?').get(reference.id)?.source_text } finally { sourceDb.close() }
  assert.ok(source?.trim(), 'Previous episode source is missing')
  const labels = { 2:'二', 3:'三', 4:'四', 5:'五', 6:'六', 7:'七', 8:'八', 9:'九', 10:'十' }
  const title = `赤潮 · 第${labels[number] || number}话`
  assert.ok(!(await api('/admin-api/comics')).items.some(episode => episode.title === title), 'An episode with this title already exists; recover its state first')
  state = { apiBase:base, title, episodeNumber:number, previousEpisodeId:reference.id, previousWorkId:reference.workId, panelCount:4, textModelId:text.id, textModel:text.model, imageModelId:image.id, imageModel:image.model, imageRetryPolicy:'never', sourceContext:source, writingJobIds:[], storyboardJobIds:[], imageJobIds:[], storyboardReviewed:false, visualReviewed:false, status:'preparing', createdAt:new Date().toISOString() }
  save()
}
if (process.argv.includes('--start') && state && !state.workId) {
  const db = new DatabaseSync(resolve('server/data/mojing.sqlite'), { readOnly:true })
  let recovered
  try {
    const matches = db.prepare('SELECT id FROM works WHERE title=?').all(state.title)
    assert.ok(matches.length <= 1, 'Multiple works have this title; recover the intended work first')
    recovered = matches[0]
  } finally { db.close() }
  const work = recovered ? (await api(`/api/works/${recovered.id}`)).work : (await api('/api/works','POST',{ title:state.title, summary:`续接原创《赤潮》的上一话《${reference.title}》。热血守护题材，人物保持：${reference.characters}。下一话正文目标900到1400汉字，紧接上一话结尾的悬念；保持伤势、围巾破损、武器和人物位置连续，不让重伤无故恢复。通过人物选择、代价、行动与对话推动情绪，避免复述和空泛设定。完整写完一个小段落，留下具体的新悬念。`, type:'短篇小说' })).work
  state.workId = work.id; state.status = 'writing_pending'; save()
}
assert.ok(state?.workId, 'Start next-episode writing first')
const recordedJobs = writingJobs(state.workId)
if (recordedJobs.some(job => !state.writingJobIds.includes(job.id))) {
  state.writingJobIds = recordedJobs.map(job => job.id); save()
}
if ((process.argv.includes('--start') && !state.writingJobIds.length) || process.argv.includes('--retry-writing') || feedback) {
  assert.ok(!state.episodeId, 'Story already accepted; do not rewrite an existing comic')
  assert.ok(!recordedJobs.some(job => ['queued','running'].includes(job.status)), 'Writing is already active')
  if (additionalRetry) {
    assert.equal(state.extraWritingRetryUsed, undefined, 'The one-time additional writing retry was already used')
    assert.equal(state.writingJobIds.length, 3, 'Additional retry is only available after the standard three attempts')
  }
  if (state.writingJobIds.length) {
    const current = (await api(`/api/jobs/${state.writingJobIds.at(-1)}`)).job
    assert.equal(current.status, additionalRetry ? 'failed' : (feedback ? 'success' : 'failed'), 'Revise completed candidates with review feedback; retry only failed jobs')
    if (authorizedRevision) {
      assert.ok(current.result?.content?.trim(), 'A completed candidate is required')
      assert.ok(blockingReviewIssues(current.result.review).length, 'Additional revisions require an unresolved review issue')
    }
    if (feedback) {
      if (current.status === 'success') state.revisionSource = current.result.content
      assert.ok(state.revisionSource, 'A successful candidate is required before an additional revision retry')
      state.reviewFeedback = feedback
      save()
    }
  }
  if (feedback) assert.ok(state.revisionSource, 'Generate a candidate before requesting revisions')
  assert.ok(authorizedRevision || authorizedRetry || state.writingJobIds.length < (additionalRetry ? 4 : 3), 'Writing attempt cap reached')
  if (process.env.COMIC_TEXT_MODEL_ID) {
    const configured = (await api('/admin-api/models')).items.find(model => model.id === process.env.COMIC_TEXT_MODEL_ID && model.enabled && model.kind === 'text' && ['generation','both'].includes(model.textRole))
    assert.ok(configured, 'Selected platform text model is unavailable')
    state.textModelId = configured.id; state.textModel = configured.model; save()
  }
  const revising = Boolean(state.revisionSource && state.reviewFeedback)
  if (!revising && approvedEndingOutline && !state.sourceContext.includes('【审核通过的完本大纲】')) {
    state.sourceContext = `${state.sourceContext}\n\n【审核通过的完本大纲】\n${approvedEndingOutline}\n\n【执行约束】只写当前一话发生的正文；严格追踪人物位置、两块布和伤势；不要把入口敲击、门后声音或其他新悬念作为结尾，完结话必须明确收束。`
    save()
  }
  const queued = await api(`/api/works/${state.workId}/text-jobs`,'POST',{ action:revising ? 'rewrite' : 'continue', modelId:state.textModelId, context:revising ? `${state.sourceContext}\n\n责任编辑审查要求：${state.reviewFeedback}\n只返回修订后的本话完整正文。` : state.sourceContext, selected:revising ? state.revisionSource : '只返回下一话新增的小说正文，不输出分析、提纲、总结或漫画分镜。不要在本话结尾添加大纲之外的新悬念。' })
  state.writingJobIds.push(queued.jobId); state.status = 'writing_running'
  if (authorizedRevision || authorizedRetry) {
    state.authorizedRevisions ||= []
    state.authorizedRevisions.push({ jobId:queued.jobId, previousJobId:recordedJobs.at(-1)?.id,
      authorization:'User authorized continued platform revisions through completion on 2026-10-10',
      mode:authorizedRevision ? 'revision' : 'retry',
      feedbackHash:feedback ? createHash('sha256').update(feedback).digest('hex') : null, requestedAt:new Date().toISOString() })
  }
  if (additionalRetry) state.extraWritingRetryUsed = true
  save()
}
assert.ok(state.writingJobIds.length, 'No writing job found; run --start')
const job = (await api(`/api/jobs/${state.writingJobIds.at(-1)}`)).job
if (job.status === 'success') {
  writeFileSync(resolve(output,'story.txt'), job.result.content)
  if (!state.episodeId) {
    const blockingIssues = blockingReviewIssues(job.result.review)
    state.storyReviewBlockingIssues = blockingIssues
    state.storyReviewRequired = blockingIssues.length > 0
    state.status = blockingIssues.length ? 'writing_review_required' : 'writing_ready'
  }
  delete state.lastWritingError
  save()
} else if (job.status === 'failed') {
  state.status = 'writing_failed'
  state.lastWritingError = job.errorCode || 'WRITING_FAILED'
  save()
}
if (process.argv.includes('--accept-story') && !state.episodeId) {
  assert.equal(job.status,'success')
  assert.ok(job.result.content.trim().length > 300)
  const candidateHash = createHash('sha256').update(job.result.content).digest('hex')
  const frozenReview = state.storyReviewAcceptance?.jobId === job.id && state.storyReviewAcceptance.candidateHash === candidateHash
    ? state.storyReviewAcceptance.review : job.result.review
  assertReviewPassed(frozenReview)
  assert.equal(frozenReview.candidateHash, candidateHash, 'Candidate changed after review')
  state.storyReviewAcceptance = { jobId:job.id, candidateHash, review:frozenReview }
  save()
  const existing = (await api('/admin-api/comics')).items.find(episode => episode.workId === state.workId)
  if (!existing) await api(`/api/works/${state.workId}/blocks`,'PUT',{ items:[{ id:randomUUID(), content:job.result.content, blockType:'text' }] })
  const episode = existing || (await api('/admin-api/comics','POST',{ workId:state.workId, title:state.title, style:reference.style, characters:reference.characters, seriesId:referenceMembership?.seriesId || reference.seriesId, seriesTitle:referenceMembership?.seriesTitle || reference.seriesTitle, episodeNumber:number, rightsConfirmed:true, rightsNote:'用户授权平台模型续写原创赤潮并制作下一话漫画。' })).episode
  assert.equal(episode.sourceHash, candidateHash, 'Comic source must match the reviewed candidate')
  state.storyReviewAcceptance = { jobId:job.id, candidateHash, review:frozenReview }
  state.episodeId = episode.id; state.storyReviewed = true; state.storyReviewRequired = false; state.storyReviewBlockingIssues = []; state.status = 'storyboard_pending'; save()
}
console.log(JSON.stringify({ state, writing:{ id:job.id, status:job.status, errorCode:job.errorCode, characters:job.result?.content?.length || 0 } }))
release()
