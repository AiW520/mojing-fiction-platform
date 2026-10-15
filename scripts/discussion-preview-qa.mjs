import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
const require = createRequire(resolve(process.env.PLAYWRIGHT_MODULE_ROOT || '.', 'package.json'))
const { chromium } = require('playwright')
const base = process.env.PREVIEW_URL || 'http://127.0.0.1:4173'
const url = `${base}/preview/?page=${encodeURIComponent('/pages/book/detail?id=work_seventh_pier')}`
const directory = resolve('artifacts/discussion-qa'); mkdirSync(directory,{recursive:true})
const browser = await chromium.launch({ headless:true, executablePath:process.env.CHROMIUM_EXECUTABLE })
try {
  for (const width of [320,390,768,1440]) {
    const page = await browser.newPage({ viewport:{width,height:width > 700 ? 900 : 844} })
    const errors=[]; page.on('pageerror',error => errors.push(error.message))
    const reviews=[]; const discussions=Array.from({length:12},(_,i) => ({ id:`d${i}`,author:'测试读者',content:i ? `讨论 ${i}` : '这个故事的港口细节很真实。',rating:null,spoiler:i === 1,status:'published',createdAt:'2026-10-06 10:00:00',likes:0,liked:false,replies:0,mine:false }))
    const replies=[]
    const replyTopic={id:'d0'}
    const summary=() => ({rating:reviews.length ? 5 : null,ratings:reviews.length,reviews:reviews.length,discussions:discussions.length})
    await page.route(/\/api\/works\/work_seventh_pier\/comments(?:\?.*)?$/,async route => {
      const req=route.request(); const u=new URL(req.url())
      if (req.method() === 'POST') {
        const body=req.postDataJSON(); assert.ok(body.clientId); assert.ok(body.content)
        const item={id:`created-${Date.now()}`,author:'林间砚',content:body.content,rating:body.parentId ? null : body.rating,spoiler:!!body.spoiler,status:'published',createdAt:'2026-10-06 11:00:00',likes:0,liked:false,replies:0,mine:true}
        if(body.parentId) { replies.push(item); replyTopic.id=body.parentId; const topic=[...reviews,...discussions].find(i=>i.id===body.parentId); if(topic) topic.replies++ }
        else (body.kind === 'review' ? reviews : discussions).unshift(item)
        return route.fulfill({json:{id:item.id,status:'published'}})
      }
      const list=u.searchParams.get('kind') === 'discussion' ? discussions : reviews
      const offset=Number(u.searchParams.get('offset') || 0)
      return route.fulfill({json:{items:list.slice(offset,offset+10),total:list.length,summary:summary()}})
    })
    await page.route(/\/api\/comments\/[^/]+\/replies(?:\?.*)?$/,route => route.fulfill({json:{items:replies,total:replies.length}}))
    await page.route(/\/api\/comments\/[^/]+\/like$/,route => {
      const id=new URL(route.request().url()).pathname.split('/')[3]; const item=[...reviews,...discussions,...replies].find(i=>i.id===id)
      item.liked=route.request().method()==='POST'; item.likes=item.liked ? 1 : 0
      return route.fulfill({json:{liked:item.liked,likes:item.likes}})
    })
    await page.goto(url); await page.locator('.detail-cover img').waitFor()
    await page.waitForFunction(()=>[...document.querySelectorAll('.detail-page img')].every(i=>i.complete&&i.naturalWidth>0))
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
    await page.screenshot({path:resolve(directory,`detail-${width}.png`),fullPage:true})
    await page.locator('.comment-entry').click(); await page.locator('.composer-panel').waitFor()
    await page.locator('.composer-panel textarea').fill('港口与少年都很真实，喜欢这本书。')
    await page.locator('.comment-submit').click(); await page.getByText('请先选择评分',{exact:true}).waitFor()
    await page.getByRole('button',{name:'5星',exact:true}).click()
    await page.getByRole('button',{name:'关闭编辑',exact:true}).click()
    await page.reload(); await page.locator('.comment-entry').click(); await page.locator('.composer-panel').waitFor()
    assert.equal(await page.locator('.composer-panel textarea').inputValue(),'港口与少年都很真实，喜欢这本书。')
    assert.equal(await page.locator('.rating-star.selected').count(),5)
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
    await page.screenshot({path:resolve(directory,`composer-${width}.png`)})
    await page.locator('.comment-submit').click(); await page.locator('.comment-content').getByText('港口与少年都很真实，喜欢这本书。',{exact:true}).waitFor()
    await page.getByRole('button',{name:'点赞',exact:true}).first().click(); await page.locator('.comment-action.liked').waitFor()
    await page.getByRole('button',{name:'查看回复',exact:true}).first().click(); await page.locator('.reply-panel').waitFor()
    await page.getByRole('button',{name:'回复主题',exact:true}).click(); await page.locator('.composer-panel').waitFor()
    await page.locator('.composer-panel textarea').fill('同意，细节很有代入感。'); await page.locator('.comment-submit').click()
    await page.locator('.reply-panel .comment-content').getByText('同意，细节很有代入感。',{exact:true}).waitFor()
    await page.screenshot({path:resolve(directory,`reply-${width}.png`)})
    await page.getByRole('button',{name:'关闭回复',exact:true}).click()
    await page.locator('[data-tab="discussion"]').click(); await page.waitForFunction(()=>document.querySelectorAll('.comment-list > .comment-item').length===10)
    await page.locator('.spoiler-cover').first().click(); await page.getByText('讨论 1',{exact:true}).waitFor()
    await page.locator('.more-comments').click(); await page.waitForFunction(()=>document.querySelectorAll('.comment-list > .comment-item').length===12)
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
    for(const button of await page.locator('.comment-tab,.sort-item,.icon-btn,.comment-action').all()) { const box=await button.boundingBox(); assert.ok(box.height>=44,`${width}px button height ${box.height}`) }
    assert.deepEqual(errors,[])
    await page.route('**/*seventh_pier.webp',route=>route.abort()); await page.reload(); await page.locator('.cover-fallback').waitFor()
    await page.screenshot({path:resolve(directory,`fallback-${width}.png`)})
    await page.close(); console.log(`PASS ${width}px: cover, layout, draft, rating, publish, like, reply, spoiler, pagination, fallback`)
  }
} finally { await browser.close() }
