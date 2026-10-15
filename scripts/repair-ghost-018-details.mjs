import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'

const root = resolve('artifacts/full-scene-artwork')
assert.ok(!existsSync(resolve(root, 'generation.lock')) && !existsSync(resolve(root, 'publication.lock')))
const planPath = resolve(root, 'plan.json'), ledgerPath = resolve(root, 'ledger.json')
const plan = JSON.parse(readFileSync(planPath, 'utf8')), ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'))
const replacements = [
  { slot: 3, reason: '细红线被画成粗大成束红线，无法核对为单根夹层纤维', prompt: '小说《镇诡司》第18章正文插图「车轴木隔挡露细红线」。独立古代证物静物摄影，横向3:2：一只无字且有旧刮痕的短车轴木块竖立在空木案上，旁边一只打开的旧木匣，匣内只有一张折叠白纸的一角，纸层夹缝只露出一根极细、单根、短短的暗红色纤维线，线像夹层纤维而不是绳子、毛线、丝线束或红蜡。木块与木匣之间留出明显空隙，远处一张无字短墨线记录纸。无人物、无手、无姓名、无成束红线、无绳结、无血液、无发光、无现代物品、无标题字幕Logo水印拼图边框。写实中国古装电影器物静物，冷雪光与暖风灯照清纸纤维和木纹。' },
  { slot: 5, reason: '红线样本被画成大束红丝，未保持独立细线证物与分区交接', prompt: '小说《镇诡司》第18章正文插图「木匣红线纸条分人交接」。北镇医署换班木案的独立器物静物，横向3:2：三个互不接触的清晰分区，左区是盖严的清砂木匣，中区是一只小纸托，纸托上只有一根极细、单根、短短的暗红色纤维线，右区是一只封好的门外纸条小封袋；每区之间留宽空白，封签只有不可读短墨线。红线必须是单根纤维，不是线团、长丝、绳子或红色毛发。可有三名古代人物站在各自分区后方远处复核，但不伸手接触物件；许青棠手臂低位。无姓名、无可读文字、无血液、无发光、无现代器物、无合并封袋、无标题字幕Logo水印拼图边框。写实中国古装电影静物与人物见证，主体充分照亮。' }
]
for (const replacement of replacements) {
  const id = `work_ghost_ledger_scene_018_${String(replacement.slot).padStart(2, '0')}`
  const item = plan.entries.find(entry => entry.id === id), state = ledger.entries[id]
  assert.equal(state.status, 'visual_rejected')
  assert.ok(!state.visualApprovedAt && !state.publishedAt && existsSync(state.original) && existsSync(state.mobile))
  const filename = `${String(replacement.slot).padStart(2, '0')}-scene-attempt-2.png`
  const target = resolve('server/content/ghost-ledger/artifacts/scenes/chapter-018', filename)
  assert.ok(!existsSync(target))
  item.promptHistory = [...(item.promptHistory || []), { prompt: item.prompt, title: item.title, filename: item.filename, promptHash: state.promptHash, replacedAt: new Date().toISOString(), reason: replacement.reason }]
  item.filename = filename
  item.prompt = replacement.prompt
  item.promptReviewedAt = new Date().toISOString()
  if (state.retryAuthorization) state.authorizationHistory = [...(state.authorizationHistory || []), state.retryAuthorization]
  state.retryAuthorization = { authorizedAt: new Date().toISOString(), model: 'gpt-image-2', source: 'Standing user instruction: automatically retry failed images until successful', maxAdditionalRequests: 1, promptHash: createHash('sha256').update(item.prompt).digest('hex') }
}
for (const [path, value] of [[planPath, plan], [ledgerPath, ledger]]) { writeFileSync(path + '.tmp', JSON.stringify(value, null, 2) + '\n', 'utf8'); renameSync(path + '.tmp', path) }
console.log(JSON.stringify({ replacements: replacements.map(item => item.slot) }))
