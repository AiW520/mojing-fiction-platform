import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const require = createRequire(resolve(process.env.PLAYWRIGHT_MODULE_ROOT || '.', 'package.json'))
const { chromium } = require('playwright')
const output = resolve('artifacts/text-models-qa')
mkdirSync(output,{ recursive:true })
const browser = await chromium.launch({ headless:true, executablePath:process.env.CHROMIUM_EXECUTABLE })
try {
  for (const width of [320,390,1440]) {
    const page = await browser.newPage({ viewport:{ width,height:900 } })
    const errors=[]; page.on('pageerror',error=>errors.push(error.message))
    await page.goto(process.env.PREVIEW_URL || 'http://127.0.0.1:5192')
    await page.getByLabel('账号',{ exact:true }).fill('admin@mojing.local')
    await page.getByLabel('密码',{ exact:true }).fill('text-model-preview-only')
    await page.getByRole('button',{ name:'登录',exact:true }).click()
    await page.getByRole('button',{ name:'模型接入',exact:true }).click()
    await page.locator('.model-card').filter({ hasText:'模拟审查兜底' }).getByTitle('编辑配置').click()
    const form=page.locator('.model-editor')
    assert.equal(await form.getByLabel('默认生成',{ exact:true }).isDisabled(),true)
    await form.getByLabel('文本用途',{ exact:true }).selectOption('both')
    assert.equal(await form.getByLabel('默认生成',{ exact:true }).isDisabled(),false)
    await form.getByLabel('文本用途',{ exact:true }).selectOption('generation')
    assert.equal(await form.getByLabel('默认审查',{ exact:true }).isDisabled(),true)
    await form.getByLabel('文本用途',{ exact:true }).selectOption('reviewer')
    await form.getByLabel('兜底顺序',{ exact:true }).fill('20')
    await page.getByRole('button',{ name:'保存配置',exact:true }).click()
    await page.getByRole('status').filter({ hasText:'模型配置已保存' }).waitFor()
    await page.getByRole('status').filter({ hasText:'模型配置已保存' }).waitFor({ state:'hidden' })
    await capture('models')
    await page.getByRole('button',{ name:'生产队列',exact:true }).click()
    await page.locator('.text-review summary').first().click()
    await page.getByText('候选第 1 段',{ exact:false }).first().waitFor()
    assert.equal(await page.locator('.text-review .review-issue').count(),1)
    assert.equal(await page.locator('.text-review .image-attempts li').count(),2)
    await capture('review')
    assert.deepEqual(errors,[])
    await page.close()
    async function capture(name) {
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),true,`Overflow at ${width}: ${name}`)
      const bad = await page.evaluate(()=>[...document.querySelectorAll('main input,main select,main button,main summary')].filter(element=>element.getBoundingClientRect().right>innerWidth+1).map(element=>element.outerHTML.slice(0,100)))
      assert.deepEqual(bad,[],`${name} controls at ${width}`)
      await page.screenshot({ path:resolve(output,`${name}-${width}.png`),fullPage:true })
    }
  }
  console.log('PASS: role/default constraints, model saving and independent review reports at 320, 390 and 1440 px; isolated simulated API only.')
} finally { await browser.close() }
