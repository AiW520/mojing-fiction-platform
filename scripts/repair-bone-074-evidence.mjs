import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { withdrawSceneArtwork } from './withdraw-scene-artwork.mjs'
import { readEnvFile } from '../server/src/config.mjs'

const root = resolve('artifacts/full-scene-artwork')
assert.ok(!existsSync(join(root, 'generation.lock')))
assert.ok(!existsSync(join(root, 'publication.lock')))
const planPath = join(root, 'plan.json'), ledgerPath = join(root, 'ledger.json')
const initialLedger = JSON.parse(readFileSync(ledgerPath, 'utf8'))
const replacements = [
  { id: 'work_bone_lantern_scene_074_01', title: '新木牌背面残印', reason: 'Original-size review found three wooden plaques; text keeps the new plaque separate from the older one', scene: '义庄木案上的单件证物静物特写。全画面只有一块旧木牌平放在浅木托内，木牌一端恰好三个穿孔，展示背面，背面没有新刻短线，只有一小块被水泡开的模糊旧印和极细的纸纤维。木纹和残印充分照亮。画面无人、无手、无镜子、无其他木牌、无木牌拓本、无第二只托盘。绝不能复制这块木牌，不画可读文字、完整官印或黑蜡。' },
  { id: 'work_bone_lantern_scene_074_03', title: '五类物证独立分排', reason: 'Original-size review found duplicated plaques and fabric samples in the five evidence rows', scene: '义庄长木案俯视，五排物证彼此留出空隙，每排只有指定的一件物品，不重叠。从画面上方向下依次为：第一排一张旧病历拓本；第二排一块带三个穿孔的旧木牌；第三排一张石壁残缺笔画纸拓，只有几条不完整浅墨痕，不是建筑平面图；第四排一只纸托内的少量青布纤维；第五排一张署名处空白的古代公文纸。总共只有一块木牌、一份青布纤维，所有纸面墨线不可读。画面无人、无手、无更多木牌、无整块复制布料、无多份重复公文、无人物画像或现代标签。' }
]
for (const { id } of replacements) {
  assert.equal(initialLedger.entries[id]?.status, 'published')
  assert.ok(initialLedger.entries[id].visualApprovedAt)
}
const env = { ...readEnvFile(resolve('server/.env')), ...process.env }
for (const replacement of replacements) {
  withdrawSceneArtwork({ artworkRoot: root, contentRoot: resolve('server/content'), databasePath: resolve(env.DATA_DIR || 'server/data', 'mojing.sqlite'), rejectedId: replacement.id, reason: replacement.reason })
}
const plan = JSON.parse(readFileSync(planPath, 'utf8'))
const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'))
for (const replacement of replacements) {
  const item = plan.entries.find(entry => entry.id === replacement.id), state = ledger.entries[replacement.id]
  assert.ok(!state.visualApprovedAt)
  const filename = item.filename.replace(/\.png$/i, '-attempt-2.png')
  assert.ok(!existsSync(resolve('server/content', item.bookDir, 'artifacts/scenes', `chapter-${String(item.chapterNumber).padStart(3, '0')}`, filename)))
  item.promptHistory = [...(item.promptHistory || []), { prompt: item.prompt, title: item.title, filename: item.filename, promptHash: state.promptHash, replacedAt: new Date().toISOString(), reason: replacement.reason }]
  item.title = replacement.title
  item.filename = filename
  item.prompt = `小说《照骨灯》第74章正文插图「${replacement.title}」。${replacement.scene}统一美术：写实中国古装电影道具静物，真实木石纸张质感，秋季自然光与普通风灯照亮主体。只输出一幅横向3:2图片，无标题、文字、字幕、Logo、水印、拼图、边框，无现代物品。`
  item.promptReviewedAt = new Date().toISOString()
  if (state.retryAuthorization) state.authorizationHistory = [...(state.authorizationHistory || []), state.retryAuthorization]
  Object.assign(state, { status: 'visual_rejected', visualRejectedAt: new Date().toISOString(), visualRejectionReason: replacement.reason,
    retryAuthorization: { authorizedAt: new Date().toISOString(), model: 'gpt-image-2', source: 'Standing user instruction: automatically retry failed images until successful', maxAdditionalRequests: 1, promptHash: createHash('sha256').update(item.prompt).digest('hex') } })
}
for (const [path, value] of [[planPath, plan], [ledgerPath, ledger]]) {
  writeFileSync(path + '.tmp', JSON.stringify(value, null, 2) + '\n', 'utf8')
  renameSync(path + '.tmp', path)
}
console.log(JSON.stringify({ replacementAuthorized: replacements.map(item => item.id) }))
