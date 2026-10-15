import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { readEnvFile } from '../server/src/config.mjs'

const root = resolve(import.meta.dirname, '..')
const output = resolve(root, 'artifacts/campus-rebirth-comic')
const runtime = JSON.parse(readFileSync(resolve(output, 'runtime.json'), 'utf8'))
const state = JSON.parse(readFileSync(resolve(output, 'state.json'), 'utf8'))
const episodeState = state.episodes.find(episode => episode.number === 1)
assert.ok(episodeState?.episodeId, 'A reviewed story and comic draft are required')
const env = { ...readEnvFile(resolve(root, 'server/.env')), ...process.env }
const login = await fetch(`${runtime.apiBase}/admin-api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ account: 'admin@mojing.local', password: env.DEV_ADMIN_PASSWORD || 'mojing-dev-only' }),
})
assert.equal(login.status, 200)
const { token } = await login.json()
const response = await fetch(`${runtime.apiBase}/admin-api/comics/${episodeState.episodeId}`, { headers: { Authorization: `Bearer ${token}` } })
assert.equal(response.status, 200)
const { episode } = await response.json()
assert.equal(episode.published, false)
for (const path of [`/api/comics/${episode.id}`, `/comics/${episode.id}`]) {
  assert.equal((await fetch(`${runtime.apiBase}${path}`)).status, 404, 'Review draft must stay private')
}
const { chromium } = createRequire(resolve(process.env.PLAYWRIGHT_MODULE_ROOT || root, 'package.json'))('playwright')
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) })
const verified = []
try {
  for (const width of [320, 390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    const errors = []; const writes = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/admin-api/**', route => {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) {
        writes.push(route.request().url())
        return route.abort()
      }
      return route.continue()
    })
    await page.addInitScript(token => localStorage.setItem('mojing_admin_token', token), token)
    await page.goto(runtime.adminUrl)
    await page.getByRole('button', { name: '条漫工作室', exact: true }).click()
    await page.locator('.comic-list button').filter({ hasText: episode.title }).click()
    await page.locator('.comic-toolbar h2').filter({ hasText: episode.title }).waitFor()
    assert.equal(await page.locator('.panel-editor').count(), episode.panels.length)
    const expectedImages = episode.panels.filter(panel => panel.imageId).length
    const images = page.locator('.panel-preview img')
    if (expectedImages) await images.first().waitFor()
    assert.equal(await images.count(), expectedImages)
    for (const img of await images.all()) {
      await img.scrollIntoViewIfNeeded()
      await img.evaluate(img => img.decode())
      assert.ok(await img.evaluate(img => img.naturalWidth > 0 && img.naturalHeight > img.naturalWidth))
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    assert.deepEqual(errors, []); assert.deepEqual(writes, [])
    await page.screenshot({ path: resolve(output, `campus-draft-${width}.png`), fullPage: true })
    verified.push({ width, panels: episode.panels.length, images: expectedImages, noOverflow: true, pageErrors: 0, mutations: 0 })
    console.log(`PASS ${width}px: real campus draft visible, ${expectedImages} images, no overflow or mutations`)
    await page.close()
  }
  writeFileSync(resolve(output, 'campus-draft-browser-results.json'), JSON.stringify({ episodeId: episode.id, title: episode.title, unpublished: true, mockedApiResponses: false, verified }, null, 2))
} finally { await browser.close() }
