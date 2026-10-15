import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { style, characterProfiles as previousProfiles } from './review-ghost-033-034.mjs'
export { style }
export const bookDir='ghost-ledger',bookId='work_ghost_ledger'
export const characterProfiles={...previousProfiles,
  陆昭:'22岁中国古代边镇男性，清瘦黑发束起、灰黑短袍，左手白布包扎且失痛，浅裂不外露，仅右手记录；不增加腕绳或铃，黑皮功簿不发光。官印与职责严格遵循本场状态。',
  许青棠:'25岁中国古代北境女医官，黑发低髻、青灰军医短袍、药囊，右肩牵痛持续，动作低位克制、不拉弩、不搬重物、不展示伤口。',
  贺停舟:'39岁中国古代男性，旧黑铁甲、暗色披风、短髭，拄长木杖、一条旧疾裹布腿，不展示伤处，不增加能力。',
  秦衡:'中国古代成年男性功簿院书吏，深青文吏袍、黑漆匣，只持编号副本、程序见证，不补接收或功劳结论。',
  罗衍:'中国古代成年男性北镇守门什长，旧深灰皮甲、布巾束发，负责记录与封门，不替军牌认名。',
  城防卒:'中国古代成年男性守卒，旧灰布甲、黑发束起，短刀收鞘，只承担当场分派职责。'
}
export const chapterProfiles={}
export const chapters={}
const numbers=(process.env.GHOST_REVIEW_CHAPTERS||'35,37,38').split(',').map(Number)
assert.ok(numbers.every(n=>n>=35&&n<=66),'Only assigned chapters')
const edits={
  '35:1':{scene:'北镇验物厅的碎军令检查近景，四块碎军令按原朝向摆在无字木板上，撕裂边、折回痕、蓝灰砂粒和不可读残墨线清楚可见。许青棠以低位姿势用药钳整理纸片、右肩不抬高；秦衡双手停在纸边外，不用官印压边；陆昭只用右手记录，左手包扎垂在身侧。三人各自核对，不补写接收人。'},
  '35:2':{scene:'第一辆白蜡轮木车的空车厢内，空青铜匣与半根骨笛分开放置，骨笛平整断口与笛孔边缘暗色微痕清楚可辨，不出现人体、血滴或血腥场面，不补出另一段骨笛。车门缝透入雪地自然光，器物清楚照亮，没有骑兵、遗体、器物拼接或文字。'},
  '35:5':{scene:'北镇验物厅交接结束后的旧木案，六只独立封袋与无字六格位置图分别代表碎令、铜哨片、半根骨笛、铁甲鳞、车门白蜡粉、湿纸，格间留白，没有箭头或连线。只画三个人：陆昭只用右手核对，左手包扎收在身侧；秦衡复读无字副本；贺停舟拄木杖守在柜外。袋签和册页仅有不可读墨线，黑簿保持合起。'}
}
for(const n of numbers){
  const record=JSON.parse(readFileSync(resolve(`artifacts/comic-bulk-production/ghost-033-066/text-api/${String(n).padStart(3,'0')}-validated.json`),'utf8'))
  assert.equal(record.scenes.length,5)
  chapters[n]=record.scenes.map((s,i)=>({title:s.title,anchorText:s.anchorText,scene:`${edits[`${n}:${i+1}`]?.scene||s.scene}本场人物状态与职责：${JSON.stringify(s.characterStates)}。陆昭若出现则左手始终白布包扎，许青棠右肩动作低位；所有纸牌、印章、刻痕与簿册不显示任何可辨认字符，只画无意义短线；不增加未在本场出现的人物，不画人体伤害。`}))
}
