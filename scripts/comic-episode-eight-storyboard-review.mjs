import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { readEnvFile } from '../server/src/config.mjs'
import { lockEpisode } from './comic-series.mjs'

const directory = resolve('artifacts/comic-platform-production/episode-8')
const state = JSON.parse(readFileSync(resolve(directory, 'state.json'), 'utf8'))
const release = lockEpisode(directory)
try {
  const env = { ...readEnvFile(resolve('server/.env')), ...process.env }
  const login = await fetch(`${state.apiBase}/admin-api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: 'admin@mojing.local', password: env.DEV_ADMIN_PASSWORD || 'mojing-dev-only' })
  })
  if (!login.ok) throw new Error(`LOGIN_HTTP_${login.status}`)
  const { token } = await login.json()
  async function api(path, method = 'GET', input) {
    const response = await fetch(`${state.apiBase}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      ...(input ? { body: JSON.stringify(input) } : {})
    })
    const result = await response.json()
    if (!response.ok) throw new Error(`HTTP_${response.status}: ${result.error?.code || ''}`)
    return result
  }

  const path = `/admin-api/comics/${state.episodeId}`
  const { episode } = await api(path)
  if (episode.published) throw new Error('EPISODE_ALREADY_PUBLISHED')
  if (episode.panels.length !== 4 || episode.panels.some(panel => panel.imageId)) throw new Error('PANELS_NOT_READY_FOR_REVIEW')

  const continuity = '只画单一瞬间，竖向2:3精致彩色国漫，人物连续性固定：陆燃22岁清瘦结实，短乱黑发，狭长琥珀色眼睛，左眉尾旧疤，左耳单枚银耳钉，黑色短立领外套、银灰肩甲、黑色长靴；左手骨折无力下垂，右手虎口裂伤且麻木，未写明动作时双手不握刀、不撑地；颈部无围巾，暗红残布只缠在刀柄；黑水呈黑青色，冷青刀光与石室微弱暖光对照，不添加新人物、新武器或新门。'
  const scenes = [
    `第八话第一格，石室内的门仍完整关闭，只从门缝渗入黑水。女人侧身护住孩子，孩子仍用双臂抱着染血干布，布角被黑线从他怀中牵向湿石地面；陆燃站在他们前方，右手受伤下垂，左臂骨折无力下垂，尚未拔刀，向孩子伸出右手要求把布递给他。石壁下年轻男人仍被两人压住，手背出现黑斑。画面重点是黑线逼近孩子与干布的危险。`,
    `第八话第二格，动作明确发生在交接之后：孩子已经松开干布并退回女人身前，女人护住孩子；陆燃用受伤的右手三指接住干布，随即把干布放到自己右靴下牢牢压住，黑线沿布边爬上他的右腕。陆燃左臂骨折无力下垂，刀仍未拔出，只能看见刀柄上的暗红残布。门仍关闭，黑水停在脚边，表现“接布、压住”的单一瞬间。`,
    `第八话第三格，陆燃已经完成唯一一次拔刀斩击：青色直刃能量刀从刀柄中出鞘，刀锋贴着地面斩断被右靴压住的干布边缘黑线；黑线断口喷出的黑丝立即缠紧他的受伤右腕，刀尖抵住湿石以维持身体，左臂骨折无力下垂。孩子与女人退在后方，干布仍在右靴下，门外撞击刚刚停止。不要画第二扇门、不要画黑影、不要添加刻痕或额外武器。`,
    `第八话第四格，斩击后的悬念收束：干布仍被陆燃右靴压住，青色能量刀由右手勉强控制并抵在石面，黑丝勒住右腕，左臂骨折无力下垂。陆燃身后的盖石裂开竖直缝隙，缝隙后出现一条狭长石阶和第二扇与外门相同的黑门，一只沾黑水的手从门后敲击；外门与内门同时浮出五道指痕。孩子被女人护住并探头看向裂口，陆燃听见石壁后用他自己的声音说“这次，别松”。不要画黑影分身或布上人脸。`
  ]
  const panels = episode.panels.map((panel, index) => ({
    ...panel,
    prompt: `${scenes[index]} ${continuity}`,
    narration: [
      '黑线沿干布爬向孩子脚边，陆燃要求把布递给他。',
      '孩子松手退回女人身前，陆燃接过干布并用右靴压住黑线。',
      '青色刀锋斩断干布边缘的黑线，断口的黑丝却缠上陆燃右腕。',
      '石壁后裂出第二扇黑门，两扇门同时浮出指痕，黑暗里传来陆燃自己的声音。'
    ][index],
    dialogue: [
      '陆燃：把布给我。\n女人：你的手——\n陆燃：给我。',
      '陆燃：别松开布身。递过来。\n女人：听他的，慢慢来。',
      '陆燃：所以只砍一次。',
      '孩子：哥哥，那边也有人。\n石壁后的声音：这次，别松。'
    ][index]
  }))
  writeFileSync(resolve(directory, 'storyboard-before-visual-review.json'), JSON.stringify(episode, null, 2))
  const { episode: updated } = await api(path, 'PUT', { version: episode.version, panels })
  writeFileSync(resolve(directory, 'storyboard-visual-review.json'), JSON.stringify(updated, null, 2))
  console.log(JSON.stringify({ episodeId: updated.id, version: updated.version, reviewedPanels: updated.panels.length }))
} finally {
  release()
}
