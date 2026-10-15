import { readFileSync, writeFileSync, renameSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'

const root = resolve('artifacts/full-scene-artwork')
const planPath = resolve(root, 'plan.json')
const ledgerPath = resolve(root, 'ledger.json')
const plan = JSON.parse(readFileSync(planPath, 'utf8'))
const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'))
const ids = [
  'work_ghost_ledger_scene_025_01',
  'work_ghost_ledger_scene_025_02',
  'work_ghost_ledger_scene_025_05'
]
const extra = '所有纸张、木牌、印章和簿册只显示无意义的抽象墨痕与线条，严禁任何汉字、数字、姓名、印章文字或可辨认字符；证物文字不可读。'
for (const id of ids) {
  const item = plan.entries.find(entry => entry.id === id)
  const state = ledger.entries[id]
  if (!item || state?.status !== 'generated') throw new Error(`Expected generated item: ${id}`)
  if (state.retryAuthorization && !state.retryAuthorization.consumedAt) throw new Error(`Unused retry authorization already exists: ${id}`)
  if (state.retryAuthorization) state.authorizationHistory = [...(state.authorizationHistory || []), state.retryAuthorization]
  const oldPrompt = item.prompt
  item.filename = item.filename.replace(/\.png$/i, '-retry-1.png')
  item.prompt = `${oldPrompt}${extra}`
  state.status = 'visual_rejected'
  state.visualRejectedAt = new Date().toISOString()
  state.visualRejectionReason = 'Generated image contains readable-looking Chinese characters or seal text; replace with abstract unreadable marks.'
  state.retryAuthorization = {
    authorizedAt: new Date().toISOString(),
    model: 'gpt-image-2',
    source: 'Standing user instruction: automatically retry failed images until successful',
    maxAdditionalRequests: 1,
    promptHash: createHash('sha256').update(item.prompt).digest('hex')
  }
}
for (const [path, value] of [[planPath, plan], [ledgerPath, ledger]]) {
  writeFileSync(path + '.tmp', JSON.stringify(value, null, 2) + '\n', 'utf8')
  renameSync(path + '.tmp', path)
}
console.log(JSON.stringify({ rejected: ids, reason: 'unreadable text replacement' }))
