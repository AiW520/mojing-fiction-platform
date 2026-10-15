import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3'
import { NodeHttpHandler } from '@smithy/node-http-handler'
import { Agent } from 'node:https'
import { lookup } from 'node:dns'
import { BlockList, isIP } from 'node:net'

const denied = new BlockList()
for (const [address, bits] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]]) denied.addSubnet(address, bits, 'ipv4')
const blockedV6 = new BlockList()
for (const [address, bits] of [['2001::',32],['2001:db8::',32],['2002::',16]]) blockedV6.addSubnet(address, bits, 'ipv6')
const globalV6 = new BlockList()
globalV6.addSubnet('2000::', 3, 'ipv6')
export function publicStorageAddress(address) {
  if (isIP(address) === 4) return !denied.check(address, 'ipv4')
  if (isIP(address) !== 6) return false
  const lower = address.toLowerCase()
  if (lower.startsWith('::ffff:')) {
    const mapped = lower.slice(7)
    return isIP(mapped) === 4 && !denied.check(mapped, 'ipv4')
  }
  return globalV6.check(address, 'ipv6') && !blockedV6.check(address, 'ipv6')
}

const defaults = { provider: 's3', endpoint: '', region: '', bucket: '', prefix: '', forcePathStyle: true, enabled: false }
function fail(message) { throw Object.assign(new Error(message), { status: 400, code: 'STORAGE_CONFIG_INVALID' }) }
export function validateStorageConfig(input) {
  for (const field of ['endpoint','region','bucket','prefix']) if (typeof input[field] !== 'string') fail('存储配置字段类型无效')
  let url
  try { url = new URL(input.endpoint) } catch { fail('请输入有效的 HTTPS Endpoint') }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/' || (url.port && url.port !== '443') || isIP(url.hostname) || !url.hostname.includes('.') || /(^|\.)localhost$/.test(url.hostname)) fail('Endpoint 必须是公开 HTTPS 域名，不包含路径或凭据')
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,62}$/.test(input.region)) fail('Region 格式无效')
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(input.bucket) || /\.\.|^\d+\.\d+\.\d+\.\d+$/.test(input.bucket)) fail('Bucket 格式无效')
  if (input.prefix.length > 512 || input.prefix.startsWith('/') || input.prefix.includes('\\') || input.prefix.split('/').some(v => v === '.' || v === '..') || /[\x00-\x1f\x7f]/.test(input.prefix)) fail('路径前缀格式无效')
  if (typeof input.forcePathStyle !== 'boolean' || typeof input.enabled !== 'boolean') fail('存储开关必须是布尔值')
  return { ...input, provider: 's3', endpoint: url.origin }
}

function guardedLookup(host, options, callback) {
  lookup(host, { all: true, family: options.family || 0 }, (error, addresses) => {
    if (error) return callback(error)
    if (!addresses.length || addresses.some(v => !publicStorageAddress(v.address))) return callback(new Error('STORAGE_HOST_PRIVATE'))
    if (options.all) callback(null, addresses)
    else callback(null, addresses[0].address, addresses[0].family)
  })
}

