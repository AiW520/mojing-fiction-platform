import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { resolve } from 'node:path'
import { episodeStatePath, lockEpisode } from './comic-series.mjs'

const root = resolve('artifacts/comic-platform-production')
const file = resolve(root, 'ending-outline-task-v5.json')
const release = lockEpisode(resolve(root, 'ending-outline-v5'))
const db = new DatabaseSync(resolve('server/data/mojing.sqlite'), { readOnly:true })
try {
  const base = 'http://127.0.0.1:3000'
  const login = await fetch(`${base}/admin-api/auth/login`, { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ account:'admin@mojing.local', password:process.env.DEV_ADMIN_PASSWORD || 'mojing-dev-only' }) })
  assert.equal(login.status, 200)
  const { token } = await login.json()
  async function api(path, method='GET', input) {
    const response = await fetch(`${base}${path}`, { method, headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${token}` }, ...(input ? { body:JSON.stringify(input) } : {}) })
    const result = await response.json()
    assert.ok(response.ok, `HTTP_${response.status}: ${result.error?.code || ''}`)
    return result
  }
  let saved = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null
  if (!saved) {
    const prior = JSON.parse(readFileSync(resolve(root, 'ending-outline-task-v4.json'), 'utf8'))
    const accepted = JSON.parse(readFileSync(resolve(root, 'episode-12/revision-1/state.json'), 'utf8'))
    assert.equal(accepted.storyReviewed, true)
    const snapshots = []
    for (let number = 1; number <= 12; number++) {
      const state = number === 12 ? accepted : JSON.parse(readFileSync(episodeStatePath(root, number), 'utf8'))
      const row = db.prepare('SELECT source_text,source_hash,published_json FROM comic_episodes WHERE id=?').get(state.episodeId)
      assert.ok(number === 12 || row.published_json)
      assert.equal(createHash('sha256').update(row.source_text).digest('hex'), row.source_hash)
      snapshots.push({ number, episodeId:state.episodeId, sourceHash:row.source_hash, published:!!row.published_json, source:row.source_text })
    }
    writeFileSync(resolve(root, 'ending-outline-v5-source-snapshots.json'), JSON.stringify(snapshots, null, 2))
    const context = snapshots.filter(item => [1,10,11,12].includes(item.number)).map(item => `第${item.number}话${item.published ? '已发布' : '已审核接受的修订正文'}：\n${item.source}`).join('\n\n')
    const prompt = '根据给定已发布正文与已审核第12话，定点修订旧完本大纲，只返回第13话至自然完本的可执行大纲。可用2至3话完成，质量优先，不重复守门拖延。旧大纲是待纠错资料，以下要求优先：\n1. 女人没有骨折；仅陆燃左臂骨折松垂不承重，右手裸露虎口及右腕伤势、黑丝麻木持续。两名男子中一人掌侧咬伤，不能伤手强握刀刃；只一把青色直刃刀、一根撬棍，暗红残布只缠刀柄。年轻男子尸体第二层靠墙，五名活人，不复活。\n2. 第12话末灰白干布已夺回并交女人左手，右手牵孩子；女人与孩子第五层门外，陆燃第四层右靴压黑线、右手持刀，两名男子在第二三层维修入口处，撬棍平放墙根。都尚未进维修通道，通道外缘湿，深处干灰仍在。地下泵房始终封闭，非室外城市。\n3. 保留孩子主动识破假影、通过黑水流动/脚印拖痕差异定位门轴黑线的行动；布已经沾黑，不能写它重新干净或魔法识别，布只作直线参照。孩子不能伸手触污染黑水；女人先护住真实孩子，再在安全门外观察。将人物如何在第五层、第四层、第二三层入口与窄道间移动写清，不能人在通道内却同时在门轴旁操作。\n4. 先写持刀/固定/承力的接管及回缩时机，再撤离；不让伤手抓裸刀刃、陆燃左臂用力、武器隔空传送，不凭空添绳索新工具。若湿通道不再隔潮，写明全面打湿时点与之后如何继续撤离，不靠布挡潮。陆燃选择护人而非把他人换给门，付出永久右手精细握力损失；左臂伤后才固定，结尾不瞬愈。\n5. 彻底解释并解决赤潮倒灌、黑门假影和索刀牵引的因果，以既有刀、门轴、刻痕及排水通道的动作证据完成；必须切断来源而非只让几人暂时逃出，不能引入新神明、新能力或最终新敌人。灰白布与刀柄红残布各自的去向明确。\n6. 最终五名活人获救、污染源断绝、黑门关闭、城市/人群安全有可观察的确认；说明死者不能救回但被记下与悼念。孩子、女人及两名幸存男子各有明确生活结果，陆燃有守护选择后的生活代价与人物收束。不留下敲击、新哭声、黑线余种、第二道门或下一次赤潮当末尾悬念。\n旧大纲：\n' + prior.result.content
    assert.ok(context.length <= 16000 && prompt.length <= 8000)
    saved = { workId:prior.workId, modelId:accepted.textModelId, sourceOutline:'ending-outline-task-v4.json', context, prompt, status:'prepared', preparedAt:new Date().toISOString() }
    writeFileSync(file, JSON.stringify(saved, null, 2))
  }
  if (!saved.jobId) {
    const matches = db.prepare("SELECT id,request_json FROM generation_jobs WHERE work_id=? AND job_type='text_generation' ORDER BY rowid").all(saved.workId)
      .filter(row => { const request = JSON.parse(row.request_json); return request.action === 'outline' && request.context === saved.context && request.selected === saved.prompt })
    assert.ok(matches.length <= 1, 'Resolve duplicate outline jobs')
    assert.ok(!db.prepare("SELECT id FROM generation_jobs WHERE work_id=? AND status IN ('queued','running')").get(saved.workId) || matches.length, 'Outline work is already active')
    saved.jobId = matches[0]?.id || (await api(`/api/works/${saved.workId}/text-jobs`, 'POST', { action:'outline', modelId:saved.modelId, context:saved.context, selected:saved.prompt, maxTokens:3000 })).jobId
    saved.submittedAt = new Date().toISOString()
    writeFileSync(file, JSON.stringify(saved, null, 2))
  }
  const job = (await api(`/api/jobs/${saved.jobId}`)).job
  saved = { ...saved, status:job.status, result:job.result || null, errorCode:job.errorCode || null, checkedAt:new Date().toISOString() }
  writeFileSync(file, JSON.stringify(saved, null, 2))
  console.log(JSON.stringify({ jobId:saved.jobId, status:job.status, errorCode:job.errorCode, review:job.result?.review }))
} finally { db.close(); release() }
