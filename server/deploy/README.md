# 墨境服务部署

现有服务可以直接部署到一台带 HTTPS 反向代理的 Linux 服务器，不要求微信云开发。SQLite 数据目录必须挂载到持久化磁盘；同一时间只运行一个 API 容器。需要多实例、自动扩容或跨地域时，再把 SQLite 迁移到 PostgreSQL，并把图片结果放到对象存储。

## 单机部署

完整部署也可以在仓库根目录使用 `docker compose up -d --build`。`server/.env` 需要配置 `API_DOMAIN`、`ADMIN_DOMAIN`、`CORS_ORIGIN` 和其他生产变量。将两个域名 A 记录解析到服务器，放行 80/443，Caddy 会申请 HTTPS 证书；管理台与 API 自动使用同源代理。不要启动多个 API 副本。

1. 复制 `.env.production.example` 为 `.env`，填入微信 AppSecret、模型供应商密钥（默认配置可使用 Tuzi Key）、加密密钥和管理员密码。密钥只放服务器环境变量，不放小程序代码。
2. 在服务器执行：

```text
docker build -t mojing-server ./server
docker run -d --name mojing-server --restart unless-stopped \
  --env-file server/.env \
  -p 127.0.0.1:3000:3000 \
  -v mojing-data:/app/data \
  mojing-server
```

3. 用 Nginx、Caddy 或云负载均衡把 `https://api.example.com` 转发到 `127.0.0.1:3000`，并放行 `/api/*`、`/admin-api/*`。先访问 `/api/health`，再把公开的 API 和管理台 HTTPS 地址填入 `miniprogram/deployment.json` 的 `trial` 和 `release`。该文件不能包含密钥。
4. 在微信公众平台的“服务器域名”中加入 API HTTPS 域名。管理台独立在浏览器访问；只有以后使用小程序 web-view 展示管理台，才需要额外配置业务域名。大陆服务器通常需要完成域名备案，正式发布还需满足小程序类目、隐私和内容合规要求。开发版才使用本机地址。

## 发布前检查

- `NODE_ENV=production` 会强制关闭开发登录，只接受 `/api/auth/wechat`。
- `CORS_ORIGIN` 只填写管理台的 HTTPS 来源，不要在生产环境使用 `*`。
- 每天使用 SQLite 在线备份或先停止 API 容器再备份整个数据卷（包括 WAL 文件）；同时保存 `MODEL_CONFIG_ENCRYPTION_KEY`，否则已保存的模型密钥无法解密。导入开发数据库后，使用 `RESET_ADMIN_PASSWORD=1` 初始化管理员密码，完成后移除该变量。加密密钥不能直接替换，轮换需要重加密现有配置。
- 图片和文本任务使用可配置的 OpenAI 兼容公网 HTTPS 接口。Tuzi `gpt-image-2` 是图片默认配置，允许添加其他模型；上线前人工验证各供应商实际生成。管理台的模型列表检查不触发付费请求。

## A 方案执行顺序

推荐先准备一台支持 Docker Compose 的 Linux 服务器、两个域名及持久化磁盘。低流量起步可选 2 核 2GB，但仍需根据实际并发监控内存与延迟。大陆服务器先核实备案要求。首次部署用新的数据库卷；不要把开发环境会话和测试用户直接作为生产用户导入。

1. 在服务器配置 `server/.env`，用密码管理器生成不同的管理员密码和加密密钥。把 `API_DOMAIN`、`ADMIN_DOMAIN` 与 `CORS_ORIGIN` 配成一致的真实域名；不要公开 3000 端口。
2. 在开发机填写 `miniprogram/deployment.json`，确认 `project.config.json` 的 AppID 与服务器一致。开发机检查时可指定生产配置文件路径：`npm run check:release -- /path/to/production.env`。命令只报告字段名，不显示密钥，也不发起模型请求。
3. 在已安装 Node 22.18+ 的开发机运行 `npm run check`、`npm test`，以及 `npm --prefix admin-web run build`。根检查依赖管理台开发依赖，首次先运行 `npm --prefix admin-web ci`。
4. 在服务器仓库根目录运行 `docker compose config --quiet`、`docker compose up -d --build`，然后检查 `docker compose ps` 与 `docker compose logs --tail=100 api gateway`。不要把含密钥的完整 Compose 配置输出发到聊天中。
5. 访问两个真实 HTTPS 域名，检查 API 的 `/api/health` 和管理台登录；配置文本、图片模型并检查模型列表。先以低并发验证生成，检查 `/comics/:id` 条漫阅读路由的反向代理。模型列表检查不进行收费生成。
6. 在微信公众平台配置 request 合法域名。当前内置封面随小程序打包；若以后使用远程封面、下载或上传接口，还需要按实际行为配置对应合法域名。用体验版真机验证微信登录、逐章阅读、切后台进度恢复、目录和安全区，再上传审核。

`TRUST_PROXY=1` 仅用于 API 隐藏在受信任的 Caddy/Nginx 后面。Compose 已启用并仅向容器网络暴露 API。直接运行未受保护的 API 时保持 `TRUST_PROXY=0`。图片和文本共用每用户每日限额与全局队列容量，同时受各类型及每作品并发限制。队列设置保存在 SQLite，后续启动优先采用已保存设置。重启后等待执行的任务恢复；已运行任务标记 `SERVER_RESTARTED`，不会自动再次调用收费接口。任务包含入队时的加密模型快照，备份必须同时保管模型加密密钥。

## 在线备份与回退

容器运行时不要直接复制单个 SQLite 主文件，WAL 中可能有未合并数据。使用 SQLite 在线备份：

```sh
docker compose exec api npm run backup
docker compose cp api:/app/backups ./server-backups
```

备份脚本拒绝覆盖现有文件并执行完整性检查。Compose 的 `mojing-backups` 卷保留容器重建前后的备份，但和数据库在同一服务器上，不能代替异地备份。把备份复制到另一台机器或私有对象存储，并单独保管 `MODEL_CONFIG_ENCRYPTION_KEY`；备份包含用户、会话和加密模型配置，不能公开。API 以非 root 用户运行；已有数据卷需要保证容器的 `node` 用户有读写权限，新卷会自动继承目录权限。

回退时先停止 API，再将已验证备份恢复到原数据卷；保留原数据库及其 WAL/SHM 到安全位置，不能把旧 WAL 混到恢复文件上。随后使用匹配的加密密钥启动，并重新检查健康、登录和阅读进度。维护窗口内执行，未经确认不要覆盖生产数据库。

## 当前边界

配置预检通过不等于完成上线，它无法代替 DNS/TLS、微信正式登录、内容审核、真机和备份恢复演练。当前数据库只支持单 API 实例，不适合水平扩容。大量远程生成图片需要增加私有对象存储和持久化素材流程，再逐步迁移 PostgreSQL；本轮不自动引入新的云平台或数据库。
