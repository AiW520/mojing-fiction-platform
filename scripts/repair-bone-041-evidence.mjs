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
const replacements = [
  { id: 'work_bone_lantern_scene_041_03', title: '开放水槽与封闭水槽', scene: '古代药房木案上两只完全独立的浅木水槽。左槽出口开放，一股清水从左槽流入下方浅盆。右槽末端用厚木塞完整严密堵住，右槽内水面平静，水中有少许胶膜与黑色矿粉，右槽没有水流、滴水、瀑布或下方接水盆。侧上方近景，清晰照出左侧流动与右侧静止的差别，木塞占右槽末端明显位置。旁边放小铜片和木槌。只画器物，无人物。' },
  { id: 'work_bone_lantern_scene_041_04', title: '竹筹盒两组孔位', scene: '旧疫所木案上一只打开的古代竹筹盒局部近景。盒底左侧有六列细密小圆孔，各列等距排列向画面下方延伸，左侧长孔列的末端被镜头裁切，明确只展示其局部。盒底右侧单独一组十八孔，严格三行六孔，三行六孔的完整边缘全部可见，并与左侧用宽木隔条分开。上方摆几枚带抽象刻痕的细竹筹，其余竹筹收在木格内。自然侧光照清两组孔位与旧木纹，无人物，无可读文字。' }
]
for (const replacement of replacements) {
  const item = plan.entries.find(entry => entry.id === replacement.id)
  const state = ledger.entries[replacement.id]
  assert.equal(state?.status, 'generated')
  assert.ok(!state.visualApprovedAt)
  const reason = replacement.id.endsWith('_03') ? 'Both troughs incorrectly shown draining instead of one blocked outlet' : 'Dense treatment positions incorrectly depicted as a small generic grid'
  item.promptHistory = [...(item.promptHistory || []), { prompt: item.prompt, filename: item.filename, promptHash: state.promptHash, replacedAt: new Date().toISOString(), reason }]
  Object.assign(item, { title: replacement.title, filename: item.filename.replace('.png', '-attempt-2.png'),
    prompt: `小说《照骨灯》第41章正文插图「${replacement.title}」。${replacement.scene}写实中国古代电影静帧，清晰照亮证物，真实旧木、水和铜器。只输出一幅横向3:2图片，无标题、字幕、Logo、水印、拼图、边框、现代物品。`, promptReviewedAt: new Date().toISOString() })
  Object.assign(state, { status: 'visual_rejected', visualRejectedAt: new Date().toISOString(), visualRejectionReason: reason,
    retryAuthorization: { authorizedAt: new Date().toISOString(), model: 'gpt-image-2', source: 'Standing user instruction: automatically retry failed images until successful', maxAdditionalRequests: 1, promptHash: createHash('sha256').update(item.prompt).digest('hex') } })
}
for (const [path, value] of [[planPath, plan], [ledgerPath, ledger]]) {
  writeFileSync(path + '.tmp', JSON.stringify(value, null, 2) + '\n', 'utf8')
  renameSync(path + '.tmp', path)
}
console.log(JSON.stringify({ replacementAuthorized: replacements.map(item => item.id) }))
