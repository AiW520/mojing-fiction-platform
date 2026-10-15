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
  { id: 'work_bone_lantern_scene_055_05', reason: 'Generated large crossed paper strips rather than the specific record beside the sealed room', scene: '古代闻宅一扇完整关闭的深色木门正面静物，门上只有一条窄窄横贴的灰纸封条，纸条不交叉、不覆盖成X形，封条上只有模糊不可读墨痕。封条右侧门框有一张小小竖式记录纸，纸上几行不可读短墨线，底部留白并有一个小指印。门和记录纸同框清晰，安静日光，没有人、笔、药物、醒目交叉纸带、现代物品或可读文字。' },
  { id: 'work_bone_lantern_scene_056_04', reason: 'Generated a wall notice and unclear door hardware instead of the removable interior/exterior wooden bolt', scene: '中国古代晒药房东门五金结构的清晰近景静物。敞开的木门门边只装一根横向原木插销，木栓两端都伸出门框，明确是一根能从门内或门外直接拔出的活动木条；门内侧与门外侧均没有锁、锁链或门闩套。门旁木钩挂一本打开的小访问簿，页面只有不可读短线与空白栏。背景略见旧晾药架。无人、无墙上告示、无文字、无现代金属把手。' }
]
for (const replacement of replacements) {
  const item = plan.entries.find(entry => entry.id === replacement.id)
  const state = ledger.entries[replacement.id]
  assert.equal(state?.status, 'generated')
  assert.ok(!state.visualApprovedAt)
  item.promptHistory = [...(item.promptHistory || []), { prompt: item.prompt, filename: item.filename, promptHash: state.promptHash, replacedAt: new Date().toISOString(), reason: replacement.reason }]
  Object.assign(item, { filename: item.filename.replace('.png', '-attempt-2.png'),
    prompt: `小说《照骨灯》正文插图「${item.title}」。${replacement.scene}写实中国古代电影静帧，真实木石纸张质感，主体清晰。只输出一幅横向3:2图片，无标题、字幕、Logo、水印、拼图、边框、现代物品。`, promptReviewedAt: new Date().toISOString() })
  Object.assign(state, { status: 'visual_rejected', visualRejectedAt: new Date().toISOString(), visualRejectionReason: replacement.reason,
    retryAuthorization: { authorizedAt: new Date().toISOString(), model: 'gpt-image-2', source: 'Standing user instruction: automatically retry failed images until successful', maxAdditionalRequests: 1, promptHash: createHash('sha256').update(item.prompt).digest('hex') } })
}
for (const [path, value] of [[planPath, plan], [ledgerPath, ledger]]) {
  writeFileSync(path + '.tmp', JSON.stringify(value, null, 2) + '\n', 'utf8')
  renameSync(path + '.tmp', path)
}
console.log(JSON.stringify({ replacementAuthorized: replacements.map(item => item.id) }))
