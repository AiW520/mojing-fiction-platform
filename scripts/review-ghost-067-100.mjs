import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { style as previousStyle, characterProfiles as previousProfiles } from './review-ghost-031-032.mjs'

export const style = `${previousStyle}后期九镇天灾与分权核验阶段；证物、人物动作和环境边界清晰，写实克制，不把异常现象画成已证实妖物。`
export const bookDir = 'ghost-ledger'
export const bookId = 'work_ghost_ledger'
export const characterProfiles = {
  ...previousProfiles,
  陆昭: '22岁中国古代边镇男性陆昭，清瘦黑发束起、灰黑短袍，停职事实观察员；左手失痛、掌心浅裂包扎不外露，疲劳时会错认，通常只用右手记录，不能持印、触尸骨、使用听骨或封功刀；不画发光黑簿。',
  许青棠: '25岁中国古代北境女医官许青棠，黑发低髻、青灰军医短袍、药囊；留皇城独立复核署远程复核，右肩牵痛持续，不搬运原件、不连续拉弩，不展示伤口。',
  贺停舟: '39岁中国古代男性贺停舟，旧黑铁甲、暗色披风、短髭，拄木杖，一条旧疾裹布腿，负责北镇城防、三钥柜和守线，动作克制。',
  司空烬: '中国古代中年男性功簿院掌院，深色官袍、文书夹，负责格式、补给、公示和越权解释责任，不替活人接收功劳。',
  卫岑: '中国古代北境成年男性镇诡卫，旧灰甲、束发，负责分镇防务、巡骑、封线和撤离调度，不替失踪者确认生死。',
  顾衡: '中国古代成年男性粮账吏，灰褐文吏袍、木算筹与粮袋清单，只承接实耗、签领和退回条件。',
  阮遐: '中国古代成年女性药吏，黑发低髻、深青短袍、药囊与伤情卡，负责第二镇药房执行和采样，不代替家属认尸。',
  文吏: '中国古代成年男性文吏，素色短袍、封袋、拓纸和木尺，负责编号、时刻、分柜和回传。'
}

const plan = JSON.parse(readFileSync(resolve('artifacts/comic-bulk-production/ghost-067-100/plan.json'), 'utf8'))
const paragraphList = number => readFileSync(resolve('server/content/ghost-ledger/chapters', `${String(number).padStart(3, '0')}.md`), 'utf8').replace(/^\uFEFF/, '').trim().split(/\n\s*\n/).slice(1).map(v => v.trim()).filter(Boolean)
const sceneFrom = (entry, paragraph, index) => ({
  title: entry.title.replace(/^第[^ ]+章\s*/, ''),
  anchorText: paragraph.slice(0, Math.min(42, paragraph.length)),
  scene: `依据正文证据段落“${paragraph.slice(0, 220)}”，呈现第${entry.chapterNumber}章第${index + 1}个横向场景：将正文中可见的地点、人物动作和证物作为画面主体，证物分柜或分袋并留出清晰间隔；只画正文已经出现的人物，异常现象保持未定性，不画可读文字、结论性妖物、血腥尸体特写、现代物品、Logo、水印或拼图。`
})

