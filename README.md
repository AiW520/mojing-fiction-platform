# teat1 / 墨境 · 小程序阅读与创作

本仓库 tutorial-site 分支仅包含独立静态教程。业务源码位于 main。

目标：https://AiW520.github.io/mojing-fiction-platform/

需要 Node.js 22、npm，静态校验需要 Python 3。

```sh
npm ci
npm run check
npm run build
python scripts/verify_site.py --built-only
npm run preview
```

本地直接运行校验时设置 SITE_BASE=/mojing-fiction-platform。Actions 自动配置。Pages 选择 GitHub Actions；仅部署此分支，不覆盖业务代码。

修改 Markdown 后构建。重新分析必须回到私有分析工作区核对快照。见 source-version、coverage、sources 页面。原源码和私有审计材料不在本分支。
