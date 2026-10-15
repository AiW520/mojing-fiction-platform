import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { readEnvFile, textRequestTimeoutMs } from '../server/src/config.mjs'

const root = resolve(import.meta.dirname, '..')
const output = join(root, 'artifacts/campus-rebirth-comic')
const runtime = join(output, 'runtime.json')
const apiOnly = process.argv.includes('--api-only')
const previousRuntime = existsSync(runtime) ? JSON.parse(readFileSync(runtime, 'utf8')) : null
mkdirSync(join(output, 'data'), { recursive: true })
if (existsSync(runtime)) {
  const previous = JSON.parse(readFileSync(runtime, 'utf8'))
  try {
    const health = await fetch(`${previous.apiBase}/api/health`, { signal: AbortSignal.timeout(2000) })
    if (health.ok) { console.log(JSON.stringify(previous)); process.exit(0) }
  } catch {}
}
const env = { ...readEnvFile(join(root, 'server/.env')), ...process.env }
const timeoutMs = textRequestTimeoutMs({ TEXT_REQUEST_TIMEOUT_MS: env.CAMPUS_TEXT_REQUEST_TIMEOUT_MS || '600000' })
const log = openSync(join(output, 'server.log'), 'a')
const api = spawn(process.execPath, ['--import', pathToFileURL(join(root, 'scripts/campus-comic-transport.mjs')).href, 'src/server.mjs'], {
  cwd: join(root, 'server'), env: { ...env, HOST: '127.0.0.1', PORT: '3014', DATA_DIR: join(output, 'data'), CAMPUS_COMIC_DIR: output, TEXT_REQUEST_TIMEOUT_MS: String(timeoutMs), TUZI_CODING_API_KEY: '' },
  windowsHide: true, detached: true, stdio: ['ignore', log, log],
})
api.unref(); closeSync(log)
const base = 'http://127.0.0.1:3014'
for (let i = 0; i < 100; i++) {
  try { if ((await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(2000) })).ok) break } catch {}
  await new Promise(done => setTimeout(done, 100))
}
const response = await fetch(`${base}/admin-api/auth/login`, { method: 'POST', signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ account: 'admin@mojing.local', password: env.DEV_ADMIN_PASSWORD || 'mojing-dev-only' }) })
assert.ok(response.ok, `LOGIN_${response.status}`)
const { token } = await response.json()
if (apiOnly) {
  assert.ok(previousRuntime, 'Existing runtime required for API-only restart')
  const result = { ...previousRuntime, apiPid: api.pid, textRequestTimeoutMs: timeoutMs, apiRestartedAt: new Date().toISOString() }
  writeFileSync(runtime, JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
  process.exit(0)
}
if (!existsSync(join(output, 'models-initialized.json'))) {
  // Reuse the platform's encrypted model records; plaintext credentials never leave memory.
  const source = new DatabaseSync(resolve(root, env.DATA_DIR || 'server/data', 'mojing.sqlite'), { readOnly: true })
  const target = new DatabaseSync(join(output, 'data/mojing.sqlite'))
  try {
    const rows = source.prepare('SELECT * FROM model_configs WHERE enabled=1 AND encrypted_key IS NOT NULL').all()
    assert.ok(rows.some(row => row.model === 'gpt-image-2'))
    target.exec('BEGIN; DELETE FROM model_config_order; DELETE FROM model_configs;')
    const columns = target.prepare('PRAGMA table_info(model_configs)').all().map(c => c.name)
    const insert = target.prepare(`INSERT INTO model_configs(${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`)
    for (const row of rows) insert.run(...columns.map(c => row[c] ?? null))
    for (const row of source.prepare('SELECT * FROM model_config_order').all()) target.prepare('INSERT INTO model_config_order(model_id,priority) VALUES (?,?)').run(row.model_id, row.priority)
    const reviewer = rows.find(row => row.model === 'gpt-6-sol' && ['reviewer', 'both'].includes(row.text_role))
    if (reviewer) {
      target.exec('UPDATE model_configs SET review_default=0')
      target.prepare('UPDATE model_configs SET review_default=1 WHERE id=?').run(reviewer.id)
    }
    target.exec('COMMIT')
    writeFileSync(join(output, 'models-initialized.json'), JSON.stringify({ at: new Date().toISOString(), source: 'platform-configured-models', modelIds: rows.map(row => row.id), independentReviewer: reviewer?.id }, null, 2))
  } catch (error) { target.exec('ROLLBACK'); throw error }
  finally { source.close(); target.close() }
}
const settings = await fetch(`${base}/admin-api/production`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ concurrency: 4, textConcurrency: 2, imageConcurrency: 2, perWorkConcurrency: 2 }) })
assert.ok(settings.ok)
const require = createRequire(join(root, 'admin-web/package.json'))
const webLog = openSync(join(output, 'web.log'), 'a')
const web = spawn(process.execPath, [join(dirname(require.resolve('vite/package.json')), 'bin/vite.js'), '--host', '127.0.0.1', '--port', '5193', '--strictPort'], {
  cwd: join(root, 'admin-web'), env: { ...env, MOJING_API_PROXY: base }, windowsHide: true, detached: true, stdio: ['ignore', webLog, webLog],
})
web.unref(); closeSync(webLog)
const result = { apiBase: base, adminUrl: 'http://127.0.0.1:5193/', apiPid: api.pid, webPid: web.pid, dataDir: join(output, 'data'), realProvider: true, textRequestTimeoutMs: timeoutMs, createdAt: new Date().toISOString() }
writeFileSync(runtime, JSON.stringify(result, null, 2))
console.log(JSON.stringify(result))
