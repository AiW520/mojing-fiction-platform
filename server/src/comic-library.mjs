import { createHash } from 'node:crypto'

// Existing production scripts created a separate source work for every episode.
const legacySeries = [
  { id: 'red-tide', title: '赤潮', matches: /^赤潮\s*·\s*(?:第[一二三四五六七八九十百\d]+话(?:\s*·\s*修订稿)?|守住最后一盏灯（平台模型版）)$/ },
  { id: 'rain-before-film', title: '雨停之前，底片未干', matches: /^雨停之前，底片未干\s*·\s*第\d+话$/ },
]

const chineseNumbers = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }
function episodeNumber(title) {
  const value = /第([一二三四五六七八九十百\d]+)话/.exec(title)?.[1]
  if (!value) return /守住最后一盏灯（平台模型版）/.test(title) ? 1 : null
  if (/^\d+$/.test(value)) return Number(value)
  const parts = value.split('十')
  if (parts.length === 2) return (chineseNumbers[parts[0]] || 1) * 10 + (chineseNumbers[parts[1]] || 0)
  return chineseNumbers[value] || null
}

export function comicSeries(episodes, namespace = 'local') {
  const groups = new Map()
  for (const episode of episodes) {
    const legacy = legacySeries.find(series => series.matches.test(episode.title))
    const key = `${episode.ownerId || ''}:${episode.seriesId || legacy?.id || episode.workId || episode.id}`
    const id = episode.seriesId && namespace === 'local' ? episode.seriesId : `comic-series-${createHash('sha256').update(`${namespace}:${key}`).digest('hex').slice(0, 16)}`
    const existing = groups.get(id)
    if (existing) existing.episodes.push(episode)
    else groups.set(id, { id, title: episode.seriesTitle || legacy?.title || episode.workTitle || episode.title, coverUrl: episode.coverUrl, latestEpisodeId: episode.id, episodes: [episode] })
  }
  return [...groups.values()].map(series => {
    const order = episode => episode.episodeNumber || episodeNumber(episode.title) || Number.MAX_SAFE_INTEGER
    const sorted = [...series.episodes].sort((a, b) => order(a) - order(b) || a.id.localeCompare(b.id))
      .map((episode, index) => ({ ...episode, episodeNumber: episode.episodeNumber || episodeNumber(episode.title) || index + 1 }))
    return { ...series, coverUrl: sorted[0]?.coverUrl || series.coverUrl, latestEpisodeId: sorted.at(-1)?.id || series.latestEpisodeId, episodeCount: sorted.length, panelCount: sorted.reduce((sum, episode) => sum + episode.panelCount, 0), episodes: sorted }
  })
}

