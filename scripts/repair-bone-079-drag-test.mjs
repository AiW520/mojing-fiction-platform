import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { withdrawSceneArtwork } from './withdraw-scene-artwork.mjs'
import { readEnvFile } from '../server/src/config.mjs'
const root = resolve('artifacts/full-scene-artwork')
assert.ok(!existsSync(join(root, 'generation.lock')))
assert.ok(!existsSync(join(root, 'publication.lock')))
const id = 'work_bone_lantern_scene_079_02'
const reason = 'Visual review could not clearly distinguish the wrapped test sack from a body-sized wrapped object; show an unoccupied grain sack with visible contents to make the experiment unambiguous'
const env = { ...readEnvFile(resolve('server/.env')), ...process.env }
withdrawSceneArtwork({ artworkRoot: root, contentRoot: resolve('server/content'), databasePath: resolve(env.DATA_DIR || 'server/data', 'mojing.sqlite'), rejectedId: id, reason })
const planPath = join(root, 'plan.json'), ledgerPath = join(root, 'ledger.json')
const plan = JSON.parse(readFileSync(planPath, 'utf8')), ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'))
const item = plan.entries.find(entry => entry.id === id), state = ledger.entries[id]
assert.equal(state.status, 'visual_rejected')
const filename = '02-scene-attempt-2.png'
assert.ok(!existsSync(resolve('server/content/bone-lantern/artifacts/scenes/chapter-079', filename)))
item.promptHistory = [...(item.promptHistory || []), { prompt: item.prompt, title: item.title, filename: item.filename, promptHash: state.promptHash, replacedAt: new Date().toISOString(), reason }]
item.filename = filename
item.prompt = '小说《照骨灯》第79章正文插图「裹席麻袋的拖行试验」。写实中国古装电影证物静物摄影，义庄院中雨后湿石板，画面唯一主体是一只已经封口的粗麻袋，袋内只装谷物或沙土，外面平整裹着一张旧席子，席子边缘在石面上留下两道先并行、后突然偏开的水痕。旁边放三块小木牌表示三次实验的不可读短墨线记录，木牌之间分开。必须是无人静物：没有人、手、脚、头部、身体轮廓、尸体或人体搬运暗示；麻袋不能像人体，不能有头肩形状。水痕、席纤维和湿石板清楚明亮，普通古代环境，无血迹、无照骨灯、无黑蜡、无现代器具。只输出一幅横向3:2图片，无标题、文字、字幕、Logo、水印、拼图、边框。'
item.prompt = item.prompt.replace('旁边放三块小木牌表示三次实验的不可读短墨线记录，木牌之间分开。', '麻袋为短小饱满的谷物袋，袋口露出少许谷粒，旁边纸托上一张记录纸只有不可读墨线，记录三次试验。不可添加木牌。')
item.promptReviewedAt = new Date().toISOString()
if (state.retryAuthorization) state.authorizationHistory = [...(state.authorizationHistory || []), state.retryAuthorization]
state.retryAuthorization = { authorizedAt: new Date().toISOString(), model: 'gpt-image-2', source: 'Standing user instruction: automatically retry failed images until successful', maxAdditionalRequests: 1, promptHash: createHash('sha256').update(item.prompt).digest('hex') }
for (const [path, value] of [[planPath, plan], [ledgerPath, ledger]]) { writeFileSync(path + '.tmp', JSON.stringify(value, null, 2) + '\n'); renameSync(path + '.tmp', path) }
console.log(JSON.stringify({ replacementAuthorized: id, reason }))
