---
title: "05 · 已跑测试与可恢复实验"
sidebar:
  order: 5
---

> **阅读版本：** 本课程含本地未提交修改，请先查看[源码版本与远端差异](../../../source-version/)。


> **学完能做什么：** 完成一个中文边界测试，并列出登录、权限与部署的真实保护范围。

## 必要概念

回归测试（regression test）把已知边界固化为可重复断言；测试通过仅对这些断言与环境负责。

## 安全矩阵

| 主题 | 状态 | 范围与局限 |
| --- | --- | --- |
| 登录与身份 | 已发现实现 | Bearer、会话环境绑定、服务端 requireUser，开发/微信两分支 |
| 角色与所有权 | 已发现部分实现 | requireWorkOwner 用于创作设定，任务查询限定 owner；不能推广到每个路由 |
| 输入校验 | 已发现并局部实测 | 字节上限、对象 JSON、进度/章节约束 |
| SQL 注入 | 已发现实现 | 所读书架/进度/回执使用绑定参数 |
| 幂等 | 已发现实现 | 显式 key、请求哈希与回执事务；不是全局所有写请求保证 |
| 密码、XSS、CSRF、CORS、上传 | 尚未完整专项审计 | 小程序与 Web 管理端的威胁模型不同，不能互相替代 |
| 密钥、TLS、对象存储 | 依赖部署配置 | 正式微信与模型/存储配置未验证 |
| 建议补充 | 建议 | 书架对象可见性、全部角色矩阵、异步作业重复执行测试 |

## 已执行

复制 request-body、idempotency 和两份测试到独立实验目录，运行：

```sh
node --experimental-sqlite --test server/test/request-body.test.mjs server/test/idempotency-concurrency.test.mjs
```

**14 项通过**。包含中文与补充平面字符所有切分位置、单字节块、精确字节上限、非对象 JSON、维护切换，以及两个 SQLite 连接的写者竞争和异常回滚。没有调用微信、模型或生产数据库。不是完整小程序 E2E 验证。

## 实验：扩展中文边界用例

1. 在副本 request-body.test.mjs 的 expected 增加含中文、emoji 和换行的嵌套字段。
2. 保留按所有字节 split 位置切开的循环，运行上述命令，预期解析结果与 expected 深相等。
3. 仅在副本把 decoder 改成逐块 toString，预期部分中文边界失败；据此解释 bug。
4. 恢复 decoder，再跑一次应通过。恢复整个副本改动即可，不动原源码。

## 实验：重放冲突

用内存 SQLite 建 users/counter 表，createIdempotency 返回的函数使用固定合成 key。调用两次相同输入，断言 counter 只加一次、结果一致；同 key 改输入或 path，应抛 409，counter 不变。operation 抛异常则计数与回执都回滚。该扩展实验是参考步骤，本次未声称其已执行。

## 排错和维护

先区分微信网络域名问题、401、业务 400/409 与模型作业失败，再按请求路径查 server/test 对应用例。写入竞争需检查事务/忙碌超时而不是无限重试。发布前仍需真实开发者工具、设备、正式登录和完整服务验证；这里交付的教程自身可纯静态部署，原项目当然仍需后端。

## 源码定位

- [request body tests · server/test/request-body.test.mjs:1–33](../../../evidence/teat-test/)
- [createJsonBodyReader · server/src/request-body.mjs:3–30](../../../evidence/teat-body/)
- [createIdempotency · server/src/idempotency.mjs:3–38](../../../evidence/teat-idempotency/)
- [userFromRequest / requireUser / requireWorkOwner · server/src/server.mjs:311–327](../../../evidence/teat-auth/)
- [creative-settings · server/src/server.mjs:691–704](../../../evidence/teat-settings/)
- [shelfMatch / me shelf · server/src/server.mjs:1044–1048](../../../evidence/teat-shelf/)

## 常见误区

14 项测试通过就认定整套微信支付、漫画生成、对象存储已经可上线。

## 自检

哪项测试最直接证明改成 chunk.toString 会坏？

<details>
<summary>展开参考思路</summary>

遍历所有字节分割位置且包含中文/emoji 的深相等断言。

</details>
