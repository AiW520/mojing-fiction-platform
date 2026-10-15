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
const id = 'work_bone_lantern_scene_037_02'
const item = plan.entries.find(entry => entry.id === id)
const state = ledger.entries[id]
assert.equal(state?.status, 'failed')
assert.ok(!state.retryAuthorization || state.retryAuthorization.consumedAt)
item.promptHistory = [...(item.promptHistory || []), {
  prompt: item.prompt, filename: item.filename, promptHash: state.promptHash,
  replacedAt: new Date().toISOString(), reason: 'Replace rejected scene with an unoccupied evidence still life'
}]
item.filename = '02-scene-attempt-2.png'
item.title = '白布棚与独立证物'
item.prompt = '小说《照骨灯》第37章正文插图「白布棚与独立证物」。中国古代河边村口，竹架搭成的空棚，白布棚顶和垂挂白布随风轻动，棚旁一块旧木板上分开放置一只空心竹管、一枚指甲大小的铜片、一截细水草和一小片旧渔网；棚后湿泥地上有两组方向不同的鞋印。远处清楚可见平静河岸和朴素村屋，柔和晨光照亮物件。唯一主体是白布棚和独立器物，没有人物。写实中国古代悬疑电影静帧，灰青河水、自然木色、克制光线，证物细节清晰。只输出一幅横向3:2图片，无标题、文字、字幕、Logo、水印、拼图、边框、现代物品。'
item.promptReviewedAt = new Date().toISOString()
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
