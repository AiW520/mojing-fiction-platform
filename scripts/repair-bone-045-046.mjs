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
  { id: 'work_bone_lantern_scene_045_02', reason: 'Left hand incorrectly supports bridge; text requires right hand and left ear facing upstream', scene: '中国古代河边木栈桥，成年男性裴照川黑衣束发，背向镜头，完整上身和双手清楚可见。镜头从背后拍，所以男子右侧在画面右边：他的右手掌牢牢扶着画面右侧桥板，右胳膊由右肩连续伸到桥板。左手在画面左侧垂下，握着薄铜片。头朝画面左边上游转动，让左耳朝向来水方向。单人画面，无其他人物，无耳内插片，无伤口。平静河水和木桥为背景。' },
  { id: 'work_bone_lantern_scene_045_05', reason: 'Waterline drawing has ten prominent nodes instead of nine', scene: '古代石闸干燥平台上的两张半幅旧纸独立静物，纸边不相接。左半纸只画四个清晰墨点，右半纸只画五个清晰墨点，合计九点，没有任何其他点状印章、墨斑或符号。细水线连接纸上墨点形成河道抽象图。两张纸分别压在两个独立木托上，背景是平静河水。纸面只含墨点和细线，没有文字，无人物。' },
  { id: 'work_bone_lantern_scene_046_03', reason: 'Seven fine threads incorrectly rendered as thick textile bundles', scene: '古代河东染蓝坊木桌局部近景，桌中央只有七根单独纤细蓝色丝线，每一根如细绳而非线束或织布，七根长度相同，平行间隔展开，分别由浅蓝到深蓝，共七根，数量全部完整可见，没有其他线团、流苏或额外线。年近五十中国女性穿旧蓝布衣，用双手轻轻整理七根线，背景旧染缸与晾布架。无文字，无现代物品。' },
  { id: 'work_bone_lantern_scene_046_04', reason: 'Withdrawal scene does not clearly show a cut corner of the copy', scene: '古代村中木桌上两张河道图纸的独立静物近景。左边正本完整四角，其一段旧细线已用小条白纸覆盖。右边副本的右下角被整齐剪去，缺口明确呈三角形，同形状三角纸角独立放在旁边浅盘里。古代铁剪摆在缺口旁边。两张纸互不重叠，没有人物，没有手，柔和侧光照清白纸覆盖处与剪角。纸面仅抽象河道线，没有文字或印章。' }
]
for (const replacement of replacements) {
  const item = plan.entries.find(entry => entry.id === replacement.id)
  const state = ledger.entries[replacement.id]
  assert.equal(state?.status, 'generated')
  assert.ok(!state.visualApprovedAt)
  item.promptHistory = [...(item.promptHistory || []), { prompt: item.prompt, filename: item.filename, promptHash: state.promptHash, replacedAt: new Date().toISOString(), reason: replacement.reason }]
  Object.assign(item, { filename: item.filename.replace('.png', '-attempt-2.png'),
    prompt: `小说《照骨灯》正文插图「${item.title}」。${replacement.scene}写实中国古代电影静帧，真实材质，物证清晰。只输出一幅横向3:2图片，无标题、文字、字幕、Logo、水印、拼图、边框、现代物品。`, promptReviewedAt: new Date().toISOString() })
  Object.assign(state, { status: 'visual_rejected', visualRejectedAt: new Date().toISOString(), visualRejectionReason: replacement.reason,
    retryAuthorization: { authorizedAt: new Date().toISOString(), model: 'gpt-image-2', source: 'Standing user instruction: automatically retry failed images until successful', maxAdditionalRequests: 1, promptHash: createHash('sha256').update(item.prompt).digest('hex') } })
}
for (const [path, value] of [[planPath, plan], [ledgerPath, ledger]]) {
  writeFileSync(path + '.tmp', JSON.stringify(value, null, 2) + '\n', 'utf8')
  renameSync(path + '.tmp', path)
}
console.log(JSON.stringify({ replacementAuthorized: replacements.map(item => item.id) }))
