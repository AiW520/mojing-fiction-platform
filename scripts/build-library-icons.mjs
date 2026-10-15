import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const adminRequire = createRequire(resolve(root, 'admin-web/package.json'))
const serverRequire = createRequire(resolve(root, 'server/package.json'))
const { createSSRApp, h } = adminRequire('vue')
const { renderToString } = adminRequire('@vue/server-renderer')
const icons = adminRequire('lucide-vue-next')
const sharp = serverRequire('sharp')
const directory = resolve(root, 'miniprogram/assets/icons/library')
mkdirSync(directory, { recursive: true })
const entries = { search: 'Search', user: 'UserRound', books: 'Library', read: 'BookOpen', plus: 'Plus', arrow: 'ArrowRight', refresh: 'RefreshCw', back: 'ArrowLeft', share: 'Share2', star: 'Star', like: 'ThumbsUp', message: 'MessageCircle', more: 'Ellipsis', close: 'X', pen: 'PenLine' }
for (const [name, component] of Object.entries(entries)) {
  for (const [variant, color] of [['ink', '#545760'], ['active', '#007aff']]) {
    const svg = await renderToString(createSSRApp({ render: () => h(icons[component], { size: 72, color, strokeWidth: 1.7 }) }))
    const png = await sharp(Buffer.from(svg)).png().toBuffer()
    writeFileSync(resolve(directory, `${name}-${variant}.png`), png)
  }
}
console.log(`Built ${Object.keys(entries).length * 2} library icons from the existing Lucide icon library.`)
