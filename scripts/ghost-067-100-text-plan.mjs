import { createDecipheriv, createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readEnvFile } from '../server/src/config.mjs'
import { acquireLock } from './campus-comic-lock.mjs'

const project = fileURLToPath(new URL('..', import.meta.url))
const laneRoot = resolve(project, 'artifacts/comic-bulk-production/ghost-067-100')
const outputRoot = join(laneRoot, 'text-model-responses')
mkdirSync(outputRoot, { recursive: true })
const release = acquireLock(join(laneRoot, 'text-planning.lock'))
process.once('exit', release)
const event = value => appendFileSync(join(outputRoot, 'request-events.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...value }) + '\n')
const envFile = resolve(project, 'server/.env')
const env = { ...readEnvFile(envFile), ...process.env }
if (!env.TUZI_CODING_API_KEY) throw new Error('TUZI_CODING_API_KEY is required')
const db = new DatabaseSync(resolve(project, 'server/data/mojing.sqlite'), { readOnly: true })
const rows = db.prepare("SELECT * FROM model_configs WHERE kind='text' AND enabled=1 AND encrypted_key IS NOT NULL AND text_role IN ('generation','reviewer','both') ORDER BY review_default DESC,is_default DESC,rowid").all()
if (rows.length < 2) throw new Error('Writer and reviewer text models are not both configured')
const key = row => {
  const [iv, tag, encrypted] = row.encrypted_key.split('.')
  const secret = createHash('sha256').update(env.MODEL_CONFIG_ENCRYPTION_KEY || env.DEV_ADMIN_PASSWORD || 'mojing-dev-only').digest()
  const decipher = createDecipheriv('aes-256-gcm', secret, Buffer.from(iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString('utf8')
}
const writer = rows.find(row => ['generation', 'both'].includes(row.text_role)) || rows[0]
const reviewer = rows.find(row => ['reviewer', 'both'].includes(row.text_role)) || rows[0]
const chapterText = n => readFileSync(resolve(project, 'server/content/ghost-ledger/chapters', `${String(n).padStart(3, '0')}.md`), 'utf8').replace(/^\uFEFF/, '').trim()
const cnNumber = n => n === 100 ? '一百' : `${n >= 20 ? '一二三四五六七八九'[Math.floor(n / 10) - 1] : ''}十${n % 10 ? '一二三四五六七八九'[n % 10 - 1] : ''}`
const continuity = readFileSync(resolve(project, 'server/content/ghost-ledger/continuity-log.md'), 'utf8')
const chapterContext = (first, last) => {
  const sections = continuity.split(/(?=\n### )/)
  const headings = Array.from({ length: last - first + 3 }, (_, i) => `第${cnNumber(first - 1 + i)}章`)
  return sections.filter(section => headings.some(heading => section.split('\n').slice(0, 3).join('\n').includes(heading))).join('\n')
}
const call = async (row, system, user) => {
  const endpoint = new URL(row.endpoint)
  if (endpoint.origin !== 'https://api.tu-zi.com' || !endpoint.pathname.startsWith('/coding/')) throw new Error('Configured text endpoint is outside the authorized coding channel')
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      event({ model: row.model, status: 'requested', attempt })
      const response = await fetch(endpoint, { method: 'POST', signal: AbortSignal.timeout(600000), headers: { 'content-type': 'application/json', authorization: `Bearer ${key(row)}` }, body: JSON.stringify({ model: row.model, temperature: 0.1, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }) })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw Object.assign(new Error(`Text model request failed: ${response.status}`), { status: response.status })
      event({ model: row.model, status: 'completed', attempt, usage: body.usage || null })
      return body
    } catch (error) {
      const message = `${error.message}${error.cause?.code ? ` (${error.cause.code})` : ''}`
      event({ model: row.model, status: 'failed', attempt, error: message })
      if (error.status && error.status < 500 || attempt === 3) throw new Error(message)
      await new Promise(done => setTimeout(done, 15000 * attempt))
    }
  }
}
const batches = []
const firstChapter = Number(process.argv[2] || 67), lastChapter = Number(process.argv[3] || 100)
for (let first = firstChapter; first <= lastChapter; first += 2) batches.push([first, Math.min(first + 1, lastChapter)])
for (const [first, last] of batches) {
  if (existsSync(join(outputRoot, `${first}-${last}.json`))) continue
  const source = Array.from({ length: last - first + 1 }, (_, i) => chapterText(first + i)).join('\n\n---NEXT CHAPTER---\n\n')
  const context = chapterContext(first, last)
  const prompt = `你是漫画分镜规划writer。请只基于下列第${first}-${last}章完整正文，输出严格JSON对象{chapters:[{chapterNumber:数字,scenes:[{paragraphAnchor:原文短句,title:短标题,visualDescription:具体单一静帧,characters:数组,continuityRisks:数组}]}]}。每章恰好5个场景，均匀覆盖情节，锚点必须唯一且递增逐字出现在对应段落。画面描述100-180字，必须明确人物位置、动作、器物、材质、时间，不说“根据正文”或“呈现该段”。禁止文字、标签、分屏、拼图。只选可清晰表现的画面，涉及尸体优先选择对应证物静物。陆昭停职不持印、不触尸骨/黑簿/封功刀，许青棠只在皇城远程复核，贺停舟留北镇，阮遐留第二镇，不凭回传把他们传送到异镇。保持伤情、证物分柜、人物选择和四步边界，不添加妖物或胜利。不要改写正文。\n\n${source}`
  const checkpoint = join(outputRoot, `${first}-${last}-writer.json`)
  const writerResult = existsSync(checkpoint) ? JSON.parse(readFileSync(checkpoint, 'utf8')) : await call(writer, '你负责从完整小说正文提取可核验的漫画场景规划。输出严格JSON。', `人物和证物连续性审计（用于约束画面，不能取代本章锚点）:\n${context}\n${prompt}`)
  if (!existsSync(checkpoint)) writeFileSync(checkpoint, JSON.stringify(writerResult, null, 2) + '\n')
  const reviewResult = await call(reviewer, '你是连续性审查员。检查场景锚点是否逐字可定位、五场景是否递增、是否违反人物伤情、权限、证物分离和功簿规则。严查模型捏造现场器具/调动人物/把尚未得到的结果画成事实。不在场的人不可因回传出现在画中；编号副本不是原物。输出严格JSON，包含approved、issues、correctedChapters（若需要修改，返回完整五场景的同构chapters数组）。', `连续性审计:\n${context}\n完整正文:\n${source}\n待审规划:\n${writerResult.choices?.[0]?.message?.content || JSON.stringify(writerResult)}`)
  const record = { range: [first, last], writerModel: writer.model, reviewerModel: reviewer.model, writer: writerResult, reviewer: reviewResult, savedAt: new Date().toISOString() }
  writeFileSync(join(outputRoot, `${first}-${last}.json`), JSON.stringify(record, null, 2) + '\n')
  const totals = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
  for (let chapter = 67; chapter <= 100; chapter += 2) {
    const path = join(outputRoot, `${chapter}-${Math.min(chapter + 1, 100)}.json`)
    if (!existsSync(path)) continue
    const saved = JSON.parse(readFileSync(path, 'utf8'))
    for (const usage of [saved.writer?.usage, saved.reviewer?.usage]) for (const field of Object.keys(totals)) totals[field] += Number(usage?.[field] || 0)
  }
  writeFileSync(join(laneRoot, 'text-usage.json'), JSON.stringify({ updatedAt: new Date().toISOString(), totals }, null, 2) + '\n')
  console.log(JSON.stringify({ range: [first, last], writerModel: writer.model, reviewerModel: reviewer.model, writerUsage: writerResult.usage || null, reviewerUsage: reviewResult.usage || null }))
}
db.close()
release()
