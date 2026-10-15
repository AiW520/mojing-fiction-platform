import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'

const root = resolve('artifacts/full-scene-artwork')
assert.ok(!existsSync(join(root, 'generation.lock')) && !existsSync(join(root, 'publication.lock')))
const planPath = join(root, 'plan.json'), ledgerPath = join(root, 'ledger.json')
const plan = JSON.parse(readFileSync(planPath, 'utf8')), ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'))
const id = 'work_ghost_ledger_scene_004_04'
const item = plan.entries.find(entry => entry.id === id), state = ledger.entries[id]
assert.equal(state.status, 'generated')
assert.ok(!state.visualApprovedAt && !state.publishedAt)
const reason = 'Contact-sheet visual review: four outlined evidence boxes were replaced by diagonal strokes and the palm-on-page action became writing'
const filename = '04-scene-attempt-2.png'
assert.ok(!existsSync(resolve('server/content/ghost-ledger/artifacts/scenes/chapter-004', filename)))
item.promptHistory = [...(item.promptHistory || []), { prompt: item.prompt, title: item.title, filename: item.filename, promptHash: state.promptHash, replacedAt: new Date().toISOString(), reason }]
state.status = 'visual_rejected'
state.visualRejectedAt = new Date().toISOString()
state.visualRejectionReason = reason
item.filename = filename
item.prompt = '小说《镇诡司》第4章正文插图，独立器物近景。黑水驿厅旧木桌上只有一本打开的巴掌大黑皮薄簿，四角缝细铜线。俯视清楚呈现右页：一排恰好四个闭合正方形细墨边框，互相分隔，从左到右前三格各有一小段墨痕，第四格内部只有一条刚落下的短黑横线。每个方格都必须有清晰闭合的四条边，不能用四条斜线代替方格。页上除此以外没有文字、数字、额外方格或现代表格。左页普通旧纸空白。暖风灯从画外照亮纸面，冷雪天光补光，黑皮封面、铜线、旧木与纸质纹理真实清楚。无人、无手、无笔、无写字动作、无发光、无符文、无血液、无尸体。写实中国古装电影器物静物，只输出一幅横向3:2图片，无标题、字幕、Logo、水印、拼图或边框。'
item.promptReviewedAt = new Date().toISOString()
if (state.retryAuthorization) state.authorizationHistory = [...(state.authorizationHistory || []), state.retryAuthorization]
state.retryAuthorization = { authorizedAt: new Date().toISOString(), model: 'gpt-image-2', source: 'Standing user instruction: automatically retry failed images until successful', maxAdditionalRequests: 1, promptHash: createHash('sha256').update(item.prompt).digest('hex') }
for (const [path, value] of [[planPath, plan], [ledgerPath, ledger]]) {
  writeFileSync(path + '.tmp', JSON.stringify(value, null, 2) + '\n', 'utf8')
  renameSync(path + '.tmp', path)
}
console.log(JSON.stringify({ replacementAuthorized: id, reason }))
