import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { readEnvFile } from '../server/src/config.mjs'

const root = resolve('artifacts/comic-platform-production')
const output = resolve(root, 'ending-outline-task-v4.json')
const prior = JSON.parse(readFileSync(resolve(root, 'ending-outline-task-v3.json'), 'utf8'))
const latest = JSON.parse(readFileSync(resolve(root, 'episode-10', 'state.json'), 'utf8'))
const env = { ...readEnvFile(resolve('server/.env')), ...process.env }
const login = await fetch(`${latest.apiBase}/admin-api/auth/login`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({account:'admin@mojing.local', password:env.DEV_ADMIN_PASSWORD || 'mojing-dev-only'}) })
assert.equal(login.status, 200)
const { token } = await login.json()
async function api(path, method='GET', input) {
  const response = await fetch(`${latest.apiBase}${path}`, { method, headers:{'Content-Type':'application/json', Authorization:`Bearer ${token}`}, ...(input ? { body:JSON.stringify(input) } : {}) })
  const result = await response.json(); assert.ok(response.ok, `HTTP_${response.status}: ${result.error?.code || ''}`); return result
}
let saved = existsSync(output) ? JSON.parse(readFileSync(output, 'utf8')) : null
if (!saved) {
  assert.equal(prior.status, 'success')
  const feedback = `对已完成的大纲候选做定点修订，只返回修订后的完整完本大纲，不写正文，不增加新话数。保留四话结构、人物位置和生死安排，只修正以下问题：1) 唯一干布绝不承担隔潮功能；隔绝黑潮的是维修通道保持干燥，通道被黑水明确打湿后才失效。干布只用于让孩子比较两处异象、标记/定位门轴黑线，写清女人如何从门槛一侧用右手夺回黑影拖来的布，左臂不承重。2) 孩子比较必须同时写出真实孩子、门内假影、两处黑水和可观察的差异，结论只用于定位黑线，不把干布写成屏障。3) 写明陆燃何时因黑线暂松由强握改为右手短时扶刀柄，两名未污染男子何时接管刀身定位；不改变左臂垂落。4) 结尾“陆燃退出”改成靠右腿、身体和他人牵引，左臂全程不承重。5) 继续保持第十话末布角在黑影手中、陆燃右靴压第四层黑线、年轻男子死在第二层后不再行动、两块布分别追踪、所有活人先出泵房后由最年长未污染男子封死入口。禁止“或/或者/可能”，不得引入新的严重连续性问题。\n\n原候选：\n${prior.result.content}\n\n原审查意见：\n${prior.result.review.issues.map(i => `${i.severity}: ${i.reason}；${i.suggestion}`).join('\n')}`
  const { jobId } = await api(`/api/works/${prior.workId}/text-jobs`, 'POST', { action:'rewrite', modelId:prior.modelId, context:feedback, selected:prior.result.content, maxTokens:3000 })
  saved = { workId:prior.workId, modelId:prior.modelId, jobId, prompt:feedback, previousJobId:prior.jobId, submittedAt:new Date().toISOString(), status:'queued', sourceOutline:'ending-outline-task-v3.json' }
  writeFileSync(output, JSON.stringify(saved, null, 2)); console.log(JSON.stringify({ jobId, status:'queued', previousJobId:prior.jobId })); process.exit(0)
}
const job = (await api(`/api/jobs/${saved.jobId}`)).job
const next = { ...saved, status:job.status, result:job.result || null, errorCode:job.errorCode || null, checkedAt:new Date().toISOString() }
writeFileSync(output, JSON.stringify(next, null, 2))
console.log(JSON.stringify({ jobId:saved.jobId, status:job.status, reviewStatus:job.result?.review?.status || null, score:job.result?.review?.score || null, errorCode:job.errorCode || null }))
