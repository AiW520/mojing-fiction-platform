import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { readEnvFile } from '../server/src/config.mjs'
import { acquireLock } from './campus-comic-lock.mjs'

const root = resolve(import.meta.dirname, '..')
const releaseLock = acquireLock(resolve(root, 'artifacts/campus-rebirth-comic/.advance.lock'))
process.once('exit', releaseLock)
const state = JSON.parse(readFileSync(resolve(root, 'artifacts/campus-rebirth-comic/state.json'), 'utf8'))
assert.ok(state.ongoingAuthorization, 'Continuous production requires user authorization')
const env = { ...readEnvFile(resolve(root, 'server/.env')), ...process.env }
const login = await fetch(`${state.apiBase}/admin-api/auth/login`, { method: 'POST', signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ account: 'admin@mojing.local', password: env.DEV_ADMIN_PASSWORD || 'mojing-dev-only' }) })
assert.ok(login.ok, `LOGIN_${login.status}`)
const { token } = await login.json()
async function api(path) {
  const response = await fetch(`${state.apiBase}${path}`, { signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${token}` } })
  assert.ok(response.ok, `HTTP_${response.status}`)
  return response.json()
}
function run(number, ...args) {
  const result = spawnSync(process.execPath, [resolve(root, 'scripts/campus-comic-production.mjs'), `--episode=${number}`, ...args], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 180000 })
  if (result.status !== 0) {
    console.error(result.stderr)
    process.exit(result.status || 1)
  }
  const latest = JSON.parse(readFileSync(resolve(root, 'artifacts/campus-rebirth-comic/state.json'), 'utf8'))
  console.log(JSON.stringify({ action: args, episode: number, status: latest.status }))
}
function retryReady(job, attempts = 1) {
  const value = job.finishedAt || job.updatedAt || ''
  const finished = Date.parse(value.includes(' ') ? `${value.replace(' ', 'T')}Z` : value)
  const credentialOrQuotaError = /401|403|BALANCE|QUOTA|CREDENTIAL|KEY_MISSING|MODEL_NOT_AVAILABLE/.test(job.errorCode || '')
  const delay = credentialOrQuotaError ? 900000 : Math.min(300000, 60000 * 2 ** Math.min(Math.max(0, attempts - 1), 3))
  return Number.isFinite(finished) && Date.now() - finished >= delay
}
function providerBlocked(job) {
  return /401|402|403|BALANCE|QUOTA|CREDENTIAL|KEY_MISSING|MODEL_NOT_AVAILABLE/.test(job?.errorCode || '')
}
function resultUnknown(job) {
  // The skill transport maps timeouts and output failures to 502 without preserving their uncertainty.
  return Boolean(job?.errorCode === 'PROVIDER_HTTP_502' || job?.result?.resultUnknown || job?.result?.attempts?.some(attempt => attempt.resultUnknown))
}
function reviewPassed(job) {
  return job.status === 'success' && job.result?.candidateHash && job.result?.review?.status === 'success' && job.result.review.candidateHash === job.result.candidateHash && Array.isArray(job.result.review.issues) && !job.result.review.issues.some(i => ['blocking', 'severe'].includes(i.severity))
}
for (const published of state.episodes.filter(e => e.published)) {
  const evidenceFile = resolve(root, `artifacts/campus-rebirth-comic/episode-${published.number}/reader-results.json`)
  let evidence = null
  try { if (existsSync(evidenceFile)) evidence = JSON.parse(readFileSync(evidenceFile, 'utf8')) } catch {}
  if (evidence?.episodeId === published.episodeId && evidence.publishedVersion === published.publishedVersion) continue
  const checked = spawnSync(process.execPath, [resolve(root, 'scripts/campus-comic-reader-qa.mjs'), `--episode=${published.number}`], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 180000 })
  assert.equal(checked.status, 0, 'READER_QA_FAILED')
  console.log(JSON.stringify({ status: 'reader_verified', episode: published.number }))
  process.exit(0)
}
const episode = state.episodes.find(e => !e.published)
if (!episode) {
  const next = Math.max(0, ...state.episodes.map(e => e.number)) + 1
  if (next <= state.authorizedEpisodeCount) run(next, '--write')
  else console.log(JSON.stringify({ status: 'planned_volume_complete', published: state.episodes.length }))
  process.exit(0)
}
const production = await api('/admin-api/production')
if (production.jobs.some(j => j.workId === episode.workId && ['queued', 'running'].includes(j.status))) {
  console.log(JSON.stringify({ episode: episode.number, status: 'waiting_for_active_job' }))
  process.exit(0)
}
if (!episode.storyApproved) {
  if (!episode.writingJobIds.length) run(episode.number, '--write')
  else {
    const { job } = await api(`/api/jobs/${episode.writingJobIds.at(-1)}`)
    if (['queued', 'running'].includes(job.status)) console.log(JSON.stringify({ status: 'waiting', jobId: job.id }))
    else if (job.status === 'failed' && providerBlocked(job)) console.log(JSON.stringify({ status: 'paused_provider_auth', episode: episode.number, errorCode: job.errorCode }))
    else if (job.status === 'failed' && resultUnknown(job)) console.log(JSON.stringify({ status: 'paused_unknown_paid_result', episode: episode.number, jobId: job.id }))
    else if (job.status === 'failed' && retryReady(job, episode.writingJobIds.length)) run(episode.number, '--retry-writing')
    else if (reviewPassed(job)) run(episode.number, '--accept-story')
    else if (job.status === 'success') run(episode.number, '--revise-story')
    else console.log(JSON.stringify({ status: 'retry_backoff', jobId: job.id }))
  }
  process.exit(0)
}
if (!episode.storyboardApproved) {
  if (!episode.storyboardRevisionJobId) run(episode.number, '--reviewed-storyboard')
  else {
    const { job } = await api(`/api/jobs/${episode.storyboardRevisionJobId}`)
    let valid = false
    if (reviewPassed(job)) {
      try {
        const { panels } = JSON.parse(job.result.content)
        valid = panels.length === state.panelCount && panels.every(p => typeof p.prompt === 'string' && p.prompt.trim() && typeof p.narration === 'string' && p.narration.length <= 45 && typeof p.dialogue === 'string' && p.dialogue.length <= 65) && panels.map(p => p.dialogue).join('').length <= (episode.storyboardRefinementUsed ? 65 : 100)
      } catch {}
    }
    if (valid) run(episode.number, '--accept-storyboard-revision')
    else if (job.status === 'failed' && providerBlocked(job)) console.log(JSON.stringify({ status: 'paused_provider_auth', episode: episode.number, errorCode: job.errorCode }))
    else if (job.status === 'failed' && resultUnknown(job)) console.log(JSON.stringify({ status: 'paused_unknown_paid_result', episode: episode.number, jobId: job.id }))
    else if (job.status === 'success' || (job.status === 'failed' && retryReady(job, episode.storyboardRevisionJobIds?.length))) run(episode.number, '--reviewed-storyboard')
    else console.log(JSON.stringify({ status: 'waiting', jobId: job.id }))
  }
  process.exit(0)
}
const { episode: draft } = await api(`/admin-api/comics/${episode.episodeId}`)
const { items: jobs } = await api(`/admin-api/comics/${episode.episodeId}/jobs`)
if (jobs.some(j => ['queued', 'running'].includes(j.status))) {
  console.log(JSON.stringify({ status: 'waiting_for_images', episode: episode.number }))
} else if (!episode.imageJobIds.length) run(episode.number, '--images')
else if (draft.panels.some(p => !p.imageId)) {
  const failed = jobs.filter(j => episode.imageJobIds.includes(j.id) && j.status === 'failed')
  const details = []
  for (const job of failed) details.push((await api(`/api/jobs/${job.id}`)).job)
  const blocked = details.find(providerBlocked)
  const unknown = details.find(resultUnknown)
  if (blocked) console.log(JSON.stringify({ status: 'paused_provider_auth', episode: episode.number, errorCode: blocked.errorCode }))
  else if (unknown) console.log(JSON.stringify({ status: 'paused_unknown_paid_result', episode: episode.number, jobId: unknown.id }))
  else if (details.length && details.every(detail => retryReady(detail, 1 + (episode.retryHistory || []).filter(item => item.kind === 'image_retry').length))) run(episode.number, '--retry-images')
  else console.log(JSON.stringify({ status: 'retry_backoff', episode: episode.number }))
} else if (!episode.visualApproved) {
  run(episode.number)
  console.log(JSON.stringify({ status: 'visual_review_required', episode: episode.number, directory: `artifacts/campus-rebirth-comic/episode-${episode.number}`, next: `node scripts/campus-comic-production.mjs --episode=${episode.number} --accept-images --publish` }))
} else run(episode.number, '--publish')
