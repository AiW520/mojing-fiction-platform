import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { readEnvFile } from '../server/src/config.mjs'

const root = resolve('artifacts/comic-platform-production')
const latest = JSON.parse(readFileSync(resolve(root, 'episode-5', 'state.json'), 'utf8'))
const output = resolve(root, 'ending-outline-task.json')
const env = { ...readEnvFile(resolve('server/.env')), ...process.env }
const login = await fetch(`${latest.apiBase}/admin-api/auth/login`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ account:'admin@mojing.local', password:env.DEV_ADMIN_PASSWORD || 'mojing-dev-only' }) })
assert.equal(login.status, 200)
const { token } = await login.json()
async function api(path, method='GET', input) {
  const response = await fetch(`${latest.apiBase}${path}`, { method, headers:{'Content-Type':'application/json', Authorization:`Bearer ${token}`}, ...(input ? { body:JSON.stringify(input) } : {}) })
  const result = await response.json()
  assert.ok(response.ok, `HTTP_${response.status}: ${result.error?.code || ''}`)
  return result
}
if (existsSync(output)) {
  const saved = JSON.parse(readFileSync(output, 'utf8'))
  const job = (await api(`/api/jobs/${saved.jobId}`)).job
  if (process.argv.includes('--retry')) {
    assert.equal(job.status, 'failed', 'Do not repeat an active or successful outline job')
    const prompt = '为原创《赤潮》拟定自然完本大纲，仅输出后续每话的核心行动、人物选择与代价、伏笔回收和结局，不写正文。话数由故事质量决定。既定事实：陆燃22岁，左手骨折无力、右手虎口裂伤麻木，不能抓握长刀；唯一青色直刃长刀压在门槛盖石下，刀柄缠暗红残布；主角颈部没有围巾。孩子、女人与三名成年男子躲在关闭木门内，用一根横木抵门。黑潮自排水槽和石台裂缝侵入，石台已被撬棍压塌封住裂口，年轻男子被黑水附身试图从内开门；黑线循陆燃右手血迹接近孩子的染血干布，布内响起和门外相同的撞击声，长刀回应布。核心未解：黑潮、门、长刀和孩子的联系。请从可验证的行动逐步揭示规则，离开重复守门的局面，安排主动逃生或反击；规则不能临时凭空解决问题。结局须解决黑潮威胁与门的核心冲突，交代陆燃的守护选择和不可逆代价、孩子与女人及幸存者归宿。最后一话不能用新悬念冒充结束。大纲要紧凑，1200汉字以内。'
    const { jobId } = await api(`/api/works/${saved.workId}/text-jobs`, 'POST', { action:'outline', modelId:saved.modelId, context:prompt, selected:prompt, maxTokens:1800 })
    const attempts = saved.attempts || []
    if (!attempts.some(attempt => attempt.jobId === saved.jobId)) attempts.push({ jobId:saved.jobId, status:job.status, errorCode:job.errorCode, result:job.result })
    const retried = { ...saved, attempts, jobId, prompt, status:'queued', result:null, errorCode:null, recoveryUsed:true, contextType:'verified-current-rules', submittedAt:new Date().toISOString() }
    writeFileSync(output, JSON.stringify(retried, null, 2))
    console.log(JSON.stringify({ jobId, status:'queued', previousJobId:saved.jobId }))
    process.exit(0)
  }
  writeFileSync(output, JSON.stringify({ ...saved, status:job.status, result:job.result || null, errorCode:job.errorCode || null, checkedAt:new Date().toISOString() }, null, 2))
  console.log(JSON.stringify({ jobId:saved.jobId, status:job.status, result:job.result || null, errorCode:job.errorCode || null }))
} else {
  const context = [1,2,3,4,5].map(number => {
    const file = resolve(root, number === 1 ? 'state.json' : `episode-${number}/state.json`)
    const state = JSON.parse(readFileSync(file, 'utf8'))
    return `第${number}话：${state.episodeId}；正文快照：${String(state.sourceContext || state.revisionSource || '').slice(-12000)}`
  }).join('\n\n')
  const prompt = '根据已接受的前五话正文快照，为原创《赤潮》规划一条以自然完本为目标的后续故事大纲。必须解决潮汐、黑门、长刀的规则和核心冲突，明确陆燃的守护选择与长期代价，交代孩子、女人及幸存者的结局，安排人物弧、伏笔回收、关键行动节拍和预计后续话数范围。冲突要推进到新的空间和选择，不能重复门口防守，也不能以新悬念冒充完结。大纲供平台后续正文任务引用，不输出正文。'
  const { jobId } = await api(`/api/works/${latest.previousWorkId}/text-jobs`, 'POST', { action:'outline', modelId:latest.textModelId, context:`${context}\n\n${prompt}`, selected:prompt, maxTokens:3000 })
  const saved = { workId:latest.previousWorkId, modelId:latest.textModelId, jobId, prompt, submittedAt:new Date().toISOString(), status:'queued' }
  writeFileSync(output, JSON.stringify(saved, null, 2))
  console.log(JSON.stringify(saved))
}
