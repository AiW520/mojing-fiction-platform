import { spawn } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, join } from 'node:path'
import { parseSkillResult, skillFailureDiagnostic } from './campus-skill-result.mjs'

const transport = globalThis.fetch
const output = resolve(process.env.CAMPUS_COMIC_DIR)
mkdirSync(join(output, 'images'), { recursive: true })
const record = event => appendFileSync(join(output, 'provider-events.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`)
let active = 0
let sequence = 0

globalThis.fetch = async (url, options = {}) => {
  if (options.method !== 'POST' || new URL(String(url)).hostname !== 'api.tu-zi.com') return transport(url, options)
  const payload = JSON.parse(options.body)
  const image = String(url).endsWith('/images/generations')
  const id = ++sequence
  const started = Date.now()
  record({ event: 'start', id, kind: image ? 'image' : 'text', model: payload.model, active: ++active })
  let status = 0
  try {
    if (!image) {
      const response = await transport(url, options)
      // Consume the body inside the measured interval, including download time.
      const bytes = await response.arrayBuffer()
      status = response.status
      return new Response(bytes, { status, headers: response.headers })
    }
    if (String(url) !== 'https://api.tu-zi.com/coding/images/generations' || payload.model !== 'gpt-image-2') throw new Error('CAMPUS_IMAGE_MODEL_INVALID')
    const key = String(options.headers.Authorization || '').replace(/^Bearer /, '')
    if (!key) throw new Error('PLATFORM_KEY_MISSING')
    const filename = `request-${id}-${createHash('sha256').update(payload.prompt).digest('hex').slice(0, 12)}`
    const result = await new Promise((done, reject) => {
      const child = spawn(process.env.CAMPUS_PYTHON || 'python', [
        resolve(process.env.USERPROFILE, '.codex/skills/tuzi-image-generation/scripts/generate_image.py'),
        '--channel', 'coding', '--prompt', payload.prompt, '--size', payload.size, '--quality', payload.quality,
        '--output-dir', join(output, 'images'), '--filename', filename,
      ], { windowsHide: true, env: { ...process.env, TUZI_CODING_API_KEY: key, OPENAI_API_KEY: '', PYTHONIOENCODING: 'utf-8' }, stdio: ['ignore', 'pipe', 'pipe'] })
      let stdout = ''; let stderr = ''
      child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8')
      child.stdout.on('data', bytes => { stdout += bytes })
      child.stderr.on('data', bytes => { stderr += bytes })
      child.once('error', () => reject(new Error('SKILL_START_FAILED')))
      child.once('close', code => {
        try { done(parseSkillResult(code, stdout, stderr)) }
        catch { reject(new Error('SKILL_OUTPUT_INVALID')) }
      })
    })
    if (result.code !== 0 || !result.payload.saved_files?.length) {
      record({ event: 'skill_failure', id, ...skillFailureDiagnostic(result.payload) })
      const code = Number(result.payload.code)
      status = code >= 400 && code <= 599 ? code : 502
      return Response.json({ error: { code: 'SKILL_GENERATION_FAILED' } }, { status })
    }
    const saved = result.payload.saved_files[0]
    const bytes = readFileSync(saved)
    if (!bytes.length) throw new Error('SKILL_EMPTY_OUTPUT')
    record({ event: 'saved', id, path: saved, bytes: bytes.length })
    status = 200
    return Response.json({ data: [{ b64_json: bytes.toString('base64') }] })
  } finally {
    record({ event: 'finish', id, status, durationMs: Date.now() - started, active: --active })
  }
}
