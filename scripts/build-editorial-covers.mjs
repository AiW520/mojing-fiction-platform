import { createRequire } from 'node:module'
import { mkdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
const root = resolve(import.meta.dirname, '..')
const sharp = createRequire(resolve(root, 'server/package.json'))('sharp')
const output = resolve(root, 'miniprogram/assets/books/editorial')
mkdirSync(output, { recursive: true })
const books = [
  ['seventh-pier', 'seventh_pier', ['风从', '第七码头来'], '程野', '现实 / 成长', '#eaf1ef'],
  ['paper-moon', 'paper_moon', ['纸月亮', '失窃案'], '顾西洲', '悬疑 / 奇想', '#eceef6'],
  ['migratory-bird', 'migratory_bird', ['候鸟不在', '冬天告别'], '苏木棉', '情感 / 公路', '#eef0e9'],
  ['last-lamp', 'last_lamp', ['旧城最后', '一盏灯'], '陆沉星', '科幻 / 人文', '#e9ecf2'],
  ['camellia-seven', 'camellia_seven', ['山茶花开到', '第七码'], '闻溪', '女性 / 成长', '#f4e8ec'],
  ['midnight-watch', 'midnight_watch', ['凌晨零点的', '修表铺'], '白屿', '治愈 / 奇幻', '#e6ede8'],
  ['tide', 'tide', ['潮汐把信', '带走'], '闻舟', '情感 / 海岸', '#e8eff5'],
  ['moon', 'moon', ['凌晨四点的', '月亮'], '沈青禾', '生活 / 治愈', '#edf0f6'],
]
for (const [source, id, title, author, genre, color] of books) {
  const art = await sharp(resolve(root, `artifacts/cover-originals/${source}.png`)).resize(480, 500, { fit: 'cover', position: 'bottom' }).toBuffer()
  const header = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="480" height="720"><rect width="480" height="220" fill="${color}"/><g fill="#20282e" font-family="Microsoft YaHei, sans-serif"><text x="30" y="33" font-size="12">墨境文库 / ${genre}</text><text x="28" y="99" font-size="46" font-weight="bold">${title[0]}</text><text x="28" y="156" font-size="46" font-weight="bold">${title[1]}</text><text x="30" y="197" font-size="15">${author} 著</text></g><rect x="30" y="43" width="22" height="2" fill="#20282e"/></svg>`)
  const target = resolve(output, `${id}.webp`)
  await sharp({ create: { width: 480, height: 720, channels: 3, background: color } }).composite([{ input: art, left: 0, top: 220 }, { input: header, left: 0, top: 0 }]).webp({ quality: 80 }).toFile(target)
  console.log(`${id}: ${statSync(target).size} bytes`)
}
const sheet = await Promise.all(books.map(async ([, id]) => ({ input: await sharp(resolve(output, `${id}.webp`)).resize(240, 360).png().toBuffer() })))
await sharp({ create: { width: 960, height: 720, channels: 3, background: '#ffffff' } }).composite(sheet.map((item, index) => ({ ...item, left: (index % 4) * 240, top: Math.floor(index / 4) * 360 }))).png().toFile(resolve(root, 'artifacts/cover-originals/contact-sheet.png'))
