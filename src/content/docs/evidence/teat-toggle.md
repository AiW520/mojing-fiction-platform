---
title: "teat-toggle · toggleShelf"
---

> **版本核对：** 本地文件存在差异。本页行号对应已审阅的本地快照。 引用片段与远端一致：[固定提交源码](https://github.com/AiW520/mojing-fiction-platform/blob/ec4fa9c01417c37cfd8cad05de74707d70c92401/miniprogram/pages/book/detail.ts#L48-L50)（远端行 48–50；私有仓库需要访问权限）。


## 结论

防忙碌与未就绪点击，等待服务端成功后更新 inShelf 并显示 toast。

## 源码定位

- 项目：`teat1`
- 相对路径：`miniprogram/pages/book/detail.ts`
- 符号：`toggleShelf`
- 行号：65–67
- 文件 SHA-256：`1c151c8a3016b88b82c13660a42adb8a32841789a9f649b49bd27ebee9601a58`

工作区可能有未提交修改；以本页文件哈希为精确依据。提交版本和范围见[覆盖报告](../../coverage/)。

## 核对片段

以下是已审阅的必要片段，不包含完整文件。代码仅作为文本展示。起始行：65。

````ts
  openCharacters() { this.navigate('/pages/characters/index?workId=' + encodeURIComponent(this.data.book.id)) },
  canParticipate() { if (!isTimelinePreview()) return true; wx.showToast({ title: '请打开完整小程序后参与', icon: 'none' }); return false },
  async toggleShelf() { if (this.data.shelfBusy || this.data.loading || this.data.error || !this.canParticipate()) return; this.setData({ shelfBusy: true }); const next = !this.data.inShelf; try { await ensureSession(); await request(`/api/works/${encodeURIComponent(this.data.book.id)}/shelf`, { method: next ? 'POST' : 'DELETE', data: {} }); this.setData({ inShelf: next }); wx.showToast({ title: next ? '已加入书架' : '已移出书架', icon: 'none' }) } catch (error) { wx.showToast({ title: (error as Error).message || '书架操作失败', icon: 'none' }) } finally { this.setData({ shelfBusy: false }) } },
````
