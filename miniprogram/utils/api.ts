import { getEnvironment } from '../config'

type Session = { token: string; expiresAt: string; userId: string; role: string; name: string }
type LoginPayload = { token: string; expiresAt: string; user: { id: string; name: string; roles: string[] } }
let loginPromise: Promise<Session> | null = null
const pendingRequests = new Map<string, Promise<unknown>>()
const responseCache = new Map<string, { expiresAt: number; value: unknown }>()
let cacheEpoch = 0

type RequestOptions = Record<string, any> & { cacheTtl?: number; noCache?: boolean; sessionRetried?: boolean; idempotencyKey?: string; idempotent?: boolean; idempotencyScope?: string }
export class ApiError extends Error {
  constructor(message: string, public status = 0, public code = 'NETWORK_ERROR') { super(message) }
}

export function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let config: ReturnType<typeof getEnvironment>
  try { config = getEnvironment() } catch (error) { return Promise.reject(error) }
  const apiBase = config.apiBase
  const method = String(options.method || 'GET').toUpperCase() as WechatMiniprogram.RequestOption['method']
  const cacheTtl = Number(options.cacheTtl || 0)
  const epoch = cacheEpoch
  const session = wx.getStorageSync('mojing_session') || {}
  const receiptKey = `mojing_pending_writes_${encodeURIComponent(apiBase)}_${session.userId || 'anonymous'}`
  const operation = JSON.stringify([path, options.data || null, options.idempotencyScope || ''])
  if (options.idempotent && !options.idempotencyKey) {
    try {
      const receipts = wx.getStorageSync(receiptKey) || {}
      const key = receipts[operation] || createIdempotencyKey('write')
      if (!receipts[operation]) wx.setStorageSync(receiptKey, { ...receipts, [operation]: key })
      options = { ...options, idempotencyKey: key }
    } catch { return Promise.reject(new ApiError('本机存储不可用，请清理空间后再提交', 0, 'LOCAL_STORAGE_UNAVAILABLE')) }
  }
  const header = { 'content-type': 'application/json', ...(options.header || {}) } as Record<string, string>
  if (session.token && session.environment === `${apiBase}:${config.auth}`) header.Authorization = `Bearer ${session.token}`
  if (options.idempotencyKey) header['Idempotency-Key'] = options.idempotencyKey
  const cacheKey = JSON.stringify([apiBase, config.auth, method, path, header, options.data || null])
  if (method === 'GET' && !options.noCache) {
    const cached = responseCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) return Promise.resolve(JSON.parse(JSON.stringify(cached.value)) as T)
    const pending = pendingRequests.get(cacheKey)
    if (pending) return pending as Promise<T>
  }
  const promise = new Promise<T>((resolve, reject) => {
    const requestOptions = { ...options }
    delete requestOptions.cacheTtl
    delete requestOptions.noCache
    delete requestOptions.sessionRetried
    delete requestOptions.idempotencyKey
    delete requestOptions.idempotent
    delete requestOptions.idempotencyScope
    wx.request({ timeout: 15000, ...requestOptions, method, url: `${apiBase}${path}`, header, success: (response: any) => {
      if ((response.statusCode || 500) >= 200 && (response.statusCode || 500) < 300) resolve(response.data as T)
      else if (response.statusCode === 401 && !path.startsWith('/api/auth/') && !options.sessionRetried) {
        wx.removeStorageSync('mojing_session')
        ensureSession().then(() => request<T>(path, { ...options, sessionRetried: true, noCache: true })).then(resolve, reject)
      } else reject(new ApiError(response.data?.error?.message || `请求失败（${response.statusCode}）`, response.statusCode, response.data?.error?.code))
    }, fail: (error: { errMsg?: string }) => reject(new ApiError(error.errMsg?.includes('timeout') ? '连接超时，请重试' : '暂时无法连接服务，请检查网络后重试')) })
  })
  if (method === 'GET') {
    pendingRequests.set(cacheKey, promise)
    promise.then(value => {
      if (cacheTtl > 0 && epoch === cacheEpoch) {
        if (responseCache.size >= 40) responseCache.delete(responseCache.keys().next().value!)
        responseCache.set(cacheKey, { expiresAt: Date.now() + cacheTtl, value: JSON.parse(JSON.stringify(value)) })
      }
    }, () => undefined).finally(() => { if (pendingRequests.get(cacheKey) === promise) pendingRequests.delete(cacheKey) })
  } else {
    clearRequestCache()
    if (options.idempotent) {
      const clearReceipt = () => {
        try {
          const receipts = wx.getStorageSync(receiptKey) || {}
          if (receipts[operation] !== options.idempotencyKey) return
          delete receipts[operation]
          wx.setStorageSync(receiptKey, receipts)
        } catch { /* Keep the receipt when device storage is unavailable. */ }
      }
      promise.then(clearReceipt, error => { if (error.status >= 400 && error.status < 500) clearReceipt() })
    }
  }
  return promise
}

export function clearRequestCache() { cacheEpoch++; responseCache.clear(); pendingRequests.clear() }

export function createIdempotencyKey(prefix = 'op'): string {
  const random = Math.random().toString(36).slice(2)
  return `${prefix}_${Date.now().toString(36)}_${random}`.slice(0, 100)
}

export function ensureSession(): Promise<Session> {
  const config = getEnvironment()
  const current = wx.getStorageSync('mojing_session')
  const key = `${config.apiBase}:${config.auth}`
  if (current?.token && current.environment === key && Date.parse(current.expiresAt) > Date.now() + 60000) return Promise.resolve(current)
  if (loginPromise) return loginPromise
  loginPromise = (async () => {
    const payload = config.auth === 'development'
      ? await request<LoginPayload>('/api/auth/dev-login', { method: 'POST', data: { account: 'wechat:1001' } })
      : await new Promise<string>((resolve, reject) => wx.login({ success: result => result.code ? resolve(result.code) : reject(new Error('微信登录失败')), fail: reject }))
        .then(code => request<LoginPayload>('/api/auth/wechat', { method: 'POST', data: { code } }))
    const session = { token: payload.token, expiresAt: payload.expiresAt, userId: payload.user.id,
      role: payload.user.roles.find(role => role !== 'user') || 'user', name: payload.user.name, environment: key }
    wx.setStorageSync('mojing_session', session)
    return session
  })().finally(() => { loginPromise = null })
  return loginPromise
}

export const ensureDevSession = ensureSession

export function openAdminWeb(section = '', episodeId = '') {
  const base = getEnvironment().adminUrl
  const url = base && section === 'comics' ? `${base.split('#')[0]}#comics${episodeId ? `?episodeId=${encodeURIComponent(episodeId)}` : ''}` : base
  if (!url) { wx.showToast({ title: '尚未配置管理台地址', icon: 'none' }); return }
  wx.setClipboardData({ data: url, success: () => wx.showModal({ title: section === 'comics' ? '漫画工作室' : '管理员后台', content: '管理台地址已复制，请在浏览器中打开。', showCancel: false }) })
}
