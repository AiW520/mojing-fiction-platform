import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'

const root = resolve('artifacts/full-scene-artwork')
assert.ok(!existsSync(resolve(root, 'generation.lock')))
assert.ok(!existsSync(resolve(root, 'publication.lock')))
const plan = JSON.parse(readFileSync(resolve(root, 'plan.json'), 'utf8'))
const ledger = JSON.parse(readFileSync(resolve(root, 'ledger.json'), 'utf8'))
const corrections = [
  ['031_03', 'Paper gate box became a wooden chest.', '明亮的雪地证物静物近景：一只完全由薄纸折叠的城门形纸匣，清楚可见纸边、折痕和薄纸厚度，绝不是木匣。匣旁三只独立浅托分别放空白背纸、无字拓纸和抽象碎纸，只有一根纤细红线穿过纸材。无人物、无木箱、无文字、无符号、无印章。'],
  ['031_04', 'Wooden identity pieces contain character-like inscriptions.', '木桩外的证物托盘近景，盘中只放一枚缺角木牌和一枚军籍腰牌，全部背面朝上，背面木纹清楚、完全无字无刻痕。远处周梅穿灰棉袄头巾、石七和罗衍穿灰皮甲，三人退在纸墙外，双手自然垂下，不接触纸牌。不要文字、笔画、印记、刻字。'],
  ['031_05', 'Collapse image retains continuous red cord and active injured hand.', '纸城崩塌后的雪地静物：空白木牌背面朝上，地面分散薄纸片、朱砂小点和白蜡屑。一根纤细红线已经断成两段，断口明显分离，不接触、不相连、不画成多股粗绳。纸墙残片已塌在地面。无人物、无手、无血、无文字、无书法、无刻字。'],
  ['032_03', 'Bandage and operating hand continuity cannot be verified in the rendered pose.', '护城河冰面的证物近景：两片被撕开的空白军令副本沿白蜡轮痕停在门洞前，一根纤细红线从纸背伸出，一端由无字木片压住，每隔一尺插一根短木针标记位置。冰面和纸纤维清楚。无人物、无手、无字、无印章、无符文、不画多股粗红绳。'],
  ['032_05', 'Paper contains prominent character-like marks and an extra bone flute.', '北门内侧三层木架证物静物近景：上层只有一只关闭的旧青铜匣；中层只有半根短骨笛，断口清楚，不出现第二支笛子，关印窄纸反面朝上完全空白；下层只有无字轮痕压纹拓纸和一本合上的黑皮功簿。所有纸面均为纯空白，只允许纸纤维和压纹，不要笔画、字母、数字、汉字、圆形法阵、符号。无人物、无手、无额外笛子。']
]
for (const [suffix, reason, scene] of corrections) {
  const id = `work_ghost_ledger_scene_${suffix}`
  const item = plan.entries.find(entry => entry.id === id)
  const state = ledger.entries[id]
  assert.ok(item && state?.status === 'generated' && !state.visualApprovedAt)
  const at = new Date().toISOString()
  Object.assign(state, { status: 'visual_rejected', visualRejectedAt: at, visualRejectionReason: reason, rejectedPrompt: item.prompt })
  item.promptHistory = [...(item.promptHistory || []), { prompt: item.prompt, filename: item.filename, rejectedAt: at, reason }]
  item.prompt = `${item.prompt.split('人物一致性：')[0]}当前唯一画面：${scene}只输出一幅横向3:2图片，无标题、字幕、Logo、水印、拼图、边框、现代物品。`
  item.filename = `${String(item.slot).padStart(2, '0')}-scene-resume-repair-1.png`
  item.promptReviewedAt = at
  if (state.retryAuthorization) state.authorizationHistory = [...(state.authorizationHistory || []), state.retryAuthorization]
  state.retryAuthorization = { authorizedAt: at, model: 'gpt-image-2', source: 'User 2026-10-11 resumed batch creation with standing targeted visual correction authorization', maxAdditionalRequests: 1, promptHash: createHash('sha256').update(item.prompt).digest('hex') }
}
for (const [name, data] of [['plan.json', plan], ['ledger.json', ledger]]) {
  const path = resolve(root, name)
  writeFileSync(`${path}.tmp`, `${JSON.stringify(data, null, 2)}\n`)
  renameSync(`${path}.tmp`, path)
}
console.log(JSON.stringify({ authorized: corrections.map(([suffix]) => `work_ghost_ledger_scene_${suffix}`) }))
