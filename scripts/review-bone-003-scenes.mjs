import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, renameSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'

const planPath = resolve('artifacts/full-scene-artwork/plan.json')
const plan = JSON.parse(readFileSync(planPath, 'utf8'))
const ledger = JSON.parse(readFileSync('artifacts/full-scene-artwork/ledger.json', 'utf8'))
const source = readFileSync('server/content/bone-lantern/chapters/003.md', 'utf8').trim().split(/\r?\n/).slice(1).join('\n').trim()
const paragraphs = source.split(/\n\s*\n/).map(value => value.trim()).filter(Boolean)
const cast = '沈青崖：23岁中国女性，细长脸、清晰颧骨、平直眉、黑发低髻，无首饰，深色窄袖旧官服、薄皮手套；裴照川：27岁中国男性，修长脸、平直眉、黑发束冠、黑色窄袖巡夜官服、腰间连鞘旧刀；晏九：16岁中国男性少年，瘦削、眼尾微扬、麻布短衣、墨迹手指、小黑册。同名人物外貌服装保持一致，未提及人物不得加入。'
const scenes = [
  { title: '无花椒薄饼', start: '油纸底下却另包', scene: '午时的义庄木桌旁，沈青崖看向油纸包底下另包的无花椒薄饼，一侧是她已咬一口的花椒盐烧饼。裴照川稍远处背向镜头等候，没有触碰她；桌边摊开记录簿，纸面只有模糊笔迹。沈青崖神情困惑而克制，左手用普通布条包好，窗外湿檐与灰白午光，室内主体充分照亮。镜头以两种饼和她的观察为中心，不出现回忆或幻象。' },
  { title: '桐油雨痕', start: '床前的确有一片颜色更深的木板', scene: '云来客栈二楼临街旧客房，房间落满灰尘，床帐霉旧，门锁锈死，地板上有一片被薄桐油画成的雨水痕迹。沈青崖戴手套蹲下以刀尖刮取木屑，裴照川在旁观察；窗外真实雨景与室内干燥灰尘形成对比。不出现尸体，不画超自然客人，不加入可读文字。' },
  { title: '三张面孔', start: '掌柜和伙计同时开口', scene: '客栈旧房门口，掌柜、年轻伙计和后厨婆子分别向沈青崖与裴照川描述同一个不存在的客人，三人神情笃定但互相指向不同方向；画面用三组不同姿态和手势表现记忆冲突，不把三人画成同一张脸。沈青崖手持记录纸，裴照川克制询问。背景为积灰桌面与锈锁，写实中景，无字幕无文字。' },
  { title: '百骨空棺', start: '棺中没有顾不言', scene: '奉安义庄后坡雨泥中刚打开的旧棺材，棺内整齐分层放着许多经过清理的不同大小人骨，骨骼仅作为考古式证物展示，无血肉、无伤口、无恐怖夸张。铜尺横放在骨堆上方，沈青崖、裴照川、晏九站在棺边震惊而克制，泥地、棺钉和雨水清楚可见。不要出现完整尸体，不要渲染血腥。' },
  { title: '七声钟间', start: '数到第五声时', scene: '义庄后坡雨幕和城西观星台远景，沈青崖抬头默数远处钟声，裴照川侧耳辨认，晏九握着两枚旧铜钱。远处多座屋檐与钟楼形成层叠空间，画面以突然停顿后的空旷感表现时间缺口，不画声波文字、钟面数字或超自然实体。三人站在湿泥路上，人物和环境均清楚可辨。' }
]
for (const [index, scene] of scenes.entries()) {
  const id = `work_bone_lantern_scene_003_${String(index + 1).padStart(2, '0')}`
  const entry = plan.entries.find(item => item.id === id)
  assert.ok(entry && !ledger.entries[id], 'Do not change any requested prompt')
  assert.equal(createHash('sha256').update(source).digest('hex'), entry.chapterTextHash)
  const anchor = paragraphs.findIndex(paragraph => paragraph.includes(scene.start))
  assert.ok(anchor >= 0)
  Object.assign(entry, { title: scene.title, paragraphIndex: anchor, paragraphExcerpt: paragraphs[anchor], filename: `${String(index + 1).padStart(2, '0')}-scene.png`,
    prompt: `《照骨灯》第三章正文插图，第${index + 1}幅。统一美术：写实古装电影静帧，真实木石、布料、金属和皮肤质感，雨后奉安城，青灰环境与克制暖光，画面明亮可辨。人物一致性：${cast}当前唯一画面：${scene.scene}只输出一幅横向3:2图片，无标题、文字、字幕、Logo、水印、拼图、边框，无现代物品，无动漫立绘。`,
    promptReviewedAt: new Date().toISOString() })
  console.log(JSON.stringify({ id, title: scene.title, anchor }))
}
writeFileSync(planPath + '.tmp', JSON.stringify(plan, null, 2) + '\n', 'utf8')
renameSync(planPath + '.tmp', planPath)
