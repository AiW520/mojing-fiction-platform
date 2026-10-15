import { createHash } from 'node:crypto'

export const MAX_TXT_BYTES = 8 * 1024 * 1024
export const countWords = text => [...text.replace(/\s/g, '')].length
export const textHash = text => createHash('sha256').update(text).digest('hex')

export function parseNovel(input) {
  if (typeof input.fileName !== 'string' || !/\.txt$/i.test(input.fileName) || input.fileName.length > 200) throw new Error('请选择 TXT 文件')
  if (typeof input.base64 !== 'string' || !input.base64 || input.base64.length > Math.ceil(MAX_TXT_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64)) throw new Error('TXT 文件格式错误或超过 8MB')
  const bytes = Buffer.from(input.base64, 'base64')
  if (!bytes.length || bytes.length > MAX_TXT_BYTES || bytes.toString('base64') !== input.base64) throw new Error('TXT 文件格式错误或超过 8MB')
  const allowed = ['utf-8', 'gb18030', 'utf-16le', 'utf-16be']
  let encoding = input.encoding || 'auto'
  let text
  if (encoding === 'auto') {
    encoding = bytes[0] === 255 && bytes[1] === 254 ? 'utf-16le' : bytes[0] === 254 && bytes[1] === 255 ? 'utf-16be' : 'utf-8'
    try { text = new TextDecoder(encoding, { fatal: true }).decode(bytes) }
    catch { encoding = 'gb18030' }
  }
  if (!allowed.includes(encoding)) throw new Error('不支持此文本编码')
  try { text ??= new TextDecoder(encoding, { fatal: true }).decode(bytes) } catch { throw new Error('无法解码，请手动选择 TXT 编码') }
  text = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  if (!text.trim() || /[\x00-\x08\x0e-\x1f]/.test(text) || text.includes('\uFFFD')) throw new Error('文件为空、包含二进制内容或编码异常')
  if (text.length > 3000000) throw new Error('正文超过 300 万字符，请拆为多部作品')
  const headings = /^(?:第[零〇一二三四五六七八九十百千万两\d]+[章回节](?:\s*[^\n]{0,90})?|chapter\s+\d+(?:\s*[^\n]{0,90})?|(?:序章|楔子|尾声|后记)(?:\s*[^\n]{0,90})?)$/i
  const chapters = []
  let title = '正文'
  let lines = []
  let foundHeading = false
  const flush = () => {
    const content = lines.join('\n').trim()
    if (content || foundHeading) chapters.push({ title, content, wordCount: countWords(content) })
    lines = []
  }
  for (const line of text.split('\n')) {
    const candidate = line.trim()
    if (headings.test(candidate)) {
      if (!foundHeading && lines.some(value => value.trim())) title = '卷首'
      flush(); title = candidate; foundHeading = true
    } else lines.push(line)
  }
  flush()
  if (chapters.length > 3000) throw new Error('章节超过 3000 章')
  const warnings = []
  if (!foundHeading) warnings.push('未识别章节标题，暂按一章导入。可先在 TXT 中补充“第1章 标题”后重新预览。')
  const empty = chapters.filter(chapter => !chapter.wordCount).length
  if (empty) warnings.push(`${empty} 个章节没有正文，发布前必须补齐。`)
  if (chapters.some(chapter => chapter.content.length > 12000)) warnings.push('部分章节超过 AI 单章处理上限（12000 字符），仍可导入和阅读，但需要人工审阅。')
  const duplicates = new Set(chapters.map(chapter => chapter.title)).size !== chapters.length
  if (duplicates) warnings.push('有重复章节标题，请检查是否包含重复目录。')
  return { text, encoding, chapters, warnings, wordCount: chapters.reduce((total, chapter) => total + chapter.wordCount, 0), sourceHash: createHash('sha256').update(bytes).digest('hex'), bytes }
}
