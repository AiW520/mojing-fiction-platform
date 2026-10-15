import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'

const root = resolve(import.meta.dirname, '../..')
const require = createRequire(resolve(root, 'admin-web/package.json'))
const ts = require('typescript')
function editor() {
  let definition; const calls = []; const toasts = []
  const source = ts.transpileModule(readFileSync(resolve(root, 'miniprogram/pages/editor/index.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  const dependencies = {
    '../../utils/api': { ensureSession: async () => ({}), request: async path => { calls.push(path); return {} } },
    '../../utils/creator': { creatorInsets: () => ({ topInset: 44 }), displayAssets: async items => items },
  }
  runInNewContext(source, { exports: {}, require: name => dependencies[name], Page: page => { definition = page }, wx: { showToast: item => toasts.push(item.title) }, setTimeout, clearTimeout })
  return { page: { ...definition, data: structuredClone(definition.data), updates: [], setData(value) {
    this.updates.push(value)
    for (const [key, item] of Object.entries(value)) {
      const match = key.match(/^blocks\[(\d+)\]$/)
      if (match) this.data.blocks[Number(match[1])] = item
      else this.data[key] = item
    }
  } }, calls, toasts }
}

test('AI continuation keeps illustrations attached to stable source block IDs', () => {
  const { page } = editor()
  page.setData({ workId: 'draft', blocks: ['第一段', '第二段'], blockIds: ['one', 'two'], sceneTitles: ['开篇', '转折'], lockedBlocks: [true, false], assets: [{ id: 'art', blockId: 'two', title: '转折插图' }], generatedText: '新续写', generatedAction: 'continue', generatedIndex: 0, originalText: '第一段' })
  page.applyGenerated()
  assert.equal(page.data.blocks[1], '新续写')
  assert.equal(page.data.blockIds[2], 'two')
  assert.equal(page.data.blockAssets[1], null)
  assert.equal(page.data.blockAssets[2].id, 'art')
  assert.equal(page.data.lockedBlocks[0], true)
  assert.equal(page.data.lockedBlocks[1], false)
  assert.equal(page.data.sceneTitles[2], '转折')
  assert.equal(page.data.saved, false)
  page.addBlock()
  assert.equal(page.data.lockedBlocks.length, page.data.blocks.length)
})

test('stale AI output and concurrent text/image jobs cannot overwrite or resubmit', async () => {
  const { page, calls, toasts } = editor()
  page.setData({ blocks: ['手动改过的正文'], generatedText: '旧的建议', generatedAction: 'rewrite', generatedIndex: 0, originalText: '原正文' })
  page.applyGenerated()
  assert.equal(page.data.blocks[0], '手动改过的正文')
  assert.match(toasts[0], /原段落已修改/)
  page.setData({ imageBusy: true, textReady: true })
  await page.tool({ currentTarget: { dataset: { name: '续写' } } })
  page.setData({ imageBusy: false, generating: true, imageReady: true })
  await page.generateIllustration()
  page.setData({ generating: false, imageJobId: 'existing-job' })
  await page.generateIllustration()
  assert.equal(calls.length, 0)
})

test('editing context invalidates the candidate review without replacing its text or advice', () => {
  const { page } = editor()
  page.setData({ blocks: ['第一段','第二段'], originalContext: '第一段\n\n第二段', generatedText: '保留候选', generatedReview: { status: 'success', issues: [{ location: '第 1 段', suggestion: '补充来源' }] } })
  page.editBlock({ currentTarget: { dataset: { index: 1 } }, detail: { value: '手动修改' } })
  assert.equal(page.data.generatedReview.stale,true)
  assert.equal(page.data.generatedText,'保留候选')
  assert.equal(page.data.generatedReview.issues[0].suggestion,'补充来源')
  assert.match(page.data.reviewLabel,/失效/)
  assert.equal(page.data.blocks[1], '手动修改')
  assert.equal(page.updates.some(update => 'blocks[1]' in update && !('blocks' in update)), true)
})
