---
title: "03 · 书架读取、加入与移除"
sidebar:
  order: 3
---

> **阅读版本：** 本课程含本地未提交修改，请先查看[源码版本与远端差异](../../../source-version/)。


> **学完能做什么：** 从三个真实操作核对方法、身份、SQL 和界面变化。

## 必要概念

乐观更新（optimistic update）先改界面再等服务端；本课收藏按钮采用等待成功后更新，失败时保留原状态。

## 一：读取个人书架

用户进入书架 → shelf/index.ts 的加载函数 → ensureSession → Promise.all 请求 `GET /api/me/shelf` 与漫画书架，noCache=true → request 根据当前环境附加 Bearer → server 的 requireUser → bookshelves JOIN works，LEFT JOIN reading_progress 并限定 user_id → HTTP 200 `{ "items":[] }`（合成空列表）→ 页面整理两类作品并 setData。

noCache 表示主动重新拉取，不能把旧本地缓存当最终书架。小说和漫画并行，漫画响应 partial 会主动抛错；catch 若有当前用户缓存就显示离线书架，否则显示错误。alive 和 userId 检查阻止卸载或切账号后的旧响应更新。未登录最终返回 401；首次 401 可触发一次重登。

## 二：加入书架

详情页 toggleShelf 检查 shelfBusy/loading/error/canParticipate → ensureSession → `POST /api/works/demo-work/shelf`，JSON `{}`，Bearer → requireUser → INSERT OR IGNORE INTO bookshelves(user_id,work_id) → HTTP 201 `{ "inShelf":true }` → setData({inShelf:true})，toast“已加入书架”，finally 清除 busy。

这条前端调用没有显式 idempotent=true，重复关系处理主要来自 SQLite 插入约束，不能归功于通用操作回执。服务端所读 shelf POST 片段没有像 reading-progress 一样显式检查作品发布状态；需要沿外键和其它路由守卫进一步核对，不能仅凭前端 canParticipate 宣称服务端对象可见性保护完整。

## 三：移出书架

同一按钮 inShelf=true → next=false → `DELETE /api/works/demo-work/shelf` → requireUser → DELETE WHERE user_id=? AND work_id=? → HTTP 200 `{ "inShelf":false }` → setData(false)，toast“已移出书架”。与 StoryForge 的 204 无正文不同。

请求异常会显示 error.message，按钮状态保持原值。两种写请求都会清 GET 缓存；网络超时只说明没有收到结果，不能证明数据库没有变化，应重新获取书架确认。

## 请求/响应安全

所有 demo 编号与响应均为合成说明，不包含实际用户。认证头仅写 `Authorization: Bearer REDACTED`。不要在教程示例中复制开发固定账号到生产认证方案。

## 源码定位

- [shelf · load · miniprogram/pages/shelf/index.ts:21–43](../../../evidence/teat-front-shelf/)
- [request · miniprogram/utils/api.ts:15–57](../../../evidence/teat-request/)
- [ensureSession · miniprogram/utils/api.ts:91–109](../../../evidence/teat-login/)
- [shelfMatch / me shelf · server/src/server.mjs:1044–1048](../../../evidence/teat-shelf/)
- [toggleShelf · miniprogram/pages/book/detail.ts:65–67](../../../evidence/teat-toggle/)
- [responseCache / cacheEpoch · miniprogram/utils/api.ts:59–84](../../../evidence/teat-cache/)

## 常见误区

其他接口有作品归属检查，就推断这个书架入口也一定执行了同样检查。

## 自检

移除请求超时后，按钮仍显示已收藏，怎样确认事实？

<details>
<summary>展开参考思路</summary>

重新 GET 书架状态；超时是结果未知，不能直接推断删除失败。

</details>
