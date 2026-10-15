import { ensureSession } from './api'
import { getEnvironment } from '../config'
export type CreativeSettings = { genre?: string; mood?: string; protagonist?: string; world?: string; outline?: string; visualStyle?: string; illustrationsEnabled?: boolean }
export type CreativeWork = { id: string; title: string; summary: string; type: string; status: string; words: number; coverImage?: string; format?: string; chapterCount: number; characterCount?: number }
export type CreativeAsset = { id: string; blockId?: string; chapterId?: string; type: string; title: string; url: string; approvalStatus: string; displayUrl?: string; loadError?: boolean }
export type ModelAttempt = { modelId: string; name?: string; model: string; status: string; errorCode?: string; resultUnknown?: boolean }
export type TextReview = { status: string; stale?: boolean; score?: number; message?: string; model?: string; attempts?: ModelAttempt[]; issues?: Array<{ severity: string; type: string; location: string; reason: string; suggestion: string }> }
export type TextJobResult = { content?: string; review?: TextReview; attempts?: ModelAttempt[] }
export type CreativeJob = { id: string; type: string; status: string; errorCode?: string; materialKey?: string; result?: TextJobResult }
const mediaRequests = new Map<string, Promise<string>>()
const mediaFiles = new Map<string, { url: string; expiresAt: number }>()
export function creatorInsets() { const info = wx.getSystemInfoSync(); return { topInset: (info.statusBarHeight || 0) + 44 } }
// Authenticated downloads keep private image URLs and keys out of image components.
export async function creatorMedia(url: string): Promise<string> {
  if (!url || !url.startsWith('/api/assets/')) return url
  const session = await ensureSession()
  const key = `${getEnvironment().apiBase}:${session.userId}:${url}`
  const cached = mediaFiles.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.url
  const pending = mediaRequests.get(key)
  if (pending) return pending
  const promise = new Promise<string>((resolve, reject) => wx.downloadFile({ url: `${getEnvironment().apiBase}${url}`, header: { Authorization: `Bearer ${session.token}` }, success: result => result.statusCode === 200 ? resolve(result.tempFilePath) : reject(new Error('素材加载失败')), fail: () => reject(new Error('素材加载失败')) }))
  mediaRequests.set(key, promise)
  promise.then(file => {
    if (mediaFiles.size >= 24) mediaFiles.delete(mediaFiles.keys().next().value!)
    mediaFiles.set(key, { url: file, expiresAt: Date.now() + 30000 })
  }, () => undefined).finally(() => { if (mediaRequests.get(key) === promise) mediaRequests.delete(key) })
  return promise
}
export async function displayAssets(items: CreativeAsset[]) { return Promise.all(items.map(async item => { try { return { ...item, displayUrl: await creatorMedia(item.url), loadError: false } } catch { return { ...item, displayUrl: '', loadError: true } } })) }
