import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const require = createRequire(resolve(process.env.PLAYWRIGHT_MODULE_ROOT || '.', 'package.json'))
const { chromium } = require('playwright')
const output = resolve('artifacts/production-qa')
mkdirSync(output, { recursive: true })
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE })
const models = [
  { id: 'image', name: '图片供应商', kind: 'image', provider: 'tuzi', model: 'gpt-image-2', endpoint: 'https://api.tu-zi.com/coding/images/generations', enabled: true, isDefault: true, keyHint: '测试密钥' },
  { id: 'text', name: '文本供应商', kind: 'text', provider: 'compatible', model: 'text-model', endpoint: 'https://provider.test/v1/chat/completions', enabled: true, isDefault: true, keyHint: '测试密钥' },
]
const episode = { id: 'episode', title: '风雪定山河 · 第一话', workId: 'work', sourceLength: 3000, version: 1, published: false,
  panels: [{ id: 'panel-one', prompt: '雪夜边关，年轻士兵站在营门前。', narration: '雪压着营门。', dialogue: '陆川：守住这里。', imageId: 'image-one', approved: false },
    { id: 'panel-two', prompt: '城头远景，士兵沿着城墙行进。', narration: '', dialogue: '', imageId: null, approved: false }] }
try {
  for (const width of [320, 390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    const errors = []
    const savedModels = structuredClone(models)
    let active = structuredClone(episode)
    let settings = { concurrency: 4, textConcurrency: 2, imageConcurrency: 2, perWorkConcurrency: 2, perUserLimit: 200, queueLimit: 500, dailyLimit: 200, paused: false }
    page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript(() => localStorage.setItem('mojing_admin_token', 'qa-token'))
    await page.route('**/*', async route => {
      const request = route.request(); const path = new URL(request.url()).pathname
      if (!path.startsWith('/api/') && !path.startsWith('/admin-api/')) return route.continue()
      if (path === '/api/comic-media/image-one') return route.fulfill({ contentType: 'image/webp', body: readFileSync(resolve('miniprogram/assets/books/ghost-ledger/blackwater-pass.webp')) })
      let body; const method = request.method(); const input = method === 'GET' ? null : request.postDataJSON()
      if (path === '/api/me') body = { name: '测试管理员', roles: ['super_admin'] }
      else if (path === '/admin-api/system/status') body = { environment: 'test', storage: 'sqlite-single-instance', imageConfigured: true, textConfigured: true, stats: { published: 12, users: 1, runningJobs: 2, failedJobs: 0 } }
      else if (path === '/admin-api/audit-logs') body = { items: [] }
      else if (path === '/admin-api/models') body = { items: savedModels }
      else if (path === '/admin-api/models/image' && method === 'PUT') { Object.assign(savedModels[0], input); body = { model: savedModels[0] } }
      else if (path === '/admin-api/production') { if (method === 'PATCH') settings = { ...settings, ...input }; body = { settings, counts: [{ status: 'queued', count: 1 }], jobs: [{ id: 'job', workTitle: '风雪定山河', type: 'comic_panel_image', modelName: '图片供应商', status: 'queued' }] } }
      else if (path === '/admin-api/comics/options') body = { works: [{ id: 'work', title: '风雪定山河' }], models: savedModels }
      else if (path === '/admin-api/comics') body = { items: [active] }
      else if (path === '/admin-api/comics/episode/jobs') body = { items: [] }
      else if (path === '/admin-api/comics/episode') { if (method === 'PUT') active = { ...active, panels: input.panels, version: active.version + 1 }; body = { episode: active } }
      else throw new Error(`Unexpected QA request: ${method} ${path}`)
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) })
    })
    const capture = async name => {
      await page.waitForTimeout(150)
      const overflow = await page.evaluate(() => [...document.querySelectorAll('main input, main textarea, main select, main button, main h2, main p')].filter(e => e.getBoundingClientRect().right > innerWidth + 1).map(e => e.outerHTML.slice(0, 120)))
      assert.deepEqual(overflow, [], `${name}: overflowing controls at ${width}`)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name}: page overflow at ${width}`)
      await page.screenshot({ path: resolve(output, `${name}-${width}.png`), fullPage: true })
    }
    await page.goto(process.env.PREVIEW_URL || 'http://127.0.0.1:4173')
    await page.getByRole('button', { name: '模型接入', exact: true }).click()
    await page.getByTitle('编辑配置').first().click()
    for (const label of ['HTTPS 接口', '模型', '供应商']) assert.equal(await page.locator('.model-editor').getByLabel(label, { exact: true }).isEditable(), true)
    await page.locator('.model-editor').getByLabel('模型', { exact: true }).fill('other-image-model')
    await page.getByRole('button', { name: '保存配置', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('.model-card').textContent.includes('other-image-model'))
    assert.equal(savedModels[0].model, 'other-image-model'); await capture('models')
    await page.getByRole('button', { name: '生产队列', exact: true }).click()
    await page.getByLabel('总并发数', { exact: true }).fill('6')
    await page.getByRole('button', { name: '保存设置', exact: true }).click()
    await page.waitForFunction(() => document.body.textContent.includes('队列设置已保存'))
    assert.equal(settings.concurrency, 6); await capture('queue')
    await page.getByRole('button', { name: '条漫工作室', exact: true }).click()
    await page.locator('.comic-list button').first().click()
    await page.locator('.panel-preview img').waitFor()
    await page.waitForFunction(() => document.querySelector('.panel-preview img').naturalWidth > 0)
    await page.getByLabel('画面描述', { exact: true }).first().fill('雪夜边关，少年守在营门前。')
    await page.getByTitle('下移', { exact: true }).first().click()
    await page.getByTitle('保存分镜', { exact: true }).click()
    await page.waitForFunction(() => document.querySelector('.comic-toolbar').textContent.includes('草稿 v2'))
    assert.equal(active.panels[1].id, 'panel-one'); await capture('comics')
    assert.deepEqual(errors, [])
    await page.close()
  }
  console.log('PASS: model editing, queue settings, comic editing/order/save and image rendering at 320, 390 and 1440 px; no real API writes.')
} finally { await browser.close() }
