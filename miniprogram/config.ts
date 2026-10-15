import deployment from './deployment.json'

// Public URLs only. Secrets belong in server/.env.
export const environment = {
  development: { apiBase: 'http://127.0.0.1:3000', adminUrl: 'http://127.0.0.1:4173/', auth: 'development' },
  trial: { ...deployment.trial, auth: 'wechat' },
  release: { ...deployment.release, auth: 'wechat' },
}

export function getEnvironment() {
  const rawVersion = wx.getAccountInfoSync().miniProgram.envVersion || 'release'
  const version: 'development' | 'trial' | 'release' = rawVersion === 'develop' ? 'development' : rawVersion === 'trial' ? 'trial' : 'release'
  const config = environment[version]
  if (!config.apiBase || (version !== 'development' && !/^https:\/\//.test(config.apiBase))) throw new Error('请先配置小程序 HTTPS 服务域名')
  return { ...config, apiBase: config.apiBase.replace(/\/$/, '') }
}
