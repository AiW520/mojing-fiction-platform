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
  { id: 'work_bone_lantern_scene_053_01', reason: 'Chair outside the sealed door contradicts the original indoor location', scene: '清晨中国古代奉安官署木门独立环境镜头。两扇紧闭木门横贴三道灰纸封条，纸面只有模糊墨痕与抽象印记不可读。门槛、纸边封泥和雨后青石地清晰，街对面茶棚只是远景。门前空地完全没有椅子，没有人物，没有任何家具。门内不可见。不要在门外画空椅。' },
  { id: 'work_bone_lantern_scene_053_03', reason: 'Copper record plate incorrectly rendered as a circular dial with columns instead of five dated rows', scene: '茶棚木案上一块薄长方形铜板的独立俯拍静物。铜板四角均为直角，宽约二十厘米长约三十厘米，完全不是圆盘。铜板从上到下只划五行横向记录，每行左边是不可读日期短刻，右边是不可读动作短刻，每行末尾一个被刮白的空格。五行互相平行，刻线细小，表面旧铜质感真实。铜板旁少量蜡灰与一段青布纤维分别置小纸托，没有其他铜板、圆环、指针或人物。' },
  { id: 'work_bone_lantern_scene_053_05', reason: 'Five paper bags shown instead of four separate evidence bags', scene: '古代茶棚木桌的独立俯拍静物。画面只有四个古代牛皮色折叠纸袋，横向一行整齐排列，四个均完整可见、互不遮挡。第一袋前灰纸小样，第二袋前长方铜板纸拓，第三袋前一道刮痕泥拓，第四袋前日期记录小纸。四个袋口均折好且封有白纸条，袋面仅抽象短线，不可读。没有人物、手、额外纸袋、布袋或塑料袋。严格只有四袋。' },
  { id: 'work_bone_lantern_scene_054_04', reason: 'Survivors clothing rubbings rendered as physical cloth samples in dishes', scene: '古代裴宅木案上衣物痕迹比对的独立俯拍静物。一小片长条灰布横放中央，布上分成六段，每段只有一个小缝补针脚组，六段间留空。灰布上方三张纸、下方三张纸，共六张独立纸质衣物拓片，纸上仅灰色衣物轮廓与抽象针脚印，不画实物衣物。纸均为平面浅米色纸，每纸仅印一个局部拓印。没有盘碟、没有其他布片、没有人物或手、没有可读字。灰布原件与六张纸拓完全分开。' }
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
