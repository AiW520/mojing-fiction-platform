import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { readEnvFile } from '../server/src/config.mjs'
import { lockEpisode } from './comic-series.mjs'

const output = resolve(process.env.COMIC_PRODUCTION_DIR || 'artifacts/comic-platform-production/episode-3/revision-1')
const state = JSON.parse(readFileSync(resolve(output, 'state.json'), 'utf8'))
const release = lockEpisode(output)
try {
  assert.equal(state.storyReviewed, true)
  const env = { ...readEnvFile(resolve('server/.env')), ...process.env }
  const login = await fetch(`${state.apiBase}/admin-api/auth/login`, { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ account:'admin@mojing.local', password:env.DEV_ADMIN_PASSWORD || 'mojing-dev-only' }) })
  assert.equal(login.status, 200)
  const { token } = await login.json()
  const path = `/admin-api/comics/${state.episodeId}`
  const response = await fetch(`${state.apiBase}${path}`, { headers:{ Authorization:`Bearer ${token}` } })
  assert.equal(response.status, 200)
  const { episode } = await response.json()
  assert.equal(episode.published, false)
  assert.equal(episode.panels.length, 4)
  assert.ok(episode.panels.every(panel => !panel.imageId), 'Lock visual prompts before paid generation')
  const marker = '本话视觉审查锁定：'
  const constraint = `${marker}单一瞬间、单格、竖向2:3电影构图，不拼贴多动作。与前话一致的厚重铆钉木质城门，横木始终卡在门槽，门完整关闭只凹陷渗水，不是石门，不是开启的城门。陆燃同一清瘦成年男性脸型、短乱黑发、狭长琥珀眼、左眉尾旧疤、左耳单枚银耳钉，黑色短立领破损外套、同款雕纹银灰肩甲、黑色长靴。右手裸露、裂伤下垂，左手折伤下垂、松散干布只覆盖手背，双手不得握刀、抵门或撑地；颈部无围巾，暗红残布只缠刀柄，不画新绷带、吊带、手套或额外护甲。青色刀光与暖金灯火、黑青海水形成对比，人物脸清晰、细节精致，表现守护孩子的紧迫感。`
  const panels = episode.panels.map((panel, index) => {
    if (panel.prompt.includes(marker)) return panel
    let prompt = panel.prompt.replaceAll('石门', '厚重铆钉木门')
    if (index === 2) {
      prompt = prompt.replace('腰身猛然拧转，完成贴着石槽的短促横斩', '腰身转动后定住，画面停在短促横斩刚结束的瞬间')
        .replace('画面充满速度感与反震力量', '只呈现斩击结束后的反震瞬间，青光为残留刀光，不重复画出挥刀姿态')
    }
    if (index === 3) prompt += '。倒悬黑门只存在于排水槽的超自然水面倒影，不是门内实体门，不移动城外检修井；构图以陆燃侧脸和槽中倒影为两个清晰焦点。'
    return { ...panel, prompt:`${prompt}。${constraint}` }
  })
  if (panels.some((panel, index) => panel.prompt !== episode.panels[index].prompt)) {
    writeFileSync(resolve(output, 'storyboard-before-visual-lock.json'), JSON.stringify(episode, null, 2))
    const updated = await fetch(`${state.apiBase}${path}`, { method:'PUT', headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${token}` }, body:JSON.stringify({ version:episode.version, panels }) })
    assert.equal(updated.status, 200)
    const result = await updated.json()
    writeFileSync(resolve(output, 'storyboard-visual-lock.json'), JSON.stringify(result.episode, null, 2))
    console.log(JSON.stringify({ episodeId:episode.id, version:result.episode.version, panels:panels.length, published:false }))
  } else console.log('Visual prompts already locked; no mutation')
} finally { release() }
