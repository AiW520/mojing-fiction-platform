import { getEnvironment } from '../config'

type CacheEntry = { key: string; bytes: number }
const prefix = 'mojing_reader_v1_'
const maxBytes = 2 * 1024 * 1024
const maxEntries = 36

function namespace() { return encodeURIComponent(getEnvironment().apiBase) }

export function readReaderCache<T>(id: string): T | undefined {
  try { return wx.getStorageSync(`${prefix}${namespace()}_${id}`) || undefined } catch { return undefined }
}

// Cache only published content; bounded eviction leaves space for positions and sessions.
export function writeReaderCache(id: string, payload: unknown) {
  try {
    const scope = namespace()
    const key = `${prefix}${scope}_${id}`
    const indexKey = `${prefix}${scope}_index`
    const bytes = encodeURIComponent(JSON.stringify(payload)).length
    if (bytes > maxBytes) return
    const entries: CacheEntry[] = (wx.getStorageSync(indexKey) || []).filter((entry: CacheEntry) => entry.key !== key)
    entries.push({ key, bytes })
    let total = entries.reduce((sum, entry) => sum + entry.bytes, 0)
    while (entries.length > maxEntries || total > maxBytes) {
      const oldest = entries.shift()!
      total -= oldest.bytes
      wx.removeStorageSync(oldest.key)
    }
    wx.setStorageSync(indexKey, entries)
    wx.setStorageSync(key, payload)
  } catch { /* Storage exhaustion must not interrupt fetched content. */ }
}
