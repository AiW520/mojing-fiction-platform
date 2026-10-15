import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const require = createRequire(resolve(process.env.PLAYWRIGHT_MODULE_ROOT || '.', 'package.json'))
const { chromium } = require('playwright')
const base = process.env.PREVIEW_URL || 'http://127.0.0.1:4173'
const output = resolve(process.env.QA_OUTPUT || 'artifacts/share-qa')
mkdirSync(output, { recursive: true })
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) })
try {
  for (const width of [320, 390, 768, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: width > 700 ? 900 : 844 } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript(() => {
      window.shareCalls = []
      Object.defineProperty(navigator, 'share', { configurable: true, value: async data => { window.shareCalls.push(data) } })
    })
    await page.goto(`${base}/preview/?page=${encodeURIComponent('/pages/book/detail?id=work_ghost_ledger')}`)
    const share = page.getByRole('button', { name: '分享作品' })
    await share.waitFor(); await page.waitForFunction(() => document.querySelector('button[open-type="share"]')?.disabled === false)
    const size = await share.boundingBox()
    assert.ok(size.width >= 44 && size.height >= 44)
    await share.click()
    const payload = await page.evaluate(() => window.shareCalls[0])
    assert.ok(new URL(payload.url).searchParams.get('page').includes('id=work_ghost_ledger'))
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: resolve(output, `detail-${width}.png`), fullPage: true })
    const chapters = await page.request.get(`${base}/api/works/work_ghost_ledger/chapters?limit=2`).then(response => response.json())
    const chapterId = chapters.items[1].id
    await page.route('**/api/auth/dev-login', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: '登录暂不可用' } }) }))
    await page.goto(`${base}/preview/?page=${encodeURIComponent(`/pages/reader/index?workId=work_ghost_ledger&chapterId=${chapterId}&shared=1`)}`)
    const readerShare = page.getByRole('button', { name: '分享阅读内容' })
    await page.waitForFunction(() => document.querySelector('button[open-type="share"]')?.disabled === false)
    await readerShare.click()
    const shared = await page.evaluate(() => window.shareCalls[0])
    assert.ok(new URL(shared.url).searchParams.get('page').includes(`chapterId=${chapterId}`))
    await page.screenshot({ path: resolve(output, `reader-${width}.png`) })
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'share', { configurable: true, value: undefined })
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { window.copiedShare = value } } })
    })
    await readerShare.click(); await page.getByText('阅读链接已复制').waitFor()
    assert.ok((await page.evaluate(() => window.copiedShare)).includes('shared'))
    await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw new Error('denied') } })
    await readerShare.click(); await page.locator('dialog[open]').waitFor()
    assert.ok(await page.getByRole('textbox', { name: '阅读链接' }).inputValue())
    await page.screenshot({ path: resolve(output, `share-dialog-${width}.png`) })
    await page.getByRole('button', { name: '关闭', exact: true }).click()
    await page.goto(`${base}/preview/?page=${encodeURIComponent('/pages/book/detail?id=missing-shared-work')}`)
    await page.getByRole('button', { name: '重新加载' }).waitFor()
    assert.equal(await page.getByRole('button', { name: '分享作品' }).isDisabled(), true)
    assert.deepEqual(errors, [])
    await page.close()
    console.log(`PASS ${width}px: share, copied link, clipboard fallback, chapter landing, invalid work`)
  }
} finally { await browser.close() }
