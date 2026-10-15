import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const require = createRequire(resolve(process.env.PLAYWRIGHT_MODULE_ROOT || '.', 'package.json'))
const { chromium } = require('playwright')
const base = process.env.PREVIEW_URL || 'http://127.0.0.1:4173'
const output = resolve('artifacts/chapter-065-reader-qa')
mkdirSync(output, { recursive: true })
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) })
try {
  for (const width of [320, 390, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: width >= 700 ? 900 : 844 } })
    const page = await context.newPage()
    const errors = []
    const failedImages = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('response', response => { if (response.status() >= 400 && /\.(webp|png)(\?|$)/.test(response.url())) failedImages.push(`${response.status()} ${response.url()}`) })
    // Public catalog and images use the real server; block all stateful API calls.
    await page.route('**/api/**', async route => {
      if (route.request().method() !== 'GET') return route.fulfill({ status: 503, json: { error: { message: '只读验收' } } })
      await route.continue()
    })
    await page.goto(`${base}/preview/?page=${encodeURIComponent('/pages/reader/index?workId=work_cold_command&chapterId=work_cold_command_chapter_065')}`)
    await page.locator('.illustration-frame').first().waitFor()
    try { await page.waitForFunction(() => document.querySelectorAll('.illustration-frame').length === 5, null, { timeout: 5000 }) }
    catch (error) {
      console.error(JSON.stringify({ errors, failedImages, images: await page.locator('.illustration-frame img').evaluateAll(images => images.map(image => ({ src: image.src, complete: image.complete, width: image.naturalWidth }))) }, null, 2))
      throw error
    }
    assert.equal(await page.locator('.illustration-frame').count(), 5)
    assert.equal(await page.locator('.reader-paragraph').count(), 62)
    const frames = page.locator('.illustration-frame')
    for (let index = 0; index < 5; index++) {
      const frame = frames.nth(index)
      await frame.scrollIntoViewIfNeeded()
      const img = frame.locator('img')
      await page.waitForFunction(index => {
        const image = document.querySelectorAll('.illustration-frame img')[index]
        return image?.complete && image.naturalWidth > 0
      }, index, { timeout: 10000 })
      try { await img.evaluate(image => image.decode()) }
      catch (error) { console.error(JSON.stringify({ width, index, src: await img.getAttribute('src'), failedImages, errors })); throw error }
      const box = await frame.boundingBox()
      assert.ok(box.width > 200 && box.x >= 0 && box.x + box.width <= width + 1)
      assert.ok(Math.abs(box.height / box.width - 2 / 3) < .01)
      assert.ok(await img.evaluate(image => image.naturalWidth > 0))
      if (index === 0 || index === 4) await page.screenshot({ path: resolve(output, `reader-${width}-scene-${index + 1}.png`) })
      await img.click()
      const enlarged = page.locator('dialog[open] img')
      await enlarged.evaluate(image => image.decode())
      assert.ok(await enlarged.evaluate(image => image.naturalWidth > 0))
      await page.getByRole('button', { name: '关闭', exact: true }).click()
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await page.getByText('设置', { exact: true }).click()
    const toggle = page.locator('.settings-sheet input[type="checkbox"]')
    await toggle.uncheck()
    assert.equal(await frames.count(), 0)
    assert.equal(await page.locator('.reader-paragraph').count(), 62)
    await toggle.check()
    assert.equal(await frames.count(), 5)
    await page.locator('.sheet-mask').click({ position: { x: 5, y: 5 } })
    await frames.first().locator('img').dispatchEvent('error')
    assert.equal(await frames.count(), 4)
    assert.equal(await page.locator('.reader-paragraph').count(), 62)
    assert.deepEqual(errors, [])
    console.log(`PASS ${width}px: real chapter 65, five real images, enlarged images, switch, no overflow, error isolation`)
    await page.goto(`${base}/preview/?page=${encodeURIComponent('/pages/home/index')}`)
    await page.locator('.book-tile').first().waitFor()
    const covers = page.locator('.book-tile img')
    assert.equal(await covers.count(), 9)
    for (const cover of await covers.all()) {
      await cover.scrollIntoViewIfNeeded()
      await cover.evaluate(image => { image.loading = 'eager' })
      await cover.evaluate(image => image.decode())
      assert.ok(await cover.evaluate(image => image.naturalWidth > 0))
    }
    assert.deepEqual(errors, [])
    console.log(`PASS ${width}px: all nine published book covers load in the real library`)
    await context.close()
  }
} finally { await browser.close() }
