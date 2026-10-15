import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { spawn } from 'node:child_process'
import { acquireLock, processAlive } from './campus-comic-lock.mjs'

const root = resolve(import.meta.dirname, '..')
const output = join(root, 'artifacts/campus-rebirth-comic')
const logFile = join(output, 'watchdog.log')
const statusFile = join(output, 'watchdog-status.json')
const configuredInterval = Number(process.env.CAMPUS_WATCHDOG_INTERVAL_MS || 30000)
if (!Number.isInteger(configuredInterval) || configuredInterval < 15000) throw new Error('INVALID_WATCHDOG_INTERVAL')
mkdirSync(output, { recursive: true })
let release
try { release = acquireLock(join(output, '.watchdog.lock')) }
catch (error) {
  if (error.code === 'LOCK_BUSY') process.exit(0)
  throw error
}
process.once('exit', release)

function log(event, details = {}) {
  if (existsSync(logFile) && statSync(logFile).size > 5 * 1024 * 1024) renameSync(logFile, `${logFile}.previous`)
  appendFileSync(logFile, `${JSON.stringify({ at: new Date().toISOString(), event, ...details })}\n`)
}
function status(details) {
  const temporary = `${statusFile}.${process.pid}.tmp`
  writeFileSync(temporary, JSON.stringify({ pid: process.pid, updatedAt: new Date().toISOString(), ...details }, null, 2))
  renameSync(temporary, statusFile)
}
function runtime() {
  const current = JSON.parse(readFileSync(join(output, 'runtime.json'), 'utf8'))
  if (current.apiBase !== 'http://127.0.0.1:3014' || resolve(current.dataDir) !== join(output, 'data')) throw new Error('ISOLATED_RUNTIME_REQUIRED')
  return current
}
async function ensureServer() {
  const current = runtime()
  let healthy = false
  try { healthy = (await fetch(`${current.apiBase}/api/health`, { signal: AbortSignal.timeout(3000) })).ok } catch {}
  if (healthy) return
  // Do not launch a second queue against a live but temporarily unresponsive API.
  if (processAlive(current.apiPid)) throw new Error('API_UNRESPONSIVE')
  await run('campus-comic-server.mjs', ['--api-only'], 60000)
  log('api_recovered', { apiPid: runtime().apiPid })
}
function run(script, args = [], timeoutMs = 240000) {
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, [join(root, 'scripts', script), ...args], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''; let stderr = ''; let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      // Terminate descendants as well, so an orphan cannot submit another job later.
      if (process.platform === 'win32') {
        const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
        killer.on('error', () => child.kill())
      } else child.kill('SIGKILL')
    }, timeoutMs)
    child.stdout.on('data', chunk => { stdout = (stdout + chunk).slice(-16000) })
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-16000) })
    child.once('error', () => { clearTimeout(timer); reject(new Error('CHILD_START_FAILED')) })
    child.once('close', code => {
      clearTimeout(timer)
      if (timedOut) return reject(new Error('CHILD_TIMEOUT'))
      if (code !== 0) return reject(new Error(stderr.includes('LOCK_BUSY') ? 'LOCK_BUSY' : 'ADVANCE_FAILED'))
      // Persist only known status fields. Never copy arbitrary child/provider output.
      let outcome = { status: 'advanced' }
      for (const line of stdout.trim().split(/\r?\n/)) {
        try {
          const value = JSON.parse(line)
          if (typeof value.status === 'string' && /^[a-z_]+$/.test(value.status)) {
            outcome = { status: value.status, ...(Number.isInteger(value.episode) ? { episode: value.episode } : {}) }
          }
        } catch {}
      }
      done(outcome)
    })
  })
}
let failures = 0
log('watchdog_started', { pid: process.pid, intervalMs: configuredInterval })
while (true) {
  let delay = configuredInterval
  try {
    const state = JSON.parse(readFileSync(join(output, 'state.json'), 'utf8'))
    if (!state.ongoingAuthorization) throw new Error('AUTHORIZATION_MISSING')
    await ensureServer()
    const outcome = await run('campus-comic-advance.mjs')
    failures = 0
    if (outcome.status === 'planned_volume_complete') delay = 300000
    log('advance_completed', outcome)
    status({ ...outcome, failures, nextCheckAt: new Date(Date.now() + delay).toISOString() })
  } catch (error) {
    failures++
    delay = error.message === 'LOCK_BUSY' ? configuredInterval : Math.min(300000, 60000 * 2 ** Math.min(failures - 1, 3))
    const code = /^[A-Z_]+$/.test(error.message) ? error.message : 'CYCLE_FAILED'
    log('cycle_failed', { code, failures, retryInMs: delay })
    status({ status: 'recovering', code, failures, nextCheckAt: new Date(Date.now() + delay).toISOString() })
  }
  await new Promise(done => setTimeout(done, delay))
}
