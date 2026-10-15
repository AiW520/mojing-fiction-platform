import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { episodeArgument, episodeDirectory } from './comic-series.mjs'

const { chromium } = createRequire(resolve(process.env.PLAYWRIGHT_MODULE_ROOT || '.', 'package.json'))('playwright')
const number = episodeArgument(process.argv.slice(2))
assert.ok(!number || !process.env.COMIC_QA_OUTPUT, 'Use either --episode or COMIC_QA_OUTPUT')
const output = number ? episodeDirectory('artifacts/comic-platform-production', number) : resolve(process.env.COMIC_QA_OUTPUT || 'artifacts/comic-platform-production/episode-2')
const manifest = JSON.parse(readFileSync(resolve(output,'manifest.json'),'utf8'))
if (number) assert.equal(JSON.parse(readFileSync(resolve(output,'state.json'),'utf8')).episodeId, manifest.episodeId, 'Manifest must identify the current episode')
const preview = process.env.COMIC_PREVIEW_URL || 'http://127.0.0.1:4173'
const response = await fetch(`${manifest.apiBase}/api/comics/${manifest.episodeId}`)
assert.equal(response.status,200)
const { episode } = await response.json()
for (const panel of episode.panels) {
  assert.ok(panel.imageWidth > 0 && panel.imageHeight > 0)
  assert.equal((await fetch(`${manifest.apiBase}/api/comic-media/${panel.imageId}/original`)).status,404)
}
const browser = await chromium.launch({ headless:true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath:process.env.CHROMIUM_EXECUTABLE } : {}) })
const verified = []
try {
  for (const width of [320,390,768,1440]) {
    for (const mini of [false,true]) {
      const page = await browser.newPage({ viewport:{ width,height:844 } })
      const errors=[];page.on('pageerror',error=>errors.push(error.message))
      const url=mini ? `${preview}/preview/?page=${encodeURIComponent(`/pages/comics/index?id=${manifest.episodeId}`)}` : manifest.readerUrl
      await page.goto(url)
      const images=page.locator(mini ? '.comic-panel img' : 'figure img')
      await images.first().waitFor()
      assert.equal(await images.count(),episode.panels.length)
      for (const [index,img] of (await images.all()).entries()) {
        await img.scrollIntoViewIfNeeded();await img.evaluate(img=>img.decode())
        const box=await img.boundingBox()
        assert.ok(Math.abs(box.height/box.width-episode.panels[index].imageHeight/episode.panels[index].imageWidth)<.006,'full image aspect ratio')
      }
      const first=images.first();await first.click()
      const dialog=page.locator('dialog[open]');await dialog.locator('img').evaluate(img=>img.decode())
      await page.getByRole('button',{name:'下一张',exact:true}).click()
      assert.ok((await dialog.locator('img').getAttribute('src')).includes(episode.panels[1].imageId))
      await page.keyboard.press('ArrowLeft')
      assert.ok((await dialog.locator('img').getAttribute('src')).includes(episode.panels[0].imageId))
      await page.getByRole('button',{name:'放大',exact:true}).click()
      assert.equal(await dialog.locator('img').evaluate(img=>img.style.width),'150%')
      await page.getByRole('button',{name:'缩小',exact:true}).click()
      assert.equal(await dialog.locator('img').evaluate(img=>img.style.width),'100%')
      assert.ok(await page.getByRole('button',{name:'缩小',exact:true}).isDisabled())
      const toolbar=dialog.locator(mini ? '.preview-image-toolbar' : '.viewer-toolbar')
      assert.equal(await toolbar.evaluate(node=>node.scrollWidth<=node.clientWidth),true,'viewer toolbar fits')
      await page.screenshot({path:resolve(output,`${mini?'mini':'web'}-viewer-${width}.png`)})
      await page.keyboard.press('Escape');assert.equal(await dialog.count(),0)
      const reserved=page.locator(mini?'.comic-media':'.image-preview').first()
      const before=(await reserved.boundingBox()).height
      await first.dispatchEvent('error')
      await page.getByRole('button',{name:'图片载入失败，重试',exact:true}).click()
      await images.first().evaluate(img=>img.decode())
      assert.ok(Math.abs((await reserved.boundingBox()).height-before)<1,'retry preserves height')
      await page.evaluate(()=>window.scrollTo(0,800))
      await page.waitForFunction(mini=>{
        const keys=Object.keys(localStorage).filter(key=>mini?key.includes('comic-position-'):key==='mojing-comic-positions-v1')
        return keys.some(key=>localStorage.getItem(key).includes('800'))
      },mini)
      await page.reload();await images.first().waitFor()
      await page.waitForFunction(()=>Math.abs(scrollY-800)<8)
      assert.ok(await page.locator(mini?'.comic-progress-label':'.percent').textContent()!=='0%')
      await page.getByRole('button',{name:'从头阅读',exact:true}).click()
      await page.waitForFunction(()=>scrollY<2)
      if (mini) {
        await page.getByRole('button',{name:'返回',exact:true}).click()
        await page.locator('.comic-library').waitFor()
      } else {
        await page.getByRole('link',{name:'返回漫画书库',exact:true}).click()
        assert.equal(new URL(page.url()).pathname,'/comics')
        await page.locator('.library a').filter({hasText:manifest.title}).first().click()
        await page.locator('figure img').first().waitFor()
      }
      assert.deepEqual(errors,[])
      verified.push({width,view:mini?'mini':'web',aspectRatio:true,nextPrevious:true,zoom:true,keyboard:true,positionRestored:true,restart:true,library:true,retryGeometry:true,pageErrors:0})
      await page.close()
      console.log(`PASS ${width}px ${mini?'mini':'web'}: switch/zoom/keyboard/position/retry/library`)
    }
  }
  writeFileSync(resolve(output,'reading-interactions-results.json'),JSON.stringify({apiBase:manifest.apiBase,episodeId:manifest.episodeId,title:manifest.title,version:episode.version,verified,mockedApiResponses:false},null,2))
} finally { await browser.close() }
