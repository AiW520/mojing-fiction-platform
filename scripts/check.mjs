import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const root = resolve(import.meta.dirname, '..')
const require = createRequire(resolve(root, 'admin-web/package.json'))
const sass = require('sass')
function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status || 1)
}
run([require.resolve('typescript/bin/tsc'), '--noEmit', '-p', 'tsconfig.json'])
run([require.resolve('vue-tsc/bin/vue-tsc.js'), '--noEmit', '-p', 'admin-web/tsconfig.json'])
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(resolve(directory, entry.name)) : [resolve(directory, entry.name)])
}
for (const path of files(resolve(root, 'server')).filter(path => path.endsWith('.mjs') && !path.includes('node_modules'))) run(['--check', path])
const styles = files(resolve(root, 'miniprogram')).filter(path => path.endsWith('.scss'))
for (const path of styles) sass.compile(path, { silenceDeprecations: ['import'] })
console.log(`PASS: Mini program TypeScript, admin TypeScript, server syntax, ${styles.length} Sass files.`)
