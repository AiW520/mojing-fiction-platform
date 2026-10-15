import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const output = resolve(root, 'artifacts/campus-rebirth-comic')
const state = JSON.parse(readFileSync(resolve(output, 'state.json'), 'utf8'))
const number = Number(process.argv.find(arg => arg.startsWith('--episode='))?.split('=')[1] || 1)
const episode = state.episodes.find(e => e.number === number)
assert.ok(episode?.published)
const response = await fetch(`${state.apiBase}/api/comics/${episode.episodeId}`)
assert.equal(response.status, 200)
const { episode: published } = await response.json()
for (const panel of published.panels) {
  assert.equal((await fetch(`${state.apiBase}/api/comic-media/${panel.imageId}`)).status, 200)
  assert.equal((await fetch(`${state.apiBase}/api/comic-media/${panel.imageId}/original`)).status, 404)
}
const moduleRoot = process.env.PLAYWRIGHT_MODULE_ROOT || 'C:/Users/ZhuanZ1/.cache/codex-runtimes/codex-primary-runtime/dependencies/node'
const { chromium } = createRequire(resolve(moduleRoot, 'package.json'))('playwright')
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe' })
const verified = []
try {
  for (const width of [320, 390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    const navigation = await page.goto(`${state.apiBase}/comics/${episode.episodeId}`)
    assert.equal(navigation.status(), 200)
    const images = page.locator('.image-preview img')
    assert.equal(await images.count(), published.panels.length)
    for (const img of await images.all()) {
      await img.scrollIntoViewIfNeeded()
      await img.evaluate(image => image.decode())
      assert.ok(await img.evaluate(image => image.naturalWidth > 0))
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await images.first().click()
    assert.equal(await page.locator('dialog').evaluate(el => el.open), true)
    await page.getByRole('button', { name: '下一张', exact: true }).click()
    assert.equal(await page.locator('.viewer-count').innerText(), `2 / ${published.panels.length}`)
    await page.getByRole('button', { name: '关闭', exact: true }).click()
    assert.deepEqual(errors, [])
    await page.screenshot({ path: resolve(output, `episode-${number}/reader-${width}.png`), fullPage: true })
    verified.push({ width, images: published.panels.length, pageErrors: 0, noOverflow: true, viewer: true })
    await page.close()
  }
} finally { await browser.close() }
writeFileSync(resolve(output, `episode-${number}/reader-results.json`), JSON.stringify({ episodeId: episode.episodeId, publishedVersion: episode.publishedVersion, readerUrl: `${state.apiBase}/comics/${episode.episodeId}`, publicImages: true, anonymousOriginals: 404, verified }, null, 2))
console.log(JSON.stringify({ episode: number, verified }))
