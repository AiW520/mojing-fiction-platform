import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'

const root = resolve('artifacts/full-scene-artwork')
assert.ok(!existsSync(join(root, 'generation.lock')) && !existsSync(join(root, 'publication.lock')))
const planPath = join(root, 'plan.json'), ledgerPath = join(root, 'ledger.json')
const plan = JSON.parse(readFileSync(planPath, 'utf8')), ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'))
const id = 'work_ghost_ledger_scene_013_03'
const item = plan.entries.find(entry => entry.id === id), state = ledger.entries[id]
assert.equal(state.status, 'visual_rejected')
assert.ok(!state.visualApprovedAt && !state.publishedAt)
assert.ok(existsSync(state.original) && existsSync(state.mobile), 'Preserve the visually rejected original files')
const reason = 'Visual review counted six wall holes; chapter text explicitly records seven shallow holes'
const filename = '03-scene-attempt-2.png'
assert.ok(!existsSync(resolve('server/content/ghost-ledger/artifacts/scenes/chapter-013', filename)))
item.promptHistory = [...(item.promptHistory || []), { prompt: item.prompt, title: item.title, filename: item.filename, promptHash: state.promptHash, replacedAt: new Date().toISOString(), reason }]
item.filename = filename
item.prompt = '小说《镇诡司》第13章正文插图「墙砖七个红蜡浅孔」。独立中国古代证物静物摄影，北镇医署后院一段灰色旧砖墙正面近景，墙砖上横向排列且仅有恰好七个浅圆孔，每个孔眼都填有红蜡，清楚逐个可数，绝不能少于或多于七个；第六孔正下方有一条细短向下刮痕。旁边一把古代木尺用于量孔距，但不遮挡任何孔；一张无字拓纸置于墙下木案。冬日天光与风灯充分照亮七孔、蜡色和刮痕，写实古装电影静帧，画面清楚简洁。禁止人物、手、弩箭、牌匾、牌子、额外孔洞、墙上其他圆形装饰、可读文字、现代物品、血腥、鬼影、标题、字幕、Logo、水印、拼图或边框，只输出一幅横向3:2图片。'
item.promptReviewedAt = new Date().toISOString()
if (state.retryAuthorization) state.authorizationHistory = [...(state.authorizationHistory || []), state.retryAuthorization]
state.retryAuthorization = { authorizedAt: new Date().toISOString(), model: 'gpt-image-2', source: 'Standing user instruction: automatically retry failed images until successful', maxAdditionalRequests: 1, promptHash: createHash('sha256').update(item.prompt).digest('hex') }
for (const [path, value] of [[planPath, plan], [ledgerPath, ledger]]) { writeFileSync(path + '.tmp', JSON.stringify(value, null, 2) + '\n', 'utf8'); renameSync(path + '.tmp', path) }
console.log(JSON.stringify({ replacementAuthorized: id, reason }))
