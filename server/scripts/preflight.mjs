import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readEnvFile, productionIssues, isPublicOrigin } from '../src/config.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const path = process.argv[2] ? resolve(process.argv[2]) : resolve(root, 'server/.env')
const env = { ...readEnvFile(path), ...process.env }
const errors = productionIssues(env)
for (const key of ['API_DOMAIN', 'ADMIN_DOMAIN']) if (!isPublicOrigin(`https://${env[key] || ''}`)) errors.push(`${key}: a real public domain is required`)
if (env.API_DOMAIN === env.ADMIN_DOMAIN) errors.push('API_DOMAIN / ADMIN_DOMAIN: use different domains for this Compose configuration')
if (env.CORS_ORIGIN !== `https://${env.ADMIN_DOMAIN}`) errors.push('CORS_ORIGIN: must match https://ADMIN_DOMAIN')
try {
  const deployment = JSON.parse(readFileSync(resolve(root, 'miniprogram/deployment.json'), 'utf8'))
  for (const version of ['trial', 'release']) {
    const config = deployment[version]
    if (!isPublicOrigin(config?.apiBase)) errors.push(`miniprogram ${version}.apiBase: a real HTTPS origin is required`)
    if (!isPublicOrigin(config?.adminUrl)) errors.push(`miniprogram ${version}.adminUrl: a real HTTPS origin is required`)
    if (config?.apiBase !== `https://${env.API_DOMAIN}`) errors.push(`miniprogram ${version}.apiBase: must match API_DOMAIN`)
    if (config?.adminUrl !== `https://${env.ADMIN_DOMAIN}`) errors.push(`miniprogram ${version}.adminUrl: must match ADMIN_DOMAIN`)
  }
  const project = JSON.parse(readFileSync(resolve(root, 'project.config.json'), 'utf8'))
  if (project.appid !== env.WECHAT_APPID) errors.push('WECHAT_APPID: must match project.config.json')
} catch { errors.push('Mini program deployment/project configuration is unreadable') }
if (!env.TUZI_CODING_API_KEY || /replace-with|change-me/.test(env.TUZI_CODING_API_KEY)) console.log('WARN: Tuzi key must be configured in server environment or the encrypted admin model settings.')
console.log('NOTE: Text model must be configured and tested in the admin console. DNS, TLS, WeChat domains and backups need live verification.')
if (errors.length) {
  for (const issue of [...new Set(errors)]) console.error(`FAIL: ${issue}`)
  process.exitCode = 1
} else console.log('PASS: Local deployment configuration. No network calls or paid generation were made.')
