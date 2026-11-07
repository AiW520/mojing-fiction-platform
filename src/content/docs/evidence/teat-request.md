---
title: "teat-request · request"
---

> **版本核对：** 本地文件存在差异。本页行号对应已审阅的本地快照。 引用片段与远端一致：[固定提交源码](https://github.com/AiW520/mojing-fiction-platform/blob/ec4fa9c01417c37cfd8cad05de74707d70c92401/miniprogram/utils/api.ts#L15-L57)（远端行 15–57；私有仓库需要访问权限）。


## 结论

按环境和身份构造请求；幂等回执是显式 opt-in；401 最多重新登录重试一次。

## 源码定位

- 项目：`teat1`
- 相对路径：`miniprogram/utils/api.ts`
- 符号：`request`
- 行号：15–57
- 文件 SHA-256：`1629800acc21e98de08de4d75a22e29ea1906c5d30fbb9f5e00ece9cd3efa971`

工作区可能有未提交修改；以本页文件哈希为精确依据。提交版本和范围见[覆盖报告](../../coverage/)。

## 核对片段

以下是已审阅的必要片段，不包含完整文件。代码仅作为文本展示。起始行：15。

````ts
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
````
