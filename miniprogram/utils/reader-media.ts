import { getEnvironment } from '../config'

type MediaEntry = { url: string; path: string; bytes: number }
const pending = new Map<string, Promise<string>>()
const maxBytes = 12 * 1024 * 1024

// Only public images are persisted; private creator downloads keep their own short cache.
export function cachedReaderMedia(url: string): Promise<string> {
  if (!/^https?:\/\//.test(url) || typeof wx.getFileSystemManager !== 'function' || typeof wx.getImageInfo !== 'function') return Promise.resolve(url)
  const indexKey = `mojing_public_media_${encodeURIComponent(getEnvironment().apiBase)}`
  const fs = wx.getFileSystemManager()
  let entries: MediaEntry[] = []
  try { entries = wx.getStorageSync(indexKey) || [] } catch { return Promise.resolve(url) }
  const cached = entries.find(item => item.url === url)
  if (cached) {
    try { fs.accessSync(cached.path); return Promise.resolve(cached.path) } catch { /* The OS may clear local files. */ }
  }
  const key = `${indexKey}:${url}`
  const existing = pending.get(key)
  if (existing) return existing
  const promise = new Promise<string>(resolve => wx.getImageInfo({ src: url, success: info => {
    let bytes = 0
    try { bytes = (fs.statSync(info.path) as WechatMiniprogram.Stats).size } catch { resolve(url); return }
    if (!bytes || bytes > maxBytes) { resolve(info.path); return }
    fs.saveFile({ tempFilePath: info.path, success: saved => {
      try {
        // Re-read after each download to avoid lost indexes when images finish together.
        entries = (wx.getStorageSync(indexKey) || []).filter((item: MediaEntry) => item.url !== url)
        entries.push({ url, path: saved.savedFilePath, bytes })
        let total = entries.reduce((sum, item) => sum + item.bytes, 0)
        while (entries.length > 24 || total > maxBytes) {
          const oldest = entries.shift()!
          total -= oldest.bytes
          try { fs.unlinkSync(oldest.path) } catch { /* Already removed. */ }
        }
        wx.setStorageSync(indexKey, entries)
        resolve(saved.savedFilePath)
      } catch { resolve(info.path) }
    }, fail: () => resolve(info.path) })
  }, fail: () => resolve(url) }))
  pending.set(key, promise)
  promise.finally(() => pending.delete(key))
  return promise
}
