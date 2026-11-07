---
title: "teat-login · ensureSession"
---

> **版本核对：** 本地文件存在差异。本页行号对应已审阅的本地快照。 引用片段与远端一致：[固定提交源码](https://github.com/AiW520/mojing-fiction-platform/blob/ec4fa9c01417c37cfd8cad05de74707d70c92401/miniprogram/utils/api.ts#L91-L109)（远端行 91–109；私有仓库需要访问权限）。


## 结论

区分开发登录与 wx.login，用 apiBase/auth 标识会话环境并复用登录 Promise。

## 源码定位

- 项目：`teat1`
- 相对路径：`miniprogram/utils/api.ts`
- 符号：`ensureSession`
- 行号：91–109
- 文件 SHA-256：`1629800acc21e98de08de4d75a22e29ea1906c5d30fbb9f5e00ece9cd3efa971`

工作区可能有未提交修改；以本页文件哈希为精确依据。提交版本和范围见[覆盖报告](../../coverage/)。

## 核对片段

以下是已审阅的必要片段，不包含完整文件。代码仅作为文本展示。起始行：91。

````ts
export function ensureSession(): Promise<Session> {
  const config = getEnvironment()
  const current = wx.getStorageSync('mojing_session')
  const key = `${config.apiBase}:${config.auth}`
  if (current?.token && current.environment === key && Date.parse(current.expiresAt) > Date.now() + 60000) return Promise.resolve(current)
  if (loginPromise) return loginPromise
  loginPromise = (async () => {
    const payload = config.auth === 'development'
      ? await request<LoginPayload>('/api/auth/dev-login', { method: 'POST', data: { account: 'wechat:1001' } })
      : await new Promise<string>((resolve, reject) => wx.login({ success: result => result.code ? resolve(result.code) : reject(new Error('微信登录失败')), fail: reject }))
        .then(code => request<LoginPayload>('/api/auth/wechat', { method: 'POST', data: { code } }))
    const session = { token: payload.token, expiresAt: payload.expiresAt, userId: payload.user.id,
      role: payload.user.roles.find(role => role !== 'user') || 'user', name: payload.user.name, environment: key }
    wx.setStorageSync('mojing_session', session)
    return session
  })().finally(() => { loginPromise = null })
  return loginPromise
}

````
