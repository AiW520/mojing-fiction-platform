import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { readEnvFile } from '../server/src/config.mjs'

const root = resolve('artifacts/comic-platform-production')
const dir = resolve(root, 'episode-6')
const statePath = resolve(dir, 'state.json')
const state = JSON.parse(readFileSync(statePath, 'utf8'))
const env = { ...readEnvFile(resolve('server/.env')), ...process.env }
const login = await fetch(`${state.apiBase}/admin-api/auth/login`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ account:'admin@mojing.local', password:env.DEV_ADMIN_PASSWORD || 'mojing-dev-only' }) })
const { token } = await login.json()
const previous = readFileSync(resolve(dir, 'story-revision-3.txt'), 'utf8').trim()
const feedback = '只做篇幅压缩，不改变剧情或连续性。上一版已正确明确：干布从陆燃左手滑落，左手空着无力；女人保护孩子；门震带动布角擦过陆燃右手虎口；黑线沿血迹到染血布角；布中三次撞击、刀柄响应、末尾“找到你了”。请将全文压缩到900至1400汉字：删除重复的门撞、多人受力、伤势说明和布中重复声响，只保留一次清楚的右手染血动作、一次黑线抵近、两次布中撞击并让第三声与刀柄响应合并。保留“别松！”开头和本话末尾威胁，不重述第五话。只返回完整第六话正文。'
const response = await fetch(`${state.apiBase}/api/works/${state.workId}/text-jobs`, { method:'POST', headers:{'content-type':'application/json', authorization:`Bearer ${token}`}, body:JSON.stringify({ action:'rewrite', modelId:state.textModelId, context:`第六话正文：\n${previous}\n\n责任编辑篇幅修订要求：\n${feedback}`, selected:previous, maxTokens:1900 }) })
const result = await response.json()
if (!response.ok) throw new Error(JSON.stringify(result))
state.correctCandidateRevisionJobId = result.jobId
state.revisionAttempts ||= []
state.revisionAttempts.push({ jobId:result.jobId, feedback, submittedAt:new Date().toISOString() })
writeFileSync(resolve(dir, 'revision-feedback-4.txt'), feedback)
writeFileSync(statePath, JSON.stringify(state, null, 2))
console.log(JSON.stringify({ jobId:result.jobId, status:'queued' }))
