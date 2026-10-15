import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve, join } from 'node:path'
import { readFileSync, existsSync } from 'node:fs'

const sharp = createRequire(resolve('server/package.json'))('sharp')
const root = resolve(process.env.SCENE_ARTWORK_ROOT || 'artifacts/full-scene-artwork')
const ledger = JSON.parse(readFileSync(join(root, 'ledger.json'), 'utf8'))
const plan = JSON.parse(readFileSync(join(root, 'plan.json'), 'utf8'))
const args = process.argv.slice(2)
const bookDir = args.find(value => value.startsWith('--book='))?.slice(7) || 'bone-lantern'
const bookId = plan.entries.find(item => item.bookDir === bookDir)?.bookId
assert.ok(bookId, `Unknown book: ${bookDir}`)
for (const value of args.filter(value => !value.startsWith('--book='))) {
  const number = Number(value)
  assert.ok(Number.isInteger(number) && number > 0 && plan.entries.some(item => item.bookId === bookId && item.chapterNumber === number))
  const chapter = String(number).padStart(3, '0')
  const tiles = []
  for (let slot = 1; slot <= 5; slot++) {
    const entry = plan.entries.find(item => item.bookId === bookId && item.chapterNumber === number && item.slot === slot)
    const state = ledger.entries[entry?.id]
    const path = entry?.status === 'existing' ? resolve('miniprogram', entry.url.replace(/^\/+/, '')) : state?.mobile
    if (!path || !existsSync(path)) continue
    const input = await sharp(path).resize(600, 400, { fit: 'contain', background: '#ffffff' }).toBuffer()
    tiles.push({ input, left: ((slot - 1) % 2) * 600, top: Math.floor((slot - 1) / 2) * 400 })
  }
  assert.equal(tiles.length, 5, `Incomplete images for ${bookDir} chapter ${chapter}`)
  const output = join(root, `${bookDir === 'bone-lantern' ? 'review' : `review-${bookDir}`}-chapter-${chapter}.png`)
  await sharp({ create: { width: 1200, height: 1200, channels: 3, background: '#ffffff' } }).composite(tiles).png().toFile(output)
  console.log(output)
}
