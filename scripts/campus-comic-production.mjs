import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { readEnvFile } from '../server/src/config.mjs'
import { planRevisionRequest } from './campus-plan-request.mjs'
import { acquireLock } from './campus-comic-lock.mjs'

const root = resolve(import.meta.dirname, '..')
const output = join(root, 'artifacts/campus-rebirth-comic')
const file = join(output, 'state.json')
const lockPath = join(output, '.producer.lock')
const releaseLock = acquireLock(lockPath)
process.once('exit', releaseLock)
const runtime = JSON.parse(readFileSync(join(output, 'runtime.json'), 'utf8'))
const env = { ...readEnvFile(join(root, 'server/.env')), ...process.env }
const response = await fetch(`${runtime.apiBase}/admin-api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ account: 'admin@mojing.local', password: env.DEV_ADMIN_PASSWORD || 'mojing-dev-only' }) })
assert.ok(response.ok, `LOGIN_${response.status}`)
const { token } = await response.json()
async function api(path, method = 'GET', input) {
  const response = await fetch(`${runtime.apiBase}${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, ...(input ? { body: JSON.stringify(input) } : {}) })
  const data = await response.json()
  if (!response.ok) throw new Error(`${path}: HTTP_${response.status} ${data.error?.code || ''}`)
  return data
}
let state = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null
function save() {
  state.updatedAt = new Date().toISOString()
  const temporary = `${file}.${process.pid}.tmp`
  writeFileSync(temporary, JSON.stringify(state, null, 2)); renameSync(temporary, file)
}
const argument = name => process.argv.find(value => value.startsWith(`${name}=`))?.slice(name.length + 1)
if (process.argv.includes('--plan') && !state) {
  const models = (await api('/admin-api/models')).items.filter(m => m.enabled)
  const writers = models.filter(m => m.kind === 'text' && ['generation', 'both'].includes(m.textRole))
  const writer = writers.find(m => m.isDefault) || writers[0]
  const image = models.find(m => m.kind === 'image' && m.model === 'gpt-image-2' && m.endpoint === 'https://api.tu-zi.com/coding/images/generations')
  assert.ok(writer && image)
  const work = (await api('/api/works', 'POST', { title: '青春校园重生 · 新漫画创作稿', type: '短篇小说', summary: '原创青春校园漫画，加入重生设定，男主帅气而有行动力，角色通过校园事件与选择建立感情。画面唯美、人物有感染力，开场即有抓人的事件，避免重生万能、霸凌浪漫化、油腻强迫亲密、堆砌悲剧和说教。由平台模型完成写作与分镜，助手仅监督。' })).work
  state = { apiBase: runtime.apiBase, workId: work.id, title: work.title, textModelId: writer.id, textModel: writer.model, imageModelId: image.id, imageModel: image.model, status: 'planning', planApproved: false, episodes: [], authorizedEpisodeCount: null, panelCount: 6, createdAt: new Date().toISOString() }
  save()
}
assert.ok(state, 'Create the plan first')
if (process.argv.includes('--retry-group-plan-once')) {
  assert.ok(state.groupPlanSubmitted && !state.groupPlanRetryUsed, 'Single authorized ensemble retry already used or no original request')
  assert.equal(state.planJobId, state.groupPlanJobId, 'Retry only the ensemble request')
  const previous = (await api(`/api/jobs/${state.groupPlanJobId}`)).job
  assert.equal(previous.status, 'failed', 'Original ensemble request must be terminal')
  assert.equal(runtime.textRequestTimeoutMs, 150000, 'Restart isolated API with the selected timeout first')
  const db = new (await import('node:sqlite')).DatabaseSync(join(output, 'data/mojing.sqlite'), { readOnly: true })
  let request
  try {
    request = JSON.parse(db.prepare('SELECT request_json FROM generation_jobs WHERE id=?').get(previous.id).request_json)
  } finally { db.close() }
  state.groupPlanRetryUsed = true
  state.groupRetryAuthorization = { receivedAt: new Date().toISOString(), instruction: '用户选择A：重启空闲隔离API，加载150秒超时，群像策划重发一次', previousJobId: previous.id }
  state.status = 'group_retry_submitting'; save()
  const result = await api(`/api/works/${state.workId}/text-jobs`, 'POST', {
    action: request.action, modelId: state.textModelId, maxTokens: request.maxTokens, context: request.context, selected: request.selected,
  })
  state.planJobIds.push(result.jobId); state.planJobId = result.jobId; state.groupPlanRetryJobId = result.jobId
  state.status = 'planning_group_cast'; state.awaitingRetryAuthorization = false; delete state.planError; save()
}
if (process.argv.includes('--group-plan')) {
  assert.ok(!state.groupPlanSubmitted, 'The new ensemble plan was already submitted')
  assert.ok(!state.planApproved && !state.episodes.length, 'Ensemble planning must precede approved episodes')
  const previous = (await api(`/api/jobs/${state.planJobId}`)).job
  assert.ok(['failed', 'success', 'cancelled'].includes(previous.status), 'Previous request must be terminal')
  const models = (await api('/admin-api/models')).items.filter(m => m.enabled && m.kind === 'text')
  const writer = models.find(m => m.id === state.textModelId && ['generation', 'both'].includes(m.textRole))
  const reviewer = models.find(m => m.reviewDefault && ['reviewer', 'both'].includes(m.textRole))
  assert.ok(writer && reviewer && writer.id !== reviewer.id, 'Configured writer and independent reviewer required')
  state.groupPlanSubmitted = true
  state.groupPortraitCount = 6
  state.status = 'group_plan_submitting'; save()
  const result = await api(`/api/works/${state.workId}/text-jobs`, 'POST', {
    action: 'outline', modelId: writer.id, maxTokens: 3000,
    selected: '根据用户的新需求，创作原创青春校园重生群像漫画策划，约1000汉字。核心恰好6名学生，每人有不同目标、独立选择和视觉锚点，至少3个视角；帅气清爽、有辨识度的男主为主视角，但其他人不只为他服务。女主有自己的目标。用具体校园事件让各人的愿望交叉、选择相互影响。重生仅一次，明确回到的日期、记忆来源及边界、不可重来与改变的代价；因果可证，不靠全知预言解决冲突，不额外添加时间暂停等复杂异能。唯美清透、有感染力，情绪由物件、目光、动作表达，避免说教。首话仅6格，不要6个人逐一登场介绍；聚焦2到3人主动参与的一个事件，其余埋线。第1格抓人，第6格具体可见悬念。规划起承合连载阶段与阶段结局。不要改用旧策划或旧标题，你决定新的原创标题和人物。严格只返回JSON，不用代码围栏：{"title":"","logline":"","theme":"","rebirthRule":"触发、日期、记忆边界、代价","characters":[{"name":"","role":"","goal":"","secret":"","visual":"年龄发型脸型身高体态服装主色配饰"}],"style":"","storyArcs":["起","承","合"],"firstEpisodeBeats":["1","2","3","4","5","6"],"ending":""}。characters必须6人，firstEpisodeBeats必须6条。所有场景节拍、秘密和结局要具体，避免抽象口号。',
  })
  state.planJobIds ||= [state.planJobId]
  state.planJobIds.push(result.jobId)
  state.planJobId = result.jobId
  state.groupPlanJobId = result.jobId
  state.status = 'planning_group_cast'; state.awaitingRetryAuthorization = false; delete state.planError; save()
}
if (process.argv.includes('--retry-plan-once')) {
  const previous = (await api(`/api/jobs/${state.planJobId}`)).job
  assert.equal(previous.status, 'failed', 'Previous planning request must be terminal')
  assert.ok(!state.authorizedPlanRetryUsed, 'The single authorized retry was already submitted')
  state.planJobIds = [state.planJobId]
  state.authorizedPlanRetryUsed = true
  state.authorizedEpisodeCount = 1
  state.retryAuthorization = { receivedAt: new Date().toISOString(), instruction: '用户确认重发一次；首批按1话6格推进', previousJobId: state.planJobId }
  state.status = 'planning_retry_submitting'; save()
  const result = await api(`/api/works/${state.workId}/text-jobs`, 'POST', { action: 'outline', modelId: state.textModelId, selected: '创作原创青春校园重生漫画精简策划，全文约600汉字。男主帅气克制、以行动吸引人，女主有独立目标；重生有明确边界与代价。你决定人物、书名与事件。首话6格，开场抓人，末格具体悬念。唯美清透电影构图。只返回严格JSON：{"title":"","logline":"","theme":"","rebirthRule":"","characters":[{"name":"","role":"","goal":"","visual":"年龄发型脸型身高服装配饰"}],"style":"","storyArcs":["起","承","合"],"firstEpisodeBeats":["1","2","3","4","5","6"],"ending":""}。角色仅2人，避免说明、代码围栏。' })
  state.planJobId = result.jobId; state.planJobIds.push(result.jobId)
  state.status = 'planning'; state.awaitingRetryAuthorization = false; delete state.planError; save()
}
if (process.argv.includes('--plan') && !state.planJobId) {
  const result = await api(`/api/works/${state.workId}/text-jobs`, 'POST', { action: 'outline', modelId: state.textModelId, selected: '请创作一本原创青春校园重生漫画的策划案。请你自己决定书名、具体人物、独特重生规则和主冲突。帅气男主有辨识度，外形通过清楚的形貌体现，魅力通过克制、有担当的行动体现，女主有自己的目标和选择。校园生活具体可信，色彩清透、柔光、电影构图，情绪由物件、动作、目光承载。设计一个可扩展连载的核心矛盾，以及可用于短篇完结的结局方案；首话准确6个画面节拍，第一格抓人，第六格留具体悬念。角色不要太多。只返回严格JSON，不用代码围栏：{"title":"","logline":"","theme":"","rebirthRule":"明确触发、代价、时间点、记忆边界","characters":[{"name":"","role":"","goal":"","visual":"发型脸型年龄身高服装主色配饰，固定视觉锚点"}],"style":"详细画风与颜色构图","storyArcs":["起","承","合"],"firstEpisodeBeats":["六条画面节拍"],"ending":""}。不输出正文，必须原创，不模仿现有漫画。' })
  state.planJobId = result.jobId; save()
}
const targetCount = argument('--episodes')
if (targetCount) {
  assert.ok(['1', '3', '30'].includes(targetCount), 'Use the approved story length')
  state.authorizedEpisodeCount = Number(targetCount); save()
}
if (process.argv.includes('--ongoing')) {
  state.ongoingAuthorization = { at: new Date().toISOString(), instruction: '用户授权持续平台模型创作、失败重试和助手审核发布' }
  state.authorizedEpisodeCount = 30
  save()
}
if (state.planJobId) {
  const job = (await api(`/api/jobs/${state.planJobId}`)).job
  writeFileSync(join(output, 'plan-job.json'), JSON.stringify(job, null, 2))
  if (job.status === 'failed') {
    state.status = 'planning_failed'; state.planError = job.errorCode
    state.awaitingRetryAuthorization = true; save()
  }
  if (job.status === 'success') {
    writeFileSync(join(output, 'plan-model-output.txt'), job.result.content)
    if (process.argv.includes('--accept-plan')) {
      assert.equal(job.result.review?.status, 'success', 'Model review must finish before planning acceptance')
      assert.ok(!job.result.review.issues.some(i => ['blocking', 'severe'].includes(i.severity)), 'Resolve serious review issues first')
      const plan = JSON.parse(job.result.content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim())
      assert.ok(plan.title && plan.rebirthRule && plan.style && plan.characters?.length && plan.firstEpisodeBeats?.length === 6)
      if (state.groupPortraitCount) assert.equal(plan.characters.length, state.groupPortraitCount)
      state.plan = plan; state.title = plan.title; state.planApproved = true; state.status = 'plan_approved'
      await api(`/api/works/${state.workId}/creative-settings`, 'PUT', { genre: '青春校园重生漫画', protagonist: plan.characters.map(c => `${c.name}：${c.goal}`).join('\n'), world: plan.rebirthRule, outline: JSON.stringify(plan), mood: plan.theme, visualStyle: plan.style })
      save()
    }
  }
}
if (process.argv.includes('--revise-plan-once')) {
  const previous = (await api(`/api/jobs/${state.planJobId}`)).job
  assert.equal(previous.status, 'success', '策划初稿必须已经成功')
  assert.ok(previous.result?.review?.status === 'success', '策划初稿必须有审查报告')
  assert.ok(!state.planRevisionUsed, '策划修订只能提交一次')
  state.planRevisionUsed = true
  state.status = 'plan_revision_submitting'; save()
  const result = await api(`/api/works/${state.workId}/text-jobs`, 'POST', planRevisionRequest(previous.result, state.textModelId))
  state.planJobIds ||= [state.planJobId]
  state.planJobIds.push(result.jobId)
  state.planRevisionJobId = result.jobId; state.planJobId = result.jobId
  state.status = 'planning_revision'; save()
}
const episodeNumber = Number(argument('--episode') || 1)
assert.ok(Number.isInteger(episodeNumber) && episodeNumber >= 1 && episodeNumber <= (state.authorizedEpisodeCount || 3))
let episode = state.episodes.find(e => e.number === episodeNumber)
if (process.argv.includes('--retry-writing') || process.argv.includes('--revise-story')) {
  assert.ok(state.ongoingAuthorization && episode && !episode.episodeId)
  const previous = (await api(`/api/jobs/${episode.writingJobIds.at(-1)}`)).job
  const revision = process.argv.includes('--revise-story')
  assert.equal(previous.status, revision ? 'success' : 'failed')
  const prior = state.episodes.find(e => e.number === episodeNumber - 1)
  const issues = previous.result?.review?.issues || []
  const result = await api(`/api/works/${episode.workId}/text-jobs`, 'POST', {
    action: revision ? 'rewrite' : 'continue', modelId: state.textModelId, maxTokens: 2500,
    context: revision ? previous.result.content : prior?.story || '',
    selected: revision
      ? `按照已批准的群像策划修订第${episodeNumber}话，保留事件与人物动机，只输出600到900字完整正文。落实审查问题：${JSON.stringify(issues)}。不复述上一话，不增加异能，不提前结束30话主线。`
      : `依照已批准的30话群像策划续写第${episodeNumber}话，600到900字，单一冲突、适合6格条漫。承接上话并推进本阶段，每人有独立选择和后果。只输出正文，末尾具体悬念，不提前完结。`,
  })
  episode.writingJobIds.push(result.jobId)
  episode.retryHistory ||= []
  episode.retryHistory.push({ at: new Date().toISOString(), sourceJobId: previous.id, jobId: result.jobId, kind: revision ? 'story_revision' : 'writing_retry' })
  state.status = revision ? 'revising_story' : 'writing'; save()
}
if (process.argv.includes('--revise-story-once')) {
  assert.ok(state.planApproved && episode && !episode.storyApproved)
  assert.ok(!episode.storyRevisionUsed, 'Single story correction already submitted')
  const previous = (await api(`/api/jobs/${episode.writingJobIds.at(-1)}`)).job
  assert.equal(previous.status, 'success', 'Only completed candidates can be corrected')
  assert.equal(previous.result?.review?.status, 'success', 'Completed independent review required')
  assert.ok(previous.result.review.issues.length, 'Correction requires concrete review findings')
  episode.storyRevisionUsed = true
  episode.storyRevisionSourceJobId = previous.id
  state.status = 'story_revision_submitting'; save()
  const issues = previous.result.review.issues.map(({ severity, location, reason, suggestion }) => ({ severity, location, reason, suggestion }))
  const result = await api(`/api/works/${episode.workId}/text-jobs`, 'POST', {
    action: 'rewrite', modelId: state.textModelId, maxTokens: 2500, context: previous.result.content,
    selected: `依据已批准策划和独立审查，修订当前第${episodeNumber}话，约600到900汉字，适合6格条漫。只输出完整修订正文，不输出标题或分析。修正所有严重问题和警告，准确使用2028年回到2021年的日期及记忆边界；阀门位置由许知雨现场指示，不使用全知预言；补齐断电与避险动作、架子有人支撑的连续行动、清退文件的存放来源。保持首话具体事件、角色各自行动、清透画面与末尾同意书悬念。不得改变6人群像设定或增加异能。审查意见：${JSON.stringify(issues)}`,
  })
  episode.writingJobIds.push(result.jobId)
  episode.storyRevisionJobId = result.jobId
  state.status = 'revising_story'; save()
}
if (process.argv.includes('--write')) {
  assert.ok(state.planApproved && state.authorizedEpisodeCount && episodeNumber <= state.authorizedEpisodeCount)
  if (!episode) {
    const previous = state.episodes.find(e => e.number === episodeNumber - 1)
    if (episodeNumber > 1) assert.ok(previous?.published, 'Publish the previous episode first')
    const work = (await api('/api/works', 'POST', { title: `${state.title} · 第${episodeNumber}话`, type: '短篇小说', summary: JSON.stringify(state.plan) })).work
    episode = { number: episodeNumber, workId: work.id, title: work.title, writingJobIds: [], storyboardJobIds: [], imageJobIds: [], storyApproved: false, storyboardApproved: false, visualApproved: false }
    state.episodes.push(episode); save()
  }
  assert.equal(episode.writingJobIds.length, 0, 'No automatic paid writing retries')
  const previous = state.episodes.find(e => e.number === episodeNumber - 1)
  const arc = state.plan.storyArcs[episodeNumber <= 6 ? 0 : episodeNumber <= 18 ? 1 : 2]
  const result = await api(`/api/works/${episode.workId}/text-jobs`, 'POST', { action: 'continue', modelId: state.textModelId, maxTokens: 2500, context: previous?.story || '', selected: `创作第${episodeNumber}话原创正文，约600到900汉字，适合精准改编为6格条漫，单话限定一个具体冲突和少量场景。遵守策划中的人物目标、外形、重生规则；承接上一话，避免复述。${episodeNumber === 1 ? '从firstEpisodeBeats展开，先给具体事件，再逐渐揭示重生，不用大段自我介绍。' : `本阶段：${arc}。按当前话号循序推进，不在一话写完整个阶段。`}${episodeNumber === state.authorizedEpisodeCount && state.ongoingAuthorization ? `完成本部结局：${state.plan.ending}` : state.authorizedEpisodeCount === 3 && episodeNumber === 3 ? '这是三话短篇的最后一话，完成核心冲突、兑现前文线索，给有余韵且明确的结局。' : '最后留下具体可见的新悬念。'}男主帅气的形貌和举止自然呈现，台词精炼，群像角色有独立选择，情感有克制的力量。只输出正文，不输出标题、分析、提纲、画面指令或说明。` })
  episode.writingJobIds.push(result.jobId); state.status = 'writing'; save()
}
if (episode?.writingJobIds.length) {
  const job = (await api(`/api/jobs/${episode.writingJobIds.at(-1)}`)).job
  const folder = join(output, `episode-${episodeNumber}`); mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, 'writing-job.json'), JSON.stringify(job, null, 2))
  if (job.status === 'success') {
    writeFileSync(join(folder, 'story.txt'), job.result.content)
    if (process.argv.includes('--accept-story') && !episode.episodeId) {
      assert.equal(job.result.review?.status, 'success')
      assert.ok(!job.result.review.issues.some(i => ['blocking', 'severe'].includes(i.severity)))
      assert.equal(job.result.review.candidateHash, job.result.candidateHash)
      episode.storyReviewAcceptance = { jobId: job.id, candidateHash: job.result.candidateHash, review: job.result.review }
      save()
      await api(`/api/works/${episode.workId}/blocks`, 'PUT', { items: [{ id: randomUUID(), blockType: 'text', content: job.result.content }] })
      const result = await api('/admin-api/comics', 'POST', { workId: episode.workId, title: episode.title, style: state.plan.style, characters: state.plan.characters.map(c => `${c.name}（${c.role}）：${c.visual}；目标：${c.goal}`).join('\n'), rightsConfirmed: true, rightsNote: '用户授权平台配置模型创作原创青春校园重生漫画；保留平台任务记录；由助手审核，草稿暂不公开。' })
      episode.episodeId = result.episode.id; episode.story = job.result.content; episode.storyApproved = true; state.status = 'story_approved'; save()
    }
  }
}
if (episode?.episodeId) {
  const path = `/admin-api/comics/${episode.episodeId}`
  let draft = (await api(path)).episode
  if (process.argv.includes('--reviewed-storyboard')) {
    assert.ok(state.ongoingAuthorization && episode.storyApproved && !episode.storyboardRevisionApplied && !episode.imageJobIds.length)
    if (episode.storyboardRevisionJobId) {
      const previous = (await api(`/api/jobs/${episode.storyboardRevisionJobId}`)).job
      assert.ok(['success', 'failed'].includes(previous.status), 'Wait for the current storyboard task')
    }
    const previous = episode.storyboardRevisionJobId ? (await api(`/api/jobs/${episode.storyboardRevisionJobId}`)).job : null
    const result = await api(`/api/works/${episode.workId}/text-jobs`, 'POST', {
      action: 'outline', modelId: state.textModelId, maxTokens: 3000,
      context: JSON.stringify({ plan: state.plan, story: episode.story, previous: previous?.result?.content, issues: previous?.result?.review?.issues }),
      selected: `将第${episodeNumber}话完整正文改编为恰好6格唯美清透竖向条漫。忠于正文，不编造后续，人物独立行动有感染力。每格单一时刻，动作和空间连续、服装及道具外观固定；男主黑短发蓝白校服与黑色旧运动表，不添加背包或额外胸章；其他人物严格遵照视觉档案。画面prompt约150到250中文字符，写清构图、光线、人物表情动作与环境；所有文字、台词、数字日期均不得画进图片，放到narration/dialogue。每格旁白不超过45字符，6格对白合计不超过100字符。第1格抓人，第6格兑现正文悬念。避免危险动作与旁白矛盾、重复脸孔及手部错误。${previous ? '修正上次独立审查意见和JSON/长度问题。' : ''}只返回严格JSON：{"panels":[{"prompt":"","narration":"","dialogue":""}]}，不加代码围栏、标题或解释。`,
    })
    episode.storyboardRevisionSourceVersion = draft.version
    episode.storyboardRevisionJobId = result.jobId
    episode.storyboardRevisionJobIds ||= []
    episode.storyboardRevisionJobIds.push(result.jobId)
    if (previous) {
      episode.retryHistory ||= []
      episode.retryHistory.push({ at: new Date().toISOString(), kind: previous.status === 'failed' ? 'storyboard_retry' : 'storyboard_revision', sourceJobId: previous.id, jobId: result.jobId })
    }
    state.status = 'revising_storyboard'; save()
  }
  if (process.argv.includes('--refine-storyboard-once')) {
    assert.ok(episode.storyboardRevisionJobId && !episode.storyboardRevisionApplied && !episode.storyboardRefinementUsed)
    const previous = (await api(`/api/jobs/${episode.storyboardRevisionJobId}`)).job
    assert.equal(previous.status, 'success')
    assert.equal(previous.result.review?.status, 'success')
    episode.storyboardRefinementUsed = true
    episode.storyboardRevisionJobIds = [episode.storyboardRevisionJobId]
    state.status = 'storyboard_refinement_submitting'; save()
    const result = await api(`/api/works/${episode.workId}/text-jobs`, 'POST', {
      action: 'outline', modelId: state.textModelId, maxTokens: 3000,
      context: JSON.stringify({ previous: JSON.parse(previous.result.content), review: previous.result.review.issues }),
      selected: '依据审查修订6格首话分镜，只返回严格JSON：{"panels":[{"prompt":"","narration":"","dialogue":""}]}。恰好6格，画面prompt必须详细具体、服装面貌锚点稳定且无可辨识文字日期数字气泡水印，不要省略画面细节。现在明确全话全部对白拼接总长度不超过65个字符（包含角色名、标点与换行），每格旁白不超过45个字符。简化为三人主动行动：陆澈始终在干燥门槛扶住铁架直到重新立稳，不离开去关阀，不交给周竞；许知雨在干燥边界指示，唐禾让其余学生撤离并在干燥走廊断电，断电确认后许知雨沿干燥走廊关闭红阀，再抢救公共底片；唐禾记录损失和放置接水桶。其余人物只用器材、照片背面、画筒埋线，不承担支撑交接。第一格以爆管顶架抓人，第二格旧运动表特写、旁白交代2028年触照片后回到2021年9月6日16:20，画面仍为17岁少年而非24岁；第三格断电撤离，第四格女主关阀且水停止，第五格公共底片上台同时男主将架子立稳，归档袋露出并简短交代学生会待归档来源，第六格男主手拿文件、克制震惊，旁白清退书9月3日签名陆澈、9月20日执行。每格单一时刻、真实空间、一人不同时做多个动作。不新增其他剧情、异能、解释或标题。',
    })
    episode.storyboardRevisionJobId = result.jobId
    episode.storyboardRevisionJobIds.push(result.jobId)
    state.status = 'revising_storyboard'; save()
  }
  if (process.argv.includes('--revise-storyboard-once')) {
    assert.ok(episode.storyApproved && !episode.storyboardApproved && !episode.storyboardRevisionJobId)
    const jobs = (await api(`${path}/jobs`)).items
    assert.ok(jobs.some(j => j.type === 'comic_storyboard' && j.status === 'success' && !j.result?.stale))
    const result = await api(`/api/works/${episode.workId}/text-jobs`, 'POST', {
      action: 'outline', modelId: state.textModelId, maxTokens: 3000,
      context: JSON.stringify({ story: episode.story, panels: draft.panels.map(({ prompt, narration, dialogue }) => ({ prompt, narration, dialogue })) }),
      selected: '修订首话6格竖向条漫分镜，只返回严格JSON：{"panels":[{"prompt":"","narration":"","dialogue":""}]}。恰好6格，保持已批准正文的事件与末尾清退同意书悬念，不新增后续。监督问题：旧分镜把2028年24岁的男主画成少年；撤离、断电和支撑铁架连续性不清；忘记旧运动表；最后旁白过长。第一格可从爆管顶架抓人，第二格用旧运动表特写与简短旁白交代2028年触照片后回到2021年9月6日16:20。首话以陆澈、许知雨、唐禾三人主动行动为主，其余用器材、照片、画筒埋线，避免多人堆满每格。男主在干燥门槛支撑铁架，许知雨在干燥安全边界指示，其他人撤出积水区域，唐禾在干燥走廊拉闸，断电确认后再救底片；必须交代按许知雨指示关阀的人及支撑交接，不能遗忘关闭水管。每格是一张可绘制的单一画面，不要拼贴或要求同一人物同时做多动作。公共底片救完并稳定架子后，资料袋露出同意书；唐禾通过归档袋来源交代文件。每格旁白不超过45汉字，对白总长不超过65汉字，可用换行。图片prompt内无可辨识文字、日期、字迹、印章文字、气泡或水印，时间与文件内容只放narration/dialogue。男主清俊帅气，水彩清透，动作具体、情绪克制。',
    })
    episode.storyboardRevisionJobId = result.jobId
    episode.storyboardRevisionSourceVersion = draft.version
    state.status = 'revising_storyboard'; save()
  }
  if (episode.storyboardRevisionJobId) {
    const job = (await api(`/api/jobs/${episode.storyboardRevisionJobId}`)).job
    writeFileSync(join(output, `episode-${episodeNumber}`, 'storyboard-revision-job.json'), JSON.stringify(job, null, 2))
    if (process.argv.includes('--accept-storyboard-revision')) {
      assert.equal(job.status, 'success')
      assert.equal(job.result.review?.status, 'success')
      assert.ok(!job.result.review.issues.some(i => ['blocking', 'severe'].includes(i.severity)))
      assert.ok(!episode.storyboardRevisionApplied)
      assert.equal(draft.version, episode.storyboardRevisionSourceVersion)
      const { panels } = JSON.parse(job.result.content)
      assert.equal(panels.length, state.panelCount)
      assert.ok(panels.every(p => typeof p.prompt === 'string' && p.prompt.trim() && typeof p.narration === 'string' && p.narration.length <= 45 && typeof p.dialogue === 'string' && p.dialogue.length <= 65))
      if (episode.storyboardRefinementUsed) assert.ok(panels.map(p => p.dialogue).join('').length <= 65, 'Refined dialogue must fit the complete-episode limit')
      draft = (await api(path, 'PUT', { version: draft.version, panels: panels.map(p => ({ ...p, id: randomUUID(), imageId: null, approved: false })) })).episode
      episode.storyboardReviewAcceptance = { jobId: job.id, candidateHash: job.result.candidateHash, review: job.result.review }
      episode.storyboardRevisionApplied = true
      episode.storyboardApproved = true
      state.status = 'storyboard_revision_applied'; save()
    }
  }
  if (process.argv.includes('--storyboard')) {
    assert.equal(episode.storyboardJobIds.length, 0, 'No automatic paid storyboard retries')
    const result = await api(`${path}/storyboard`, 'POST', { version: draft.version, panelCount: state.panelCount, modelId: state.textModelId })
    episode.storyboardJobIds.push(result.jobId); state.status = 'storyboarding'; save()
  }
  if (process.argv.includes('--accept-storyboard')) {
    assert.equal(draft.panels.length, state.panelCount)
    const jobs = (await api(`${path}/jobs`)).items
    assert.ok(jobs.some(j => j.type === 'comic_storyboard' && j.status === 'success' && !j.result?.stale))
    episode.storyboardApproved = true; state.status = 'storyboard_approved'; save()
  }
  if (process.argv.includes('--images')) {
    assert.ok(episode.storyboardApproved)
    assert.equal(episode.imageJobIds.length, 0, 'Failed paid image requests require new authorization')
    const result = await api(`${path}/images`, 'POST', { version: draft.version, modelId: state.imageModelId, retryPolicy: 'never' })
    episode.imageJobIds.push(...result.jobIds); state.status = 'illustrating'; save()
  }
  if (process.argv.includes('--retry-images-once')) {
    assert.ok(episode.storyboardApproved && episode.awaitingImageRetryAuthorization && !episode.imageRetryUsed)
    const jobs = (await api(`${path}/jobs`)).items
    assert.ok(!jobs.some(j => ['queued', 'running'].includes(j.status)), 'Wait for all current tasks to finish')
    const panels = draft.panels.filter(p => !p.imageId)
    assert.equal(panels.length, 5, 'Only the five reviewed missing panels are in scope')
    const originalJobs = episode.imageJobIds.map(id => jobs.find(j => j.id === id))
    assert.equal(originalJobs.filter(j => j?.status === 'failed').length, 5)
    assert.equal(originalJobs.filter(j => j?.status === 'success').length, 1)
    episode.imageRetryUsed = true
    episode.imageRetrySourceJobIds = [...episode.failedImageJobIds]
    episode.imageRetryAuthorization = { at: new Date().toISOString(), instruction: '用户明确授权失败5格各重发一次，成功第2格复用' }
    episode.awaitingImageRetryAuthorization = false
    state.status = 'image_retry_submitting'; save()
    const result = await api(`${path}/images`, 'POST', { version: draft.version, modelId: state.imageModelId, retryPolicy: 'never', panelIds: panels.map(p => p.id) })
    assert.equal(result.jobIds.length, 5)
    episode.imageRetryJobIds = result.jobIds
    episode.imageJobIds.push(...result.jobIds)
    state.status = 'illustrating'; save()
  }
  if (process.argv.includes('--retry-images')) {
    assert.ok(state.ongoingAuthorization && episode.storyboardApproved)
    const currentJobs = (await api(`${path}/jobs`)).items
    assert.ok(!currentJobs.some(j => ['queued', 'running'].includes(j.status)), 'Wait for the current tasks')
    const missing = draft.panels.filter(p => !p.imageId)
    assert.ok(missing.length, 'No missing images to retry')
    const result = await api(`${path}/images`, 'POST', { version: draft.version, modelId: state.imageModelId, retryPolicy: 'never', panelIds: missing.map(p => p.id) })
    episode.imageRetryJobIds = result.jobIds
    episode.imageJobIds.push(...result.jobIds)
    episode.retryHistory ||= []
    episode.retryHistory.push({ at: new Date().toISOString(), kind: 'image_retry', sourceJobIds: episode.failedImageJobIds || [], jobIds: result.jobIds })
    episode.awaitingImageRetryAuthorization = false
    state.status = 'illustrating'; save()
  }
  const regeneratePanels = argument('--regenerate-panels')
  if (regeneratePanels) {
    assert.ok(state.ongoingAuthorization && episode.storyboardApproved && !episode.published)
    const currentJobs = (await api(`${path}/jobs`)).items
    assert.ok(!currentJobs.some(j => ['queued', 'running'].includes(j.status)))
    const numbers = regeneratePanels.split(',').map(Number)
    assert.ok(numbers.length && numbers.every(n => Number.isInteger(n) && n >= 1 && n <= draft.panels.length))
    const result = await api(`${path}/images`, 'POST', { version: draft.version, modelId: state.imageModelId, retryPolicy: 'never', panelIds: [...new Set(numbers)].map(n => draft.panels[n - 1].id) })
    episode.imageRetryJobIds = result.jobIds
    episode.imageJobIds.push(...result.jobIds)
    episode.visualApproved = false
    episode.retryHistory ||= []
    episode.retryHistory.push({ at: new Date().toISOString(), kind: 'visual_regeneration', panels: numbers, jobIds: result.jobIds })
    state.status = 'illustrating'; save()
  }
  draft = (await api(path)).episode
  const jobs = (await api(`${path}/jobs`)).items
  if (episode.imageJobIds.length && !jobs.some(j => ['queued', 'running'].includes(j.status))) {
    const failed = jobs.filter(j => (episode.imageRetryJobIds || episode.imageJobIds).includes(j.id) && j.status === 'failed')
    if (failed.length && !episode.visualApproved) {
      episode.failedImageJobIds = failed.map(j => j.id)
      episode.awaitingImageRetryAuthorization = true
      state.status = 'images_partial_failed'; save()
    } else if (draft.panels.every(p => p.imageId) && !episode.visualApproved) {
      episode.failedImageJobIds = []
      episode.awaitingImageRetryAuthorization = false
      state.status = 'images_ready_for_review'; save()
    }
  }
  const folder = join(output, `episode-${episodeNumber}`)
  writeFileSync(join(folder, 'comic-results.json'), JSON.stringify({ episode: draft, jobs }, null, 2))
  for (const [index, panel] of draft.panels.entries()) {
    if (!panel.imageId) continue
    const imageFile = join(folder, `panel-${index + 1}.png`)
    const identityFile = join(folder, `panel-${index + 1}.image-id.txt`)
    if (existsSync(imageFile) && existsSync(identityFile) && readFileSync(identityFile, 'utf8') === panel.imageId) continue
    const response = await fetch(`${runtime.apiBase}/api/comic-media/${panel.imageId}/original`, { headers: { Authorization: `Bearer ${token}` } })
    assert.ok(response.ok)
    if (existsSync(imageFile)) {
      const oldId = existsSync(identityFile) ? readFileSync(identityFile, 'utf8') : 'previous'
      const history = join(folder, 'image-history'); mkdirSync(history, { recursive: true })
      renameSync(imageFile, join(history, `panel-${index + 1}-${oldId}-${Date.now()}.png`))
    }
    writeFileSync(imageFile, Buffer.from(await response.arrayBuffer()))
    writeFileSync(identityFile, panel.imageId)
  }
  if (process.argv.includes('--accept-images')) {
    assert.ok(draft.panels.every(p => p.imageId) && !jobs.some(j => ['queued', 'running'].includes(j.status)))
    draft = (await api(path, 'PUT', { version: draft.version, panels: draft.panels.map(p => ({ ...p, approved: true })) })).episode
    episode.visualApproved = true; state.status = state.episodes.filter(e => e.visualApproved).length === state.authorizedEpisodeCount ? 'complete' : 'episode_complete'; save()
  }
  if (process.argv.includes('--publish')) {
    assert.ok(episode.visualApproved, 'Images must be accepted before publication')
    draft = (await api(path)).episode
    assert.ok(draft.panels.every(p => p.imageId && p.approved))
    const published = await api(`${path}/publish`, 'POST', { version: draft.version })
    episode.published = true
    episode.publishedVersion = published.episode.publishedVersion
    state.status = 'published'
    state.readerUrl = `${runtime.apiBase}/comics/${episode.episodeId}`
    save()
  }
}
const production = await api('/admin-api/production')
console.log(JSON.stringify({ title: state.title, status: state.status, planJobId: state.planJobId, authorizedEpisodeCount: state.authorizedEpisodeCount, episodes: state.episodes.map(({ story, ...e }) => e), active: production.jobs.filter(j => ['queued', 'running'].includes(j.status)).map(j => ({ id: j.id, type: j.type, status: j.status })), jobs: production.jobs.slice(0, 12).map(j => ({ id: j.id, type: j.type, status: j.status, errorCode: j.errorCode })) }))
