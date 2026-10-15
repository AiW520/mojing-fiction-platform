import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { readEnvFile } from '../server/src/config.mjs'
import { assertReviewPassed } from './comic-review-gates.mjs'
import { lockEpisode, saveEpisode } from './comic-series.mjs'

const root = resolve('artifacts/comic-platform-production/episode-6')
const statePath = resolve(root, 'state.json')
const state = JSON.parse(readFileSync(statePath, 'utf8'))
const release = lockEpisode(root)
const candidate = readFileSync(resolve(root, 'story.txt'), 'utf8').trim()
assert.ok(candidate.startsWith('“别松！”'), 'Rewrite the sixth episode, not the previous episode')
const feedback = readFileSync(resolve(root, 'revision-feedback-2.txt'), 'utf8').trim()
const env = { ...readEnvFile(resolve('server/.env')), ...process.env }
const login = await fetch(`${state.apiBase}/admin-api/auth/login`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ account:'admin@mojing.local', password:env.DEV_ADMIN_PASSWORD || 'mojing-dev-only' }) })
assert.equal(login.status, 200)
const { token } = await login.json()
async function api(path, method='GET', input) {
  const response = await fetch(`${state.apiBase}${path}`, { method, headers:{'Content-Type':'application/json', Authorization:`Bearer ${token}`}, ...(input ? { body:JSON.stringify(input) } : {}) })
  const result = await response.json(); assert.ok(response.ok, `HTTP_${response.status}: ${result.error?.code || ''}`); return result
}
const oldEpisode = (await api(`/admin-api/comics/${state.episodeId}`)).episode
const { items:jobs } = await api(`/admin-api/comics/${state.episodeId}/jobs`)
assert.ok(!jobs.some(job => ['queued','running'].includes(job.status)), 'Comic generation still active')
const jobId = state.correctCandidateRevisionJobId || (await api(`/api/works/${state.workId}/text-jobs`, 'POST', {
  action:'rewrite', modelId:state.textModelId,
  context:`上一话已发布结束状态：年轻男人眼白被黑浸透，门外声音问陆燃“你还要守哪一边？”；孩子抱着从陆燃无力左手滑落的干布，尚未交代血迹。修订原文在selected，不可重写上一话营救和撬棍救靴。\n责任编辑定点修订要求：${feedback}\n只返回第六话修订后的完整正文。`,
  selected:candidate, maxTokens:2400
})).jobId
state.correctCandidateRevisionJobId = jobId
state.rejectedRevision ||= { jobId:state.authorizedStoryRevisionJobId, episodeId:state.episodeId, reason:'Previous episode supplied as selected; repeats published episode five', rejectedAt:new Date().toISOString() }
saveEpisode(statePath,state)
const job = (await api(`/api/jobs/${jobId}`)).job
if (job.status !== 'success') {
  console.log(JSON.stringify({jobId,status:job.status,errorCode:job.errorCode}))
  release()
  process.exit(0)
}
if (state.storyReviewAcceptance?.jobId === jobId) {
  console.log(JSON.stringify({jobId,status:'already_applied',episodeId:state.episodeId}))
  release()
  process.exit(0)
}
assert.ok(job.result?.content?.trim())
const content = job.result.content
assert.ok(!content.includes('“抱走他！”'), 'Candidate repeats published episode five')
const candidateHash = createHash('sha256').update(content).digest('hex')
assert.equal(job.result.review.candidateHash, candidateHash)
const revisionNumber = state.revisionAttempts?.length ? 3 : 2
writeFileSync(resolve(root,`story-revision-${revisionNumber}.txt`), content)
writeFileSync(resolve(root,`story-revision-${revisionNumber}-review.json`), JSON.stringify(job.result.review,null,2))
assertReviewPassed(job.result.review)
if (!process.argv.includes('--accept')) {
  console.log(JSON.stringify({jobId,status:'review_ready',score:job.result.review.score,issues:job.result.review.issues}))
  release()
  process.exit(0)
}
const workBlocks = await api(`/api/works/${state.workId}/blocks`, 'PUT', { items:[{ id:randomUUID(), content, blockType:'text' }] })
const episode = (await api('/admin-api/comics', 'POST', {
  workId:state.workId, title:state.title, style:oldEpisode.style, characters:oldEpisode.characters,
  rightsConfirmed:true, rightsNote:'用户授权平台模型定点修订第六话并继续完成原创赤潮。'
})).episode
state.priorEpisodeId = state.episodeId
state.episodeId = episode.id
assert.equal(episode.sourceHash,candidateHash)
if (!state.writingJobIds.includes(jobId)) state.writingJobIds.push(jobId)
state.storyRevisionSource = content
state.sourceContext = content
state.storyReviewAcceptance = { jobId, candidateHash, review:job.result.review }
state.storyReviewBlockingIssues = []
state.storyReviewRequired = false
state.storyReviewed = true
state.storyboardJobIds = []
state.imageJobIds = []
state.storyboardReviewed = false
state.visualReviewed = false
state.status = 'storyboard_pending'
state.authorizedRevisions ||= []
state.authorizedRevisions.push({ jobId, previousJobId:state.writingJobIds?.at(-1), authorization:'User authorized continued platform revisions through completion on 2026-10-10', feedbackHash:createHash('sha256').update(feedback).digest('hex'), requestedAt:new Date().toISOString() })
state.updatedAt = new Date().toISOString(); writeFileSync(statePath, JSON.stringify(state,null,2))
console.log(JSON.stringify({ jobId, episodeId:episode.id, priorEpisodeId:state.priorEpisodeId, candidateHash, score:job.result.review.score, workBlocks:workBlocks ? true : false }))
release()
