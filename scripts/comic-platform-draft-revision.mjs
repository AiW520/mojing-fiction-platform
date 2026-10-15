import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { resolve } from 'node:path'
import { episodeArgument, episodeDirectory, episodeStatePath, lockEpisode, saveEpisode } from './comic-series.mjs'
import { assertReviewPassed, blockingReviewIssues } from './comic-review-gates.mjs'
import { readEnvFile } from '../server/src/config.mjs'

const args = process.argv.slice(2)
const number = episodeArgument(args)
assert.ok(number >= 2)
const parentDirectory = episodeDirectory('artifacts/comic-platform-production', number)
const parent = JSON.parse(readFileSync(resolve(parentDirectory, 'state.json'), 'utf8'))
const output = resolve(parentDirectory, 'revision-1')
const statePath = resolve(output, 'state.json')
const release = lockEpisode(parentDirectory)
const env = { ...readEnvFile(resolve('server/.env')), ...process.env }
const db = new DatabaseSync(resolve('server/data/mojing.sqlite'), { readOnly:true })
try {
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
  assert.equal(original.published, false, 'Only repair an unpublished draft')
  assert.ok(!(await api(`/admin-api/comics/${parent.episodeId}/jobs`)).items.some(job => ['queued','running'].includes(job.status)), 'Original draft still active')
  const previousState = JSON.parse(readFileSync(episodeStatePath('artifacts/comic-platform-production', number - 1), 'utf8'))
  const previous = (await api(`/admin-api/comics/${previousState.episodeId}`)).episode
  assert.equal(previous.published, true)
  const anchors = JSON.parse(readFileSync(resolve(parentDirectory, 'revision-anchors.json'), 'utf8'))
  let state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : null
  if (args.includes('--start') && !state) {
    mkdirSync(output, { recursive:true })
    state = { apiBase:parent.apiBase, title:`${parent.title} · 修订稿`, episodeNumber:number,
      previousEpisodeId:previous.id, previousWorkId:previous.workId, repairedEpisodeId:original.id,
      sourceContext:db.prepare('SELECT source_text FROM comic_episodes WHERE id=?').get(previous.id).source_text,
      revisionSource:db.prepare('SELECT source_text FROM comic_episodes WHERE id=?').get(original.id).source_text,
      panelCount:parent.panelCount, textModelId:parent.textModelId, textModel:parent.textModel,
      imageModelId:parent.imageModelId, imageModel:'gpt-image-2', imageRetryPolicy:'never',
      writingJobIds:[], storyboardJobIds:[], imageJobIds:[], storyReviewed:false, storyboardReviewed:false,
      visualReviewed:false, status:'preparing', createdAt:new Date().toISOString() }
    saveEpisode(statePath, state)
  }
  assert.ok(state, 'Use --start for a new revision')
  assert.equal(state.repairedEpisodeId, original.id)
  const save = () => saveEpisode(statePath, state)
  if (args.includes('--start') && !state.workId) {
    const matches = db.prepare('SELECT id FROM works WHERE title=?').all(state.title)
    assert.ok(matches.length <= 1)
    state.workId = matches[0]?.id || (await api('/api/works', 'POST', { title:state.title, summary:`原创赤潮第${number}话定点修订，严格续接已发布上一话。${anchors.summary}`, type:'短篇小说' })).work.id
    save()
  }
  assert.ok(state.workId)
  const recorded = db.prepare("SELECT id,status FROM generation_jobs WHERE work_id=? AND job_type='text_generation' ORDER BY rowid").all(state.workId)
  state.writingJobIds = recorded.map(job => job.id)
  save()
  if ((args.includes('--start') && !recorded.length) || args.includes('--authorized-revision')) {
    assert.ok(!state.episodeId, 'Accepted revision cannot be rewritten')
    assert.ok(!recorded.some(job => ['queued','running'].includes(job.status)), 'Revision already active')
    const feedbackIndex = args.indexOf('--review-feedback')
    const feedbackFile = feedbackIndex < 0 ? resolve(parentDirectory, 'repair-review-feedback.txt') : resolve(args[feedbackIndex + 1])
    const feedback = readFileSync(feedbackFile, 'utf8').trim()
    assert.ok(feedback && feedback.length <= 3000)
    if (recorded.length) {
      const last = (await api(`/api/jobs/${recorded.at(-1).id}`)).job
      assert.equal(last.status, 'success', 'Investigate failed or unknown jobs before recovery')
      assert.ok(last.result?.content?.trim())
      state.revisionSource = last.result.content
      writeFileSync(resolve(output, `story-${last.id}.txt`), last.result.content)
      writeFileSync(resolve(output, `review-${last.id}.json`), JSON.stringify(last.result.review, null, 2))
    }
    const queued = await api(`/api/works/${state.workId}/text-jobs`, 'POST', { action:'rewrite', modelId:state.textModelId,
      context:`已发布上一话完整正文：\n${state.sourceContext}\n\n责任编辑定点修订要求：\n${feedback}\n只返回本话完整正文。`, selected:state.revisionSource })
    state.writingJobIds.push(queued.jobId)
    state.authorizedRevisions ||= []
    state.authorizedRevisions.push({ jobId:queued.jobId, feedbackFile, feedbackHash:createHash('sha256').update(feedback).digest('hex'), requestedAt:new Date().toISOString(), authorization:'User authorized necessary revisions and recovery through completion' })
    state.status = 'writing_running'
    save()
  }
  assert.ok(state.writingJobIds.length)
  const job = (await api(`/api/jobs/${state.writingJobIds.at(-1)}`)).job
  if (job.status === 'success') {
    writeFileSync(resolve(output, 'story.txt'), job.result.content)
    writeFileSync(resolve(output, 'story-review.json'), JSON.stringify(job.result.review, null, 2))
    if (!state.episodeId) {
      state.storyReviewBlockingIssues = blockingReviewIssues(job.result.review)
      state.storyReviewRequired = state.storyReviewBlockingIssues.length > 0
      state.status = state.storyReviewRequired ? 'writing_review_required' : 'writing_ready'
      save()
    }
  } else if (job.status === 'failed') {
    state.status = 'writing_failed'
    state.lastWritingError = job.errorCode
    save()
  }
  if (args.includes('--accept-story') && !state.episodeId) {
    assert.equal(job.status, 'success')
    assertReviewPassed(job.result.review)
    const candidateHash = createHash('sha256').update(job.result.content).digest('hex')
    assert.equal(job.result.review.candidateHash, candidateHash)
    let episode = (await api('/admin-api/comics')).items.find(item => item.workId === state.workId)
    if (!episode) {
      await api(`/api/works/${state.workId}/blocks`, 'PUT', { items:[{ id:randomUUID(), content:job.result.content, blockType:'text' }] })
      // The API reserves episode numbers for drafts too. Keep the rejected draft in an archive series.
      const membership = db.prepare('SELECT series_id,series_title,episode_number,published_json FROM comic_episodes WHERE id=?').get(original.id)
      if (membership.series_id === previous.seriesId) {
        assert.equal(membership.published_json, null)
        const archiveFile = resolve(output, 'original-membership.json')
        if (!existsSync(archiveFile)) writeFileSync(archiveFile, JSON.stringify({ episodeId:original.id, ...membership, reason:'Rejected unpublished draft preserved separately so reviewed replacement can retain its episode number' }, null, 2))
        const maintenance = new DatabaseSync(resolve('server/data/mojing.sqlite'))
        try {
          assert.ok(!maintenance.prepare("SELECT id FROM generation_jobs WHERE status IN ('queued','running') AND json_extract(request_json,'$.episodeId')=?").get(original.id))
          maintenance.prepare('UPDATE comic_episodes SET series_id=?,series_title=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND published_json IS NULL AND series_id=?')
            .run(`comic-archive-${original.id}`, '赤潮修订前存档', original.id, previous.seriesId)
        } finally { maintenance.close() }
      }
      episode = (await api('/admin-api/comics', 'POST', { workId:state.workId, title:parent.title, style:anchors.style,
        characters:anchors.characters, seriesId:previous.seriesId, seriesTitle:previous.seriesTitle, episodeNumber:number,
        rightsConfirmed:true, rightsNote:'用户授权原创赤潮定点修订，旧稿及付费素材保留。' })).episode
    }
    assert.equal(episode.sourceHash, candidateHash)
    state.storyReviewAcceptance = { jobId:job.id, candidateHash, review:job.result.review }
    state.episodeId = episode.id
    state.storyReviewed = true
    state.storyReviewRequired = false
    state.status = 'storyboard_pending'
    save()
  }
  console.log(JSON.stringify({ output, status:state.status, workId:state.workId, episodeId:state.episodeId, writing:{ id:job.id, status:job.status, errorCode:job.errorCode, review:job.result?.review } }))
} finally { db.close(); release() }
