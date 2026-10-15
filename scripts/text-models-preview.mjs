import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const root = resolve(import.meta.dirname, '..')
const data = mkdtempSync(join(tmpdir(), 'mojing-text-preview-'))
const children = []
process.once('exit', () => { for (const child of children) child.kill() })
const api = spawn(process.execPath, ['--import', pathToFileURL(join(root, 'server/test/fixtures/text-provider.mjs')).href, 'src/server.mjs'], {
  cwd: join(root, 'server'), env: { ...process.env, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0', DATA_DIR: data,
    DEV_ADMIN_PASSWORD: 'text-model-preview-only', MODEL_CONFIG_ENCRYPTION_KEY: 'text-model-preview-isolated-secret', TUZI_CODING_API_KEY: '', ALLOW_DEV_AUTH: '1' },
  stdio: ['ignore','pipe','pipe'], windowsHide: true,
})
children.push(api)
api.stderr.pipe(process.stderr)
const base = await new Promise((resolveBase,reject) => {
  let output = ''
  api.stdout.on('data', chunk => {
    output += chunk
    const ready = output.match(/listening on (http:\/\/[^\s]+)/)
    if (ready) resolveBase(ready[1])
  })
  api.once('exit', code => reject(new Error(`Preview API exited ${code}`)))
})
async function request(path, body, token) {
  const response = await fetch(`${base}${path}`, { method:'POST', headers: { 'content-type':'application/json', ...(token ? { Authorization:`Bearer ${token}` } : {}) }, body:JSON.stringify(body) })
  const result = await response.json()
  if (!response.ok) throw new Error(JSON.stringify(result))
  return result
}
const admin = (await request('/admin-api/auth/login', { account:'admin@mojing.local', password:'text-model-preview-only' })).token
for (const [name,model,textRole,priority,isDefault,reviewDefault] of [
  ['模拟主模型','gen-503','generation',10,true,false], ['模拟兜底模型','gen-good','generation',20,false,false],
  ['模拟审查主模型','review-503','reviewer',10,false,true], ['模拟审查兜底','review-good','reviewer',20,false,false],
]) await request('/admin-api/models', { name,provider:'mock',kind:'text',endpoint:'https://models.example.test/v1/chat/completions',model,textRole,priority,isDefault,reviewDefault,apiKey:'fake-preview-key' },admin)
const owner = (await request('/api/auth/dev-login',{ account:'wechat:1001' })).token
const work = (await request('/api/works',{ title:'多文本模型 · 模拟审查',summary:'雨夜灯塔与第二封信。' },owner)).work
await request(`/api/works/${work.id}/text-jobs`,{ action:'continue',context:'雨夜里，他走到灯塔门前。',selected:'' },owner)
const require = createRequire(join(root,'admin-web/package.json'))
const web = spawn(process.execPath,[join(dirname(require.resolve('vite/package.json')),'bin/vite.js'),'--host','127.0.0.1','--port',process.env.TEXT_MODEL_PREVIEW_PORT || '5192'], {
  cwd:join(root,'admin-web'),env:{ ...process.env,MOJING_API_PROXY:base },stdio:['ignore','pipe','pipe'],windowsHide:true,
})
children.push(web)
web.stdout.pipe(process.stdout); web.stderr.pipe(process.stderr)
console.log(`Isolated simulated preview. API: ${base}; data: ${data}`)
console.log('Login: admin@mojing.local / text-model-preview-only')
const stop = () => { for (const child of children) child.kill(); process.exit(0) }
process.on('SIGINT',stop); process.on('SIGTERM',stop)
web.once('exit',stop)
