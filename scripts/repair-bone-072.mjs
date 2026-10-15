import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, renameSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'

const root = resolve('artifacts/full-scene-artwork')
const planPath = join(root, 'plan.json')
const ledgerPath = join(root, 'ledger.json')
const plan = JSON.parse(readFileSync(planPath, 'utf8'))
const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'))
const replacements = [
  { id: 'work_bone_lantern_scene_072_01', reason: 'Original-size review: nine tiles on table plus one in hand, ten instead of nine', scene: '午后义庄正厅，晏九坐在与木案等高的普通木凳上，木案只摆九枚小木片，排成三行三列，每片只有简单刻槽无可读文字；晏九将其中一枚移到左侧，手中不再持有其他木片。沈青崖与宋延在侧记录，裴照川站侧边，不坐高椅。不要第十枚木片、九个人幻象、审讯枷锁或强迫指认。' },
  { id: 'work_bone_lantern_scene_072_05', reason: 'Tile packing assigned to Shen Qingya instead of Yan Jiu', scene: '临近夜半的义庄正厅，晏九独自坐在木案边，双手把九枚动作木片收入小木盒，最上方露出三枚刻槽木片，木案上没有其他人正在收拾木片。沈青崖站在一旁仅记录，闻夫人和裴照川分别保管三份证言纸封袋，彼此独立。桌边有封好的门缝灰小纸袋，小黑册合起。普通油灯照亮主体，不画原名、召唤幻象、共同身份或现代塑料袋。' }
]
for (const replacement of replacements) {
  const item = plan.entries.find(entry => entry.id === replacement.id)
  const state = ledger.entries[replacement.id]
  assert.ok(item && state)
  item.promptHistory = [...(item.promptHistory || []), { prompt: item.prompt, filename: item.filename, promptHash: state.promptHash, replacedAt: new Date().toISOString(), reason: replacement.reason }]
  item.filename = item.filename.replace(/\.png$/i, '-attempt-2.png')
  item.prompt = `小说《照骨灯》正文插图「${item.title}」。统一美术：写实中国古装电影静帧，真实木石布料与铜器质感，秋季奉安古城，冷灰自然光与暖色风灯对照，清晰照亮剧情主体。人物一致性：晏九：中国男性少年，瘦削，黑发束小髻，旧浅灰麻衣，谨慎克制，双手无伤口；沈青崖：23岁中国女性，细长脸、清晰颧骨、平直眉、黑发低髻，深色窄袖旧官服；闻夫人：中国成年女性，深青灰布衣，黑发低髻，神情沉静；裴照川：中国成年男性，修长脸、平直眉、黑发束冠、黑色窄袖巡夜官服。当前唯一画面：${replacement.scene}只输出一幅横向3:2图片，无标题、文字、字幕、Logo、水印、拼图、边框，无现代物品，无动漫立绘。`
  item.promptReviewedAt = new Date().toISOString()
  state.status = 'visual_rejected'
  delete state.visualApprovedAt
  delete state.visualOriginalHash
  delete state.visualMobileHash
  state.visualRejectedAt = new Date().toISOString()
  state.visualRejectionReason = replacement.reason
  state.retryAuthorization = { authorizedAt: new Date().toISOString(), model: 'gpt-image-2', source: 'Standing user instruction: automatically retry failed images until successful', maxAdditionalRequests: 1, promptHash: createHash('sha256').update(item.prompt).digest('hex') }
}
for (const [path, value] of [[planPath, plan], [ledgerPath, ledger]]) {
  writeFileSync(path + '.tmp', JSON.stringify(value, null, 2) + '\n', 'utf8')
  renameSync(path + '.tmp', path)
}
console.log(JSON.stringify({ replacementAuthorized: replacements.map(item => item.id) }))
