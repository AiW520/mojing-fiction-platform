import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'

const root = resolve('artifacts/full-scene-artwork')
assert.ok(!existsSync(join(root, 'generation.lock')) && !existsSync(join(root, 'publication.lock')))
const planPath = join(root, 'plan.json'), ledgerPath = join(root, 'ledger.json')
const plan = JSON.parse(readFileSync(planPath, 'utf8')), ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'))
const id = 'work_ghost_ledger_scene_011_01'
const item = plan.entries.find(entry => entry.id === id), state = ledger.entries[id]
assert.equal(state.status, 'failed')
assert.ok(!state.visualApprovedAt && !state.publishedAt)
assert.ok(!existsSync(state.original) && !existsSync(state.mobile), 'Reconcile existing files before requesting a replacement')
const reason = 'Provider safety rejection; retain the chapter transport record as an independent paper-and-tools still life'
const filename = '01-scene-attempt-2.png'
assert.ok(!existsSync(resolve('server/content/ghost-ledger/artifacts/scenes/chapter-011', filename)))
item.promptHistory = [...(item.promptHistory || []), { prompt: item.prompt, title: item.title, filename: item.filename, promptHash: state.promptHash, replacedAt: new Date().toISOString(), reason }]
item.filename = filename
item.prompt = '小说《镇诡司》第11章正文插图「搬运链分段记录」。独立中国古代器物静物：黑水驿木案上三张交接记录纸分开铺放，每张仅有几段不可辨认的短墨线和保留空白，表现分别记录搬运时刻与换手位置，纸张边角用一根旧木杖压住；旁边放一把普通木尺、未书写的纸签和一只旧墨碗。古代冬夜风灯从画外照亮纸纤维、木杖纹理和空白处，冷雪天光在后方木窗补光，写实古装电影器物摄影，主体清楚明亮。无人、无手、无人体、无骨骼、无血液、无医疗检查、无现代物品，无可读汉字、数字、标题、字幕、Logo、水印、拼图或边框，只输出一幅横向3:2图片。'
item.promptReviewedAt = new Date().toISOString()
if (state.retryAuthorization) state.authorizationHistory = [...(state.authorizationHistory || []), state.retryAuthorization]
state.retryAuthorization = { authorizedAt: new Date().toISOString(), model: 'gpt-image-2', source: 'Standing user instruction: automatically retry failed images until successful', maxAdditionalRequests: 1, promptHash: createHash('sha256').update(item.prompt).digest('hex') }
for (const [path, value] of [[planPath, plan], [ledgerPath, ledger]]) {
  writeFileSync(path + '.tmp', JSON.stringify(value, null, 2) + '\n', 'utf8')
  renameSync(path + '.tmp', path)
}
console.log(JSON.stringify({ replacementAuthorized: id, reason }))
