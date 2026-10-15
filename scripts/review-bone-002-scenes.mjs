import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, renameSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'

const planPath = resolve('artifacts/full-scene-artwork/plan.json')
const plan = JSON.parse(readFileSync(planPath, 'utf8'))
const ledger = JSON.parse(readFileSync('artifacts/full-scene-artwork/ledger.json', 'utf8'))
const source = readFileSync('server/content/bone-lantern/chapters/002.md', 'utf8').trim().split(/\r?\n/).slice(1).join('\n').trim()
const paragraphs = source.split(/\n\s*\n/).map(value => value.trim()).filter(Boolean)
const cast = '沈青崖：23岁中国女性，细长脸、清晰颧骨、平直眉、黑发低髻，无首饰，深色窄袖旧官服、薄皮手套；裴照川：27岁中国男性，修长脸、平直眉、黑发束冠、黑色窄袖巡夜官服、腰间连鞘旧刀；晏九：16岁中国男性少年，瘦削、眼尾微扬、麻布短衣、墨迹手指、小黑册。同名人物的外貌服装一致，场景未提及的人物不得加入。'
const lamp = '照骨灯是一掌高的小型古代青铜提灯，深青铜锈，短环形提手，四面镂空细纹如纠缠裂纹，灰白细灯芯；不是大型灯笼，不是现代油灯，没有可读文字。'
const scenes = [
  { title: '师父遗物', start: '牌位新漆未干', scene: '天色刚亮的奉安义庄西房东墙，木质纪念牌位背向镜头，旁边整齐放着古代铜尺、小型骨剪和缺口茶碗，木纹与铜锈清楚。沈青崖站在稍远处凝望遗物，眼神压抑思念。窗外雨滴沿石槽落下，温暖风灯与青灰晨光并存。画面不出现任何已故人物、遗体、检验动作或回忆画面。中近景，以三件遗物为主体，人物清晰但不遮挡物品。' },
  { title: '半枚铜齿', start: '齿轮只有小指甲大', scene: '義庄木桌上的小铜证物碟里，放着半枚指甲盖大小的旧铜齿轮，轮齿有一个明显缺口，轴孔穿着一根细黑发，边缘残留少量黑蜡。主体特写，精细表现小尺度、磨损和金属质感。沈青崖戴薄皮手套的手刚放下物件，裴照川的手停在碟边，后方两人神情冷静地观察。不展示物件取出过程，不出现身体、血液、解剖器械或创口。不画夸张巨型齿轮。' },
  { title: '往生扣钥匙', start: '晏九从怀里摸出一把小钥匙', scene: '义庄西房门槛，晏九低头用两手捧出一把古代小铜钥匙，钥匙系着红色细绳结，结中藏着小活扣；沈青崖靠近观察绳结，裴照川在门侧静静等待，手臂没有碰到少年。中近景，红绳与钥匙为视觉中心，三人神情凝重克制。门外晨雨，屋内明亮暖色风灯，木门与青石地面充分可见；不画箱子已经开启，不画人物受伤。' },
  { title: '铜灯初明', start: '青铜灯无火自明', scene: `三人回到空荡的棺材铺，木地板上摆着刚打开的黑木箱，沈青崖从箱中提起小型青铜灯，${lamp}小小苍白火焰开始在灯芯上亮起。晏九和裴照川站在她侧后方看灯，三人分开不重叠，木板上人影被压得低平。画面只表现铺内这一瞬，门外画面不展开，镜头能看清灯和三人，冷雨晨光与苍白火光交融，没有人形幽灵、鬼脸或现代器件。` },
  { title: '灯灭失忆', start: '裴照川扶住她肩膀', scene: `棺材铺内，照骨灯已经熄灭，${lamp}灯放在浅水空木棺边，一滴泪状黑蜡凝在灯壁下端。沈青崖跪坐在空棺底的薄薄积水里，上半身直起，茫然望着扶住她肩膀的裴照川。他蹲在棺外侧伸手扶稳她，神情担忧，肢体自然不交叠。晏九站在远处抱紧小黑册，室内浅灰晨光足以看清人物。没有火焰、伤口、血液、亡者或钟楼幻象，不把她画成昏迷。中景，以沈青崖失忆后的眼神和扶持动作为中心。` }
]
for (const [index, scene] of scenes.entries()) {
  const id = `work_bone_lantern_scene_002_${String(index + 1).padStart(2, '0')}`
  const entry = plan.entries.find(item => item.id === id)
  assert.ok(entry && !ledger.entries[id], 'Do not change any requested prompt')
  assert.equal(createHash('sha256').update(source).digest('hex'), entry.chapterTextHash)
  const anchor = paragraphs.findIndex(paragraph => paragraph.startsWith(scene.start))
  assert.ok(anchor >= 0)
  Object.assign(entry, { title: scene.title, paragraphIndex: anchor, paragraphExcerpt: paragraphs[anchor], filename: `${String(index + 1).padStart(2, '0')}-scene.png`,
    prompt: `《照骨灯》第二章正文插图，第${index + 1}幅。统一美术：写实古装电影静帧，真实布料、木石与皮肤质感，秋雨清晨，青灰环境和琥珀灯光，主体明亮清楚。人物一致性：${cast}当前唯一画面：${scene.scene}只输出一幅横向3:2图片，无标题、文字、字幕、Logo、水印、拼图、边框，无现代物品，无动漫立绘。`,
    promptReviewedAt: new Date().toISOString() })
  console.log(JSON.stringify({ id, title: scene.title, anchor }))
}
writeFileSync(planPath + '.tmp', JSON.stringify(plan, null, 2) + '\n', 'utf8')
renameSync(planPath + '.tmp', planPath)
