import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { readEnvFile } from '../server/src/config.mjs'

const require = createRequire(resolve(process.env.PLAYWRIGHT_MODULE_ROOT || '.', 'package.json'))
const { chromium } = require('playwright')
const output = resolve(process.env.COMIC_QA_OUTPUT || 'artifacts/comic-live-smoke')
const manifest = JSON.parse(readFileSync(resolve(output, process.env.COMIC_QA_MANIFEST || 'manifest.json'), 'utf8'))
const preview = process.env.COMIC_PREVIEW_URL || 'http://127.0.0.1:4184'
const env = { ...readEnvFile(resolve('server/.env')), ...process.env }
const login = await fetch(`${manifest.apiBase}/admin-api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ account: 'admin@mojing.local', password: env.DEV_ADMIN_PASSWORD || 'mojing-dev-only' }) })
assert.equal(login.status, 200)
const { token } = await login.json()
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) })
const verified = []
async function capture(page, name, width) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name}: overflow at ${width}px`)
  await page.screenshot({ path: resolve(output, `${name}-${width}.png`), fullPage: true })
}
async function loadedImages(page, selector) {
  const images = page.locator(selector)
  await images.first().waitFor()
  assert.equal(await images.count(), manifest.panelCount || 3)
  for (const img of await images.all()) {
    await img.scrollIntoViewIfNeeded()
    await img.evaluate(img => img.decode())
    assert.ok(await img.evaluate(img => img.naturalWidth > 0 && img.naturalHeight > img.naturalWidth))
  }
}
try {
  for (const width of [320, 390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(manifest.readerUrl)
    await loadedImages(page, 'figure img')
    await page.locator('.image-preview').first().click()
    await page.locator('dialog[open] img').evaluate(img => img.decode())
    await page.getByRole('button', { name: '关闭', exact: true }).click()
    assert.equal(await page.locator('dialog[open]').count(), 0)
    await capture(page, 'web-reader', width)

    const miniUrl = `${preview}/preview/?page=${encodeURIComponent(`/pages/comics/index?id=${manifest.episodeId}`)}`
    await page.goto(miniUrl)
    await loadedImages(page, '.comic-panel img')
    await page.locator('.comic-panel img').first().click()
    await page.locator('dialog[open] img').evaluate(img => img.decode())
    await page.getByRole('button', { name: '关闭', exact: true }).click()
    await capture(page, 'mini-reader', width)
    await page.locator('.comic-panel img').first().dispatchEvent('error')
    await page.getByRole('button', { name: '图片载入失败，重试' }).click()
    await page.locator('.comic-panel img').first().evaluate(img => img.decode())
    assert.equal(await page.locator('.comic-panel img').count(), manifest.panelCount || 3)

    await page.addInitScript(token => localStorage.setItem('mojing_admin_token', token), token)
    await page.goto(preview)
    await page.getByRole('button', { name: '条漫工作室', exact: true }).click()
    await page.locator('.comic-list button').filter({ hasText: manifest.title }).click()
    await loadedImages(page, '.panel-preview img')
    assert.equal(await page.getByRole('checkbox', { name: '审核通过' }).count(), manifest.panelCount || 3)
    assert.equal(await page.getByRole('button', { name: '生成缺失图片', exact: true }).isDisabled(), true)
    for (const check of await page.getByRole('checkbox', { name: '审核通过' }).all()) assert.equal(await check.isChecked(), true)
    assert.ok(await page.locator('.comic-jobs').getByText('已完成', { exact: false }).count() >= (manifest.panelCount || 3))
    await capture(page, 'studio', width)
    assert.deepEqual(errors, [])
    verified.push({ width, webReader: true, miniReader: true, zoom: true, imageRetry: true, studio: true, pageErrors: 0 })
    await page.close()
    console.log(`PASS ${width}px: real comic images, reader/zoom/retry, published studio, no overflow`)
  }
  writeFileSync(resolve(output, 'browser-results.json'), JSON.stringify({ apiBase: manifest.apiBase, verified, mockedApiResponses: false }, null, 2))
} finally { await browser.close() }
