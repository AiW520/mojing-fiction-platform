import { DatabaseSync, backup } from 'node:sqlite'
import { existsSync, mkdirSync, chmodSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readEnvFile } from '../src/config.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const env = { ...readEnvFile(resolve(root, '.env')), ...process.env }
const data = resolve(env.DATA_DIR || resolve(root, 'data'))
const destination = resolve(process.argv[2] || resolve(root, 'backups', `mojing-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`))
if (!existsSync(resolve(data, 'mojing.sqlite'))) throw new Error('Source database does not exist')
if (existsSync(destination)) throw new Error('Backup destination already exists; refusing to overwrite')
mkdirSync(dirname(destination), { recursive: true, mode: 0o700 })
const db = new DatabaseSync(resolve(data, 'mojing.sqlite'), { readOnly: true })
try {
  await backup(db, destination)
  chmodSync(destination, 0o600)
  const copy = new DatabaseSync(destination, { readOnly: true })
  try { if (copy.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('Backup integrity check failed') } finally { copy.close() }
  console.log(`Verified SQLite backup: ${destination}`)
  console.log('Store a copy off-server, and preserve the encryption key separately. No keys were printed.')
} finally { db.close() }
