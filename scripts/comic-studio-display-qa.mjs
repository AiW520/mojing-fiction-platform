import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { readEnvFile } from '../server/src/config.mjs'

const require = createRequire(resolve(process.env.PLAYWRIGHT_MODULE_ROOT || '.', 'package.json'))
const { chromium } = require('playwright')
const env = { ...readEnvFile(resolve('server/.env')), ...process.env }
const preview = 'http://127.0.0.1:5193'
const response = await fetch(`${preview}/admin-api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ account: 'admin@mojing.local', password: env.DEV_ADMIN_PASSWORD || 'mojing-dev-only' }),
})
assert.equal(response.status, 200)
const { token } = await response.json()
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE })
try {
  for (const width of [320, 390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    const errors = []
    const writes = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('request', request => { if (request.url().includes('/admin-api/') && request.method() !== 'GET') writes.push(request.url()) })
    await page.addInitScript(token => localStorage.setItem('mojing_admin_token', token), token)
    await page.goto(preview)
    await page.getByRole('button', { name: '条漫工作室', exact: true }).click()
    const source = page.locator('.comic-source').filter({ hasText: '青春校园重生' })
    await source.waitFor()
    assert.equal(await page.getByText('暂无漫画草稿', { exact: true }).count(), 0)
    await source.click()
    assert.equal(await page.locator('.comic-create select').first().inputValue(), 'ba0740fc-6065-419f-b537-0ceb3de26e59')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    assert.deepEqual(errors, [])
    await page.screenshot({ path: resolve(`artifacts/campus-rebirth-comic/studio-display-${width}.png`), fullPage: true })
    const actual = await page.request.get(`${preview}/admin-api/comics`, { headers: { Authorization: `Bearer ${token}` } })
    const { items } = await actual.json()
    const external = { id: 'display-qa-external', workId: 'ba0740fc-6065-419f-b537-0ceb3de26e59', title: 'QA external draft', version: 1,
      sourceLength: 1, panels: [{ id: 'qa-panel', prompt: 'Original scene', narration: '', dialogue: '', imageId: null, approved: false }], published: false }
    await page.route('**/admin-api/comics', route => route.fulfill({ json: { items: [external, ...items] } }))
    await page.route(`**/admin-api/comics/${external.id}`, route => route.fulfill({ json: { episode: external } }))
    await page.route(`**/admin-api/comics/${external.id}/jobs`, route => route.fulfill({ json: { items: [] } }))
    const draft = page.locator('.comic-list button').filter({ hasText: external.title })
    await draft.waitFor({ timeout: 10000 })
    assert.equal(await page.locator('.comic-source').filter({ hasText: '青春校园重生' }).count(), 0)
    await draft.click()
    await page.getByRole('textbox', { name: '画面描述' }).fill('Unsaved user edit')
    await page.waitForTimeout(4500)
    assert.equal(await page.getByRole('textbox', { name: '画面描述' }).inputValue(), 'Unsaved user edit')
    assert.equal(await page.locator('.comic-toolbar').getByText('未保存', { exact: false }).count(), 1)
    assert.deepEqual(writes, [])
    console.log(`PASS ${width}px: campus project visible, adaptation form preselected, no overflow or page errors`)
    console.log(`PASS ${width}px: external draft appears automatically; unsaved editor changes survive list refresh (mocked draft, no content writes)`)
    await page.close()
  }
} finally { await browser.close() }
