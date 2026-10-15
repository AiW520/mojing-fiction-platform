import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { style, characterProfiles } from './review-ghost-067-100.mjs'
export { style, characterProfiles }
export const bookDir = 'ghost-ledger'
export const bookId = 'work_ghost_ledger'
const record = JSON.parse(readFileSync(resolve('artifacts/comic-bulk-production/ghost-067-100/text-model-responses/75-76.json'), 'utf8'))
const reviewed = JSON.parse(record.reviewer.choices[0].message.content)
export const chapters = Object.fromEntries(reviewed.correctedChapters.map(chapter => [chapter.chapterNumber, chapter.scenes.map(scene => ({
  title: scene.title,
  anchorText: scene.paragraphAnchor,
  scene: `${scene.visualDescription} 约束：${scene.continuityRisks.join('；')} 所有编号只以不可读线痕表现，不出现数字或汉字。`
}))]))
chapters[76][4].scene = '夜间会盟结束后的皇城北苑旧驿厅，九块无字木牌分别放入九只浅木盒，盒间留出明显距离，中央只留一张有抽象短线的索引副纸。司空烬站在柜前将一只盒盖合上，秦衡把包布和封存工具放在旁边，皇城记录吏坐在独立桌上阅读第四镇送来的复述副纸。陆昭仍在第四镇，不在这幅画中；阮遐在第二镇、贺停舟在北镇均不出现。只表现九牌分别封存，不能画共同功劳册、认名、结算或新技艺。冷灯清晰照出木纹和封袋。'
