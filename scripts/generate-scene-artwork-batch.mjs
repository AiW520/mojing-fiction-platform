import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, openSync, closeSync, unlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { sceneImageConfig } from './scene-image-config.mjs'
import { isProviderBlocked, shouldRetryGeneration, retryDelay } from './scene-artwork-retry-policy.mjs'

const project = fileURLToPath(new URL('..', import.meta.url))
export async function runConcurrentBatch(items, concurrency, processItem) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32) throw new Error('Concurrency must be an integer from 1 to 32')
  const controller = new AbortController()
  let cursor = 0
  let failure
  async function worker() {
    while (!controller.signal.aborted && cursor < items.length) {
      const item = items[cursor++]
      try {
        await processItem(item, controller.signal)
      } catch (error) {
        if (!controller.signal.aborted) {
          failure = error
          controller.abort()
        }
      }
    }
  }
  // Workers absorb failures so the caller keeps its lock until every request settles.
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
  if (controller.signal.aborted) throw failure
}

export function waitForRetry(milliseconds, signal) {
  if (signal.aborted) return Promise.resolve(false)
  return new Promise(resolveWait => {
    const finish = ready => {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      resolveWait(ready)
    }
    const abort = () => finish(false)
    const timer = setTimeout(() => finish(true), milliseconds)
    signal.addEventListener('abort', abort, { once: true })
  })
}

