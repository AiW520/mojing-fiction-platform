# 方案 B 验收记录

验证日期：2026-10-10。面向十几部作品的当前规模，保留原生小程序、Node.js 和 SQLite 架构，优化请求、缓存、页面状态和交互。没有进行真实模型生成或正式发布。

## 验证结果

- `npm run check`：小程序 TypeScript、管理台 TypeScript、服务端语法和 17 个 Sass 文件全部通过。
- `npm test`：84 项通过，0 项失败。覆盖请求合并、账号隔离、写入后缓存失效、401 重登、网络错误后凭据复用、服务端事务回滚、重启重放、搜索竞态、文件缓存淘汰和阅读位置同步等。
- 浏览器书城、分享、创作、体验交互四组回归均通过，视口宽度为 320、390、768、1440。截图位于本目录的 `library/`、`share/`、`creator/`、`interactions/`。
- 体验回归检查长篇阅读首屏调用一次 `reader-bootstrap`，不再串行请求作品、目录、插图和当前章；下一章预取和切章共用一次章节请求。
- 拦住登录请求时，公开正文仍能显示；延迟旧关键词请求时，新搜索结果保持正确。主导航、空书架、目录和各宽度的横向溢出检查通过。
- 抽查手机阅读器、空书架、编辑器及桌面配图确认弹层截图，素材正常显示，没有重复导航或文字溢出。
- 漫画回归 `scripts/comic-discovery-preview-qa.mjs`：验证《赤潮》8 话与《雨停之前，底片未干》5 话按本展示，四种宽度均通过首页、话目目录、竖向阅读、图片查看器、阅读进度恢复、缺图占位、分享入口、网络失败缓存和返回书城。截图位于 `comic/`。

以上是功能和请求行为的验证，没有测量微信真机启动耗时、内存或滚动帧率，因此不报告性能提升百分比。

## 隔离预览

本轮 API 位于 `http://127.0.0.1:3101`，浏览器预览位于 `http://127.0.0.1:4174/preview/`。使用 `api-data/` 中的独立数据库、开发登录和空模型凭据。创作浏览器回归使用请求拦截模拟数据；HTTP 测试使用临时数据库，任务队列暂停，不派发真实供应商请求。

漫画公开回归由隔离 API 的 `COMIC_PUBLIC_SOURCES` 聚合本地 3000、3014 的已发布目录与素材。来源只配置 API origin；代理限制响应大小、阻止重定向、校验目录/分镜结构，来源短暂故障时保留最近一次成功目录。漫画创作和管理写入接口留在隔离 API。

原有 3000 API 服务和真实数据库没有重启或改写。其内存中的代码仍为启动时版本；正式联调需要按正常部署流程加载本轮前后端改动。手机无法使用电脑的 `127.0.0.1`，应使用可访问的 HTTPS 测试域名。

## 复现

需要 Node.js 22、项目依赖、Playwright 和 Chromium，以及运行中的隔离预览/API。PowerShell 示例：

```powershell
npm run check
npm test
$env:PREVIEW_URL = 'http://127.0.0.1:4174'
# 安装位置不同于项目依赖时，配置 Playwright 的模块根目录和浏览器可执行文件。
$env:PLAYWRIGHT_MODULE_ROOT = 'C:\path\to\node-dependencies'
$env:CHROMIUM_EXECUTABLE = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
$env:QA_OUTPUT = 'artifacts/experience-performance-qa/library'
node scripts/library-preview-qa.mjs
$env:QA_OUTPUT = 'artifacts/experience-performance-qa/share'
node scripts/share-preview-qa.mjs
$env:QA_OUTPUT = 'artifacts/experience-performance-qa/creator'
node scripts/creator-preview-qa.mjs
node scripts/experience-preview-qa.mjs
node scripts/comic-discovery-preview-qa.mjs
```

体验脚本截图固定保存到 `interactions/`。隔离 Vite 可通过 `MOJING_API_PROXY=http://127.0.0.1:3101` 指向测试 API。

## 后续维护与真机验收

- 在微信开发者工具和体验版手机中检查实际微信登录、真实公开图片的文件缓存、重开后离线阅读、存储空间不足、系统清理缓存、键盘和安全区。
- 用实际作品连续切换章节、滚动长文本与漫画，并记录冷启动/重复进入耗时、内存和滚动帧率，决定是否需要后续更细的优化。
- 本地待确认提交凭据在成功或明确的 4xx 后清理，网络错误/5xx 后保留；不要主动清理仍有收费结果未知的凭据。持久凭据按 API 和账号隔离，但保存提交内容用于区分操作，长期积累需关注本地空间。
- 服务端提交凭据当前长期保留，以支持重启和较晚重试。数据量增长后，应先明确客户端重试期限，再设计归档和清理规则；直接删除记录会缩短重复提交保护期限。
- 版本提交去重只针对同一次提交，不能替代多端编辑的冲突处理。更大书库、多实例部署和实时多端协作需要另行设计。
