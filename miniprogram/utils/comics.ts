import { getEnvironment } from '../config'

export type Comic = { id: string; title: string; panelCount: number; coverUrl: string }
export type ComicEpisode = Comic & { updatedAt?: string; episodeNumber?: number }
export type ComicSeries = { id: string; title: string; episodeCount: number; panelCount: number; coverUrl: string; latestEpisodeId: string; episodes: ComicEpisode[] }

export function displayComic(comic: Comic): Comic {
  return { ...comic, coverUrl: comic.coverUrl?.startsWith('/') ? `${getEnvironment().apiBase}${comic.coverUrl}` : comic.coverUrl || '' }
}

export function displaySeries(series: ComicSeries): ComicSeries {
  return { ...series, coverUrl: series.coverUrl?.startsWith('/') ? `${getEnvironment().apiBase}${series.coverUrl}` : series.coverUrl || '', episodes: (series.episodes || []).map(displayComic) }
}
