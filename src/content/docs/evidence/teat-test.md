---
title: "teat-test · request body tests"
---

> **版本核对：** 仅在本地快照发现。本页行号对应已审阅的本地快照。


## 结论

测试覆盖每个 UTF-8 分割边界、单字节块、大小边界和非对象 JSON。

## 源码定位

- 项目：`teat1`
- 相对路径：`server/test/request-body.test.mjs`
- 符号：`request body tests`
- 行号：1–33
- 文件 SHA-256：`268ccbfb60ecb77207a50a7bfa2be294b152a7246eb4d8a3b0bc39dfbe353436`

工作区可能有未提交修改；以本页文件哈希为精确依据。提交版本和范围见[覆盖报告](../../coverage/)。

## 核对片段

以下是已审阅的必要片段，不包含完整文件。代码仅作为文本展示。起始行：1。

````js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createJsonBodyReader } from '../src/request-body.mjs'

class HttpError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code }
}
const readBody = createJsonBodyReader({ HttpError, mediaWriteBlocked: () => false })
async function* chunks(parts) { yield* parts }
const expected = { prompt: '没有露骨伤口；顾原胸口紧贴岩壁。🧗‍♂️', panels: [{ imageId: 'retained-original', narration: '保留原图' }] }
const encoded = Buffer.from(JSON.stringify(expected))

test('all byte boundaries preserve Chinese, supplementary characters and untouched image fields', async () => {
  for (let split = 1; split < encoded.length; split++) {
    assert.deepEqual(await readBody(chunks([encoded.subarray(0, split), encoded.subarray(split)])), expected, `split at byte ${split}`)
  }
})
test('one-byte HTTP chunks preserve the entire JSON object', async () => {
  assert.deepEqual(await readBody(chunks(Array.from(encoded, byte => Buffer.from([byte])))), expected)
})
test('limit counts encoded bytes and permits exactly the limit', async () => {
  assert.deepEqual(await readBody(chunks([encoded]), encoded.length), expected)
  await assert.rejects(readBody(chunks([encoded.subarray(0, 7), encoded.subarray(7)]), encoded.length - 1), { status: 413, code: 'BODY_TOO_LARGE' })
})
test('empty input remains an empty object', async () => {
  assert.deepEqual(await readBody(chunks([])), {})
})
for (const raw of ['{', 'null', '[]', '1', 'true', '"字符串"', ' ']) test(`invalid JSON object is rejected: ${raw}`, async () => {
  await assert.rejects(readBody(chunks([Buffer.from(raw)])), { status: 400, code: 'INVALID_JSON' })
})
test('maintenance blocks reading before consuming input', async () => {
  let consumed = false
  const reader = createJsonBodyReader({ HttpError, mediaWriteBlocked: () => true })
````
