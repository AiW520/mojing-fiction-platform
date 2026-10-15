import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'

const sharp = createRequire(resolve('server/package.json'))('sharp')
const artworkRoot = resolve(process.env.SCENE_ARTWORK_ROOT || 'artifacts/full-scene-artwork')
assert.ok(!existsSync(resolve(artworkRoot, 'generation.lock')), 'Wait for the current generation batch to finish')
const ledgerPath = resolve(artworkRoot, 'ledger.json')
const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'))
for (const [id, item] of Object.entries(ledger.entries)) {
  if (!['requested', 'failed'].includes(item.status) || !item.original || !existsSync(item.original)) continue
  const metadata = await sharp(item.original, { limitInputPixels: 20000000 }).metadata()
  const pixels = await sharp(item.original).stats()
  if (!metadata.width || !metadata.height || !pixels.channels.some(c => c.stdev > 5)) throw new Error(`Unusable image: ${id}`)
  if (!existsSync(item.mobile)) await sharp(item.original).resize({ width: 900, withoutEnlargement: true }).webp({ quality: 82 }).toFile(item.mobile)
  const mobile = await sharp(item.mobile).metadata()
  item.localRecoveryNote = item.error || 'request interrupted after local output was saved'
  delete item.error
  item.status = 'generated'
  item.completedAt = new Date().toISOString()
  item.width = metadata.width
  item.height = metadata.height
  item.mobileBytes = mobile.size
  console.log(JSON.stringify({ id, status: item.status, original: item.original, mobile: item.mobile, width: item.width, height: item.height }))
}
writeFileSync(ledgerPath + '.tmp', JSON.stringify(ledger, null, 2) + '\n', 'utf8')
renameSync(ledgerPath + '.tmp', ledgerPath)
