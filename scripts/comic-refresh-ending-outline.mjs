import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { readEnvFile } from '../server/src/config.mjs'

const root = resolve('artifacts/comic-platform-production')
const output = resolve(root, 'ending-outline-task-v2.json')
const latest = JSON.parse(readFileSync(resolve(root, 'episode-10', 'state.json'), 'utf8'))
const env = { ...readEnvFile(resolve('server/.env')), ...process.env }
const login = await fetch(`${latest.apiBase}/admin-api/auth/login`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({account:'admin@mojing.local', password:env.DEV_ADMIN_PASSWORD || 'mojing-dev-only'}) })
assert.equal(login.status, 200)
const { token } = await login.json()
async function api(path, method='GET', input) {
  const response = await fetch(`${latest.apiBase}${path}`, { method, headers:{'Content-Type':'application/json', Authorization:`Bearer ${token}`}, ...(input ? { body:JSON.stringify(input) } : {}) })
  const result = await response.json()
  assert.ok(response.ok, `HTTP_${response.status}: ${result.error?.code || ''}`)
  return result
}
let saved = existsSync(output) ? JSON.parse(readFileSync(output, 'utf8')) : null
if (!saved) {
  const previous = JSON.parse(readFileSync(resolve(root, 'episode-9', 'state.json'), 'utf8'))
  const prompt = `根据已发布的《赤潮》第九、十话正文快照，规划后续自然完本大纲。必须由平台模型创作，不输出正文。至少覆盖：黑潮、黑门、青色长刀和染血干布的可验证因果链；孩子必须在逃生或反击中作出关键选择而非仅被保护；从地下石室主动转移到新空间，出口线索需由排水槽风向、木屑流向、墙体空响或旧维修痕迹铺垫，不能临时生成捷径；明确门轴、盖石、撬棍、刀身支点和陆燃用腿/肩施力的受力方向；交代陆燃左臂骨折恢复过程与右手永久损伤的具体功能限制；写清幸存者为何能折返救援。结局必须解决威胁与门的冲突、陆燃守护选择及不可逆代价、孩子和女人及三名男子的归宿，最后一话不得以新悬念收尾。保持已知连续性：陆燃短乱黑发、琥珀眼、左眉旧疤、左耳银耳钉、左臂骨折、右腕虎口伤、唯一青色直刃长刀、刀柄暗红残布、唯一干布、黑门和湿石阶。建议按后续每话列出核心行动、人物选择与代价、规则揭示、伏笔回收、结局，1200汉字以内。\n\n第九话正文：${String(previous.sourceContext || '').slice(-9000)}\n\n第十话正文：${String(latest.sourceContext || '').slice(-9000)}`
  const { jobId } = await api(`/api/works/${latest.workId}/text-jobs`, 'POST', { action:'outline', modelId:latest.textModelId, context:prompt, selected:prompt, maxTokens:3000 })
  saved = { workId:latest.workId, modelId:latest.textModelId, jobId, prompt, submittedAt:new Date().toISOString(), status:'queued', sourceEpisodes:[9,10] }
  writeFileSync(output, JSON.stringify(saved, null, 2))
  console.log(JSON.stringify({ jobId, status:'queued' }))
  process.exit(0)
}
const job = (await api(`/api/jobs/${saved.jobId}`)).job
const next = { ...saved, status:job.status, result:job.result || null, errorCode:job.errorCode || null, checkedAt:new Date().toISOString() }
writeFileSync(output, JSON.stringify(next, null, 2))
console.log(JSON.stringify({ jobId:saved.jobId, status:job.status, reviewStatus:job.result?.review?.status || null, score:job.result?.review?.score || null, errorCode:job.errorCode || null }))
