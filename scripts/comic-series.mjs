import assert from 'node:assert/strict'
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

export function episodeDirectory(root, number) {
  assert.ok(Number.isSafeInteger(number) && number >= 1, 'Episode must be a positive integer')
  return number === 1 ? resolve(root) : resolve(root, `episode-${number}`)
}

export function episodeArgument(args) {
  const entries = args.filter(arg => arg === '--episode' || arg.startsWith('--episode='))
  assert.ok(entries.length <= 1, 'Specify --episode only once')
  if (!entries.length) return null
  const entry = entries[0]
  const value = entry === '--episode' ? args[args.indexOf(entry) + 1] : entry.slice('--episode='.length)
  assert.ok(/^\d+$/.test(value || ''), 'Use --episode N with a positive integer')
  const number = Number(value)
  episodeDirectory('.', number)
  return number
}

export function episodeStatePath(root, number) {
  const directory = episodeDirectory(root, number)
  const pointer = resolve(directory, 'published-revision.json')
  if (!existsSync(pointer)) return resolve(directory, 'state.json')
  const selected = JSON.parse(readFileSync(pointer, 'utf8'))
  assert.ok(/^revision-\d+$/.test(selected.directory || ''), 'Invalid published revision directory')
  const file = resolve(directory, selected.directory, 'state.json')
  const state = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(state.status, 'complete', 'Selected revision must be published')
  assert.equal(state.episodeId, selected.episodeId, 'Published revision identity changed')
  return file
}

export function nextEpisode(root) {
  const numbers = readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory() && /^episode-\d+$/.test(entry.name))
    .map(entry => Number(entry.name.slice(8))).filter(number => existsSync(resolve(episodeDirectory(root, number), 'state.json')))
  const latest = Math.max(1, ...numbers)
  const state = JSON.parse(readFileSync(episodeStatePath(root, latest), 'utf8'))
  return state.status === 'complete' ? latest + 1 : latest
}

export function lockEpisode(directory) {
  mkdirSync(directory, { recursive: true })
  const path = resolve(directory, 'production.lock')
  let descriptor
  try { descriptor = openSync(path, 'wx') } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`EPISODE_SCRIPT_LOCKED: ${path}; inspect the recorded process before removing a stale lock`)
    throw error
  }
  writeFileSync(descriptor, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }))
  let released = false
  const release = () => {
    if (released) return
    released = true
    closeSync(descriptor)
    unlinkSync(path)
    process.off('exit', release)
  }
  process.once('exit', release)
  return release
}

export function saveEpisode(path, state) {
  state.updatedAt = new Date().toISOString()
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, JSON.stringify(state, null, 2))
  renameSync(temporary, path)
}
