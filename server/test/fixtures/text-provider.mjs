import dns from 'node:dns/promises'
import { syncBuiltinESMExports } from 'node:module'

// Preloaded only by isolated tests. Neither DNS nor paid requests reach a provider.
dns.lookup = async () => [{ address: '203.0.113.10', family: 4 }]
syncBuiltinESMExports()
const timeout = AbortSignal.timeout.bind(AbortSignal)
AbortSignal.timeout = milliseconds => { console.log(`MOCK_DEADLINE:${milliseconds}`); return timeout(milliseconds) }
globalThis.fetch = async (_url, options) => {
  const input = JSON.parse(options.body)
  const model = input.model
  console.log(`MOCK_MODEL:${model}`)
  console.log(`MOCK_MAX_TOKENS:${input.max_tokens}`)
  if (model === 'gen-deadline') await new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, 3000)
    const abort = () => { clearTimeout(timer); reject(options.signal.reason) }
    if (options.signal.aborted) abort()
    else options.signal.addEventListener('abort', abort, { once: true })
  })
  if (model.includes('timeout')) throw new DOMException('Timed out', 'TimeoutError')
  if (model.includes('network')) throw new TypeError('fetch failed')
  if (model.includes('503')) return new Response('{}', { status: 503 })
  if (model.includes('hold')) await new Promise(resolve => setTimeout(resolve, 300))
  const reviewer = input.messages[0].content.includes('监督审查员')
  const importer = input.messages[0].content.includes('suggestedContent')
  const content = importer ? JSON.stringify({ suggestedContent: '修改建议正文', issues: [], imagePlan: '' })
    : reviewer ? JSON.stringify(model.includes('invalid') ? { score: 'bad', issues: [] } : { score: 7, issues: [{ severity: 'warning', type: '连续性', location: '候选第 1 段', reason: '线索衔接不足', suggestion: '补充线索来源' }] })
      : '灯塔下，守夜人把第二封信递给他。'
  return Response.json({ choices: [{ message: { content }, finish_reason: 'stop' }] })
}