async function main() {
const require = createRequire(resolve(project, 'server/package.json'))
const sharp = require('sharp')
const batchSize = Number(process.argv[2] || 5)
if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) throw new Error('Batch size must be an integer from 1 to 1000')
const concurrency = Number(process.env.SCENE_IMAGE_CONCURRENCY || 1)
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32) throw new Error('SCENE_IMAGE_CONCURRENCY must be an integer from 1 to 32')
const retryIds = process.argv.slice(3)
if (new Set(retryIds).size !== retryIds.length) throw new Error('Duplicate retry IDs')
const root = resolve(process.env.SCENE_ARTWORK_ROOT || resolve(project, 'artifacts/full-scene-artwork'))
const generator = resolve(process.env.TUZI_GENERATOR || 'C:/Users/ZhuanZ1/.codex/skills/tuzi-image-generation/scripts/generate_image.py')
const imageConfig = sceneImageConfig(project)
const configuredGenerator = resolve(project, 'scripts/generate-configured-scene-image.py')
const lockPath = join(root, 'generation.lock')
const lock = openSync(lockPath, 'wx')
writeFileSync(lock, String(process.pid))
const ledgerPath = join(root, 'ledger.json')
function save(value) {
  const temporary = ledgerPath + '.tmp'
  writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', 'utf8')
  renameSync(temporary, ledgerPath)
}
function generate(args) {
  return new Promise((resolveResult, reject) => {
    const child = spawn('python', [imageConfig.key ? configuredGenerator : generator, ...args], { windowsHide: true, env: {
      ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1',
      ...(imageConfig.key ? { TUZI_CODING_API_KEY: imageConfig.key, SCENE_IMAGE_MODEL: imageConfig.model, SCENE_TUZI_SKILL_SCRIPT: generator } : {})
    } })
    let stdout = '', stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk; if (stdout.length > 100000) child.kill() })
    child.stderr.on('data', chunk => { stderr += chunk; if (stderr.length > 100000) child.kill() })
    child.on('error', () => reject(new Error('Could not start Tuzi skill process')))
    child.on('close', code => {
      let result
      try { result = JSON.parse((code === 0 ? stdout : stderr).trim()) } catch { return reject(new Error('Skill returned an unreadable result; inspect original output before proceeding')) }
      if (code !== 0 || result.code !== 0 || !result.saved_files?.length) return reject(new Error(`Tuzi generation failed: ${result.message || result.code || code}`))
      resolveResult(result)
    })
  })
}
try {
  const plan = JSON.parse(readFileSync(join(root, 'plan.json'), 'utf8'))
  const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'))
  let selected
  if (retryIds.length) {
    if (retryIds.length > batchSize) throw new Error('Retry count exceeds batch size')
    selected = retryIds.map(id => {
      const item = plan.entries.find(entry => entry.id === id)
      const state = ledger.entries[id]
      if (!item?.promptReviewedAt || !item.prompt || !['failed', 'visual_rejected'].includes(state?.status) || !state.retryAuthorization || state.retryAuthorization.consumedAt) throw new Error(`No unused retry authorization: ${id}`)
      if (state.retryAuthorization.promptHash !== createHash('sha256').update(item.prompt).digest('hex')) throw new Error(`Authorized prompt changed: ${id}`)
      if (state.retryAuthorization.model && state.retryAuthorization.model !== imageConfig.model) throw new Error(`Authorized image model changed: ${id}`)
      return item
    })
  } else {
    selected = plan.entries.filter(item => item.status === 'pending' && !item.productionLane && item.promptReviewedAt && item.prompt && !ledger.entries[item.id]?.status).slice(0, batchSize)
  }
  if (new Set(selected.map(item => item.id)).size !== selected.length) throw new Error('Duplicate selected artwork IDs; reconcile the plan before requesting')
  let generated = 0
  let failed = 0
  await runConcurrentBatch(selected, concurrency, async (item, signal) => {
    const chapterPath = resolve(project, 'server/content', item.bookDir, 'chapters', `${String(item.chapterNumber).padStart(3, '0')}.md`)
    const content = readFileSync(chapterPath, 'utf8').replace(/^\uFEFF/, '').trim().split(/\r?\n/).slice(1).join('\n').trim()
    if (createHash('sha256').update(content).digest('hex') !== item.chapterTextHash) throw new Error(`Chapter changed: ${item.id}; review plan before any request`)
    const originalDir = resolve(project, 'server/content', item.bookDir, 'artifacts/scenes', `chapter-${String(item.chapterNumber).padStart(3, '0')}`)
    const original = resolve(originalDir, item.filename)
    const mobile = original.replace(/\.png$/i, '-mobile.webp')
    mkdirSync(originalDir, { recursive: true })
    if (existsSync(original) || existsSync(mobile)) throw new Error(`Output already exists: ${item.id}; reconcile without requesting again`)
    const previous = ledger.entries[item.id]
    const requestedAt = new Date().toISOString()
    const retryRecord = previous ? {
      attempts: [...(previous.attempts || []), Object.fromEntries(Object.entries(previous).filter(([key]) => !['attempts', 'retryAuthorization'].includes(key)))],
      retryAuthorization: { ...previous.retryAuthorization, consumedAt: requestedAt },
      ...(previous.authorizationHistory ? { authorizationHistory: previous.authorizationHistory } : {})
    } : {}
    ledger.entries[item.id] = { ...retryRecord, status: 'requested', requestedAt, original, mobile, model: imageConfig.model, modelConfigId: imageConfig.modelConfigId, channel: 'coding', promptHash: createHash('sha256').update(item.prompt).digest('hex') }
    save(ledger)
    console.log(JSON.stringify({ id: item.id, status: 'requested' }))
    let attempt = 0
    while (true) {
      attempt++
      try {
        const result = await generate(['--channel', 'coding', '--prompt', item.prompt, '--size', '1536x1024', '--quality', 'high', '--output-format', 'png', '--output-dir', originalDir, '--filename', item.filename])
        if (result.model !== imageConfig.model) throw new Error('Returned model does not match the authorized selection')
        if (!result.saved_files.some(file => resolve(file).toLowerCase() === original.toLowerCase())) throw new Error('Provider returned an unexpected output path')
        const meta = await sharp(original, { limitInputPixels: 20000000 }).metadata()
        const pixels = await sharp(original).stats()
        if (!meta.width || !meta.height || !pixels.channels.some(c => c.stdev > 5)) throw new Error('Output image has no usable visual content')
        await sharp(original).resize({ width: 900, withoutEnlargement: true }).webp({ quality: 82 }).toFile(mobile)
        const optimized = await sharp(mobile).metadata()
        ledger.entries[item.id] = { ...ledger.entries[item.id], status: 'generated', completedAt: new Date().toISOString(), width: meta.width, height: meta.height, mobileBytes: optimized.size }
        save(ledger)
        console.log(JSON.stringify({ id: item.id, status: 'generated', attempts: attempt, original, mobile, mobileBytes: optimized.size }))
        generated++
        break
      } catch (error) {
        const current = ledger.entries[item.id]
        const failedAt = new Date().toISOString()
        // An existing file or a local processing error must be reconciled without another API request.
        if (signal.aborted || existsSync(original) || existsSync(mobile) || !shouldRetryGeneration(error.message)) {
          ledger.entries[item.id] = { ...current, status: 'failed', failedAt, error: error.message }
          save(ledger)
          failed++
          console.error(JSON.stringify({ id: item.id, status: 'failed', attempts: attempt, error: error.message }))
          if (isProviderBlocked(error.message)) throw new Error('Provider requires configuration or balance repair; batch stopped')
          break
        }
        ledger.entries[item.id] = { ...current, status: 'failed', failedAt, error: error.message, automaticRetryPending: true }
        save(ledger)
        const waitMs = retryDelay(attempt)
        console.error(JSON.stringify({ id: item.id, status: 'retrying', attempt, waitMs, error: error.message }))
        if (!await waitForRetry(waitMs, signal) || signal.aborted) {
          const { automaticRetryPending, ...stopped } = ledger.entries[item.id]
          ledger.entries[item.id] = stopped
          save(ledger)
          failed++
          console.error(JSON.stringify({ id: item.id, status: 'failed', attempts: attempt, error: error.message, batchStopped: true }))
          break
        }
        const previousAttempt = Object.fromEntries(Object.entries(ledger.entries[item.id]).filter(([key]) => !['attempts', 'retryAuthorization', 'authorizationHistory', 'automaticRetryPending'].includes(key)))
        ledger.entries[item.id] = {
          ...current, status: 'requested', requestedAt: new Date().toISOString(),
          attempts: [...(current.attempts || []), previousAttempt],
          automaticRetryAuthorization: 'User instruction: retry transient generation failures until successful',
          lastError: error.message
        }
        save(ledger)
      }
    }
  })
  console.log(JSON.stringify({ generated, failed, unrequested: plan.entries.filter(e => e.status === 'pending' && !ledger.entries[e.id]).length }))
} finally {
  closeSync(lock)
  unlinkSync(lockPath)
}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error.message)
    process.exitCode = 1
  })
}
