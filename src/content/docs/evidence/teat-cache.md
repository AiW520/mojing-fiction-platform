---
title: "teat-cache · responseCache / cacheEpoch"
---

> **版本核对：** 本地文件存在差异。本页行号对应已审阅的本地快照。 引用片段与远端一致：[固定提交源码](https://github.com/AiW520/mojing-fiction-platform/blob/ec4fa9c01417c37cfd8cad05de74707d70c92401/miniprogram/utils/api.ts#L59-L84)（远端行 59–84；私有仓库需要访问权限）。


## 结论

GET 可复用在途请求，写入清缓存；未知网络失败保留显式幂等回执。

## 源码定位

- 项目：`teat1`
- 相对路径：`miniprogram/utils/api.ts`
- 符号：`responseCache / cacheEpoch`
- 行号：59–84
- 文件 SHA-256：`1629800acc21e98de08de4d75a22e29ea1906c5d30fbb9f5e00ece9cd3efa971`

工作区可能有未提交修改；以本页文件哈希为精确依据。提交版本和范围见[覆盖报告](../../coverage/)。

## 核对片段

以下是已审阅的必要片段，不包含完整文件。代码仅作为文本展示。起始行：59。

````ts
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
````
