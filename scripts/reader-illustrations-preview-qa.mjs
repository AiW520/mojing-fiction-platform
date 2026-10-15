import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const require = createRequire(resolve(process.env.PLAYWRIGHT_MODULE_ROOT || '.', 'package.json'))
const { chromium } = require('playwright')
const base = process.env.PREVIEW_URL || 'http://127.0.0.1:4173'
const output = resolve(process.env.QA_OUTPUT || 'artifacts/reader-illustrations-qa')
mkdirSync(output, { recursive: true })
// All API responses and artwork below are isolated layout fixtures, never book publication.
const artwork = readFileSync(resolve('server/content/cold-command/artifacts/chapter-065-original/04-courtyard-cart-mobile.webp'))
const work = { id: 'qa-reader', title: '插图布局测试', author: 'QA', status: 'published', format: 'longform', serializationStatus: 'serializing' }
const chapter = { id: 'qa-chapter', chapterNumber: 1, title: '正文与场景', volumeTitle: '排版验收', wordCount: 3000,
  content: Array.from({ length: 10 }, (_, index) => `第${index + 1}段。` + '冬日的院落中，众人退到安全的位置，等木架停稳后再清点物件。'.repeat(5)).join('\n\n') }
const assets = [0, 2, 4, 6, 8].map((paragraphIndex, index) => ({ id: `qa-image-${index}`, chapterId: chapter.id, type: 'scene', title: `场景测试 ${index + 1}`, paragraphIndex, sortOrder: index, url: `/api/assets/qa-${index}` }))
const nextChapter = { ...chapter, id: 'qa-next-chapter', chapterNumber: 2, title: '下一章重连测试' }
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) })
try {
  for (const width of [320, 390, 768, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: width >= 700 ? 900 : 844 } })
    const errors = []
    const consoleErrors = []
    const failedRequests = []
    let failNextChapter = true
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
    page.on('requestfailed', request => failedRequests.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText || 'failed'}`))
    await page.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname
      if (path.startsWith('/api/assets/')) return route.fulfill({ status: 200, contentType: 'image/webp', body: artwork })
      let body
      if (path.endsWith('/reader-bootstrap')) body = { work, mode: 'longform', chapters: [chapter, nextChapter], assets, shortChapters: [], chapter, prev: null, next: nextChapter }
      else if (path.endsWith('/assets')) body = { items: assets }
      else if (path.endsWith('/chapters')) body = { items: [chapter, nextChapter], total: 2 }
      else if (path === `/api/chapters/${nextChapter.id}`) {
        if (failNextChapter) return route.fulfill({ status: 503, json: { error: { message: '下一章暂时不可用' } } })
        body = { chapter: nextChapter, prev: chapter, next: null }
      }
      else if (path.startsWith('/api/chapters/')) body = { chapter, prev: null, next: nextChapter }
      else if (path === '/api/auth/dev-login') return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: 'QA登录隔离' } }) })
      else if (path === '/api/works/qa-reader') body = { work }
      else throw new Error(`Unexpected layout request: ${path}`)
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    })
    await page.goto(`${base}/preview/?page=${encodeURIComponent(`/pages/reader/index?workId=${work.id}&chapterId=${chapter.id}`)}`)
    try {
      await page.locator('.illustration-frame').first().waitFor({ timeout: 10000 })
    } catch (error) {
      console.error(`Reader preview diagnostics at ${width}px:`, JSON.stringify({
        title: await page.title(),
        body: (await page.locator('body').innerText()).slice(0, 2500),
        pageErrors: errors,
        consoleErrors,
        failedRequests,
        url: page.url(),
      }, null, 2))
      throw error
    }
    assert.equal(await page.locator('.illustration-frame').count(), 5)
    assert.equal(await page.locator('.reader-paragraph').count(), 10)
    assert.equal(await page.getByRole('button', { name: '上一章', exact: true }).isDisabled(), true)
    for (const frame of await page.locator('.illustration-frame').all()) {
      const box = await frame.boundingBox()
      assert.ok(box.width > 200 && box.x >= 0 && box.x + box.width <= width + 1)
      assert.ok(Math.abs(box.height / box.width - 2 / 3) < .01)
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.locator('.illustration-frame img').first().click()
    await page.locator('dialog[open] img').waitFor()
    assert.equal(await page.locator('dialog[open] img').evaluate(img => img.complete && img.naturalWidth > 0), true)
    await page.getByRole('button', { name: '关闭', exact: true }).click()
    await page.screenshot({ path: resolve(output, `reader-${width}.png`) })
    await page.getByText('设置', { exact: true }).click()
    await page.locator('.settings-sheet input[type="checkbox"]').uncheck()
    assert.equal(await page.locator('.illustration-frame').count(), 0)
    assert.equal(await page.locator('.reader-paragraph').count(), 10)
    await page.locator('.settings-sheet input[type="checkbox"]').check()
    assert.equal(await page.locator('.illustration-frame').count(), 5)
    for (const [decrease, increase, steps] of [['减小字号', '增大字号', 11], ['减小行距', '增大行距', 9]]) {
      const down = page.getByRole('button', { name: decrease, exact: true })
      const up = page.getByRole('button', { name: increase, exact: true })
      while (await down.isEnabled()) await down.click()
      assert.equal(await down.isDisabled(), true)
      for (let index = 0; index < steps; index++) await up.click()
      assert.equal(await up.isDisabled(), true)
    }
    await page.locator('.theme-option.ink').click()
    assert.equal(await page.locator('.reader-page.theme-ink').count(), 1)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: resolve(output, `settings-${width}.png`) })
    await page.locator('.sheet-mask').click({ position: { x: 5, y: 5 } })
    await page.locator('.illustration-frame img').first().dispatchEvent('error')
    assert.equal(await page.locator('.illustration-frame').count(), 5)
    await page.getByRole('button', { name: '插图未载入，点击重试' }).click()
    await page.waitForFunction(() => {
      const image = document.querySelector('.illustration-frame img')
      return image?.complete && image.naturalWidth > 0
    })
    assert.equal(await page.locator('.reader-paragraph').count(), 10)
    await page.getByRole('button', { name: '下一章', exact: true }).click()
    await page.getByText('下一章暂时不可用', { exact: true }).waitFor()
    failNextChapter = false
    await page.getByRole('button', { name: '重新连接', exact: true }).click()
    await page.waitForFunction(title => document.querySelector('.long-chapter-title')?.textContent === title, nextChapter.title)
    assert.equal(await page.getByRole('button', { name: '下一章', exact: true }).isDisabled(), true)
    assert.deepEqual(errors, [])
    await page.close()
    console.log(`PASS ${width}px: five anchors, preview, toggle, image retry, settings limits, chapter boundaries, correct failed-chapter retry`)
  }
} finally { await browser.close() }
