import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

function countText(value) {
  return value.replace(/\s/g, '').length
}

function readChapter(path, fallbackNumber) {
  const source = readFileSync(path, 'utf8').replace(/^\uFEFF/, '').trim()
  const lines = source.split(/\r?\n/)
  const heading = lines[0]?.match(/^#\s+(.+)$/)
  const title = heading ? heading[1].trim() : `第${fallbackNumber}章`
  const content = (heading ? lines.slice(1) : lines).join('\n').trim()
  return { title, content, wordCount: countText(content) }
}

export function loadLongformCatalog(contentRoot) {
  if (!existsSync(contentRoot)) return []
  return readdirSync(contentRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => {
      const bookRoot = join(contentRoot, entry.name)
      const manifestPath = join(bookRoot, 'manifest.json')
      const chapterRoot = join(bookRoot, 'chapters')
      if (!existsSync(manifestPath) || !existsSync(chapterRoot)) return null
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      const chapterFiles = readdirSync(chapterRoot).filter(name => /^\d+\.md$/.test(name)).sort()
      const chapters = chapterFiles.map((name, index) => {
        const number = Number(name.replace(/\.md$/, '')) || index + 1
        let firstChapter = 1
        const volume = manifest.volumes.find(item => {
          const containsChapter = number >= firstChapter && number < firstChapter + item.plannedChapters
          firstChapter += item.plannedChapters
          return containsChapter
        }) || manifest.volumes.at(-1)
        return { id: `${manifest.id}_chapter_${String(number).padStart(3, '0')}`, number, volumeId: volume.id, ...readChapter(join(chapterRoot, name), number) }
      })
      return { ...manifest, chapters, currentWords: chapters.reduce((sum, item) => sum + item.wordCount, 0), contentRoot: bookRoot }
    })
    .filter(Boolean)
}

export function seedLongformCatalog(db, books, ownerId = 'u_1001') {
  const upsertWork = db.prepare(`
    INSERT INTO works(id, owner_id, title, author, summary, type, status, progress, words, published_at)
    VALUES (?, ?, ?, ?, ?, ?, 'published', 0, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET title = excluded.title, author = excluded.author,
      summary = excluded.summary, type = excluded.type, status = 'published', words = excluded.words,
      published_at = COALESCE(works.published_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
  `)
  const upsertMeta = db.prepare(`
    INSERT INTO work_metadata(work_id, format, tagline, cover_url, reads_label, score_label, target_words, planned_chapters, serialization_status)
    VALUES (?, 'longform', ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(work_id) DO UPDATE SET tagline = excluded.tagline, cover_url = excluded.cover_url,
      reads_label = excluded.reads_label, score_label = excluded.score_label,
      target_words = excluded.target_words, planned_chapters = excluded.planned_chapters,
      serialization_status = excluded.serialization_status, updated_at = CURRENT_TIMESTAMP
  `)
  const upsertVolume = db.prepare(`
    INSERT INTO story_volumes(id, work_id, title, sort_order, planned_chapters)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET title = excluded.title, sort_order = excluded.sort_order,
      planned_chapters = excluded.planned_chapters, updated_at = CURRENT_TIMESTAMP
  `)
  const upsertChapter = db.prepare(`
    INSERT INTO story_chapters(id, work_id, volume_id, chapter_number, title, content, word_count, status, published_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'published', CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET volume_id = excluded.volume_id, chapter_number = excluded.chapter_number,
      title = excluded.title, content = excluded.content, word_count = excluded.word_count,
      status = 'published', published_at = COALESCE(story_chapters.published_at, CURRENT_TIMESTAMP),
      updated_at = CURRENT_TIMESTAMP
  `)
  const upsertCharacter = db.prepare(`
    INSERT INTO characters(id, work_id, name, character_role, relation, public_summary, private_profile, visual_profile, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, character_role = excluded.character_role,
      relation = excluded.relation, public_summary = excluded.public_summary,
      private_profile = excluded.private_profile, visual_profile = excluded.visual_profile,
      sort_order = excluded.sort_order, updated_at = CURRENT_TIMESTAMP
  `)
  const upsertAsset = db.prepare(`
    INSERT INTO story_assets(id, work_id, chapter_id, character_id, asset_type, title, asset_url, sort_order, paragraph_index)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET chapter_id = excluded.chapter_id, character_id = excluded.character_id,
      asset_type = excluded.asset_type, title = excluded.title, asset_url = excluded.asset_url,
      sort_order = excluded.sort_order, paragraph_index = excluded.paragraph_index, updated_at = CURRENT_TIMESTAMP
  `)

  for (const book of books) {
    upsertWork.run(book.id, ownerId, book.title, book.author, book.summary, book.type, book.currentWords)
    upsertMeta.run(book.id, book.tagline, book.cover, book.reads, book.score, book.targetWords, book.plannedChapters, book.status)
    book.volumes.forEach(volume => upsertVolume.run(volume.id, book.id, volume.title, volume.sortOrder, volume.plannedChapters))
    const volumeIds = book.volumes.map(volume => volume.id)
    if (volumeIds.length) {
      const placeholders = volumeIds.map(() => '?').join(', ')
      db.prepare(`DELETE FROM story_volumes WHERE work_id = ? AND id NOT IN (${placeholders})
        AND NOT EXISTS (SELECT 1 FROM story_chapters WHERE story_chapters.volume_id = story_volumes.id)`)
        .run(book.id, ...volumeIds)
    }
    book.chapters.forEach(chapter => upsertChapter.run(chapter.id, book.id, chapter.volumeId, chapter.number, chapter.title, chapter.content, chapter.wordCount))
    book.characters.forEach((character, index) => upsertCharacter.run(character.id, book.id, character.name, character.role, character.relation, character.publicSummary, JSON.stringify(character.privateProfile), JSON.stringify({ version: 1, prompt: character.visualPrompt }), index))
    upsertAsset.run(`${book.id}_cover`, book.id, null, null, 'cover', '小说封面', book.cover, 0, null)
    ;(book.assets || []).forEach((asset, index) => {
      const chapter = asset.chapterNumber ? book.chapters.find(item => item.number === asset.chapterNumber) : null
      const anchor = Number.isInteger(asset.paragraphIndex) && asset.paragraphIndex >= 0 ? asset.paragraphIndex : null
      upsertAsset.run(asset.id, book.id, chapter?.id || null, asset.characterId || null, asset.type || 'scene', asset.title || '', asset.url, asset.sortOrder ?? index + 1, anchor)
    })
  }
}
