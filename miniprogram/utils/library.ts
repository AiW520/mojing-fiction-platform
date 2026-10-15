import { getEnvironment } from '../config'

export type LibraryBook = {
  id: string; title: string; author: string; summary?: string; tagline?: string; type?: string;
  format?: string; coverImage?: string; words?: number; readMinutes?: number;
  chapterCount?: number; serializationStatus?: string;
}
export type DisplayBook = LibraryBook & { wordLabel: string; readingLabel: string; statusLabel: string; genreLabel: string; coverTone: string }

export function boundedProgress(value: unknown) {
  const progress = Number(value)
  return Number.isFinite(progress) ? Math.max(0, Math.min(100, Math.round(progress))) : 0
}

export function displayBook(book: LibraryBook): DisplayBook {
  const words = Math.max(0, Number(book.words) || 0)
  const longform = book.format === 'longform'
  const count = Math.max(0, Number(book.chapterCount) || 0)
  const minutes = Math.max(1, Math.ceil(Number(book.readMinutes) || words / 350))
  const tones = ['fern', 'rose', 'ink', 'lilac', 'blue', 'pearl']
  const hash = [...book.id].reduce((total, char) => (total * 31 + char.charCodeAt(0)) >>> 0, 0)
  return {
    ...book,
    coverImage: book.coverImage?.startsWith('/api/assets/') ? `${getEnvironment().apiBase}${book.coverImage}` : book.coverImage || '',
    wordLabel: words >= 10000 ? `${Number((words / 10000).toFixed(1))}万字` : `${Math.round(words)}字`,
    readingLabel: longform ? `${count}章` : `约${minutes}分钟`,
    statusLabel: longform && book.serializationStatus !== 'complete' ? '连载中' : '已完结',
    genreLabel: (book.type || (longform ? '长篇小说' : '短篇小说')).split(/[·|]/)[0].trim(),
    coverTone: tones[hash % tones.length],
  }
}
