import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'

const root = resolve('artifacts/full-scene-artwork')
assert.ok(!existsSync(join(root, 'generation.lock')), 'Wait for generation to finish')
const planPath = join(root, 'plan.json')
const ledgerPath = join(root, 'ledger.json')
const plan = JSON.parse(readFileSync(planPath, 'utf8'))
const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'))
const changes = {
  work_bone_lantern_scene_001_01: null,
  work_bone_lantern_scene_003_04: { title: '铜尺下新墨', anchorText: '铜尺下面压着一张纸', scene: '义庄后坡雨后泥地，古代铜尺与刚展开的薄纸单独放在不透明厚纸垫上，纸上的新墨还有湿润光泽，只有不可读笔画。沈青崖戴薄皮手套展开纸，裴照川从侧观察，晏九抱小黑册站后方。取近景只覆盖铜尺、纸、泥地和三人手部与面孔，背景棺盖完整闭合，不展示任何骨骼、遗体、血液或身体检查。' },
  work_bone_lantern_scene_005_05: { title: '没有写完的姓名', anchorText: '木屑上只有半个字', scene: '废染坊地下砖室的干净木台近景，一片独立棺盖木屑放在白瓷盘里，木屑表面只有一撇一竖的抽象刻痕，不组成可读文字。旁边一枚姓名已磨去的古代小官牌单独放置。沈青崖戴薄皮手套以小夹子指示刻痕，裴照川提普通风灯，晏九抱黑册凝望。背景仅砖墙和完整木板，不画受检者、人体、伤口、血液、遗体或开放棺材。' },
  work_bone_lantern_scene_006_03: { title: '银盒已空', scene: '废染坊木桌上打开的扁平古代小银盒作为独立证物特写，盒内衬空无一物，仅有一处已经渗入布纤维的平面黑色污印，污印边缘干燥、哑光，完全没有厚度或立体物件。没有蜡滴、黑珠、水滴、光泽凸起或影子。盒缘一条极细撬痕，盒旁只有纸封和普通风灯，柔和午光照亮真实金属和布料，画面不出现人物或任何人体。' },
  work_bone_lantern_scene_013_01: { title: '西库证物入册', scene: '雨日义庄古代木案前，沈青崖登记西库证物，裴照川核对，晏九稍后整理湿收契。桌上三份证物分别用不透明厚黄纸折包、棉绳系紧、朱印封口；一枚小官扣单独置于木托盘上，焦纸及铜簧拓纸在黄纸包内不透视。木案与摊开的古册清楚照亮，文字都是不可读墨痕。所有包裹都是粗纤维不透明厚纸，没有透明袋、塑料、玻璃纸、密封夹链、现代证物袋或现代文具。无人体检查、伤口或幻象。' }
}
const profiles = '沈青崖：23岁中国女性，细长脸、平直眉、黑发低髻，深色窄袖旧官服、薄皮手套；裴照川：27岁中国男性，修长脸、平直眉、黑发束冠，黑色窄袖巡夜官服、腰间连鞘旧刀；晏九：16岁中国男性少年，瘦削、麻布短衣、墨迹手指、小黑册。'
for (const [id, change] of Object.entries(changes)) {
  const entry = plan.entries.find(item => item.id === id)
  const state = ledger.entries[id]
  assert.ok(entry && ['failed', 'visual_rejected'].includes(state?.status))
  assert.ok(!state.retryAuthorization || state.retryAuthorization.consumedAt, 'An unused authorization already exists')
  assert.notEqual(state.retryAuthorization?.source, 'User reply 2026-10-08: 授权这5张各新增一次请求', 'This one-time authorization was already used')
  assert.ok(!state.authorizationHistory?.some(auth => auth.source === 'User reply 2026-10-08: 授权这5张各新增一次请求'), 'This authorization was already recorded')
  if (change) {
    entry.promptHistory = [...(entry.promptHistory || []), { prompt: entry.prompt, title: entry.title, paragraphIndex: entry.paragraphIndex, filename: entry.filename, promptHash: state.promptHash, replacedAt: new Date().toISOString() }]
    if (change.anchorText) {
      const source = readFileSync(resolve('server/content', entry.bookDir, 'chapters', `${String(entry.chapterNumber).padStart(3, '0')}.md`), 'utf8').replace(/^\uFEFF/, '').trim().split(/\r?\n/).slice(1).join('\n').trim()
      assert.equal(createHash('sha256').update(source).digest('hex'), entry.chapterTextHash)
      const paragraphs = source.split(/\n\s*\n/).map(value => value.trim()).filter(Boolean)
      const indices = paragraphs.flatMap((value, i) => value.includes(change.anchorText) ? [i] : [])
      assert.equal(indices.length, 1)
      const siblings = plan.entries.filter(item => item.bookId === entry.bookId && item.chapterNumber === entry.chapterNumber)
      assert.ok(siblings.every(item => item.slot === entry.slot || (item.slot < entry.slot ? item.paragraphIndex < indices[0] : item.paragraphIndex > indices[0])))
      entry.paragraphIndex = indices[0]
      entry.paragraphExcerpt = paragraphs[indices[0]]
    }
    entry.title = change.title
    entry.prompt = `小说第${entry.chapterNumber}章正文插图「${entry.title}」。写实中国古装电影静帧，真实木石、布、纸、铜器，秋季奉安城，冷灰自然光与暖色风灯，剧情主体明亮清楚。${id.includes('_006_') ? '本图只有独立物件，不出现人物。' : profiles}当前唯一画面：${change.scene}只输出一幅横向3:2图片，无标题、文字、字幕、Logo、水印、拼图、边框，无现代物品，无动漫立绘。`
    entry.promptReviewedAt = new Date().toISOString()
  }
  const attemptNumber = (state.attempts?.length || 0) + 2
  entry.filename = `${String(entry.slot).padStart(2, '0')}-scene-attempt-${attemptNumber}.png`
  if (state.retryAuthorization) state.authorizationHistory = [...(state.authorizationHistory || []), state.retryAuthorization]
  state.retryAuthorization = {
    authorizedAt: new Date().toISOString(), source: 'User reply 2026-10-08: 授权这5张各新增一次请求',
    maxAdditionalRequests: 1, model: 'gpt-image-2.5-sunburst', promptHash: createHash('sha256').update(entry.prompt).digest('hex')
  }
}
for (const [path, value] of [[planPath, plan], [ledgerPath, ledger]]) {
  writeFileSync(path + '.tmp', JSON.stringify(value, null, 2) + '\n', 'utf8')
  renameSync(path + '.tmp', path)
}
console.log(JSON.stringify({ authorizedIds: Object.keys(changes), maxAdditionalRequests: 5, model: 'gpt-image-2.5-sunburst' }))
