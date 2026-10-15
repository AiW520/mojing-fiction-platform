import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, renameSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
const root = resolve('artifacts/full-scene-artwork')
const planPath = join(root, 'plan.json'), ledgerPath = join(root, 'ledger.json')
const plan = JSON.parse(readFileSync(planPath, 'utf8')), ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'))
const item = plan.entries.find(x => x.id === 'work_bone_lantern_scene_072_01'), state = ledger.entries[item.id]
assert.equal(state.status, 'generated')
item.promptHistory = [...(item.promptHistory || []), { prompt: item.prompt, filename: item.filename, promptHash: state.promptHash, replacedAt: new Date().toISOString(), reason: 'Second count review: image still showed ten tiles; require eight on table plus one in hand' }]
item.filename = item.filename.replace(/\.png$/i, '-attempt-3.png')
item.prompt = `小说《照骨灯》正文插图「九枚动作木片摆开」。写实中国古装电影静帧。午后义庄正厅，晏九坐在普通木凳上，右手拿着恰好一枚小木片，左手空着；木案上只摆恰好八枚小木片，分成两行四枚，合计画面中恰好九枚，不能多一枚。每片只有简单刻槽，无可读文字。沈青崖与宋延在侧记录，裴照川站侧边。请在生成前核对数量：桌面八枚，手中一枚，总数九枚。不要第十枚木片、额外棋子、九个人幻象、审讯枷锁或强迫指认。只输出一幅横向3:2图片，无标题、文字、字幕、Logo、水印、拼图、边框，无现代物品，无动漫立绘。`
item.promptReviewedAt = new Date().toISOString()
state.status = 'visual_rejected'; delete state.visualApprovedAt; delete state.visualOriginalHash; delete state.visualMobileHash
state.visualRejectedAt = new Date().toISOString(); state.visualRejectionReason = 'Second count review: image still showed ten tiles; require eight on table plus one in hand'
state.retryAuthorization = { authorizedAt: new Date().toISOString(), model: 'gpt-image-2', source: 'Standing user instruction: automatically retry failed images until successful', maxAdditionalRequests: 1, promptHash: createHash('sha256').update(item.prompt).digest('hex') }
for (const [path, value] of [[planPath, plan], [ledgerPath, ledger]]) { writeFileSync(path + '.tmp', JSON.stringify(value, null, 2) + '\n'); renameSync(path + '.tmp', path) }
