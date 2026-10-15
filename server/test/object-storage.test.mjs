import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { Readable } from 'node:stream'
import { createObjectStorage, publicStorageAddress, validateStorageConfig } from '../src/object-storage.mjs'

const valid = { endpoint: 'https://storage.vendor.test', region: 'us-east-1', bucket: 'comic-media', prefix: 'mojing/', forcePathStyle: true, enabled: false }
test('storage validates endpoint, prefix and public DNS addresses', () => {
  assert.equal(validateStorageConfig(valid).endpoint, valid.endpoint)
  for (const endpoint of ['http://host.test', 'https://user:secret@host.test', 'https://127.0.0.1', 'https://host.test/base', 'https://host.test/?secret=x']) assert.throws(() => validateStorageConfig({ ...valid, endpoint }))
  for (const prefix of ['../x','x/../y','/root','x\\y','x\n']) assert.throws(() => validateStorageConfig({ ...valid, prefix }))
  for (const ip of ['127.0.0.1','10.1.2.3','100.64.0.1','169.254.1.1','192.168.1.1','::1','::ffff:127.0.0.1','fc00::1','2001:db8::1']) assert.equal(publicStorageAddress(ip), false, ip)
  for (const ip of ['8.8.8.8','2606:4700:4700::1111']) assert.equal(publicStorageAddress(ip), true, ip)
})

test('S3 settings retain credentials, hide secrets, test prefix read only and invalidate stale results', async () => {
  const db = new DatabaseSync(':memory:'); const audits = []; const sends = []; let release
  const store = createObjectStorage({ db, encryptSecret: text => Buffer.from(text).toString('base64'), decryptSecret: text => Buffer.from(text,'base64').toString(), audit: (...args) => audits.push(args), clientFactory: (config, credentials) => ({
    send: async command => { sends.push({ config, credentials, command }); if (release === 'wait') await new Promise(resolve => { release = resolve }) }, destroy() {},
  }) })
  try {
    assert.equal(store.publicConfig().credentialsConfigured, false)
    assert.throws(() => store.save({ ...valid, enabled: true }, 'admin'))
    const first = store.save({ ...valid, enabled: true, accessKeyId: 'test-access-id', secretAccessKey: 'test-secret-key', sessionToken: 'test-token' }, 'admin')
    assert.equal(first.credentialsConfigured, true)
    assert.ok(!JSON.stringify(first).includes('test-secret-key'))
    assert.ok(!JSON.stringify(audits).includes('test-secret-key'))
    assert.equal((await store.test('admin')).status, 'success')
    assert.equal(sends[0].command.constructor.name, 'ListObjectsV2Command')
    assert.deepEqual(sends[0].command.input, { Bucket: valid.bucket, Prefix: valid.prefix, MaxKeys: 1 })
    store.save({ prefix: 'new/', secretAccessKey: '', clearSessionToken: true }, 'admin')
    assert.equal(store.publicConfig().lastTest, null)
    await store.test('admin')
    assert.equal(sends[1].credentials.secretAccessKey, 'test-secret-key')
    assert.equal(sends[1].credentials.sessionToken, undefined)
    release = 'wait'; const testing = store.test('admin')
    store.save({ prefix: 'newer/' }, 'admin'); release()
    assert.equal((await testing).stale, true)
    assert.equal(store.publicConfig().lastTest, null)
    assert.throws(() => store.save({ clearCredentials: true }, 'admin'))
    assert.equal(store.save({ enabled: false, clearCredentials: true }, 'admin').credentialsConfigured, false)
    await assert.rejects(store.test('admin'))
  } finally { db.close() }
})

test('storage connection errors never disclose provider messages or credentials', async () => {
  const db = new DatabaseSync(':memory:')
  const store = createObjectStorage({ db, encryptSecret: x => x, decryptSecret: x => x, audit() {}, clientFactory: () => ({ destroy() {}, send() { throw Object.assign(new Error('secret-key-provider-output'), { $metadata: { httpStatusCode: 403 } }) } }) })
  try {
    store.save({ ...valid, accessKeyId: 'id', secretAccessKey: 'secret' }, 'admin')
    const result = await store.test('admin')
    assert.equal(result.status, 'failed'); assert.equal(result.httpStatus, 403)
    assert.ok(!JSON.stringify(result).includes('secret'))
  } finally { db.close() }
})

test('official S3 client signs a bounded read request and disables automatic retries', async () => {
  const db = new DatabaseSync(':memory:'); const requests = []
  const store = createObjectStorage({ db, encryptSecret:x=>x, decryptSecret:x=>x, audit() {}, requestHandler: { destroy() {}, async handle(request) {
    requests.push(request)
    return { response:{ statusCode:requests.length === 1 ? 200 : 503,headers:{'content-type':'application/xml'},body:Readable.from([requests.length === 1 ? '<ListBucketResult><Name>comic-media</Name><KeyCount>0</KeyCount></ListBucketResult>' : '<Error><Code>ServiceUnavailable</Code></Error>']) } }
  } } })
  try {
    store.save({...valid,accessKeyId:'fake-id',secretAccessKey:'fake-secret'},'admin')
    assert.equal((await store.test('admin')).status,'success')
    assert.equal(requests[0].method,'GET'); assert.equal(requests[0].path,'/comic-media/')
    assert.equal(requests[0].query.prefix,valid.prefix); assert.equal(requests[0].query['max-keys'],'1')
    assert.ok(requests[0].headers.authorization.startsWith('AWS4-HMAC-SHA256 '))
    assert.equal((await store.test('admin')).status,'failed')
    assert.equal(requests.length,2)
  } finally { db.close() }
})
