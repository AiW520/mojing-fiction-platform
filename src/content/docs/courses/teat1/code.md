---
title: "04 · 精读 UTF-8、幂等和字段校验"
sidebar:
  order: 4
---

> **阅读版本：** 本课程含本地未提交修改，请先查看[源码版本与远端差异](../../../source-version/)。


> **学完能做什么：** 解释跨块中文为什么容易损坏，以及重放回执为何必须与业务同事务。

## 必要概念

UTF-8 用多个字节表示部分字符；网络 chunk（数据块）可以切在任意字节。StringDecoder 暂存不完整字符，等待后续数据。

## 请求体解析

createJsonBodyReader 返回 body(req,maxBytes)。调用前先检查存储维护状态；遍历异步数据块累计 Buffer.byteLength，超过限制返回 413；decoder.write/end 逐步拼出完整文本；接收完再检查维护状态。空请求体变 `{}`，其他 JSON 必须是非空对象且不能是数组，否则 400 INVALID_JSON。

若替换为每个 chunk.toString('utf8')，跨块的中文/emoji 会出现替换字符。限制必须按编码字节数而非字符串 length，两个单位不同。修改默认 1MB 上限还影响富文本和图片参数，不应只为大请求直接无限放开。

## 操作回执

createIdempotency 的输入为请求、用户、路径、输入和同步 operation。没有 key 也先 BEGIN IMMEDIATE，再执行业务并提交；有 key 时验证 12–100 位格式，JSON.stringify(input) 的 SHA-256 与路径共同校对历史回执。同键不同输入或路径 → 409；相同 → 返回已保存响应；新操作 → 业务变化和回执 INSERT 一起提交，异常 ROLLBACK。

JSON.stringify 不是语义规范化，同一对象字段顺序变化可能产生不同摘要。该帮助函数要求同步 operation，不能未经设计传入异步网络调用并期待事务等待。已有回执查询发生在 BEGIN IMMEDIATE 之前，多连接并发的全部竞争情况仍需额外测试；本次并发测试只覆盖无回执键时预留写者和回滚。

## 创作设定与阅读进度

creative-settings 先 requireWorkOwner，再检查可编辑状态，字符串 trim/slice 到各字段上限；illustrationsEnabled 必须 boolean。超长字符串是截断，不应教成统一 400。进度要求有限数字和章节属于作品，然后 progress 裁到 0–100、scrollRatio 裁到 0–1 后 upsert。改这些规则要同步 UI 范围和恢复阅读逻辑。

## 源码定位

- [createJsonBodyReader · server/src/request-body.mjs:3–30](../../../evidence/teat-body/)
- [createIdempotency · server/src/idempotency.mjs:3–38](../../../evidence/teat-idempotency/)
- [creative-settings · server/src/server.mjs:691–704](../../../evidence/teat-settings/)
- [progressMatch · server/src/server.mjs:1032–1042](../../../evidence/teat-progress/)

## 常见误区

JSON 字段相同就一定产生相同 JSON.stringify 哈希，或事务里包一个 Promise 就自动等到业务结束。

## 自检

为什么维护检查在读取前后各执行一次？

<details>
<summary>展开参考思路</summary>

读取过程中维护状态可能改变；开始时通过不能证明写入前仍可用。

</details>
