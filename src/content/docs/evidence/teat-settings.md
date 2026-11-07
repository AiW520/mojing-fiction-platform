---
title: "teat-settings · creative-settings"
---

> **版本核对：** 本地文件存在差异。本页行号对应已审阅的本地快照。 引用片段与远端一致：[固定提交源码](https://github.com/AiW520/mojing-fiction-platform/blob/ec4fa9c01417c37cfd8cad05de74707d70c92401/server/src/server.mjs#L711-L724)（远端行 711–724；私有仓库需要访问权限）。


## 结论

创作设定要求作品所有者，截断字段并严格检查 illustrationsEnabled 布尔类型。

## 源码定位

- 项目：`teat1`
- 相对路径：`server/src/server.mjs`
- 符号：`creative-settings`
- 行号：691–704
- 文件 SHA-256：`5e5d14bfc20c7d168ea609362e17838d684e9486f6888978d7b48fe5bb901468`

工作区可能有未提交修改；以本页文件哈希为精确依据。提交版本和范围见[覆盖报告](../../coverage/)。

## 核对片段

以下是已审阅的必要片段，不包含完整文件。代码仅作为文本展示。起始行：691。

````js
  const settingsMatch = path.match(/^\/api\/works\/([^/]+)\/creative-settings$/)
  if (settingsMatch && ['GET', 'PUT'].includes(req.method)) {
    const actor = requireWorkOwner(req, settingsMatch[1])
    const work = db.prepare('SELECT * FROM works WHERE id = ?').get(settingsMatch[1])
    const previous = JSON.parse(db.prepare('SELECT settings_json FROM creative_settings WHERE work_id = ?').get(work.id)?.settings_json || '{}')
    if (req.method === 'GET') return json(res, 200, { settings: previous })
    assertImportEditable(work)
    const input = await body(req); const settings = {}
    for (const [key, limit] of Object.entries({ protagonist: 1000, world: 2000, outline: 16000, mood: 100, genre: 100, visualStyle: 1000 })) settings[key] = String(input[key] ?? previous[key] ?? '').trim().slice(0, limit)
    if (input.illustrationsEnabled !== undefined && typeof input.illustrationsEnabled !== 'boolean') throw new HttpError(400, 'SETTINGS_INVALID', '插图开关必须为布尔值')
    settings.illustrationsEnabled = input.illustrationsEnabled ?? previous.illustrationsEnabled ?? true
    db.prepare('INSERT INTO creative_settings(work_id, settings_json) VALUES (?, ?) ON CONFLICT(work_id) DO UPDATE SET settings_json = excluded.settings_json, updated_at = CURRENT_TIMESTAMP').run(work.id, JSON.stringify(settings))
    audit(actor.id, '保存创作设定', 'work', work.id, null, { keys: Object.keys(settings) })
    return json(res, 200, { settings })
````
