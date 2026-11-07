---
title: "02 · 多端入口、数据与状态"
sidebar:
  order: 2
---

> **阅读版本：** 本课程含本地未提交修改，请先查看[源码版本与远端差异](../../../source-version/)。


> **学完能做什么：** 解释浏览器/小程序状态和数据库状态分别由谁管理。

## 必要概念

缓存纪元（cache epoch）是用递增编号标记失效边界；旧请求即使后来返回，也不能把写操作之前的数据重新放进缓存。

## 主链路图

![小程序执行链](/diagrams/teat1.svg)

[单独查看图示（可缩放）](/diagrams/teat1.svg)

图中 Page 负责用户反馈，request 处理传输，server 处理权限与业务，SQLite 保存事实。setData 不会直接写数据库；服务端成功之后才更新书架按钮。

| 模块/技术 | 实际用途 | 协作边界 |
| --- | --- | --- |
| Page / WXML / TypeScript | 小程序详情、列表、事件处理 | setData 与 wx.showToast |
| wx.request / wx.login | HTTP 与微信登录码 | ensureSession 保存环境绑定的会话 |
| Node http / SQLite | 路由、参数绑定、事务 | server.mjs 调用独立业务模块 |
| request-body / idempotency | 字节边界、对象 JSON、重放回执 | 被具体写入路由显式采用 |
| admin-web / reader-web | 另两个 Web 入口 | 本次未逐页精读，不等同于小程序界面 |
| sharp / S3 / ali-oss 依赖 | 包清单中声明 | 本课未完整追踪其所有调用，不能据此认定任意上传已安全 |

## 数据关系

bookshelves 连接 user_id/work_id；reading_progress 以同一对键保存 block_id、progress、scroll_ratio。创作设定按 work_id 保存 JSON；generation_jobs 关联 owner_id/work_id，查询任务还限定所有者。client_operations 以 user_id/operation_key 复合主键保存 path、request_hash 和 response_json。

书架添加用 INSERT OR IGNORE，阅读进度用 ON CONFLICT UPDATE，幂等写使用 BEGIN IMMEDIATE 预先获得写者资格。SQLite WAL（Write-Ahead Logging，预写日志）能让读取与写入更好协作，但不代表多写者可以同时自由提交。

## 前端状态

GET 缓存键包含 API 环境、认证头、方法、路径和数据；最多 40 项缓存。写请求递增 cacheEpoch 并清除缓存/在途表。保存结果前比较 epoch，防止旧 GET 回填过期值。登录 Promise 复用减少并行登录；切环境先比较 environment 字段。

分析推测：单机 SQLite 降低部署成本，代价是写入竞争和多实例扩展限制；如果迁移到共享数据库，要重新实现事务与回执，不是把路径换成 URL。

## 源码定位

- [responseCache / cacheEpoch · miniprogram/utils/api.ts:59–84](../../../evidence/teat-cache/)
- [ensureSession · miniprogram/utils/api.ts:91–109](../../../evidence/teat-login/)
- [createIdempotency · server/src/idempotency.mjs:3–38](../../../evidence/teat-idempotency/)
- [progressMatch · server/src/server.mjs:1032–1042](../../../evidence/teat-progress/)
- [creative-settings · server/src/server.mjs:691–704](../../../evidence/teat-settings/)
- [userFromRequest / requireUser / requireWorkOwner · server/src/server.mjs:311–327](../../../evidence/teat-auth/)

## 常见误区

所有 POST 自动幂等。只有页面显式传 idempotent 且后端接入回执机制的操作才有对应保护。

## 自检

为什么清空缓存后还要比较 epoch？

<details>
<summary>展开参考思路</summary>

清空时旧请求可能尚未结束；它返回后若无 epoch 检查会重新缓存旧数据。

</details>
