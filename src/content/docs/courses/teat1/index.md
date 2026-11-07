---
title: "00 · 模板名称背后的真实系统"
sidebar:
  order: 0
---

> **阅读版本：** 本课程含本地未提交修改，请先查看[源码版本与远端差异](../../source-version/)。


> **学完能做什么：** 辨认小程序、Web 管理端和后端的职责，找到最短学习路径。

## 必要概念

小程序（mini program）的 Page 使用 setData 把逻辑状态同步到视图；WXML 是模板语言，不能当作普通 React 组件执行。

## 项目定位

package.json 仍叫 miniprogram-ts-sass-quickstart，但实际源码包含阅读、小说/漫画书架、评论、创作设定、生成作业和管理工具。不能依据模板名称把它讲成空项目。主要用户是读者和内容创作者，后台管理员另有权限入口。

## 阅读路径

最短：总览 → 运行准备 → 书架三条流程 → UTF-8 实验。深入：Page/WXML → request/ensureSession → 路由授权 → SQLite 约束 → 请求体/幂等 → 生成队列与多端管理扩展。

先修：TypeScript 对象、Promise、HTTP 和 SQL。学完能解释用户点击收藏后有哪些状态变化，为什么切环境不能复用旧登录，以及怎样证明中文请求跨网络分块不会损坏。

## 版本提醒

工作区有未提交修改，commit 只能标识基线；本课精确定位以证据文件 SHA-256 为准。课程分析了小程序请求与书架、后端请求体/幂等、创作配置和进度边界；admin-web、reader-web、漫画生产、对象存储与模型计费没有全部逐页精读。

## 源码定位

- [request · miniprogram/utils/api.ts:15–57](../../evidence/teat-request/)
- [toggleShelf · miniprogram/pages/book/detail.ts:65–67](../../evidence/teat-toggle/)
- [shelfMatch / me shelf · server/src/server.mjs:1044–1048](../../evidence/teat-shelf/)
- [creative-settings · server/src/server.mjs:691–704](../../evidence/teat-settings/)

## 常见误区

看到 quickstart 名称就认定只有模板；或把小程序登录当成普通 Cookie 会话。

## 自检

为什么证据页同时要提交 SHA 和文件哈希？

<details>
<summary>展开参考思路</summary>

有未提交修改时当前文件不等于提交里的文件，哈希精确约束讲解对象。

</details>
