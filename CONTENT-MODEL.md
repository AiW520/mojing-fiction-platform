# 内容结构 v1

projects.json 每项有 id/title/description/tags/sourceIds/tutorialVersion/owner/status、chapters、moduleRecords、flowRecords、exerciseRecords、runtimeValidation 和 unreviewed。章节有目标、稳定路径；模块/流程/练习有独立 ID，避免组件依赖目录名猜测内容。

evidence.json 保存 project/path/symbol/start/end/sha256/excerptSha256/claim/sourceStatus/snippet。versions.json 保存 commit、dirty、snapshot、fileCount、lineCount、reviewedFileCount。source-index.json 的文件状态分 excerpt-reviewed 与 inventory-only，不能将哈希扫描算作阅读覆盖。

生成来源为 scripts/course_*.py；渲染来源为 Markdown 和 JSON。site 组件只消费内容，不执行原项目代码。Markdown 中允许网站作者控制的 details 等标签，但绝不直接导入来源仓库的 HTML/MDX。引用源码放 fenced code block。图示由固定 SVG 模板构造，文本使用 XML 转义。

新增课程：声明 course、注册 chapter/evidence、补覆盖范围、运行 generate_all；无需复制页面组件。人工页面保存在不同 slug，并在 content-manifest.json 将 owner 改为 human；生成器只应校验/覆盖 agent-authored 的页面，遇到人工同名页报错。

公开策略在 source-display.json。source mapping、范围授权、完整原始快照放 audit 私有目录；干净导出通过显式允许清单打包。禁止上传原项目的 .env、账号数据、私钥、日志或完整私有源码。
