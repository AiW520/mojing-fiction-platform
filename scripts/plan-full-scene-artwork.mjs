import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'

const root = resolve('server/content')
const output = resolve('artifacts/full-scene-artwork')
mkdirSync(output, { recursive: true })
if (existsSync(join(output, 'plan.json'))) throw new Error('Plan already exists; refusing to replace the chapter snapshot')

const slug = value => value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-|-$/g, '').slice(0, 70) || 'scene'

function chapterParagraphs(chapterPath) {
  const source = readFileSync(chapterPath, 'utf8').replace(/^\uFEFF/, '').trim()
  const lines = source.split(/\r?\n/)
  const title = lines[0]?.replace(/^#\s+/, '').trim() || ''
  const content = (lines[0]?.startsWith('#') ? lines.slice(1) : lines).join('\n').trim()
  const paragraphs = content.split(/\n\s*\n/).map(text => text.trim()).filter(Boolean)
  return { title, paragraphs, content }
}

function plannedAnchors(length) {
  if (length <= 1) return [0, 0, 0, 0, 0]
  return [...new Set([0, Math.floor(length * .24), Math.floor(length * .49), Math.floor(length * .74), length - 1])]
    .concat(Array.from({ length: 5 }, (_, index) => Math.min(length - 1, index)))
    .slice(0, 5)
}

const books = []
for (const entry of ['bone-lantern', 'ghost-ledger', 'cold-command']) {
  const bookRoot = join(root, entry)
  const manifest = JSON.parse(readFileSync(join(bookRoot, 'manifest.json'), 'utf8'))
  const chapterRoot = join(bookRoot, 'chapters')
  const names = readdirSync(chapterRoot).filter(name => /^\d+\.md$/.test(name)).sort((a, b) => Number(a.slice(0, -3)) - Number(b.slice(0, -3)))
  const existing = new Map()
  for (const asset of manifest.assets || []) {
    if (asset.type !== 'scene' || !Number.isInteger(asset.chapterNumber)) continue
    const list = existing.get(asset.chapterNumber) || []
    list.push(asset)
    existing.set(asset.chapterNumber, list)
  }
  for (const name of names) {
    const number = Number(name.slice(0, -3))
    const { title, paragraphs, content } = chapterParagraphs(join(chapterRoot, name))
    const current = (existing.get(number) || []).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    const anchors = plannedAnchors(paragraphs.length)
    const entries = []
    for (let slot = 0; slot < 5; slot++) {
      const old = current[slot]
      if (old) {
        if (!old.url.startsWith('/assets/') || !existsSync(resolve('miniprogram', old.url.slice(1)))) throw new Error(`Existing artwork missing: ${old.id}`)
        entries.push({ id: old.id, bookId: manifest.id, bookDir: entry, chapterNumber: number, slot: slot + 1, status: 'existing', title: old.title, paragraphIndex: Number.isInteger(old.paragraphIndex) ? old.paragraphIndex : anchors[slot], url: old.url })
        continue
      }
      const paragraphIndex = anchors[slot]
      const id = `${manifest.id}_scene_${String(number).padStart(3, '0')}_${String(slot + 1).padStart(2, '0')}`
      const filename = `${String(slot + 1).padStart(2, '0')}-${slug(title || `chapter-${number}`)}.png`
      const paragraph = paragraphs[paragraphIndex] || paragraphs[0] || ''
      entries.push({ id, bookId: manifest.id, bookDir: entry, chapterNumber: number, slot: slot + 1, status: 'pending', title: `${title || `第${number}章`} · 场景${slot + 1}`, paragraphIndex, filename, paragraphExcerpt: paragraph.slice(0, 520), chapterParagraphCount: paragraphs.length, chapterTextHash: createHash('sha256').update(content).digest('hex'), promptReviewedAt: null })
    }
    books.push(...entries)
  }
}

const pending = books.filter(item => item.status === 'pending')
const plan = { version: 1, createdAt: new Date().toISOString(), targetPerChapter: 5, publishedChapterCount: books.filter(item => item.slot === 1).length, pendingCount: pending.length, entries: books }
writeFileSync(join(output, 'plan.json'), JSON.stringify(plan, null, 2) + '\n', 'utf8')
const ledgerPath = join(output, 'ledger.json')
if (!existsSync(ledgerPath)) writeFileSync(ledgerPath, JSON.stringify({ version: 1, entries: {} }, null, 2) + '\n', 'utf8')
console.log(JSON.stringify({ publishedChapterCount: plan.publishedChapterCount, targetImages: books.length, existingImages: books.length - pending.length, pendingImages: pending.length, plan: join(output, 'plan.json'), ledger: ledgerPath }))