export function createObjectStorage({ db, encryptSecret, decryptSecret, audit, clientFactory, requestHandler }) {
  db.exec(`CREATE TABLE IF NOT EXISTS object_storage_config (id INTEGER PRIMARY KEY CHECK(id=1), settings_json TEXT NOT NULL, encrypted_credentials TEXT, version INTEGER NOT NULL DEFAULT 1, test_json TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`)
  const row = () => db.prepare('SELECT * FROM object_storage_config WHERE id=1').get()
  function publicConfig(value = row()) {
    return { ...(value ? JSON.parse(value.settings_json) : defaults), credentialsConfigured: Boolean(value?.encrypted_credentials), version: value?.version || 0, lastTest: value?.test_json ? JSON.parse(value.test_json) : null, updatedAt: value?.updated_at || null, usage: 'configuration-only' }
  }
  function save(input, actorId) {
    const previous = row()
    const existing = previous ? JSON.parse(previous.settings_json) : defaults
    const settings = validateStorageConfig(Object.fromEntries(Object.keys(defaults).map(key => [key, input[key] ?? existing[key]])))
    const credentials = previous?.encrypted_credentials ? JSON.parse(decryptSecret(previous.encrypted_credentials)) : {}
    for (const field of ['accessKeyId', 'secretAccessKey', 'sessionToken']) {
      if (input[field] !== undefined && (typeof input[field] !== 'string' || input[field].length > 4096)) fail('凭据格式无效')
      if (input[field]?.trim()) credentials[field] = input[field].trim()
    }
    for (const flag of ['clearCredentials', 'clearSessionToken']) if (input[flag] !== undefined && typeof input[flag] !== 'boolean') fail('清除开关必须是布尔值')
    if (input.clearSessionToken) delete credentials.sessionToken
    if (input.clearCredentials) for (const key of Object.keys(credentials)) delete credentials[key]
    if (Boolean(credentials.accessKeyId) !== Boolean(credentials.secretAccessKey)) fail('Access Key ID 和 Secret Access Key 必须成对填写')
    if (settings.enabled && !credentials.accessKeyId) fail('启用连接前请配置凭据')
    db.prepare(`INSERT INTO object_storage_config(id,settings_json,encrypted_credentials) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET settings_json=excluded.settings_json,encrypted_credentials=excluded.encrypted_credentials,version=version+1,test_json=NULL,updated_at=CURRENT_TIMESTAMP`)
      .run(JSON.stringify(settings), credentials.accessKeyId ? encryptSecret(JSON.stringify(credentials)) : null)
    audit(actorId, '保存对象存储配置', 'object_storage', '1', null, { ...settings, credentialsChanged: Boolean(input.accessKeyId || input.secretAccessKey || input.sessionToken || input.clearCredentials || input.clearSessionToken) })
    return publicConfig()
  }
  async function test(actorId) {
    const saved = row()
    if (!saved?.encrypted_credentials) fail('请先保存存储配置和凭据')
    const settings = validateStorageConfig(JSON.parse(saved.settings_json))
    const client = clientFactory ? clientFactory(settings, JSON.parse(decryptSecret(saved.encrypted_credentials))) : new S3Client({
      endpoint: settings.endpoint, region: settings.region, forcePathStyle: settings.forcePathStyle,
      credentials: JSON.parse(decryptSecret(saved.encrypted_credentials)), maxAttempts: 1,
      requestHandler: requestHandler || new NodeHttpHandler({ connectionTimeout: 5000, requestTimeout: 10000, httpsAgent: new Agent({ lookup: guardedLookup }) }),
    })
    let result
    try {
      await client.send(new ListObjectsV2Command({ Bucket: settings.bucket, Prefix: settings.prefix, MaxKeys: 1 }), { abortSignal: AbortSignal.timeout(12000) })
      result = { status: 'success', message: '桶与前缀读取成功；上传权限尚未验证', checkedAt: new Date().toISOString(), version: saved.version }
    } catch (error) {
      const status = Number(error?.$metadata?.httpStatusCode) || null
      result = { status: 'failed', httpStatus: status, message: status === 403 ? '读取被拒绝，请检查凭据和桶的读取权限' : status === 404 ? '未找到存储桶，请检查 Bucket 和 Endpoint' : '连接失败，请检查 Endpoint、Region、网络和凭据', checkedAt: new Date().toISOString(), version: saved.version }
    } finally { client.destroy() }
    const changed = db.prepare('UPDATE object_storage_config SET test_json=? WHERE id=1 AND version=?').run(JSON.stringify(result), saved.version).changes
    if (!changed) result = { ...result, stale: true, message: '配置已变更，请重新测试' }
    audit(actorId, '测试对象存储连接', 'object_storage', '1', null, result, result.status)
    return result
  }
  return { publicConfig, save, test }
}
