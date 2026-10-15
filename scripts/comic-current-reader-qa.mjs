import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const output = resolve(process.env.COMIC_PRODUCTION_DIR || '')
assert.ok(process.env.COMIC_PRODUCTION_DIR, 'Specify reviewed production directory')
const state = JSON.parse(readFileSync(resolve(output, 'state.json'), 'utf8'))
assert.equal(state.status, 'complete')
const base = state.apiBase
const episodeId = state.episodeId
mkdirSync(output, { recursive:true })
const moduleRoot = process.env.PLAYWRIGHT_MODULE_ROOT || 'C:/Users/ZhuanZ1/.cache/codex-runtimes/codex-primary-runtime/dependencies/node'
const { chromium } = createRequire(resolve(moduleRoot, 'package.json'))('playwright')
const response = await fetch(`${base}/api/comics/${episodeId}`)
assert.equal(response.status, 200)
const { episode } = await response.json()
assert.equal(episode.panels.length, state.panelCount)
for (const panel of episode.panels) {
  assert.ok(panel.imageWidth > 0 && panel.imageHeight > panel.imageWidth)
  assert.equal((await fetch(`${base}/api/comic-media/${panel.imageId}/original`)).status, 404)
}
const browser = await chromium.launch({ headless:true, executablePath:process.env.CHROMIUM_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe' })
const verified = []
try {
  for (const width of [320,390,1440]) {
    const page = await browser.newPage({ viewport:{ width, height:900 } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    assert.equal((await page.goto(`${base}/comics/${episodeId}`)).status(), 200)
    const images = page.locator('.image-preview img')
    assert.equal(await images.count(), state.panelCount)
    for (let index = 0; index < state.panelCount; index++) {
      const current = images.nth(index)
      await current.scrollIntoViewIfNeeded()
      await current.evaluate(img => img.decode())
      assert.ok(await current.evaluate(img => img.naturalWidth > 0 && img.naturalHeight > img.naturalWidth))
      const box = await current.boundingBox()
      assert.ok(box.width > 0 && box.x >= 0 && box.x + box.width <= width + 1)
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await images.first().click()
    const dialog = page.locator('dialog[open]')
    await dialog.locator('img').evaluate(img => img.decode())
    await page.getByRole('button', { name:'下一张', exact:true }).click()
    assert.equal(await page.locator('.viewer-count').innerText(), `2 / ${state.panelCount}`)
    await page.getByRole('button', { name:'放大', exact:true }).click()
    assert.equal(await dialog.locator('img').evaluate(img => img.style.width), '150%')
    await page.getByRole('button', { name:'缩小', exact:true }).click()
    assert.equal(await dialog.locator('img').evaluate(img => img.style.width), '100%')
    await page.getByRole('button', { name:'关闭', exact:true }).click()
    assert.equal(await page.locator('dialog[open]').count(), 0)
    await page.screenshot({ path:resolve(output, `reader-${width}.png`), fullPage:true })
    assert.deepEqual(errors, [])
    verified.push({ width, images:state.panelCount, noOverflow:true, zoom:true, next:true, pageErrors:0 })
    await page.close()
  }
} finally { await browser.close() }
writeFileSync(resolve(output, 'reader-results.json'), JSON.stringify({ episodeId, readerUrl:`${base}/comics/${episodeId}`, verified, anonymousOriginals:404 }, null, 2))
console.log(JSON.stringify({ episodeId, verified }))