export const chapters = {}
for (let number = 67; number <= 66; number++) {
  const entries = plan.entries.filter(entry => entry.chapterNumber === number).sort((a, b) => a.slot - b.slot)
  const paragraphs = paragraphList(number)
  chapters[number] = entries.map((entry, index) => {
    const paragraph = paragraphs[entry.paragraphIndex] || paragraphs[Math.min(index, paragraphs.length - 1)]
    return sceneFrom(entry, paragraph, index)
  })
}
chapters[67] = [
  { title: '风停九袋挂在交叉绳上', anchorText: '第二镇的风停在丑时', scene: '第二镇东粮场丑时雪地，九只空麻布粮袋分开挂在三根普通交叉麻绳上，袋口朝北、袋底朝下，绳固定在木桩之间；卫岑在桩外持普通记录木板，顾衡核袋，陆昭站白线外胸挂无字停职文书、左手包扎收在身侧，右手持副图，不持官印、黑簿或刀。风已停，无隐藏人形、怪物或被吊人物，灯光清楚照亮粮袋和木桩。' },
  { title: '分拆药粮领用', anchorText: '顾衡听完，改为拨半日粮车加两袋柴炭', scene: '第二镇药房外雪地，一辆普通木粮车旁，两袋柴炭单独置放，与麻布粮袋保持间隔；顾衡持木算筹逐袋核数，成年领用人与文吏、守门人各自核对无字纸表，卫岑在远处安排两名巡骑护车。陆昭留白线外观察、不替他们签领，左手包扎。无军旗、刀刃、可读文字或庆功。' },
  { title: '废井铁环黑线原位', anchorText: '废井下的铁环也有变化', scene: '第二镇废井内部器物静物近景，灰泥井壁嵌着旧铁环，环内一段极细黑线穿过环心，另一端仍埋在灰泥里；井口暖风灯投光，井壁旧刮痕与湿泥清晰。铁环未取出、黑线未拔断，旁边干净拓纸只见抽象拓痕。无人物、尸体、文字、妖脸或发光法术。' },
  { title: '雪下空木箱分存', anchorText: '临睡前，搜寻队回报旧柴场有一处新压雪', scene: '旧柴场新压雪中的空木箱近景，箱底粘少量细麻线与青白砂，箱盖内有一段倒向的抽象刻痕但不可读；箱旁两块分开的纸托准备分别收麻线和砂，卫岑立在外圈，文吏戴布手套保持开箱记录，陆昭站更远白线外，只右手复述已记录数字，左手包扎。箱内不画人、尸骨或妖物。' },
  { title: '三孔木板钉痕拓样', anchorText: '木板取样时，锁匠先在现场画出孔距', scene: '井北取样现场器物静物，雨水磨平的旧木板翻面，三只孔及背面两道旧钉痕清楚，其中一道磨平、另一道保留木刺；木尺、孔距拓纸、木屑小纸托互不重叠。只画静物，没有真实铃架，不把孔距相近表现成连接，不显示文字、人物、怪物或现代器材。' }
]
chapters[68] = [
  { title: '三组搜寻队分工出发', anchorText: '第二镇的第二支小队在卯时成形', scene: '第二镇城门卯时雪地，成年小队分成三个彼此分开的组，两名步卒携普通绳和木楔，药吏携热水陶壶与纸卡，文吏携独立纸封袋、拓纸及两把无字短铲。卫岑在门内核路线，陆昭站边界外、灰黑短袍和左手包扎，不携停职牌、印或黑簿；只做事实观察，不触物证。无军旗或战斗。' },
  { title: '铁铜鞋钉分装', anchorText: '第一组沿窄沟向旧柴场走', scene: '旧柴场雪沟边的证物静物，大小不同的一枚铁鞋钉和一枚铜鞋钉分放在两个相隔纸托，旁边普通木尺只比尺寸，冻泥痕和两条浅沟在背景清晰。没有完整军靴、尸体、标签、图表文字或认定同源的连接线。' },
  { title: '井壁铁环四缺口', anchorText: '第二组在井壁黑线附近听见三次轻响', scene: '废井器物近景，旧铁环仍嵌井壁，外侧清晰刻出恰好四道等距浅缺口，细黑线保持原位未拔断；下方湿泥和水面有清楚反光，旁侧无字短铲只搁在纸托上不撬环，暖风灯照明。没有可读文字、鬼脸、发光、尸体或人物。' },
  { title: '废窑活人自愿回城', anchorText: '最终在一处废窑里发现两名活人', scene: '旧柴场北坡废窑门口，两个穿完整灰褐冬衣的成年砍柴兄弟安稳坐在避风处，药吏递热水陶碗，两个步卒留普通绳在标记木桩上，卫岑在外安排自愿回城路线。无伤口、血、武器攻击、捆人或怪物，不能画成受害尸体；暖灯照亮普通活人面容和废窑材质。' },
  { title: '五色布证物分区', anchorText: '搜寻队把带回的物件摊在五张不同颜色的布上', scene: '第二镇遮棚内五张不同颜色的平布横向分隔铺在木案，分别放随身铜壶与布片、粮袋残片、半结绳索、木箱碎片、井口泥样；每一类旁各有独立无字纸封袋，彼此不混装。文吏和药吏隔案核封，陆昭站案外只右手持副纸、左手包扎，许青棠不在现场。无字标签、连线、黑簿、尸体或结功。' }
]

// The text reviewer supplied corrected scene sets for the next pair; preserve its
// approved anchors and continuity fixes verbatim while adapting to this module's API.
const reviewed69to70 = JSON.parse(readFileSync(resolve('artifacts/comic-bulk-production/ghost-067-100/text-model-responses/69-70.json'), 'utf8'))
const corrected = reviewed69to70.reviewer.choices?.[0]?.message?.content
let correctedChapters = []
try { correctedChapters = JSON.parse(corrected).correctedChapters || [] } catch {}
for (const block of correctedChapters) {
  chapters[block.chapterNumber] = block.scenes.map(scene => ({
    title: scene.title,
    anchorText: scene.paragraphAnchor,
    scene: `${scene.visualDescription} 约束：${scene.continuityRisks.join('；')} 只输出一幅横向3:2图片，无标题、文字、字幕、Logo、水印、拼图、边框、现代物品。`
  }))
}
