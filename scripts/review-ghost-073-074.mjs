import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { style, characterProfiles } from './review-ghost-067-100.mjs'
export { style, characterProfiles }
export const bookDir = 'ghost-ledger'
export const bookId = 'work_ghost_ledger'
const record = JSON.parse(readFileSync(resolve('artifacts/comic-bulk-production/ghost-067-100/text-model-responses/73-74.json'), 'utf8'))
const reviewed = JSON.parse(record.reviewer.choices[0].message.content)
export const chapters = Object.fromEntries(reviewed.correctedChapters.map(chapter => [chapter.chapterNumber, chapter.scenes.map(scene => ({
  title: scene.title,
  anchorText: scene.paragraphAnchor,
  scene: `${scene.visualDescription} 约束：${scene.continuityRisks.join('；')} 只输出一幅横向3:2图片，无标题、文字、字幕、Logo、水印、拼图、边框、现代物品。`
}))]))
