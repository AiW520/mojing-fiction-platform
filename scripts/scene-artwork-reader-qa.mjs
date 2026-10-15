import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const args = process.argv.slice(2)
const chapterNumber = Number(args.find(value => !value.startsWith('--book=')) || 2)
const bookDir = args.find(value => value.startsWith('--book='))?.slice(7) || 'bone-lantern'
const plan = JSON.parse(readFileSync(resolve('artifacts/full-scene-artwork/plan.json'), 'utf8'))
const bookId = plan.entries.find(item => item.bookDir === bookDir)?.bookId
assert.ok(bookId && Number.isInteger(chapterNumber) && chapterNumber > 0 && plan.entries.some(item => item.bookId === bookId && item.chapterNumber === chapterNumber))
const require = createRequire(resolve(process.env.PLAYWRIGHT_MODULE_ROOT || '.', 'package.json'))
const { chromium } = require('playwright')
const base = process.env.PREVIEW_URL || 'http://127.0.0.1:4173'
const chapterId = `${bookId}_chapter_${String(chapterNumber).padStart(3, '0')}`
const apiBase = process.env.QA_API_BASE || 'http://127.0.0.1:3000'
const assetBase = process.env.QA_ASSET_BASE || apiBase
const response = await fetch(`${apiBase}/api/chapters/${chapterId}`)
assert.equal(response.status, 200)
const { chapter } = await response.json()
const paragraphs = chapter.content.split(/\n\s*\n/).map(value => value.trim()).filter(Boolean).length
const output = resolve(process.env.QA_OUTPUT || `artifacts/full-scene-artwork/reader-qa-${bookDir === 'bone-lantern' ? '' : `${bookDir}-`}${chapterNumber}`)
mkdirSync(output, { recursive: true })
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) })
try {
  for (const width of [320, 390, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: width >= 700 ? 900 : 844 } })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/api/**', async route => {
      if (route.request().method() !== 'GET') return route.fulfill({ status: 503, json: { error: { message: '只读验收' } } })
      const url = new URL(route.request().url())
      if (url.pathname.startsWith('/api/assets/') && assetBase !== apiBase) {
        const media = await route.fetch({ url: new URL(`${url.pathname}${url.search}`, assetBase).href })
        return route.fulfill({ response: media })
      }
      return route.continue()
    })
    await page.goto(`${base}/preview/?page=${encodeURIComponent(`/pages/reader/index?workId=${bookId}&chapterId=${chapterId}`)}`)
    await page.waitForFunction(() => document.querySelectorAll('.illustration-frame').length === 5)
    const frames = page.locator('.illustration-frame')
    assert.equal(await page.locator('.reader-paragraph').count(), paragraphs)
    for (let index = 0; index < 5; index++) {
      const frame = frames.nth(index)
      await frame.scrollIntoViewIfNeeded()
      const img = frame.locator('img')
      await page.waitForFunction(index => {
        const image = document.querySelectorAll('.illustration-frame img')[index]
        return image?.complete && image.naturalWidth > 0
      }, index)
      await img.evaluate(image => image.decode())
      assert.ok(/\/api\/assets\/|\/assets\/books\//.test(await img.getAttribute('src')), 'Image must be published or a reused book illustration')
      const box = await frame.boundingBox()
      assert.ok(box.width > 200 && box.x >= 0 && box.x + box.width <= width + 1)
      assert.ok(Math.abs(box.height / box.width - 2 / 3) < .01)
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
    assert.equal(await page.locator('.reader-paragraph').count(), paragraphs)
    await toggle.check()
    assert.equal(await frames.count(), 5)
    await page.locator('.sheet-mask').click({ position: { x: 5, y: 5 } })
    await frames.first().scrollIntoViewIfNeeded()
    const scrollBeforeImageError = await page.locator('.reader-scroll').evaluate(node => node.scrollTop)
    await frames.first().locator('img').dispatchEvent('error')
    assert.equal(await frames.count(), 5)
    await page.getByRole('button', { name: '插图未载入，点击重试' }).click()
    await page.waitForFunction(() => document.querySelector('.illustration-frame img')?.complete)
    assert.equal(await frames.count(), 5)
    assert.equal(await page.locator('.reader-scroll').evaluate(node => node.scrollTop), scrollBeforeImageError)
    assert.equal(await page.locator('.reader-paragraph').count(), paragraphs)
    assert.deepEqual(errors, [])
    console.log(`PASS chapter ${chapterNumber} ${width}px: five published images, enlargement, toggle, no overflow, error isolation`)
    await context.close()
  }
} finally { await browser.close() }
