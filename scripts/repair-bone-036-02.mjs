import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'

const root = resolve('artifacts/full-scene-artwork')
assert.ok(!existsSync(join(root, 'generation.lock')))
assert.ok(!existsSync(join(root, 'publication.lock')))
const planPath = join(root, 'plan.json')
const ledgerPath = join(root, 'ledger.json')
const plan = JSON.parse(readFileSync(planPath, 'utf8'))
const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'))
const id = 'work_bone_lantern_scene_036_02'
const item = plan.entries.find(entry => entry.id === id)
const state = ledger.entries[id]
assert.equal(state?.status, 'generated')
assert.ok(!state.visualApprovedAt)
item.promptHistory = [...(item.promptHistory || []), {
  prompt: item.prompt, filename: item.filename, promptHash: state.promptHash,
  replacedAt: new Date().toISOString(), reason: 'Underwater stone room incorrectly rendered as a dry riverside worktable'
}]
item.filename = '02-scene-attempt-2.png'
item.prompt = '小说《照骨灯》第36章正文插图「石床木板模型」。唯一画面是一间完全淹没在水下的古代半塌石室内部，镜头位于水中，所有物件都浸在清澈的青绿色河水里。厚重灰色石床是主体，石床上平放用矩形旧木板拼成的无脸人形关节木工模型，木板胸口钉着左右两组薄铜片，左侧23枚、右侧24枚，下方空出一格且有新鲜刮痕。石床、破损石墙、沉积泥沙、水草与悬浮小气泡清楚可见，水面折射的柔和天光照到木板与铜片。模型明确由木板组成，没有真人、皮肤、骨骼或尸体。不要人物，不要木桌，不要岸边，不要窗外街市，不要灯笼，不要火焰，不要干燥室内或现代物品。写实中国古代水下遗址电影静帧，证物明亮清晰。只输出一幅横向3:2图片，无标题、文字、字幕、Logo、水印、拼图、边框。'
item.promptReviewedAt = new Date().toISOString()
state.status = 'visual_rejected'
state.visualRejectedAt = new Date().toISOString()
state.visualRejectionReason = 'Waterlogged stone room rendered as a dry riverside table'
state.retryAuthorization = {
  authorizedAt: new Date().toISOString(), model: 'gpt-image-2',
  source: 'Standing user instruction: automatically retry failed images until successful',
  maxAdditionalRequests: 1, promptHash: createHash('sha256').update(item.prompt).digest('hex')
}
for (const [path, value] of [[planPath, plan], [ledgerPath, ledger]]) {
  writeFileSync(path + '.tmp', JSON.stringify(value, null, 2) + '\n', 'utf8')
  renameSync(path + '.tmp', path)
}
console.log(JSON.stringify({ id, status: state.status, replacementAuthorized: true }))