export function createPublicComicSources(raw, fetchTransport = fetch) {
  const sources = raw ? JSON.parse(raw) : []
  if (!Array.isArray(sources) || sources.length > 8) throw new Error('COMIC_PUBLIC_SOURCES must be an array of up to 8 API origins')
  const configured = [...new Set(sources)].map(origin => {
    const parsed = new URL(origin)
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) throw new Error('Invalid public comic API origin')
    return { origin: parsed.origin, key: createHash('sha256').update(parsed.origin).digest('hex').slice(0, 12) }
  })
  const remoteId = (source, id) => `remote_${source.key}_${id}`
  const resolve = id => {
    const matched = /^remote_([a-f0-9]{12})_([a-zA-Z0-9-]+)$/.exec(id)
    const source = matched && configured.find(item => item.key === matched[1])
    return source ? { source, id: matched[2] } : null
  }
  async function readJson(source, path) {
    const response = await fetchTransport(`${source.origin}${path}`, { signal: AbortSignal.timeout(10000), redirect: 'error' })
    if (!response.ok) { const error = new Error('漫画来源暂时无法连接'); error.status = response.status; throw error }
    const bytes = await readBoundedComicBody(response, 2 * 1024 * 1024)
    return JSON.parse(bytes.toString('utf8'))
  }
  let cache, expiresAt = 0, pending
  const lastGoodBySource = new Map()
  async function list(force = false) {
    if (!force && cache && expiresAt > Date.now()) return cache
    if (!force && pending) return pending
    const operation = (async () => {
      const results = await Promise.allSettled(configured.map(async source => {
        const payload = await readJson(source, '/api/comics')
        if (!Array.isArray(payload.items) || payload.items.length > 1000) throw new Error('Invalid comic catalog')
        const episodes = payload.items.map(item => {
          if (!/^[a-zA-Z0-9-]+$/.test(item.id) || typeof item.title !== 'string' || item.title.length > 120 || !Number.isInteger(item.panelCount) || item.panelCount < 1 || item.panelCount > 60) throw new Error('Invalid comic entry')
          if (item.seriesId != null && (typeof item.seriesId !== 'string' || item.seriesId.length > 120 || !/^[a-zA-Z0-9_-]+$/.test(item.seriesId))) throw new Error('Invalid comic series')
          if (item.seriesTitle != null && (typeof item.seriesTitle !== 'string' || item.seriesTitle.length > 120)) throw new Error('Invalid comic series')
          if (item.episodeNumber != null && (!Number.isInteger(item.episodeNumber) || item.episodeNumber < 1 || item.episodeNumber > 100000)) throw new Error('Invalid comic episode number')
          const mediaId = /^\/api\/comic-media\/([a-zA-Z0-9-]+)$/.exec(item.coverUrl || '')?.[1]
          return { id: remoteId(source, item.id), title: item.title, seriesId: item.seriesId, seriesTitle: item.seriesTitle, episodeNumber: item.episodeNumber, panelCount: item.panelCount, coverUrl: mediaId ? `/api/comic-media/${remoteId(source, mediaId)}` : '' }
        })
        const series = comicSeries(episodes, source.key)
        lastGoodBySource.set(source.key, series)
        return series
      }))
      if (results.every(result => result.status === 'rejected') && configured.length && !configured.some(source => lastGoodBySource.has(source.key))) throw new Error('漫画来源暂时无法连接')
      const items = results.flatMap((result, index) => result.status === 'fulfilled' ? result.value : lastGoodBySource.get(configured[index].key) || [])
      const partial = results.some(result => result.status === 'rejected')
      const result = { items, partial }
      if (!partial) { cache = result; expiresAt = Date.now() + 15000 }
      return result
    })()
    pending = operation
    try { return await operation } finally { if (pending === operation) pending = null }
  }
  async function episode(id) {
    const target = resolve(id)
    if (!target) return null
    const payload = await readJson(target.source, `/api/comics/${encodeURIComponent(target.id)}`)
    const value = payload.episode
    if (!value || value.id !== target.id || typeof value.title !== 'string' || value.title.length > 120 || !Number.isInteger(value.version) || !Array.isArray(value.panels) || !value.panels.length || value.panels.length > 60) throw new Error('Invalid comic snapshot')
    const panels = value.panels.map(panel => {
      if (!panel || !/^[a-zA-Z0-9-]+$/.test(panel.id) || !/^[a-zA-Z0-9-]+$/.test(panel.imageId) || typeof panel.narration !== 'string' || panel.narration.length > 1000 || typeof panel.dialogue !== 'string' || panel.dialogue.length > 1000) throw new Error('Invalid comic panel')
      const dimensions = {}
      for (const key of ['imageWidth', 'imageHeight']) if (panel[key] !== undefined) {
        if (!Number.isInteger(panel[key]) || panel[key] < 1 || panel[key] > 20000) throw new Error('Invalid comic image dimensions')
        dimensions[key] = panel[key]
      }
      return { id: panel.id, narration: panel.narration, dialogue: panel.dialogue, imageId: remoteId(target.source, panel.imageId), ...dimensions }
    })
    let membership = {}
    try {
      const series = (await list()).items.find(item => item.episodes.some(episode => episode.id === id))
      const episode = series?.episodes.find(item => item.id === id)
      if (series && episode) membership = { seriesId: series.id, seriesTitle: series.title, episodeNumber: episode.episodeNumber }
    } catch { /* The shared episode remains readable if the directory is unavailable. */ }
    return { episode: { id, title: value.title, version: value.version, ...membership, panels } }
  }
  async function media(id) {
    const target = resolve(id)
    if (!target) return null
    return fetchTransport(`${target.source.origin}/api/comic-media/${encodeURIComponent(target.id)}`, { signal: AbortSignal.timeout(15000), redirect: 'error' })
  }
  return { enabled: configured.length > 0, list, episode, media, resolves: id => !!resolve(id) }
}

export async function readBoundedComicBody(response, limit) {
  const chunks = []; let size = 0
  for await (const chunk of response.body) {
    size += chunk.byteLength
    if (size > limit) throw new Error('Comic response is too large')
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}
