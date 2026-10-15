import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { acquireLock } from './campus-comic-lock.mjs'

test('live lock excludes other processes and cleanup checks ownership', () => {
  const folder = mkdtempSync(join(tmpdir(), 'campus-lock-'))
  try {
    const path = join(folder, 'producer.lock')
    const release = acquireLock(path)
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `import {acquireLock} from ${JSON.stringify(new URL('./campus-comic-lock.mjs', import.meta.url).href)}; try {acquireLock(process.argv[1]); process.exit(1)} catch(error) {process.exit(error.code === 'LOCK_BUSY' ? 0 : 2)}`, path])
    assert.equal(child.status, 0)
    assert.throws(() => acquireLock(path), { code: 'LOCK_BUSY' })
    const replacement = { pid: process.pid, identity: 'replacement' }
    writeFileSync(path, JSON.stringify(replacement))
    release()
    assert.deepEqual(JSON.parse(readFileSync(path)), replacement)
  } finally { rmSync(folder, { recursive: true, force: true }) }
})

test('dead owner is recovered but a partial lock is never stolen', () => {
  const folder = mkdtempSync(join(tmpdir(), 'campus-lock-'))
  try {
    const path = join(folder, 'producer.lock')
    const child = spawnSync(process.execPath, ['-e', 'process.exit(0)'])
    writeFileSync(path, JSON.stringify({ pid: child.pid, startedAt: new Date().toISOString() }))
    const release = acquireLock(path)
    assert.equal(JSON.parse(readFileSync(path)).pid, process.pid)
    release()
    writeFileSync(path, '')
    assert.throws(() => acquireLock(path), { code: 'LOCK_BUSY' })
  } finally { rmSync(folder, { recursive: true, force: true }) }
})

test('a crashed stale-lock recovery owner does not prevent restart', () => {
  const folder = mkdtempSync(join(tmpdir(), 'campus-lock-'))
  try {
    const path = join(folder, 'watchdog.lock')
    const child = spawnSync(process.execPath, ['-e', 'process.exit(0)'])
    for (const suffix of ['', '.recovery']) writeFileSync(`${path}${suffix}`, JSON.stringify({ pid: child.pid, identity: 'crashed' }))
    const release = acquireLock(path)
    assert.equal(JSON.parse(readFileSync(path)).pid, process.pid)
    release()
  } finally { rmSync(folder, { recursive: true, force: true }) }
})
