import assert from 'node:assert/strict'

export function planRevisionRequest(previous, modelId) {
  assert.ok(previous.content.length <= 8000, '策划超过精简修订上下文上限，不能静默截断')
  const issues = previous.review.issues.map(({ severity, location, reason, suggestion }) => ({ severity, location, reason, suggestion }))
  const request = {
    action: 'outline', modelId, maxTokens: 2200,
    context: previous.content,
    selected: `依据已有策划和审查意见修订，保持原JSON结构，只返回严格JSON。全文约600到900汉字，人物仅2人，首话正好6个节拍。保留青春校园、帅气男主、女主独立目标和唯美感染力。修正所有严重问题及警告，补齐事故与预防行动因果，明确重生记忆边界、日期、标题数字作用和结局记忆来源；第一格抓人，末格可见悬念。不要解释或代码围栏。审查意见：${JSON.stringify(issues)}`,
  }
  assert.ok(request.selected.length <= 8000, '审查意见超过请求上限，不能静默截断')
  return request
}
