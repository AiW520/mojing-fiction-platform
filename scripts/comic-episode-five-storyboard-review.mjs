import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { readEnvFile } from '../server/src/config.mjs'
import { lockEpisode } from './comic-series.mjs'

const directory = resolve('artifacts/comic-platform-production/episode-5')
const release = lockEpisode(directory)
try {
  const state = JSON.parse(readFileSync(resolve(directory, 'state.json'), 'utf8'))
  assert.equal(state.episodeId, '6372d625-f813-4015-afe6-407650cfa4d0')
  assert.equal(state.storyReviewed, true)
  const env = { ...readEnvFile(resolve('server/.env')), ...process.env }
  const login = await fetch(`${state.apiBase}/admin-api/auth/login`, { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ account:'admin@mojing.local', password:env.DEV_ADMIN_PASSWORD || 'mojing-dev-only' }) })
  assert.equal(login.status, 200)
  const { token } = await login.json()
  async function api(path, method = 'GET', input) {
    const response = await fetch(`${state.apiBase}${path}`, { method, headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${token}` }, ...(input ? { body:JSON.stringify(input) } : {}) })
    const result = await response.json()
    assert.ok(response.ok, `HTTP_${response.status}: ${result.error?.code}`)
    return result
  }
  const path = `/admin-api/comics/${state.episodeId}`
  const { episode } = await api(path)
  assert.equal(episode.published, false)
  assert.equal(episode.sourceHash, state.storyReviewAcceptance.candidateHash)
  assert.equal(episode.panels.length, 4)
  assert.ok(episode.panels.every(panel => !panel.imageId))
  const { items:jobs } = await api(`${path}/jobs`)
  assert.ok(!jobs.some(job => ['running','queued'].includes(job.status)))
  const marker = '第五话单瞬间视觉核对：'
  if (episode.panels.every(panel => panel.prompt.includes(marker))) {
    console.log('Episode five visual review already applied')
  } else {
    assert.equal(episode.version, 2, 'Review the first generated storyboard once')
    const continuity = `${marker}只画单一瞬间，不拼贴、不同时画前后动作。室内完整关闭的厚重铆钉木门，唯一原横木始终卡在门栓中。主角陆燃22岁成年东亚男性，清瘦结实，短乱黑发，狭长琥珀眼，左眉尾小旧疤，左耳一枚银耳钉；黑色短立领外套、同款银灰肩甲、黑色长靴。左手骨折无力下垂，右手裸露虎口裂伤麻木下垂，两手不握刀、不操作工具、不抵门、不撑地；颈部无围巾，无手套、吊带或新绷带。直刃青色能量刀全程留在门槛盖石下，只有破损暗红残布缠刀柄。第五话当前干布状态优先于旧角色档案：干布已从左手滑落，绝不再覆盖陆燃的左手；不画血腥特写。暖金室内灯火与黑青水面、微弱青刀光对照，人物脸和主体清晰，竖向2:3精致彩色国漫。`
    const scenes = [
      '保留第一格营救事件，画面只停在女人已把孩子从后墙石台抱离、正在退向门侧的瞬间；陆燃以肩背接近后墙阻挡裂缝，双伤手下垂。干布已落在门侧干地，不再在主角手上。背景三名男子均在门边共同顶住原横木，合计只有主角、三名男子、一名女人、一个孩子。石台仍完整但台脚和墙灰已有裂纹，黑指甲仅从裂口探出。',
      '保留第二格受困与装好撬棍事件，画面只停在年轻男子已将铁撬棍短端插进台脚裂口、中段抵稳定方砖、双手握长端准备下压的瞬间，不再同时画他从旧排水架取工具。陆燃右靴被水下黑手扣住，左腿站稳、肩背抵墙，两伤手下垂且不触工具。门边只有最年长男子和另一男子共两人顶原横木，年轻男子只出现一次在石台旁。女人在门侧护住孩子，孩子已经拾起干布抱在怀里，绝不戴干布在手上。',
      '保留第三格石台坍落脱困事件，画面停在厚石已就近塌落、压住台底黑缝后的单一瞬间；黑水的少量余溅和裂石清楚，黑手不画血腥损伤。陆燃右靴已脱困，肩背抵墙，两伤手下垂。年轻男子仍在石台侧抓住撬棍长端、即将返回门边，不能同时在门边再次出现；门边仍只有另两名男子顶原横木。女人和孩子待在门侧安全干地，孩子抱干布，不再在高处石台或女人怀里。不要同时画完整石台、坍落过程和坍落后碎石三种状态。',
      '保留第四格附身悬念，画面停在年轻男子已回到原门位、肩膀贴横木、抬起黑色眼白的脸的瞬间，另两名男子仍顶同一横木；湿脚印在退去积水后的地面从排水槽延伸到他身后。女人侧身护住站在门侧干地的孩子，孩子怀抱干布，不抱起孩子。陆燃在后墙附近观察年轻男子，双手下垂，左手没有干布；刀仍被门槛盖石压住，无人取刀。'
    ]
    const panels = episode.panels.map((panel, index) => ({ ...panel, prompt:`${scenes[index]} ${continuity}`, narration:panel.narration.replaceAll('\\n','\n'), dialogue:panel.dialogue.replaceAll('\\n','\n') }))
    panels[0].narration = '石台底部的黑手正在裂缝中逼近，女人抱离孩子，陆燃迎向后墙。'
    panels[0].dialogue = '陆燃：抱走他！\n陆燃：放到那块干地上！别让他碰水！'
    panels[2].dialogue = '陆燃：回去！'
    panels[3].dialogue = '年轻男子：陆燃，你还要守哪一边？'
    writeFileSync(resolve(directory, 'storyboard-before-visual-review.json'), JSON.stringify(episode, null, 2))
    const { episode:updated } = await api(path, 'PUT', { version:episode.version, panels })
    assert.equal(updated.version, 3)
    writeFileSync(resolve(directory, 'storyboard-visual-review.json'), JSON.stringify(updated, null, 2))
    console.log(JSON.stringify({ episodeId:updated.id, version:updated.version, reviewedPanels:updated.panels.length }))
  }
} finally { release() }
