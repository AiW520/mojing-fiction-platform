import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { withdrawSceneArtwork } from './withdraw-scene-artwork.mjs'
import { readEnvFile } from '../server/src/config.mjs'

const root = resolve('artifacts/full-scene-artwork')
assert.ok(!existsSync(join(root, 'generation.lock')))
assert.ok(!existsSync(join(root, 'publication.lock')))
const id = 'work_bone_lantern_scene_078_02'
const reason = 'Original-size review found a shallow bronze bowl instead of the small enclosed portable lamp used in the adjacent scene'
const env = { ...readEnvFile(resolve('server/.env')), ...process.env }
withdrawSceneArtwork({ artworkRoot: root, contentRoot: resolve('server/content'), databasePath: resolve(env.DATA_DIR || 'server/data', 'mojing.sqlite'), rejectedId: id, reason })
const planPath = join(root, 'plan.json'), ledgerPath = join(root, 'ledger.json')
const plan = JSON.parse(readFileSync(planPath, 'utf8')), ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'))
const item = plan.entries.find(entry => entry.id === id), state = ledger.entries[id]
assert.equal(state.status, 'visual_rejected')
const filename = '02-scene-attempt-2.png'
assert.ok(!existsSync(resolve('server/content/bone-lantern/artifacts/scenes/chapter-078', filename)))
item.promptHistory = [...(item.promptHistory || []), { prompt: item.prompt, title: item.title, filename: item.filename, promptHash: state.promptHash, replacedAt: new Date().toISOString(), reason }]
item.filename = filename
item.prompt = '小说《照骨灯》第78章正文插图，未燃照骨灯独立器物特写。古代双锁证物库内最里层普通旧木架上，只有一盏约一掌高的小型古代青铜提灯。器物结构：小圆底座、四根细直铜柱、四面窄镂空铜片围成竖直筒状灯身、上方小圆顶和短小环形提手；与古代便携提灯一致，绝不是浅碗、香炉、酒杯或大型宫灯。铜表面旧绿锈，内部灰白细灯芯没有点燃，外侧三处小小旧黑蜡残痕。四面铜片与柱清楚可见，无玻璃，无现代煤油灯部件。唯一主体是这一盏灯，灯架充分照亮；画面无人无手，无其他灯具、火焰、发光、幻象、骨粉、人物面孔、镜子。统一美术为写实中国古装电影道具静物，真实青铜和旧木纹，秋季冷灰自然光，主体明亮清楚。只输出一幅横向3:2图片，无标题、文字、字幕、Logo、水印、拼图、边框或现代物品。'
item.promptReviewedAt = new Date().toISOString()
if (state.retryAuthorization) state.authorizationHistory = [...(state.authorizationHistory || []), state.retryAuthorization]
state.retryAuthorization = { authorizedAt: new Date().toISOString(), model: 'gpt-image-2', source: 'Standing user instruction: automatically retry failed images until successful', maxAdditionalRequests: 1, promptHash: createHash('sha256').update(item.prompt).digest('hex') }
for (const [path, value] of [[planPath, plan], [ledgerPath, ledger]]) { writeFileSync(path + '.tmp', JSON.stringify(value, null, 2) + '\n', 'utf8'); renameSync(path + '.tmp', path) }
console.log(JSON.stringify({ replacementAuthorized: id, reason }))
