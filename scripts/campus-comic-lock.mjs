import { randomUUID } from 'node:crypto'
import { linkSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'

export function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch (error) { return error.code !== 'ESRCH' }
}

export function acquireLock(path) {
  const identity = randomUUID()
  for (let attempt = 0; attempt < 3; attempt++) {
    const candidate = `${path}.${process.pid}.${identity}.candidate`
    // Publish an already complete lock atomically, even if the process crashes.
    writeFileSync(candidate, JSON.stringify({ pid: process.pid, identity, startedAt: new Date().toISOString() }), { flag: 'wx' })
    let creationError
    try { linkSync(candidate, path) } catch (error) { creationError = error }
    finally { unlinkSync(candidate) }
    if (creationError) {
      const error = creationError
      if (error.code !== 'EEXIST') throw error
      let owner
      try { owner = JSON.parse(readFileSync(path, 'utf8')) } catch (readError) {
        if (readError.code === 'ENOENT') continue
        // A new owner may still be writing the lock. Never delete a partial lock.
        throw Object.assign(new Error('LOCK_BUSY'), { code: 'LOCK_BUSY' })
      }
      if (processAlive(owner.pid)) throw Object.assign(new Error('LOCK_BUSY'), { code: 'LOCK_BUSY' })
      const recoveryPath = `${path}.recovery`
      const releaseRecovery = acquireLock(recoveryPath)
      try {
        const current = JSON.parse(readFileSync(path, 'utf8'))
        if (current.identity === owner.identity && current.pid === owner.pid && !processAlive(current.pid)) unlinkSync(path)
      } catch (recoveryError) { if (recoveryError.code !== 'ENOENT') throw recoveryError }
      finally { releaseRecovery() }
      continue
    }
    return () => {
      try { if (JSON.parse(readFileSync(path, 'utf8')).identity === identity) unlinkSync(path) }
      catch (error) { if (error.code !== 'ENOENT') throw error }
    }
  }
  throw Object.assign(new Error('LOCK_BUSY'), { code: 'LOCK_BUSY' })
}
