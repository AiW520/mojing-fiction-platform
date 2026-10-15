import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, renameSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'

const modulePath = resolve(process.argv[2] || '')
assert.ok(process.argv[2], 'Pass an editorial scene definition module')
const { bookDir, bookId, cast, chapterCast = {}, characterProfiles, chapterProfiles = {}, style, chapters } = await import(pathToFileURL(modulePath).href)
const artworkRoot = resolve(process.env.SCENE_ARTWORK_ROOT || 'artifacts/full-scene-artwork')
const planPath = resolve(artworkRoot, 'plan.json')
const plan = JSON.parse(readFileSync(planPath, 'utf8'))
const ledger = JSON.parse(readFileSync(resolve(artworkRoot, 'ledger.json'), 'utf8'))
for (const [number, scenes] of Object.entries(chapters)) {
  assert.equal(scenes.length, 5)
  const source = readFileSync(resolve('server/content', bookDir, 'chapters', `${number.padStart(3, '0')}.md`), 'utf8').replace(/^\uFEFF/, '').trim().split(/\r?\n/).slice(1).join('\n').trim()
  const paragraphs = source.split(/\n\s*\n/).map(value => value.trim()).filter(Boolean)
  let previousAnchor = -1
  for (const [index, scene] of scenes.entries()) {
    const entry = plan.entries.find(item => item.bookId === bookId && item.chapterNumber === Number(number) && item.slot === index + 1)
    const id = entry?.id
    assert.ok(entry && !ledger.entries[id], `Do not change a requested prompt: ${id}`)
    const sourceHash = createHash('sha256').update(source).digest('hex')
    if (entry.chapterTextHash) assert.equal(sourceHash, entry.chapterTextHash)
    else assert.equal(entry.status, 'existing', 'Only existing illustrations can lack the initial snapshot')
    const anchors = paragraphs.flatMap((paragraph, anchor) => paragraph.includes(scene.anchorText) ? [anchor] : [])
    assert.equal(anchors.length, 1, `Anchor must be unique: ${id}`)
    const anchor = anchors[0]
    assert.ok(anchor > previousAnchor, 'Scene anchors must follow chapter order')
    previousAnchor = anchor
    if (entry.status === 'existing') {
      const manifest = JSON.parse(readFileSync(resolve('server/content', bookDir, 'manifest.json'), 'utf8'))
      assert.ok(manifest.assets.find(asset => asset.id === id && asset.type === 'scene' && asset.chapterNumber === Number(number)))
      Object.assign(entry, { paragraphIndex: anchor, paragraphExcerpt: paragraphs[anchor], chapterTextHash: sourceHash, chapterParagraphCount: paragraphs.length, anchorReviewedAt: new Date().toISOString() })
      console.log(JSON.stringify({ id, title: entry.title, anchor, reused: true }))
      continue
    }
    const sceneCast = characterProfiles
      ? Object.entries({ ...characterProfiles, ...chapterProfiles[number] }).filter(([name]) => scene.scene.includes(name)).map(([name, profile]) => `${name}：${profile}`).join('；') + '。只画当前场景人物，不加入其他配角。'
      : chapterCast[number] || cast
    Object.assign(entry, { title: scene.title, paragraphIndex: anchor, paragraphExcerpt: paragraphs[anchor], filename: `${String(index + 1).padStart(2, '0')}-scene.png`,
      prompt: `小说第${number}章正文插图「${scene.title}」。统一美术：${style}人物一致性：${sceneCast}当前唯一画面：${scene.scene}只输出一幅横向3:2图片，无标题、文字、字幕、Logo、水印、拼图、边框，无现代物品，无动漫立绘。`,
      promptReviewedAt: new Date().toISOString() })
    console.log(JSON.stringify({ id, title: scene.title, anchor }))
  }
}
writeFileSync(planPath + '.tmp', JSON.stringify(plan, null, 2) + '\n', 'utf8')
renameSync(planPath + '.tmp', planPath)
