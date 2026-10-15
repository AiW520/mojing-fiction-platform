import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash, createDecipheriv } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { readEnvFile, imageEndpoint } from '../server/src/config.mjs'

export function sceneImageConfig(project) {
  const settingsPath = resolve(project, 'artifacts/full-scene-artwork/generation-settings.json')
  const selected = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, 'utf8')).model : 'gpt-image-2'
  if (selected === 'gpt-image-2') return { model: selected }
  assert.equal(selected, 'gpt-image-2.5-sunburst', 'Only the explicitly selected alternative is authorized')
  const env = { ...readEnvFile(resolve(project, 'server/.env')), ...process.env }
  const db = new DatabaseSync(resolve(project, env.DATA_DIR || 'server/data', 'mojing.sqlite'), { readOnly: true })
  try {
    const config = db.prepare("SELECT id, model, endpoint, encrypted_key FROM model_configs WHERE kind = 'image' AND model = ? AND enabled = 1 AND encrypted_key IS NOT NULL ORDER BY updated_at DESC, rowid DESC LIMIT 1").get(selected)
    assert.ok(config, 'Selected image model is unavailable in administrator configuration')
    assert.equal(config.endpoint, imageEndpoint, 'Keep the authorized Tuzi coding endpoint')
    const [iv, tag, encrypted] = config.encrypted_key.split('.')
    const encryptionKey = createHash('sha256').update(env.MODEL_CONFIG_ENCRYPTION_KEY || env.DEV_ADMIN_PASSWORD || 'mojing-dev-only').digest()
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(iv, 'base64url'))
    decipher.setAuthTag(Buffer.from(tag, 'base64url'))
    const key = Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString('utf8')
    assert.ok(key && !/\s/.test(key), 'Configured image credential is invalid')
    return { model: config.model, modelConfigId: config.id, key }
  } finally {
    db.close()
  }
}
