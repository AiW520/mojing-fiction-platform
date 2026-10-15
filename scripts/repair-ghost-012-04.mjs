import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { withdrawSceneArtwork } from './withdraw-scene-artwork.mjs'
import { readEnvFile } from '../server/src/config.mjs'

const root = resolve('artifacts/full-scene-artwork')
assert.ok(!existsSync(join(root, 'generation.lock')) && !existsSync(join(root, 'publication.lock')))
const id = 'work_ghost_ledger_scene_012_04'
const reason = 'Visual review found the evidence box contents rendered as loose bones; chapter text requires seven thin sheep-bone name plaques and separate witness duties'
const env = { ...readEnvFile(resolve('server/.env')), ...process.env }
withdrawSceneArtwork({ artworkRoot: root, contentRoot: resolve('server/content'), databasePath: resolve(env.DATA_DIR || 'server/data', 'mojing.sqlite'), rejectedId: id, reason })
const planPath = join(root, 'plan.json'), ledgerPath = join(root, 'ledger.json')
const plan = JSON.parse(readFileSync(planPath, 'utf8')), ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'))
const item = plan.entries.find(entry => entry.id === id), state = ledger.entries[id]
assert.equal(state.status, 'visual_rejected')
const filename = '04-scene-attempt-2.png'
assert.ok(!existsSync(resolve('server/content/ghost-ledger/artifacts/scenes/chapter-012', filename)))
item.promptHistory = [...(item.promptHistory || []), { prompt: item.prompt, title: item.title, filename: item.filename, promptHash: state.promptHash, replacedAt: new Date().toISOString(), reason }]
item.filename = filename
item.prompt = '小说《镇诡司》第12章正文插图「三名见证人职责拆开」。写实中国古装电影静帧，北门封门后的旧木交接案。画面只表现三名见证人的职责分区：左侧闸链与门洞旁放一张空白交接纸和一枚木楔，中间旧木箱旁放一张空白交接纸，右侧七块薄羊骨名牌的拓纸旁放第三张空白交接纸；三张纸互相分开，纸面只有不可辨认短墨线，不出现可读字。陆昭站在桌边用毛笔把桌面分成三个区域，左手白布包扎和左腕细绳清楚；许青棠在羊骨拓纸一侧，贺停舟拄木杖在木箱一侧，守门什长在闸链一侧，四人不重叠、无人代签。羊骨只画成平整薄长方形名牌拓样，不画人体骨骼、散骨或血液。无武器冲突、现代表格、现代物品、发光、妖影、标题、字幕、Logo、水印、拼图或边框，只输出一幅横向3:2图片。'
item.promptReviewedAt = new Date().toISOString()
if (state.retryAuthorization) state.authorizationHistory = [...(state.authorizationHistory || []), state.retryAuthorization]
state.retryAuthorization = { authorizedAt: new Date().toISOString(), model: 'gpt-image-2', source: 'Standing user instruction: automatically retry failed images until successful', maxAdditionalRequests: 1, promptHash: createHash('sha256').update(item.prompt).digest('hex') }
for (const [path, value] of [[planPath, plan], [ledgerPath, ledger]]) { writeFileSync(path + '.tmp', JSON.stringify(value, null, 2) + '\n', 'utf8'); renameSync(path + '.tmp', path) }
console.log(JSON.stringify({ replacementAuthorized: id, reason }))
