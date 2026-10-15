import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { readEnvFile } from '../server/src/config.mjs'

const { chromium } = createRequire(resolve(process.env.PLAYWRIGHT_MODULE_ROOT || '.', 'package.json'))('playwright')
const output = resolve(process.env.COMIC_QA_OUTPUT || 'artifacts/comic-platform-production/episode-3')
const state = JSON.parse(readFileSync(resolve(output, 'state.json'), 'utf8'))
const preview = process.env.COMIC_PREVIEW_URL || 'http://127.0.0.1:4173'
const env = { ...readEnvFile(resolve('server/.env')), ...process.env }
const login = await fetch(`${state.apiBase}/admin-api/auth/login`, { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ account:'admin@mojing.local', password:env.DEV_ADMIN_PASSWORD || 'mojing-dev-only' }) })
assert.equal(login.status, 200)
const { token } = await login.json()
for (const path of [`/api/comics/${state.episodeId}`, `/comics/${state.episodeId}`]) assert.equal((await fetch(`${state.apiBase}${path}`)).status, 404, 'Draft must not be publicly readable')
const response = await fetch(`${state.apiBase}/admin-api/comics/${state.episodeId}`, { headers:{ Authorization:`Bearer ${token}` } })
assert.equal(response.status, 200)
const { episode } = await response.json()
assert.equal(episode.published, false)
assert.ok(episode.panels.every(panel => panel.imageId && !panel.approved))
const browser = await chromium.launch({ headless:true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath:process.env.CHROMIUM_EXECUTABLE } : {}) })
const verified = []
try {
  for (const width of [320,390,1440]) {
    const page = await browser.newPage({ viewport:{ width, height:900 } })
    const errors = []; page.on('pageerror', error => errors.push(error.message))
    const writes = []
    await page.route('**/admin-api/**', route => {
      if (!['GET','HEAD','OPTIONS'].includes(route.request().method())) {
        writes.push({ method:route.request().method(), url:route.request().url() })
        return route.abort()
      }
      return route.continue()
    })
    await page.addInitScript(token => localStorage.setItem('mojing_admin_token', token), token)
    await page.goto(preview)
    await page.getByRole('button', { name:'条漫工作室', exact:true }).click()
    await page.locator('.comic-list button').filter({ hasText:state.title }).click()
    const images = page.locator('.panel-preview img')
    await images.first().waitFor()
    assert.equal(await images.count(), episode.panels.length)
    for (const img of await images.all()) {
      await img.scrollIntoViewIfNeeded(); await img.evaluate(img => img.decode())
      assert.ok(await img.evaluate(img => img.naturalWidth > 0 && img.naturalHeight > img.naturalWidth))
      const box = await img.boundingBox()
      assert.ok(box.width > 0 && box.height > 0)
    }
    const checks = page.getByRole('checkbox', { name:'审核通过' })
    assert.equal(await checks.count(), episode.panels.length)
    for (const check of await checks.all()) assert.equal(await check.isChecked(), false)
    assert.equal(await page.getByRole('button', { name:'生成缺失图片', exact:true }).isDisabled(), true)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Overflow at ${width}px`)
    assert.deepEqual(errors, []); assert.deepEqual(writes, [])
    await page.screenshot({ path:resolve(output, `draft-studio-${width}.png`), fullPage:true })
    verified.push({ width, images:episode.panels.length, unapproved:true, noOverflow:true, pageErrors:0, mutations:0 })
    await page.close()
    console.log(`PASS ${width}px: real draft images load, no overflow, no mutations`)
  }
  writeFileSync(resolve(output, 'draft-browser-results.json'), JSON.stringify({ unpublished:true, publicStatus:404, mockedApiResponses:false, verified }, null, 2))
} finally { await browser.close() }
