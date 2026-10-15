import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, renameSync, appendFileSync } from 'node:fs'
import { resolve, join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { acquireLock, processAlive } from './campus-comic-lock.mjs'
import { isProviderBlocked } from './scene-artwork-retry-policy.mjs'

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const lane = process.argv[2]
if (!['ghost-033-066', 'ghost-067-100', 'cold-001-032', 'cold-033-065'].includes(lane)) throw new Error('Pass an assigned production lane')
const root = join(project, 'artifacts/comic-bulk-production', lane)
const release = acquireLock(join(root, 'watchdog.lock'))
process.once('exit', release)
const sleep = milliseconds => new Promise(done => setTimeout(done, milliseconds))
const statusPath = join(root, 'watchdog-status.json')
const logPath = join(root, 'watchdog-events.jsonl')
function status(state, details = {}) {
  const temporary = `${statusPath}.${process.pid}.tmp`
  writeFileSync(temporary, JSON.stringify({ pid: process.pid, lane, state, updatedAt: new Date().toISOString(), ...details }, null, 2))
  renameSync(temporary, statusPath)
}
function generate(ids) {
  return new Promise(done => {
    const args = [join(project, 'scripts/generate-scene-artwork-batch.mjs'), String(ids ? ids.length : 40), ...(ids || [])]
    const child = spawn(process.execPath, args, { cwd: project, windowsHide: true, env: { ...process.env, SCENE_ARTWORK_ROOT: root, SCENE_IMAGE_CONCURRENCY: process.env.SCENE_IMAGE_CONCURRENCY || '8' }, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = '', overflow = false, lastError = '', providerBlocked = false
    const onChunk = bytes => {
      output += bytes.toString('utf8')
      if (output.length > 150000) { output = ''; overflow = true }
      let end
      while ((end = output.indexOf('\n')) >= 0) {
        const line = output.slice(0, end).trim(); output = output.slice(end + 1)
        let event
        try { event = JSON.parse(line) } catch { continue }
        if (event.error) { lastError = event.error; providerBlocked ||= isProviderBlocked(lastError) }
        appendFileSync(logPath, JSON.stringify({ at: new Date().toISOString(), ...event }) + '\n')
      }
    }
    child.stdout.on('data', onChunk)
    child.stderr.on('data', onChunk)
    child.once('error', () => done({ code: 1, lastError: 'GENERATOR_START_FAILED' }))
    child.once('close', code => done({ code, providerBlocked, lastError: overflow ? 'GENERATOR_LOG_OVERFLOW' : lastError }))
  })
}
try {
  while (true) {
    if (existsSync(join(root, 'STOP'))) { status('paused'); break }
    if (['generation.lock', 'publication.lock'].some(name => existsSync(join(root, name)))) {
      const file = join(root, existsSync(join(root, 'generation.lock')) ? 'generation.lock' : 'publication.lock')
      const owner = Number(readFileSync(file, 'utf8').trim())
      status(processAlive(owner) ? 'waiting_for_active_batch' : 'stale_production_lock', { lock: basename(file), owner })
      await sleep(15000)
      continue
    }
    const plan = JSON.parse(readFileSync(join(root, 'plan.json'), 'utf8'))
    const ledger = JSON.parse(readFileSync(join(root, 'ledger.json'), 'utf8'))
    const counts = {}
    for (const entry of plan.entries) {
      const value = ledger.entries[entry.id]?.status || entry.status
      counts[value] = (counts[value] || 0) + 1
    }
    if (plan.entries.every(e => e.status === 'existing' || ledger.entries[e.id]?.status === 'published')) { status('complete', { counts }); break }
    const blocked = Object.values(ledger.entries).find(s => s.status === 'failed' && isProviderBlocked(s.error || ''))
    if (blocked) { status('provider_blocked', { counts, error: blocked.error }); break }
    const retry = plan.entries.filter(e => ['failed', 'visual_rejected'].includes(ledger.entries[e.id]?.status) && ledger.entries[e.id]?.retryAuthorization && !ledger.entries[e.id].retryAuthorization.consumedAt).slice(0, 40)
    const ready = plan.entries.filter(e => e.status === 'pending' && !e.productionLane && e.promptReviewedAt && e.prompt && !ledger.entries[e.id])
    if (!retry.length && !ready.length) { status('waiting_for_planning_or_review', { counts }); await sleep(15000); continue }
    status('generating', { counts, ready: ready.length, retries: retry.length })
    const result = await generate(retry.length ? retry.map(e => e.id) : null)
    if (result.providerBlocked) { status('provider_blocked', { error: result.lastError }); break }
    if (result.code !== 0) { status('batch_requires_attention', { error: result.lastError || 'GENERATOR_EXIT_FAILED' }); await sleep(60000) }
    else await sleep(15000)
  }
} finally { release() }
