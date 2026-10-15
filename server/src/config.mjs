import { existsSync, readFileSync } from 'node:fs'

export const imageEndpoint = 'https://api.tu-zi.com/coding/images/generations'

export function textRequestTimeoutMs(env = process.env) {
  const value = env.TEXT_REQUEST_TIMEOUT_MS ?? '150000'
  if (!/^\d+$/.test(String(value)) || Number(value) < 1000 || Number(value) > 600000) {
    throw new Error('TEXT_REQUEST_TIMEOUT_MS: integer between 1000 and 600000 required')
  }
  return Number(value)
}

export function readEnvFile(path) {
  if (!existsSync(path)) return {}
  const values = {}
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/)
    if (match) values[match[1]] = match[2].replace(/^['"]|['"]$/g, '')
  }
  return values
}

export function isPublicOrigin(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password
      && !url.port && url.hostname.includes('.') && !/(^|\.)localhost$|\.example\.(com|org|net)$|^example\.(com|org|net)$|^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)
  } catch { return false }
}

export function productionIssues(env) {
  const issues = []
  try { textRequestTimeoutMs(env) } catch (error) { issues.push(error.message) }
  for (const key of ['WECHAT_APPID', 'WECHAT_SECRET', 'MODEL_CONFIG_ENCRYPTION_KEY', 'DEV_ADMIN_PASSWORD', 'CORS_ORIGIN']) {
    if (!env[key] || /replace-with|change-me|example\.com/.test(env[key])) issues.push(`${key}: required production value`)
  }
  if (!/^wx[a-zA-Z0-9]{16}$/.test(env.WECHAT_APPID || '')) issues.push('WECHAT_APPID: invalid format')
  if ((env.DEV_ADMIN_PASSWORD || '').length < 16 || env.DEV_ADMIN_PASSWORD === 'mojing-dev-only') issues.push('DEV_ADMIN_PASSWORD: minimum 16 characters; no development default')
  if ((env.MODEL_CONFIG_ENCRYPTION_KEY || '').length < 32) issues.push('MODEL_CONFIG_ENCRYPTION_KEY: minimum 32 characters')
  if (env.MODEL_CONFIG_ENCRYPTION_KEY === env.DEV_ADMIN_PASSWORD) issues.push('MODEL_CONFIG_ENCRYPTION_KEY: must be independent from admin password')
  if (!isPublicOrigin(env.CORS_ORIGIN)) issues.push('CORS_ORIGIN: public HTTPS origin required')
  if (env.TUZI_IMAGE_ENDPOINT) {
    try {
      const url = new URL(env.TUZI_IMAGE_ENDPOINT)
      if (!isPublicOrigin(url.origin) || !url.pathname.endsWith('/images/generations') || url.search || url.hash || url.username || url.password) issues.push('TUZI_IMAGE_ENDPOINT: public HTTPS images/generations endpoint required')
    } catch { issues.push('TUZI_IMAGE_ENDPOINT: invalid URL') }
  }
  for (const key of ['MAX_GENERATION_JOBS_PER_DAY', 'MAX_CONCURRENT_GENERATION_JOBS']) {
    if (env[key] !== undefined && (!/^\d+$/.test(env[key]) || Number(env[key]) < 1 || Number(env[key]) > 1000)) issues.push(`${key}: integer between 1 and 1000 required`)
  }
  return issues
}
