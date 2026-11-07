---
title: "01 · 本地运行与测试数据边界"
sidebar:
  order: 1
---

> **阅读版本：** 本课程含本地未提交修改，请先查看[源码版本与远端差异](../../../source-version/)。


> **学完能做什么：** 准备独立服务与小程序开发环境，并识别开发登录的限制。

## 必要概念

Bearer 认证在请求头显式携带访问令牌；环境隔离要求开发与正式服务器不能共用缓存会话。

## 工具与入口

微信开发者工具负责小程序预览，TypeScript/WXML 源码位于 miniprogram。server/package.json 为原生 Node ESM 服务，dev/start 使用 `node --experimental-sqlite src/server.mjs`，所以 Node 必须支持 node:sqlite。本次 Node 22.18 已执行隔离基础测试，仍有 SQLite 实验性特性提示。

## 参考启动（完整小程序未实测）

复制源码到新目录，排除数据库、媒体、日志、私有项目配置与 .env；新建测试配置，不复制微信/模型/对象存储密钥。

```sh
cd server
npm ci
npm run dev
```

有锁文件时优先 npm ci；若副本只有包清单，先明确生成锁文件再安装。启动前阅读 server/src/server.mjs 的路径配置，将数据库和媒体全部指向实验目录。用根 scripts/build-miniprogram.mjs 的构建流程及开发者工具导入该副本，miniprogram/config 按实际配置选择本地 API。

开发登录分支使用 `/api/auth/dev-login`；生产中该入口禁用。微信登录先 wx.login 获取 code，再 `/api/auth/wechat` 交换。服务端缺少微信配置时返回不可用；不能把开发登录成功写成正式微信认证已验证。

## 预期与停止

先检查健康入口，再以纯合成作品/用户测试公开详情和书架。公开阅读不应强依赖登录；书架必须先取得会话。开发者工具的合法域名/HTTPS规则需要按环境配置，不应长期关闭安全校验。

停止服务使用 Ctrl+C，关闭开发者工具预览；只清理本次实验目录。15 秒网络超时、401 自动重登一次、503 维护提示都有不同含义。生成、支付、OSS 和生产部署未执行验证，不提供“开箱即用线上成功”的保证。

## 源码定位

- [ensureSession · miniprogram/utils/api.ts:91–109](../../../evidence/teat-login/)
- [request · miniprogram/utils/api.ts:15–57](../../../evidence/teat-request/)
- [createJsonBodyReader · server/src/request-body.mjs:3–30](../../../evidence/teat-body/)

## 常见误区

开发者工具里不校验域名能通，就表示上线后的域名和证书也正确。

## 自检

401 后为什么只重试一次？

<details>
<summary>展开参考思路</summary>

避免凭据始终无效时无限登录/重放，同时让最终错误回到页面。

</details>
