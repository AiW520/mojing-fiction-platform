import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const require = createRequire(resolve(process.env.PLAYWRIGHT_MODULE_ROOT || '.', 'package.json'))
const { chromium } = require('playwright')
const base = process.env.PREVIEW_URL || 'http://127.0.0.1:4173'
const output = resolve(process.env.QA_OUTPUT || 'artifacts/creator-qa'); mkdirSync(output, { recursive: true })
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE })
const cover = '/assets/books/cold-command/cover.webp'
const work = { id: 'qa-draft', title: '风雪定山河', author: '闻舟', summary: '边军小卒在风雪中夺回营门，从一支残部开始重整山河。', type: '历史', status: 'draft', words: 46, chapterCount: 2, characterCount: 1, format: 'short', coverImage: cover }
const initial = [{ id: 'qa-one', content: '雪压着营门。陆川掐灭火折，借城头换防的空当，向对面的弓手抬了抬手。\n\n远处，第一声铁哨穿透了风。', sceneTitle: '雪夜夺门', locked: 0 }, { id: 'qa-two', content: '他没有回头，只把手里的绳索绕紧了一圈。', sceneTitle: '营门之外', locked: 0 }]
try {
  for (const width of [320, 390, 768, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: width >= 700 ? 900 : 844 } })
    const errors = []; const writes = []
    let items = structuredClone(initial); let published = false
    let settings = { protagonist: '陆川：边军小卒，重建一支能战的军队。', world: '风雪边关，粮道被断。', outline: '夺门、救援、破围。', illustrationsEnabled: true, visualStyle: '克制写实，电影中远景，衣甲磨损，人物外貌统一。' }
    const asset = { id: 'qa-art', blockId: 'qa-one', type: 'scene', title: '雪夜夺门', url: '/assets/books/ghost-ledger/blackwater-pass.webp', approvalStatus: 'approved' }
    page.on('pageerror', e => errors.push(e.message))
    await page.route('**/api/**', async route => {
      const req = route.request(); const path = new URL(req.url()).pathname; const method = req.method()
      const data = method === 'GET' ? null : req.postDataJSON(); if (method !== 'GET') writes.push(path)
      let body = {}; let status = 200
      if (path === '/api/auth/dev-login') body = { token: 'qa-token', expiresAt: '2099-01-01T00:00:00Z', user: { id: 'qa-user', name: '闻舟', roles: ['creator'] } }
      else if (path === '/api/creator/status') body = { textReady: false, imageReady: false, canReview: false, imageModel: 'gpt-image-2' }
      else if (path === '/api/me/works') body = { items: [work, { ...work, id: 'qa-published', title: '照骨灯', status: 'published', chapterCount: 80, words: 220003 }] }
      else if (path === '/api/works' && method === 'POST') { body = { work: { ...work, id: 'qa-created', title: data.title } }; status = 201 }
      else if (path.endsWith('/creative-settings')) { if (method === 'PUT') settings = { ...settings, ...data }; body = { settings } }
      else if (path.endsWith('/blocks')) { if (method === 'PUT') items = data.items.map(item => ({ ...item, sceneTitle: item.sceneId })); body = { work: { ...work, status: published ? 'published' : 'draft' }, items } }
      else if (path.endsWith('/assets')) body = { items: [asset] }
      else if (path.endsWith('/jobs')) body = { items: [] }
      else if (path.endsWith('/versions')) { body = { versionId: 'qa-version' }; status = 201 }
      else if (path.endsWith('/review')) { body = { status: 'pending' }; status = 202 }
      else if (path.endsWith('/reading-progress')) body = { progress: { progress: 0, scroll_ratio: 0 } }
      else if (path.endsWith('/reader-bootstrap')) body = { work: { ...work, status: published ? 'published' : 'draft' }, mode: 'short', chapters: [], assets: [asset], shortChapters: items, progress: { progress: 0, scroll_ratio: 0 } }
      else if (/\/api\/works\/[^/]+$/.test(path)) body = { work: { ...work, status: published ? 'published' : 'draft' } }
      else { status = 404; body = { error: { message: 'Unexpected QA request: ' + path } } }
      await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    })
    const go = async path => page.goto(`${base}/preview/?page=${encodeURIComponent(path)}`)
    const layout = async name => {
      await page.waitForTimeout(120)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name}: overflow ${width}`)
      for (const button of await page.locator('.creator-page button:visible').all()) {
        const box = await button.boundingBox()
        assert.ok(box.height >= 43.9 && box.width >= 43.9, `${name}: small control ${await button.innerText()} (${box.width}x${box.height})`)
      }
      await page.screenshot({ path: resolve(output, `${name}-${width}.png`), fullPage: true })
    }
    await go('/pages/workbench/index'); await page.locator('.studio-book').first().waitFor(); await layout('bookroom')
    await page.getByRole('button', { name: '已发布', exact: true }).click(); assert.equal(await page.locator('.studio-book').count(), 1)
    await page.getByRole('button', { name: '新建作品', exact: true }).click(); await page.locator('.wizard-page').waitFor()
    await page.locator('[data-field="title"]').fill(work.title); await page.locator('[data-field="idea"]').fill(work.summary); await layout('wizard-inspiration')
    await page.getByRole('button', { name: '下一步', exact: true }).click(); await page.locator('[data-field="protagonist"]').fill(settings.protagonist); await layout('wizard-settings')
    await page.getByRole('button', { name: '下一步', exact: true }).click(); await layout('wizard-create')
    await page.getByRole('button', { name: '创建 AI 作品', exact: true }).click(); await page.locator('.studio-project').waitFor(); await layout('workbench')
    await page.getByRole('button', { name: '设定', exact: true }).click(); await page.locator('[data-field="world"]').fill('雪夜边关，先夺营门再打通粮道。'); await page.getByRole('button', { name: '保存设定', exact: true }).click(); assert.equal(settings.world, '雪夜边关，先夺营门再打通粮道。'); await layout('settings')
    await page.getByRole('button', { name: '配图', exact: true }).click(); await page.locator('.studio-asset img').waitFor(); await layout('materials')
    await page.getByRole('button', { name: '选择正文配图', exact: true }).click(); await page.locator('.block-editor').first().waitFor(); await layout('editor')
    await page.locator('.block-editor').first().fill(initial[0].content + '\n\n他迎着风雪，踩上了城墙。'); await page.getByRole('button', { name: '保存正文', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('[aria-label="保存正文"]').disabled === false)
    assert.match(items[0].content, /踩上了城墙/)
    await page.getByRole('button', { name: '配图', exact: true }).click(); await page.locator('.illustration-sheet').waitFor(); await layout('illustration-plan')
    assert.equal(await page.getByRole('button', { name: '生成场景插图', exact: true }).isDisabled(), true)
    await page.locator('[data-field="imageSubject"]').fill('陆川提着绳索攀上城墙，旧棉甲与灰色披风。')
    await page.locator('[data-field="imagePlace"]').fill('风雪夜，木制瞭望楼，远处火光。')
    await page.locator('.illustration-scroll').evaluate(node => { node.scrollTop = node.scrollHeight })
    await page.locator('.illustration-consent input').check()
    await layout('illustration-confirm')
    const generateBox = await page.getByRole('button', { name: '生成场景插图', exact: true }).boundingBox()
    assert.ok(generateBox.y + generateBox.height <= (width >= 700 ? 900 : 844), 'illustration actions must be reachable')
    await page.getByRole('button', { name: '关闭配图', exact: true }).click()
    published = true
    await go('/pages/reader/index?workId=qa-draft'); await page.locator('.inline-illustration img').waitFor()
    await page.waitForFunction(() => document.querySelector('.inline-illustration img').naturalWidth > 0)
    await layout('reader')
    await page.locator('.reader-control').filter({ hasText: '设置' }).click(); await page.locator('.settings-sheet').waitFor()
    await page.locator('.settings-sheet input[type="checkbox"]').uncheck(); assert.equal(await page.locator('.inline-illustration').count(), 0)
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('mojing_reader_illustrations'))), false)
    assert.deepEqual(errors, [])
    assert.equal(writes.some(path => path.endsWith('/image-jobs') || path.endsWith('/text-jobs')), false)
    await page.close()
    console.log(`PASS ${width}px: bookroom, creation, settings, editor save, illustration plan, reader toggle; no model calls`)
  }
} finally { await browser.close() }
