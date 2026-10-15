import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { resolve } from 'node:path'
import { readEnvFile } from '../server/src/config.mjs'
import { episodeArgument, episodeDirectory, lockEpisode } from './comic-series.mjs'
import { assertReviewPassed, blockingReviewIssues } from './comic-review-gates.mjs'

const base = 'http://127.0.0.1:3000'
const number = episodeArgument(process.argv.slice(2))
assert.ok(!number || !process.env.COMIC_PRODUCTION_DIR, 'Use either --episode or COMIC_PRODUCTION_DIR')
const output = number ? episodeDirectory('artifacts/comic-platform-production', number) : resolve(process.env.COMIC_PRODUCTION_DIR || 'artifacts/comic-platform-production')
const statePath = resolve(output, 'state.json')
const release = lockEpisode(output)
const holdPath = resolve(output, 'generation-hold.json')
if (existsSync(holdPath) && process.argv.some(argument => ['--start','--retry-storyboard','--images'].includes(argument))) {
  throw new Error(`GENERATION_HOLD: Inspect ${holdPath}; reconcile the provider failure before new paid requests`)
}
const env = { ...readEnvFile(resolve('server/.env')), ...process.env }
const login = await fetch(`${base}/admin-api/auth/login`, { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ account:'admin@mojing.local', password:env.DEV_ADMIN_PASSWORD || 'mojing-dev-only' }) })
if (!login.ok) throw new Error(`PLATFORM_LOGIN_HTTP_${login.status}`)
const { token } = await login.json()
async function api(path, method='GET', input) {
  const response = await fetch(`${base}${path}`, { method, headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${token}` }, ...(input ? { body:JSON.stringify(input) } : {}) })
  const payload = await response.json()
  if (!response.ok) throw new Error(`${path}: HTTP_${response.status} ${payload.error?.code || ''}`)
  return payload
}
let state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : null
if (number && number > 1) assert.ok(state?.episodeId, 'Accept the platform-generated story with comic-platform-next.mjs first')
function save() {
  state.updatedAt = new Date().toISOString()
  const temporary = `${statePath}.${process.pid}.tmp`
  writeFileSync(temporary, JSON.stringify(state, null, 2))
  renameSync(temporary, statePath)
}
if (process.argv.includes('--start') && !state?.episodeId) {
  const models = (await api('/admin-api/models')).items.filter(model => model.enabled)
  const select = kind => models.find(model => model.kind === kind && model.isDefault) || models.find(model => model.kind === kind)
  const text = select('text'); const image = select('image')
  assert.ok(text && image, 'Both platform model types must be configured')
  const old = JSON.parse(readFileSync(resolve('artifacts/comic-live-smoke/manifest.json'), 'utf8'))
  const db = new DatabaseSync(resolve('artifacts/comic-live-smoke/data/mojing.sqlite'), { readOnly:true })
  let source
  try { source = db.prepare('SELECT source_text,style,characters FROM comic_episodes WHERE id=?').get(old.episodeId) } finally { db.close() }
  assert.ok(source?.source_text)
  state ||= { apiBase:base, title:'赤潮 · 守住最后一盏灯（平台模型版）', createdAt:new Date().toISOString(), textModelId:text.id, textModel:text.model, imageModelId:image.id, imageModel:image.model, storyboardJobIds:[], imageJobIds:[], status:'preparing', storyboardReviewed:false, visualReviewed:false }
  save()
  if (!state.workId) {
    const work = (await api('/api/works', 'POST', { title:state.title, summary:source.source_text, type:'短篇小说' })).work
    state.workId = work.id; save()
  }
  await api(`/api/works/${state.workId}/blocks`, 'PUT', { items:[{ id:randomUUID(), content:source.source_text, blockType:'text' }] })
  const episode = (await api('/admin-api/comics', 'POST', { workId:state.workId, title:state.title, style:source.style, characters:source.characters, rightsConfirmed:true, rightsNote:'原创赤潮样章；用户授权使用平台配置模型完成分镜及漫画制作。' })).episode
  state.episodeId = episode.id; state.status = 'storyboard_pending'; save()
}
assert.ok(state?.episodeId, 'Start the platform campaign first')
const path = `/admin-api/comics/${state.episodeId}`
let episode = (await api(path)).episode
let jobs = (await api(`${path}/jobs`)).items
let sourceReview
if (state.writingJobIds?.length) {
  const writing = (await api(`/api/jobs/${state.writingJobIds.at(-1)}`)).job
  sourceReview = writing.result?.review
  // Applying the accepted candidate changes the work context, so use its frozen acceptance report.
  const acceptance = state.storyReviewAcceptance
  if (acceptance?.jobId === writing.id && acceptance.candidateHash === episode.sourceHash && acceptance.review?.candidateHash === episode.sourceHash) sourceReview = acceptance.review
  state.storyReviewBlockingIssues = blockingReviewIssues(sourceReview)
  if (sourceReview?.candidateHash !== episode.sourceHash) state.storyReviewBlockingIssues.push({ severity:'blocking', reason:'Source changed after review' })
  state.storyReviewRequired = state.storyReviewBlockingIssues.length > 0
  if (state.storyReviewRequired) state.storyReviewed = false
  save()
}
function requireStoryReview() {
  if (!state.writingJobIds?.length) return
  assertReviewPassed(sourceReview)
  assert.equal(sourceReview.candidateHash, episode.sourceHash, 'Source changed after story review')
  assert.equal(state.storyReviewed, true, 'Review the platform-generated story first')
}
for (const job of jobs) {
  const key = job.type === 'comic_storyboard' ? 'storyboardJobIds' : 'imageJobIds'
  if (!state[key].includes(job.id)) { state[key].push(job.id); save() }
}
assert.ok(state.status !== 'complete' || !process.argv.some(arg => ['--retry-storyboard','--accept-storyboard','--images','--approve-images','--publish'].includes(arg)), 'Completed episodes are read-only')
if ((process.argv.includes('--start') && !state.storyboardJobIds.length) || process.argv.includes('--retry-storyboard')) {
  assert.ok(!jobs.some(job => ['queued','running'].includes(job.status)), 'A task is already active')
  assert.ok(state.storyboardJobIds.length < 3, 'Three storyboard attempts exhausted')
  const result = await api(`${path}/storyboard`, 'POST', { version:episode.version, modelId:state.textModelId, panelCount:state.panelCount || 3 })
  state.storyboardJobIds.push(result.jobId); state.storyboardReviewed = false; state.status = 'storyboard_running'; save()
}
if (process.argv.includes('--accept-storyboard')) {
  assert.equal(episode.panels.length, state.panelCount || 3, 'Review the actual panel count before proceeding')
  assert.ok(jobs.some(job => job.type === 'comic_storyboard' && job.status === 'success'))
  state.storyboardReviewed = true; state.status = 'storyboard_approved'; save()
}
if (process.argv.includes('--images')) {
  requireStoryReview()
  assert.equal(state.storyboardReviewed, true, 'Review platform-generated storyboard first')
  const retryPolicy = process.env.COMIC_IMAGE_RETRY_POLICY || state.imageRetryPolicy || 'never'
  assert.equal(retryPolicy, 'never', 'Use only the selected Tuzi coding gpt-image-2 model; do not switch image models')
  const selected = (await api('/admin-api/models')).items.find(model => model.id === state.imageModelId)
  assert.ok(selected?.enabled && selected.kind === 'image' && selected.model === 'gpt-image-2' && selected.endpoint === 'https://api.tu-zi.com/coding/images/generations', 'Select the configured Tuzi coding gpt-image-2 model')
  const unfinished = episode.panels.filter(panel => !panel.imageId)
  if (unfinished.length) {
    const busy = new Set(jobs.filter(job => ['queued','running'].includes(job.status)).map(job => job.result?.panelId))
    assert.ok(!jobs.some(job => job.type === 'comic_panel_image' && ['queued','running'].includes(job.status)), 'Image generation is already active')
    const authorizedImages = process.argv.includes('--authorized-images')
    assert.ok(authorizedImages || state.imageJobIds.length + unfinished.length <= episode.panels.length * 2, 'Image retry budget exhausted')
    const result = await api(`${path}/images`, 'POST', { version:episode.version, modelId:state.imageModelId, retryPolicy, panelIds:unfinished.filter(panel => !busy.has(panel.id)).map(panel => panel.id) })
    state.imageJobIds.push(...result.jobIds); state.imageRetryPolicy = retryPolicy; state.status = 'images_running'; save()
    if (authorizedImages) {
      state.authorizedImageRetries ||= []
      state.authorizedImageRetries.push({ jobIds:result.jobIds, requestedAt:new Date().toISOString(),
        authorization:'User authorized continued platform generation through completion on 2026-10-10' })
      save()
    }
  }
}
if (process.argv.includes('--approve-images')) {
  requireStoryReview()
  assert.ok(episode.panels.every(panel => panel.imageId), 'All panels must have generated images')
  assert.ok(!jobs.some(job => ['queued','running'].includes(job.status)))
  episode = (await api(path, 'PUT', { version:episode.version, panels:episode.panels.map(panel => ({ ...panel, approved:true })) })).episode
  state.visualReviewed = true; state.status = 'visual_approved'; save()
}
if (process.argv.includes('--publish')) {
  requireStoryReview()
  assert.equal(state.visualReviewed, true, 'Inspect actual images before publication')
  assert.ok(episode.panels.every(panel => panel.imageId && panel.approved))
  episode = (await api(`${path}/publish`, 'POST', { version:episode.version })).episode
  state.status = 'complete'; state.readerUrl = `${base}/comics/${episode.id}`; save()
}
episode = (await api(path)).episode
jobs = (await api(`${path}/jobs`)).items
if (state.status === 'images_running' && !jobs.some(job => ['queued','running'].includes(job.status))) {
  state.status = episode.panels.every(panel => panel.imageId) ? (state.storyReviewRequired ? 'sample_review_required' : 'images_review_required') : 'images_failed'
  save()
}
for (const [index, panel] of episode.panels.entries()) {
  if (!panel.imageId) continue
  const response = await fetch(`${base}/api/comic-media/${panel.imageId}/original`, { headers:{ Authorization:`Bearer ${token}` } })
  assert.equal(response.status, 200)
  writeFileSync(resolve(output, `panel-${index + 1}.png`), Buffer.from(await response.arrayBuffer()))
}
writeFileSync(resolve(output, 'results.json'), JSON.stringify({ episode, jobs }, null, 2))
console.log(JSON.stringify({ state, episode:{ version:episode.version, panels:episode.panels, published:episode.published }, jobs:jobs.map(job => ({ id:job.id, type:job.type, status:job.status, errorCode:job.errorCode, attempts:job.result?.attempts })) }))
release()
