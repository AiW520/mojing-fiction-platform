# 权限与人物图鉴 API 契约

所有写接口必须从服务端会话读取 `actorId` 和角色，不接受客户端传入角色。作品相关接口必须验证 `works.owner_id`；管理员接口必须验证 RBAC 权限并写入 `audit_logs`。

```text
GET    /api/works
GET    /api/works/:workId
GET    /api/works/:workId/assets
GET    /api/works/:workId/blocks
GET    /api/works/:workId/shelf
POST   /api/works/:workId/shelf
DELETE /api/works/:workId/shelf
GET    /api/works/:workId/reading-progress
POST   /api/works/:workId/reading-progress
POST   /api/works/:workId/text-jobs
GET    /api/generation-jobs/:jobId
GET    /api/me/shelf

GET    /api/works/:workId/characters?view=reader
GET    /api/works/:workId/characters?view=creator
POST   /api/works/:workId/characters
GET    /api/characters/:characterId
PATCH  /api/characters/:characterId
POST   /api/characters/:characterId/reference-images
GET    /api/works/:workId/character-relationships

GET    /admin-api/users
PATCH  /admin-api/users/:userId/roles
GET    /admin-api/moderation/queue
POST   /admin-api/moderation/:workId/approve
POST   /admin-api/moderation/:workId/reject
GET    /admin-api/audit-logs
GET    /admin-api/system/status
GET    /admin-api/models
POST   /admin-api/models
PUT    /admin-api/models/:modelId
POST   /admin-api/models/:modelId/test
```

读者请求不得返回 `private_profile`、未解锁关系、重大剧透字段或图片生成提示词。角色参考图生成任务必须携带 `workId`、`characterId`、`visualProfileVersion`、参考图资产 ID、禁止元素和审核策略。图片 API Key 只保存在服务端密钥管理系统中。

模型管理接口要求 `model.manage` 权限。供应商密钥使用 `MODEL_CONFIG_ENCRYPTION_KEY` 加密后写入本地 SQLite，列表接口只返回 `keyHint`，不会返回明文密钥。首次启动时如果存在 `TUZI_CODING_API_KEY`，会自动初始化 Tuzi 图片模型配置；之后可在独立管理台的“模型管理”页面修改、启停、设为默认或测试连接。

## 读者书评与讨论

```text
GET    /api/works/:workId/comments?kind=review|discussion&sort=latest|popular&offset=0&limit=10
POST   /api/works/:workId/comments
GET    /api/comments/:commentId/replies?offset=0
POST   /api/comments/:commentId/like
DELETE /api/comments/:commentId/like
POST   /api/comments/:commentId/report
DELETE /api/comments/:commentId
GET    /admin-api/comments?offset=0
POST   /admin-api/comments/:commentId/approve
POST   /admin-api/comments/:commentId/reject
```

只允许已发布作品参与讨论；GET 公开，写操作需要有效会话。发布体：`{ kind, content, rating?, parentId?, spoiler?, clientId }`，正文 1–1000 字，书评须为 1–5 整数星级。一个账号每部作品仅有一条有效书评（删除原书评可重发），回复不参与评分。每账号每分钟最多 5 条发言。`clientId` 是 8–80 位字母/数字/下划线/短横线的幂等凭据，同一发布重试须复用；账号、角色从服务端会话读取。

返回 `{ items, total, summary: { rating, ratings, reviews, discussions } }`；真实平均分只统计已审核主书评，空评分为 `null`。列表包含 `mine/liked/likes/replies/spoiler/status`，不返回账号和 OpenID。排序和分页范围固定，每页最多 20 条主题、10 条回复。仅允许一级回复且主题必须已发布；回复继承主题剧透标记。

`NODE_ENV=production` 新评论为 `pending`，仅本人可见；开发模式为 `published`。管理员需 `content.review` 权限处理审核／举报。举报体 `reason` 为 `spam/abuse/spoiler/other`，每人每条只能举报一次。点赞幂等且可取消；仅本人或内容审核员可删除，删除／驳回主题连带隐藏其回复。管理员操作写入审计。人工审核队列是基础治理，正式发布前仍需确认微信内容安全、隐私政策和运营审核流程。

存储表：`book_comments`、`book_comment_likes`、`book_comment_reports`。启动自动迁移已有数据库，不删除原有书库与进度。需要持久化磁盘和备份；多实例部署前替换共享数据库存储层。
