---
title: "本地阅读、构建与 GitHub Pages 部署"
---

## 本地开发与构建

需要 Node.js 22.19 或更新的 Node 22，以及 npm。教程本身不需要 Python、数据库或模型；Python 只用于重新生成证据、核对来源和静态检查。

```sh
npm ci
npm run check
npm run build
npm run preview
```

默认站点子路径是 `/mojing-fiction-platform/`。预览时访问终端显示地址下的该路径，不能直接双击 dist/index.html：搜索资源需要正常的 HTTP 静态服务。

## 配置目标

`SITE_URL` 为站点域名，例如 `https://your-name.github.io`；`SITE_BASE` 为仓库路径，例如 `/learning`。用户主页仓库设置 `/`。配置仅在构建时读取，没有运行时服务端。

```powershell
$env:SITE_URL = "https://your-name.github.io"
$env:SITE_BASE = "/learning"
npm run build
```

## GitHub Actions

将网站源码提交到自己的仓库，在 Settings → Pages 中选择 GitHub Actions。自带 `.github/workflows/deploy.yml` 会在 tutorial-site 更新时安装锁定依赖、检查类型、构建并验证内部链接，然后上传 dist，部署到 Pages。工作流自动计算 owner/repo 子路径；没有发布凭证时不会替你声称已上线。

所有章节输出为目录下的 index.html，深层 URL 可以直接访问和刷新。404 页面提供回到首页链接。不要把本机 audit 私有清单、实验副本、scope.json 或完整原始仓库上传。

## 内容安全与公开范围

公开内容只包含课程、已审阅片段和相对路径。`audit/*.private.*` 保存本机路径及扫描细节，已加入忽略规则。不要直接提交整个工作文件夹；按 README 的交付文件清单操作。

新增课程使用结构化项目数据与受控 Markdown。不得把源仓库 README、HTML、脚本或 MDX 直接导入可执行组件。图使用本网站生成的静态 SVG；来源中的脚本不会进入图表执行上下文。

## 更新与导出

课程保存在 src/content/docs/courses，证据保存在 evidence；项目与证据元数据位于 src/data。生成脚本使用独立课程模块，人工补充放在独立 Markdown 文件，并在内容清单标注 owner，避免自动覆盖。

单项目导出脚本会复制网站基础设施并筛选课程与证据，输出到新的文件夹。导出后独立执行 npm ci、npm run build，按新的仓库名设置 SITE_BASE。
