import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const require = createRequire(resolve(process.env.PLAYWRIGHT_MODULE_ROOT || '.', 'package.json'))
const { chromium } = require('playwright')
const base = process.env.PREVIEW_URL || 'http://127.0.0.1:4173'
const home = `${base}/preview/?page=${encodeURIComponent('/pages/home/index')}`
const output = resolve(process.env.QA_OUTPUT || 'artifacts/library-qa')
mkdirSync(output, { recursive: true })
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) })
try {
  for (const width of [320, 390, 768, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: width >= 700 ? 900 : 844 } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(home)
    await page.locator('.book-tile').first().waitFor()
    for (const image of await page.locator('.library-page img').all()) {
      await image.scrollIntoViewIfNeeded()
      await image.evaluate(image => image.complete && image.naturalWidth > 0 || new Promise((resolve, reject) => { image.addEventListener('load', resolve, { once: true }); image.addEventListener('error', reject, { once: true }) }))
    }
    await page.evaluate(() => scrollTo(0, 0))
    await page.waitForFunction(() => [...document.querySelectorAll('.library-page img')].every(image => image.complete && image.naturalWidth > 0))
    assert.equal(await page.locator('.book-tile').count(), 9)
    assert.equal(await page.locator('.resume-row').count(), 0)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    const columns = await page.locator('.book-grid').first().evaluate(grid => getComputedStyle(grid).gridTemplateColumns.split(' ').length)
    assert.equal(columns, width < 600 ? 2 : width < 1000 ? 3 : 4)
    for (const control of await page.locator('.category-tab, .library-icon-button, .library-nav-item').all()) {
      const box = await control.boundingBox(); assert.ok(box.width >= 44 && box.height >= 44)
    }
    await page.screenshot({ path: resolve(output, `home-${width}.png`), fullPage: true })
    await page.getByRole('button', { name: '短篇', exact: true }).click()
    assert.equal(await page.locator('.book-tile').count(), 6)
    assert.equal(await page.locator('.longform-section').count(), 0)
    await page.getByRole('button', { name: '刷新书城' }).click()
    await page.waitForFunction(() => !document.querySelector('[aria-label="刷新书城"]').disabled)
    assert.equal(await page.locator('.book-tile').count(), 6)
    await page.screenshot({ path: resolve(output, `short-${width}.png`), fullPage: true })
    await page.getByRole('button', { name: '长篇', exact: true }).click()
    assert.equal(await page.locator('.book-tile').count(), 3)
    await page.locator('.book-tile').first().click()
    await page.waitForURL(url => url.searchParams.get('page')?.startsWith('/pages/book/detail?id='))
    await page.goto(home)
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('mojing_session') || 'null')?.userId)
    await page.evaluate(() => {
      const session = JSON.parse(localStorage.getItem('mojing_session'))
      localStorage.setItem('mojing_last_work', JSON.stringify({ userId: session.userId, workId: 'work_ghost_ledger' }))
      localStorage.setItem(`mojing_position_${session.userId}_work_ghost_ledger`, JSON.stringify({ progress: 43, blockId: 'position-test', pending: true, updatedAt: Date.now() }))
    })
    await page.reload(); await page.locator('.resume-row').waitFor()
    assert.match(await page.locator('.resume-row').innerText(), /43%/)
    await page.screenshot({ path: resolve(output, `resume-${width}.png`) })
    await page.route('**/api/works', route => route.abort())
    await page.reload(); await page.locator('.library-offline').waitFor()
    assert.equal(await page.locator('.book-tile').count(), 9)
    await page.screenshot({ path: resolve(output, `offline-${width}.png`) })
    await page.unroute('**/api/works')
    await page.route('**/*cover-ink-v2.webp', route => route.abort())
    await page.reload(); await page.waitForFunction(() => !!document.querySelector('[data-id="work_ghost_ledger"] .type-cover'))
    await page.screenshot({ path: resolve(output, `missing-cover-${width}.png`) })
    assert.deepEqual(errors, [])
    await page.close()
    console.log(`PASS ${width}px: layout, all assets, categories, refresh, book navigation, resume, offline, cover fallback`)
  }
  const errorPage = await browser.newPage()
  await errorPage.route('**/api/works', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":{"message":"测试连接失败"}}' }))
  await errorPage.goto(home); await errorPage.getByText('书城暂时无法连接', { exact: true }).waitFor()
  await errorPage.unroute('**/api/works')
  await errorPage.getByRole('button', { name: '重新连接', exact: true }).click()
  await errorPage.locator('.book-tile').first().waitFor(); await errorPage.close()
  console.log('PASS empty-cache network failure and retry')
} finally { await browser.close() }
