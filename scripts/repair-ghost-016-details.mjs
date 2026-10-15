import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'

const root = resolve('artifacts/full-scene-artwork')
assert.ok(!existsSync(join(root, 'generation.lock')) && !existsSync(join(root, 'publication.lock')))
const planPath = join(root, 'plan.json'), ledgerPath = join(root, 'ledger.json')
const plan = JSON.parse(readFileSync(planPath, 'utf8')), ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'))
const replacements = [
  { slot: 3, reason: 'Visual review could not verify seven shallow slots with a single red wax grain inside the seventh slot', prompt: '小说《镇诡司》第16章正文插图「半枚旧铁牌七槽」。独立古代器物静物摄影：白布上平放半枚有断裂边缘的旧铁门牌，正面朝上充分照亮，背面沿水平方向有恰好七条平行浅槽，从左往右全部清楚可数，七槽不遮挡；最右侧第七槽内仅有一粒微小冷裂红蜡，其余六槽无红蜡。侧方放一把古代木尺和一张只有不可读短墨线的限时归还记录纸。铁牌只有半枚，不画完整圆牌、不画木琴或人体骨骼，不添加羊骨实物、拓纸或额外红印。写实中国古装电影器物摄影，冬晨冷光与温暖风灯照亮金属锈蚀和浅槽。无人、无手、无可读文字、数字、现代物品、血液、发光、标题、字幕、Logo、水印、拼图、边框，只输出一幅横向3:2图片。' },
  { slot: 5, reason: 'Visual review found loose skeletal bones instead of fragments of a flat sheep-bone name plaque', prompt: '小说《镇诡司》第16章正文插图「开闸保全羊骨牌碎片与绳端」。独立古代证物静物近景：北镇城门刚升起闸链后的门内旧木案，一张白布上仅放三小块平整薄长方形羊骨名牌的碎片，都是加工过的薄牌器物，断边不规则，表面有不可读短刻痕，绝非人体骨骼；另一张分开的白布放一小截黑麻绳端，两类证物完全分开。案旁的限定责任文书只有不可读墨线和留白，背景能看见升起闸链的古代城门、风雪，远处的担架仅为完全盖严的布包，不露任何人体。写实中国古装电影器物摄影，主体充分清楚照亮。无人、无手、无人体部位、无散骨、无头骨、无长骨、无血液、无现代物品、无认名结论或可读文字、标题、字幕、Logo、水印、拼图、边框，只输出一幅横向3:2图片。' }
]
for (const replacement of replacements) {
  const id = `work_ghost_ledger_scene_016_${String(replacement.slot).padStart(2, '0')}`
  const item = plan.entries.find(entry => entry.id === id), state = ledger.entries[id]
  assert.equal(state.status, 'visual_rejected')
  assert.ok(!state.visualApprovedAt && !state.publishedAt)
  assert.ok(existsSync(state.original) && existsSync(state.mobile))
  const filename = `${String(replacement.slot).padStart(2, '0')}-scene-attempt-2.png`
  assert.ok(!existsSync(resolve('server/content/ghost-ledger/artifacts/scenes/chapter-016', filename)))
  item.promptHistory = [...(item.promptHistory || []), { prompt: item.prompt, title: item.title, filename: item.filename, promptHash: state.promptHash, replacedAt: new Date().toISOString(), reason: replacement.reason }]
  item.filename = filename
  item.prompt = replacement.prompt
  item.promptReviewedAt = new Date().toISOString()
  if (state.retryAuthorization) state.authorizationHistory = [...(state.authorizationHistory || []), state.retryAuthorization]
  state.retryAuthorization = { authorizedAt: new Date().toISOString(), model: 'gpt-image-2', source: 'Standing user instruction: automatically retry failed images until successful', maxAdditionalRequests: 1, promptHash: createHash('sha256').update(item.prompt).digest('hex') }
}
for (const [path, value] of [[planPath, plan], [ledgerPath, ledger]]) { writeFileSync(path + '.tmp', JSON.stringify(value, null, 2) + '\n', 'utf8'); renameSync(path + '.tmp', path) }
console.log(JSON.stringify({ replacements: replacements.map(item => item.slot) }))
