import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { style, characterProfiles } from './review-ghost-067-100.mjs'
export { style, characterProfiles }
export const bookDir = 'ghost-ledger'
export const bookId = 'work_ghost_ledger'
const record = JSON.parse(readFileSync(resolve('artifacts/comic-bulk-production/ghost-067-100/text-model-responses/71-72.json'), 'utf8'))
const data = JSON.parse(record.writer.choices[0].message.content)
export const chapters = Object.fromEntries(data.chapters.map(chapter => [chapter.chapterNumber, chapter.scenes.map(scene => ({
  title: scene.title,
  anchorText: scene.paragraphAnchor === '小岚母亲只撤回女儿的大名，不撤回领药和暂住的请求' ? '小岚母亲听说三镇木牌已经封袋' : scene.paragraphAnchor,
  scene: `${scene.visualDescription} 约束：${scene.continuityRisks.join('；')} 只输出一幅横向3:2图片，无标题、文字、字幕、Logo、水印、拼图、边框、现代物品。`
}))]))
