import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve, join } from 'node:path'
import { writeFileSync } from 'node:fs'
import { readEnvFile } from '../server/src/config.mjs'

const root = resolve(import.meta.dirname, '..')
const require = createRequire(join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/package.json'))
const { chromium } = require('playwright')
const env = { ...readEnvFile(join(root,'server/.env')), ...process.env }
const browser = await chromium.launch({ headless:true, channel:'msedge' })
const errors = []; const results = []
try {
  const page = await browser.newPage({ viewport:{width:1440,height:1080} })
  page.on('pageerror',e=>errors.push(e.message))
  await page.goto('http://127.0.0.1:5194/')
  await page.getByLabel('账号',{exact:true}).fill('admin@mojing.local')
  await page.getByLabel('密码',{exact:true}).fill(env.DEV_ADMIN_PASSWORD || 'mojing-dev-only')
  await page.getByRole('button',{name:'登录',exact:true}).click()
  await page.getByRole('button',{name:'服务配置',exact:true}).click()
  await page.getByRole('heading',{name:'对象存储 · S3'}).waitFor()
  await page.getByLabel('Endpoint',{exact:true}).fill('https://storage.vendor.test')
  await page.getByLabel('Region',{exact:true}).fill('us-east-1')
  await page.getByLabel('Bucket',{exact:true}).fill('comic-media')
  await page.getByLabel('路径前缀',{exact:true}).fill('mojing/media/')
  await page.getByLabel('Access Key ID',{exact:true}).fill('preview-fake-access')
  await page.getByLabel('Secret Access Key',{exact:true}).fill('preview-fake-secret')
  await page.getByRole('button',{name:'保存配置',exact:true}).click()
  await page.getByText('对象存储配置已保存',{exact:true}).waitFor()
  assert.equal(await page.getByLabel('Secret Access Key',{exact:true}).inputValue(),'')
  assert.equal(await page.getByRole('button',{name:'测试连接',exact:true}).isEnabled(),true)
  for (const [label,width,height] of [['desktop',1440,1200],['mobile',390,844]]) {
    await page.setViewportSize({width,height})
    await page.getByRole('heading',{name:'对象存储 · S3'}).scrollIntoViewIfNeeded()
    await page.screenshot({path:join(root,`artifacts/configuration-preview/${label}.png`),fullPage:true})
    const layout = await page.locator('.storage-settings').evaluate(element => {
      const rect = element.getBoundingClientRect()
      const fields = [...element.querySelectorAll('input,select,button')]
      return { left:rect.left,right:rect.right,viewport:window.innerWidth,overflow:fields.some(field=>{const r=field.getBoundingClientRect();return r.left<rect.left-1 || r.right>rect.right+1}) }
    })
    assert.ok(!layout.overflow,JSON.stringify(layout))
    assert.ok(layout.left>=0 && layout.right<=layout.viewport+1,JSON.stringify(layout))
    results.push({label,layout})
  }
  assert.deepEqual(errors,[])
  // Remove preview-only test credentials after checking the saved form.
  await page.getByLabel('清除全部凭据',{exact:true}).check()
  await page.getByRole('button',{name:'保存配置',exact:true}).click()
  await page.getByText('凭据待配置',{exact:true}).waitFor()
  writeFileSync(join(root,'artifacts/configuration-preview/qa.json'),JSON.stringify({results,errors},null,2))
  console.log(JSON.stringify({status:'passed',viewports:results.map(r=>r.label),credentialsEchoed:false}))
} finally { await browser.close() }
