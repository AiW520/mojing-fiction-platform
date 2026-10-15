import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { readEnvFile } from '../server/src/config.mjs'

const dir = resolve('artifacts/comic-platform-production/episode-8')
const statePath = resolve(dir, 'state.json')
const state = JSON.parse(readFileSync(statePath, 'utf8'))
const env = { ...readEnvFile(resolve('server/.env')), ...process.env }
const login = await fetch(`${state.apiBase}/admin-api/auth/login`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ account:'admin@mojing.local', password:env.DEV_ADMIN_PASSWORD || 'mojing-dev-only' }) })
const { token } = await login.json()
const source = readFileSync(resolve(dir, 'story.txt'), 'utf8').trim()
const feedback = '只做篇幅压缩，不改变第八话连续性或结尾。保留四个关键节点：孩子和干布被黑线牵连；陆燃明确接过干布并用右靴压住；他拔刀斩断黑线但黑丝缠上右腕；石壁后裂出第二扇黑门并用陆燃自己的声音说“这次，别松”。删除重复的门声、伤势说明、双门指痕重复和多人反应，将全文控制在900至1400汉字。陆燃左手骨折无力、右手虎口裂伤必须保持，孩子与女人的持有关系不能改变。只返回完整第八话正文。'
const response = await fetch(`${state.apiBase}/api/works/${state.workId}/text-jobs`, { method:'POST', headers:{'content-type':'application/json', authorization:`Bearer ${token}`}, body:JSON.stringify({ action:'rewrite', modelId:state.textModelId, context:`第八话初稿：\n${source}\n\n责任编辑定点压缩要求：\n${feedback}`, selected:source, maxTokens:1900 }) })
const result = await response.json()
if (!response.ok) throw new Error(JSON.stringify(result))
state.writingJobIds.push(result.jobId)
state.authorizedRevisions ||= []
state.authorizedRevisions.push({ jobId:result.jobId, previousJobId:state.writingJobIds.at(-2), mode:'revision', authorization:'User authorized continued platform revisions through completion on 2026-10-10', requestedAt:new Date().toISOString() })
state.revisionFeedback = feedback
state.status = 'writing_running'
writeFileSync(resolve(dir, 'revision-feedback.txt'), feedback)
writeFileSync(statePath, JSON.stringify(state, null, 2))
console.log(JSON.stringify({ jobId:result.jobId, status:'queued' }))
