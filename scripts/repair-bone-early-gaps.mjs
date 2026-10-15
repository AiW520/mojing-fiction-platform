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
  { id: 'work_bone_lantern_scene_001_01', filename: '01-scene-attempt-4.png', title: '雨夜铺前灯影', scene: '奉安永寿坊古代木作铺门口，秋夜冷雨打在湿青石板上，门框与屋檐投下清晰阴影，七盏暖灯照亮门前积水和四处被雨冲淡的浅鞋印。镜头从屋檐下看向空街，木门半开，小黑册放在门内木案上。唯一主体是门口环境与灯影，街道无人，画面明亮清楚。' },
  { id: 'work_bone_lantern_scene_021_02', filename: '02-scene-attempt-2.png', title: '西廊湿绳与水桶', scene: '古代户籍房西廊静物场景，一段湿棉绳一头绕在西廊石柱上，另一头自然延伸到墙根窄路，路边放木水桶、湿布与炭条，廊砖水痕朝西，远处木窗透入柔和天光。只有廊道、绳索和救援工具，绳子不连接任何人物，画面无人，器物完整。' },
  { id: 'work_bone_lantern_scene_025_03', filename: '03-scene-attempt-2.png', title: '四种针脚与袖口铜镜', scene: '古代南关木案上的独立纺织器物静物，四块旧外衣袖口布样分别摊平，每块带一枚小铜镜：第一块左向针脚，第二块双股线，第三块单绳结，第四块有装铜镜的原有暗袋。铜镜背面仅模糊刻痕，旁边摆细麻线和古代针盒，窗光照清布料与缝法。画面无人，只画独立布样、铜镜和针盒。' }
]
for (const replacement of replacements) {
  const item = plan.entries.find(entry => entry.id === replacement.id)
  const state = ledger.entries[replacement.id]
  assert.equal(state?.status, 'failed')
  assert.ok(!state.retryAuthorization || state.retryAuthorization.consumedAt)
  item.promptHistory = [...(item.promptHistory || []), {
    prompt: item.prompt, filename: item.filename, promptHash: state.promptHash,
    replacedAt: new Date().toISOString(), reason: 'Use an unoccupied setting or independent evidence still life after provider rejection'
  }]
  Object.assign(item, { title: replacement.title, filename: replacement.filename,
    prompt: `小说《照骨灯》第${item.chapterNumber}章正文插图「${replacement.title}」。${replacement.scene}统一美术：写实中国古装电影静帧，真实木石布料与铜器，冷灰自然光和温暖灯光，清晰照亮剧情主体，安静悬疑。只输出一幅横向3:2图片，无标题、文字、字幕、Logo、水印、拼图、边框、现代物品。`,
    promptReviewedAt: new Date().toISOString() })
  if (state.retryAuthorization) state.authorizationHistory = [...(state.authorizationHistory || []), state.retryAuthorization]
  state.retryAuthorization = {
    authorizedAt: new Date().toISOString(), model: 'gpt-image-2',
    source: 'Standing user instruction: automatically retry failed images until successful',
    maxAdditionalRequests: 1, promptHash: createHash('sha256').update(item.prompt).digest('hex')
  }
}
for (const [path, value] of [[planPath, plan], [ledgerPath, ledger]]) {
  writeFileSync(path + '.tmp', JSON.stringify(value, null, 2) + '\n', 'utf8')
  renameSync(path + '.tmp', path)
}
console.log(JSON.stringify({ replacementAuthorized: replacements.map(item => item.id) }))
