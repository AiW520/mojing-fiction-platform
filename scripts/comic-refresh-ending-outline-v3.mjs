import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { readEnvFile } from '../server/src/config.mjs'

const root = resolve('artifacts/comic-platform-production')
const output = resolve(root, 'ending-outline-task-v3.json')
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
  const prompt = `只输出一个不超过1000汉字的《赤潮》后续完本大纲，按第十一至第十四话各一段写“行动/位置/规则证据/选择与代价”，最后一段写确定结局。严格遵守以下事实账本，不得混写：\n1) 第十话结束时，女人和孩子在第五层；唯一干布的整块布已在门内黑影右手；陆燃在第四层，右靴压第四层黑线，右手握唯一青色长刀且刀锋被牵向右腕，左臂骨折垂落；第三层两名未污染成年男子压住唯一的年轻男子，年轻男子黑斑已到脖侧。\n2) 道具只有两块布：唯一干布=女人此前持有但第十话末已落入黑影手中；暗红残布=只缠在长刀刀柄上。分别写清谁拿哪块、何时移动、各自作用和最终哪一块被消耗，不能说干布带封门者血迹，除非先安排明确染血事件。\n3) 四名成人幸存者身份必须逐话写明：陆燃、女人、两名未污染男子；年轻男子单独列为第五人，若死亡必须写出发生位置、动作和不可逆结果，后续不得再让他行动或被救。\n4) 逃生线索只能从第十一话起新铺垫：排水槽持续冷风、木屑方向、墙体空响、旧维修缝；不能声称第九话已有这些伏笔。通道干燥只能隔绝黑潮，若后来失效必须写明被水打湿的动作和时点。\n5) 机械动作必须写接触点和方向：撬棍支点在石阶凸缘，下压撬棍使盖石向上翻；刀身由两名未污染男子定位在门轴与石框之间，陆燃右腿蹬门槛、肩甲顶同一侧石壁，把力传到刀身；左臂不承重，右手只短时扶刀柄。\n6) 结局必须给出已验证的不可逆终止条件：门轴黑线被刀切断且暗红残布脱落/燃尽，黑潮停止回流；先让所有活人出泵房，再由明确的人封死入口。陆燃当场左臂仍骨折，获救后才固定治疗；数周后左臂活动受限，右手食指拇指永久失去精细握力，长刀刃裂但保留。孩子必须在一次可验证的比较中主动选择并帮助铺布或定位黑线。不要新悬念，不要“或许/或者”方案，不要解释性复述。\n\n已发布第十话正文：${String(latest.sourceContext || '').slice(-9000)}`
  const { jobId } = await api(`/api/works/${latest.workId}/text-jobs`, 'POST', { action:'outline', modelId:latest.textModelId, context:prompt, selected:prompt, maxTokens:3000 })
  saved = { workId:latest.workId, modelId:latest.textModelId, jobId, prompt, submittedAt:new Date().toISOString(), status:'queued', sourceEpisodes:[10] }
  writeFileSync(output, JSON.stringify(saved, null, 2)); console.log(JSON.stringify({ jobId, status:'queued' })); process.exit(0)
}
const job = (await api(`/api/jobs/${saved.jobId}`)).job
const next = { ...saved, status:job.status, result:job.result || null, errorCode:job.errorCode || null, checkedAt:new Date().toISOString() }
writeFileSync(output, JSON.stringify(next, null, 2))
console.log(JSON.stringify({ jobId:saved.jobId, status:job.status, reviewStatus:job.result?.review?.status || null, score:job.result?.review?.score || null, errorCode:job.errorCode || null }))
