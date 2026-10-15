import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, renameSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'

const root = resolve('artifacts/full-scene-artwork')
const planPath = resolve(root, 'plan.json')
const ledgerPath = resolve(root, 'ledger.json')
const plan = JSON.parse(readFileSync(planPath, 'utf8'))
const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'))
const ids = ['work_bone_lantern_scene_001_01', 'work_bone_lantern_scene_001_02']
for (const id of ids) {
  assert.equal(ledger.entries[id]?.status, 'failed')
  assert.ok(!ledger.entries[id].retryAuthorization, 'Retry authorization already recorded')
}
const evidence = plan.entries.find(item => item.id === ids[1])
evidence.prompt = '《照骨灯》第一章正文插图，第2幅「鞋缝黄泥」。写实古装电影道具静物摄影，横向3:2。唯一主体：一只古代中国成年男子的旧灰布鞋放在棺材铺门口的青石板上，鞋侧朝向镜头，鞋跟接缝中夹着极少量黄色泥土和数枚细碎螺壳，微小泥粒与鞋底缝线清晰可辨。鞋完全独立，不穿在脚上，画面没有人物或人体。背景为清晨前的雨夜，木门门槛、青石积水和一盏普通暖色风灯，鞋及证物充分照亮，细致真实布料纹理，青灰环境与琥珀灯火自然对照。无标题、文字、字幕、Logo、水印、拼图、边框，无现代物品，无动漫，无血液或伤口。'
evidence.promptReviewedAt = new Date().toISOString()
for (const id of ids) {
  const item = plan.entries.find(entry => entry.id === id)
  ledger.entries[id].retryAuthorization = {
    authorizedAt: new Date().toISOString(),
    source: 'User reply in current chat: 授权这2张各重发一次',
    maxAdditionalRequests: 1,
    promptHash: createHash('sha256').update(item.prompt).digest('hex')
  }
}
for (const [path, value] of [[planPath, plan], [ledgerPath, ledger]]) {
  writeFileSync(path + '.tmp', JSON.stringify(value, null, 2) + '\n', 'utf8')
  renameSync(path + '.tmp', path)
}
console.log(JSON.stringify({ authorizedIds: ids, maxAdditionalRequests: 2 }))
