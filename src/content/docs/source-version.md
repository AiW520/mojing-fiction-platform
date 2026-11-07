---
title: "源码版本与本地差异"
---

本课程依据已审阅的本地快照编写，包含未提交修改。远端仓库为 `AiW520/mojing-fiction-platform`，核对提交为 `ec4fa9c01417c37cfd8cad05de74707d70c92401`。**这不是远端 main 的无差异说明书。**

## 差异对学习的影响

本地快照与远端差异较大：本地详情页增加媒体缓存与布局适配，书架增加漫画与小说合并；server.mjs 引入独立 JSON 请求体读取器与媒体维护检查；idempotency.mjs 在没有幂等键时也使用 BEGIN IMMEDIATE 包裹变更以预留 SQLite 写者。课程讲解的中文分块请求体与无键事务实验属于本地快照，不能作为远端 main 已具备的能力。被引用的两个本地新增文件在核对的远端提交中未发现。

## 如何使用版本证据

先阅读真实流程，再进入证据页。标记“与远端文件一致”的条目可对照固定提交；文件有差异时，只在片段逐行唯一匹配后提供远端行号。其余实现只代表本地快照。哈希（SHA-256）是内容指纹，文件改动后指纹会变化。

| 被引用文件 | 核对结果 |
|---|---|
| `miniprogram/utils/api.ts` | 本地文件存在差异 |
| `miniprogram/pages/book/detail.ts` | 本地文件存在差异 |
| `server/src/server.mjs` | 本地文件存在差异 |
| `miniprogram/pages/shelf/index.ts` | 本地文件存在差异 |
| `server/src/request-body.mjs` | 仅在本地快照发现 |
| `server/src/idempotency.mjs` | 本地文件存在差异 |
| `server/test/request-body.test.mjs` | 仅在本地快照发现 |

## 本地版本

- `teat1`：提交 `fcd778d4ebe24ab92e5cf9e15645e09de5526bfe`；快照 `b51c046f04f1c66c7adc20d63d84adfff996cae1f62a153444b9fe7812da95b9`；未提交修改：True。

文件差异可能发生在引用片段之外；不能用“文件不同”推断所有流程都改变。教程的测试结果只属于注明的本地版本，不代表线上生产环境。

[逐文件哈希报告](/reports/remote-review.json) · [分析与验证](../coverage/)
