import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const planPath = resolve('artifacts/full-scene-artwork/plan.json')
const plan = JSON.parse(readFileSync(planPath, 'utf8'))
const source = readFileSync('server/content/bone-lantern/chapters/001.md', 'utf8').trim().split(/\r?\n/).slice(1).join('\n').trim()
const paragraphs = source.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean)
const cast = '沈青崖：23岁中国女性，细长脸、清晰颧骨、平直眉、黑发低髻，无首饰，深色窄袖旧官服、薄皮手套、旧木质验尸箱；裴照川：27岁中国男性，修长脸、平直眉、黑发束冠、黑色窄袖巡夜官服、连鞘旧刀；晏九：16岁中国男性少年，瘦削、眼尾微扬、麻布短衣、墨迹手指、小黑册。每幅中出现同名人物时保持这些外貌服装，未参与该场景的人物不得加入。'
const scenes = [
  { title: '雨夜无影', start: '晏九披着麻衣冲出来', scene: '奉安永寿坊棺材铺门前，秋夜冷雨，晏九站在屋檐下看向青石板上仰卧的中年无名男尸，男尸穿普通灰布长衫，完全合衣无裸露无血腥。灯笼、门框和晏九有清晰投影，尸身下只有积水没有人形阴影。远景交代古街和木门，无牌匾文字。不得出现沈青崖或裴照川。镜头为街面中远景，画面主体清楚，冷雨与暖灯自然对照。' },
  { title: '鞋缝黄泥', start: '她又看尸体四周', scene: '雨已变小，沈青崖蹲在灰衫无名男尸脚边，戴薄皮手套的手略抬旧鞋跟，微量黄泥和碎螺壳留在鞋跟接缝。青石积水和普通灰布衣料清楚可辨，验尸木箱放在她一侧。镜头贴近鞋跟、手和她冷静的半侧脸，安静调查动作，无刀刺入人体、无伤口特写、无血腥，不加入不在场的其他主角。' },
  { title: '历纸出水', start: '裴照川接过纸，对着灯看', scene: '棺材铺门前的雨夜，沈青崖与裴照川仔细查看刚从男尸舌下取出的半个巴掌大小薄历纸，裴照川戴手套举纸向风灯，纸纤维中只有细微金粉和一枚缺口圆形墨记，不出现汉字。中景双人对物调查，晏九在门槛远处观察。男尸灰衫合衣虚化在画面下缘。禁止描绘镊子进入口腔、暴力或明显尸体损伤。' },
  { title: '棺底骨屑', start: '她以银匙舀起', scene: '铺内未上漆的空薄木棺中积着一层浅雨水，沈青崖俯身以银匙舀起极细的白色骨粉颗粒，对一旁风灯检查，旧木纹、清水、银匙和她戴薄手套的手清楚可见。晏九握小黑册站在门槛，裴照川可在后方守候。室内屋顶没有漏水。此时水未发光、无人名自行出现，不添加超自然人形。斜上方中近景，主体为手、银匙和棺中水。' },
  { title: '棺水苍焰', start: '沈青崖看见那名字，掌心旧伤猛地裂开', scene: '沈青崖立在空棺边，左手手套掌心只有一滴暗红血珠落向浅水，不展示开放伤口，水底一点微弱苍白火光开始亮起。晏九在旁惊惧地抱住自行翻开的小黑册，册页光洁模糊、没有可读字。裴照川站在稍后方，三人互不重叠，火光没有形成幽灵或人形。镜头为三人围棺的中景，浅色火光映在克制惊疑的脸上，不画师父、不画回忆或本章之后剧情。' }
]
for (let index = 0; index < scenes.length; index++) {
  const scene = scenes[index]
  const entry = plan.entries.find(e => e.id === `work_bone_lantern_scene_001_${String(index + 1).padStart(2, '0')}`)
  const anchor = paragraphs.findIndex(p => p.startsWith(scene.start) || p.includes(scene.start))
  if (!entry || anchor < 0) throw new Error(`Scene anchor missing: ${scene.title}`)
  entry.title = scene.title
  entry.paragraphIndex = anchor
  entry.paragraphExcerpt = paragraphs[anchor]
  entry.filename = `${String(index + 1).padStart(2, '0')}-scene.png`
  entry.prompt = `《照骨灯》第一章正文插图，第${index + 1}幅。统一美术：写实古装电影静帧，真实木石布料和皮肤质感，秋夜小雨，青灰环境与琥珀灯火，曝光足以看清人物动作和道具，不是黑暗模糊氛围图。人物一致性设定：${cast}。当前唯一画面：${scene.scene}。只输出一幅横向3:2场景，无标题、文字、字幕、Logo、水印、拼图、边框，无现代物品，无动漫或游戏立绘。`
  entry.promptReviewedAt = new Date().toISOString()
  console.log(JSON.stringify({ id: entry.id, title: entry.title, anchor }))
}
writeFileSync(planPath, JSON.stringify(plan, null, 2) + '\n', 'utf8')
