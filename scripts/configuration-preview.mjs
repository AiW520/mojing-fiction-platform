import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, openSync, closeSync, writeFileSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { createRequire } from 'node:module'

const root = resolve(import.meta.dirname, '..')
const folder = join(root, 'artifacts/configuration-preview')
mkdirSync(folder, { recursive: true })
const base = 'http://127.0.0.1:3015'
try { if ((await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1000) })).ok) { console.log(JSON.stringify({ apiBase: base, adminUrl: 'http://127.0.0.1:5194/' })); process.exit(0) } } catch {}
const log = openSync(join(folder, 'server.log'), 'a')
const api = spawn(process.execPath, ['src/server.mjs'], { cwd: join(root,'server'), windowsHide:true, detached:true, stdio:['ignore',log,log], env:{ ...process.env, PORT:'3015',HOST:'127.0.0.1',DATA_DIR:join(folder,'data'),TUZI_CODING_API_KEY:'',TEXT_REQUEST_TIMEOUT_MS:'150000' } })
api.unref(); closeSync(log)
for (let i=0;i<100;i++) {
  try { if ((await fetch(`${base}/api/health`)).ok) break } catch {}
  await new Promise(done=>setTimeout(done,100))
}
assert.ok((await fetch(`${base}/api/health`)).ok)
const require = createRequire(join(root,'admin-web/package.json'))
const webLog = openSync(join(folder,'web.log'),'a')
const web = spawn(process.execPath,[join(dirname(require.resolve('vite/package.json')),'bin/vite.js'),'--host','127.0.0.1','--port','5194','--strictPort'],{cwd:join(root,'admin-web'),windowsHide:true,detached:true,stdio:['ignore',webLog,webLog],env:{...process.env,MOJING_API_PROXY:base}})
web.unref(); closeSync(webLog)
const runtime = { apiBase:base,adminUrl:'http://127.0.0.1:5194/',apiPid:api.pid,webPid:web.pid,isolated:true }
writeFileSync(join(folder,'runtime.json'),JSON.stringify(runtime,null,2))
console.log(JSON.stringify(runtime))
