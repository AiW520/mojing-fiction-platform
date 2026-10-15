export type ReaderAsset = { id: string; chapterId: string | null; blockId?: string; type: string; title: string; url: string; sortOrder?: number; paragraphIndex?: number | null; loadError?: boolean }
export type IllustratedParagraph = { id: string; text: string; illustrations: ReaderAsset[] }

// Anchors are zero-based paragraph indices; unanchored legacy artwork stays after the text.
export function illustratedParagraphs(content: string, assets: ReaderAsset[]): IllustratedParagraph[] {
  const rows = content.split(/\n\s*\n/).map(text => text.trim()).filter(Boolean)
    .map((text, index) => ({ id: String(index), text, illustrations: [] as ReaderAsset[] }))
  if (!rows.length) return rows
  for (const asset of [...assets].filter(item => item.url && !item.loadError).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || a.id.localeCompare(b.id))) {
    const anchor = asset.paragraphIndex
    const index = typeof anchor === 'number' && Number.isInteger(anchor) && anchor >= 0 && anchor < rows.length ? anchor : rows.length - 1
    rows[index].illustrations.push(asset)
  }
  return rows
}
