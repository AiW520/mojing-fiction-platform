import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, copyFileSync } from 'node:fs'
import { resolve } from 'node:path'

const require = createRequire(resolve('server/package.json'))
const sharp = require('sharp')
const originals = resolve('server/content/cold-command/artifacts/chapter-065-original')
const bundled = resolve('miniprogram/assets/books/cold-command/chapter-065')
mkdirSync(bundled, { recursive: true })
const names = ['01-archive-table', '02-three-ledgers', '03-thirty-jin-gap', '04-courtyard-cart', '05-arrow-bundles']
const tiles = []
for (const [index, name] of names.entries()) {
  const source = resolve(originals, `${name}.png`)
  const optimized = resolve(originals, `${name}-mobile.webp`)
  const target = resolve(bundled, `${name}.webp`)
  const metadata = await sharp(source, { limitInputPixels: 20_000_000 }).metadata()
  assert.equal(metadata.format, 'png')
  assert.ok(metadata.width > 0 && metadata.height > 0)
  if (!existsSync(optimized)) {
    await sharp(source).resize({ width: 900, withoutEnlargement: true }).webp({ quality: 82 }).toFile(optimized)
  }
  if (existsSync(target)) {
    throw new Error(`Bundled artwork already exists: ${name}; refusing to overwrite`)
  }
  copyFileSync(optimized, target)
  const mobile = await sharp(optimized).metadata()
  assert.equal(mobile.format, 'webp')
  const pixels = await sharp(optimized).stats()
  assert.ok(pixels.channels.some(channel => channel.stdev > 5), 'Artwork must contain image content')
  console.log(JSON.stringify({ name, originalWidth: metadata.width, originalHeight: metadata.height, mobileWidth: mobile.width, mobileHeight: mobile.height, mobileBytes: mobile.size }))
  const tile = await sharp(optimized).resize(450, 300, { fit: 'contain', background: '#f5f5f7' }).png().toBuffer()
  tiles.push({ input: tile, left: index % 2 * 450, top: Math.floor(index / 2) * 300 })
}
await sharp({ create: { width: 900, height: 900, channels: 3, background: '#f5f5f7' } }).composite(tiles).png().toFile(resolve(originals, 'contact-sheet.png'))
