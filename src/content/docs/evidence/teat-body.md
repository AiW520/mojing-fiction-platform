---
title: "teat-body · createJsonBodyReader"
---

> **版本核对：** 仅在本地快照发现。本页行号对应已审阅的本地快照。


## 结论

按字节限制体积，StringDecoder 保留跨块 UTF-8，JSON 只接受对象并双重检查维护状态。

## 源码定位

- 项目：`teat1`
- 相对路径：`server/src/request-body.mjs`
- 符号：`createJsonBodyReader`
- 行号：3–30
- 文件 SHA-256：`ad4bcb13787b96c0b5e58abd630d8e0daa72266a31ec0040fdaa56825df9f618`

工作区可能有未提交修改；以本页文件哈希为精确依据。提交版本和范围见[覆盖报告](../../coverage/)。

## 核对片段

以下是已审阅的必要片段，不包含完整文件。代码仅作为文本展示。起始行：3。

````js
export function createJsonBodyReader({ HttpError, mediaWriteBlocked }) {
  return async function body(req, maxBytes = 1024 * 1024) {
    const assertAvailable = () => {
      if (mediaWriteBlocked(req)) throw new HttpError(503, 'MEDIA_MAINTENANCE', '素材存储正在维护，请稍后重试')
    }
    assertAvailable()
    const decoder = new StringDecoder('utf8')
    let raw = ''
    let bytes = 0
    for await (const chunk of req) {
      bytes += Buffer.byteLength(chunk)
      if (bytes > maxBytes) throw new HttpError(413, 'BODY_TOO_LARGE', `请求体超过${Math.round(maxBytes / 1024 / 1024)}MB`)
      // A UTF-8 character may span multiple HTTP chunks. Keep its partial bytes
      // until the following chunk rather than decoding each Buffer separately.
      raw += decoder.write(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
    }
    raw += decoder.end()
    assertAvailable()
    if (!raw) return {}
    try {
      const value = JSON.parse(raw)
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid')
      return value
    } catch {
      throw new HttpError(400, 'INVALID_JSON', '请求体不是有效 JSON 对象')
    }
  }
}
````
