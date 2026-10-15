import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'

// The smoke-test server calls the approved skill; production transport remains unchanged.
const transport = globalThis.fetch
const endpoint = 'https://api.tu-zi.com/coding/images/generations'
globalThis.fetch = async (url, options = {}) => {
  if (String(url) !== endpoint || options.method !== 'POST') return transport(url, options)
  const payload = JSON.parse(options.body)
  if (payload.model !== 'gpt-image-2') return Response.json({}, { status:400 })
  const filename=`panel-${createHash('sha256').update(payload.prompt).digest('hex').slice(0,16)}`
  const cached=resolve(process.env.DATA_DIR,'../images',`${filename}.png`)
  if (existsSync(cached)) {
    const bytes=await readFile(cached)
    console.log(JSON.stringify({ event:'reuse_saved_generation',bytes:bytes.length }))
    return Response.json({ data:[{ b64_json:bytes.toString('base64') }] })
  }
  const result = await new Promise((done, reject) => {
    const args = [resolve(process.env.USERPROFILE, '.codex/skills/tuzi-image-generation/scripts/generate_image.py'),
      '--prompt', payload.prompt, '--size', payload.size || '1024x1536', '--quality', payload.quality || 'high',
      '--output-dir', resolve(process.env.DATA_DIR, '../images'), '--filename', filename]
    const child = spawn('python', args, { windowsHide:true, env:{ ...process.env,PYTHONIOENCODING:'utf-8' } })
    let output = '', errors = ''
    child.stdout.on('data', bytes => { output += bytes })
    child.stderr.on('data', bytes => { errors += bytes })
    child.once('error', reject)
    child.once('exit', code => {
      try { done({ code, payload:JSON.parse((output || errors).trim()) }) }
      catch { reject(new Error('SKILL_OUTPUT_INVALID')) }
    })
  })
  if (result.code !== 0 || !result.payload.saved_files?.length) {
    const status = Number(result.payload.code)
    let message = String(result.payload.message || 'SKILL_GENERATION_FAILED').replace(/[\r\n]/g, ' ')
    for (const secret of [process.env.TUZI_CODING_API_KEY, process.env.OPENAI_API_KEY].filter(Boolean)) {
      message = message.replaceAll(secret, '[REDACTED]')
    }
    message = message.replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]').replace(/\b(?:sk|sess)-[A-Za-z0-9_-]+/g, '[REDACTED]').slice(0, 200)
    console.error(JSON.stringify({ event:'live_generation_failed', status:Number.isInteger(status) ? status : null, message }))
    return Response.json({ error:{ code:'SKILL_GENERATION_FAILED' } }, { status:status >= 400 && status <= 599 ? status : 502 })
  }
  const bytes = await readFile(result.payload.saved_files[0])
  console.log(JSON.stringify({ event:'live_generation_saved', path:result.payload.saved_files[0], bytes:bytes.length }))
  return Response.json({ data:[{ b64_json:bytes.toString('base64') }] })
}
