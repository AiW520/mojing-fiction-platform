import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
const root=resolve('artifacts/comic-bulk-production/ghost-033-066')
assert.ok(!existsSync(join(root,'generation.lock')),'Wait for generation')
const planPath=join(root,'plan.json'),ledgerPath=join(root,'ledger.json')
const plan=JSON.parse(readFileSync(planPath,'utf8')),ledger=JSON.parse(readFileSync(ledgerPath,'utf8'))
const repairs={
  work_ghost_ledger_scene_033_01:{reason:'人物错误地在城外铜匣旁操作，违反城内外边界；画面铜匣变为普通木箱。',scene:'独立器物静物近景，北镇城外护城河岸的铜制匣子，青铜质感清楚，匣内白骨薄片逐片竖立，只有浅灰空栏和底部细黑粉，细黑线沿匣底延向白蜡轮木车门缝与薄冰。画面没有任何人物，没有木箱替代铜匣，没有完整骨架、血迹或可读文字。背景清晰可见河岸雪坡与关闭的北镇城门。'},
  work_ghost_ledger_scene_033_03:{reason:'深青令牌被画成普通长方物，缺少恰三道横线的白雾轮廓且人位错误。',scene:'独立器物静物近景，城外护城河的浅蓝冰面，一枚深青青铜令牌平压在冰面，边缘一圈局部白雾凝成平滑无五官轮廓，雾轮廓内恰有三道无字横线，雾边混有极细骨粉和灰白纸纤维。画面无人物、無脸部五官、无军令纸、无文字印章。令牌清楚照亮，背景为关闭的北镇城门。'},
  work_ghost_ledger_scene_034_04:{reason:'周梅被画入地窖救援现场，守台卒与台脚分隔失效。',scene:'第一座烽台下地窖旧木门只打开一道窄缝，门边封条正中朱印完整，纸面无字。只画三个人：罗衍把仍有呼吸的灰甲守台卒安稳扶到干净木板上；许青棠用药钳将口边碎纸取在纸托上，右肩保持低位。守台卒完整衣着、活人端坐、无刀伤或血腥。不画周梅、不画秦衡、不画陆昭、不画贺停舟；药钳不接触人体伤口。'},
  work_ghost_ledger_scene_034_05:{reason:'背景火盆被点燃，原章证物灰盆不应出现火焰。',scene:'独立器物静物近景，第一座烽台冰冷灰盆边缘，一片白骨薄片、一卷碎纸、三圈普通麻绳和刚断开的一根细线分别落在独立纸托上，局部黑灰散开，极细黑粉仍存在。封功刀放在远处清洁木片上，刀刃远离证物。画面没有人物、没有火焰、没有篝火、没有任何发光物体、没有血迹或可读文字。灰盆保持熄灭，雪霜和冷灰清晰可辨。'}
}
for(const [id,repair]of Object.entries(repairs)){
  const item=plan.entries.find(e=>e.id===id),state=ledger.entries[id]
  assert.ok(item&&['generated','visual_rejected'].includes(state?.status)&&!state.visualApprovedAt,id)
  if(state.retryAuthorization&&!state.retryAuthorization.consumedAt)continue
  state.rejectedPrompt=item.prompt
  item.filename=item.filename.replace(/\.png$/i,'-retry-1.png')
  item.prompt=`小说第${item.chapterNumber}章正文插图「${item.title}」。写实东方玄幻电影静帧，真实雪地、青铜、旧木、灰烬与纸张质感，清晰自然光，克制悬疑。当前唯一画面：${repair.scene}只输出一幅横向3:2图片，无标题、文字、字幕、Logo、水印、拼图、边框，无现代物品，无动漫立绘。`
  item.promptReviewedAt=new Date().toISOString()
  Object.assign(state,{status:'visual_rejected',visualRejectedAt:new Date().toISOString(),visualRejectionReason:repair.reason,retryAuthorization:{authorizedAt:new Date().toISOString(),model:'gpt-image-2',source:'Standing user instruction: visually reviewed targeted corrections and regenerate',maxAdditionalRequests:1,promptHash:createHash('sha256').update(item.prompt).digest('hex')}})
}
for(const [path,value]of [[planPath,plan],[ledgerPath,ledger]]){writeFileSync(path+'.tmp',JSON.stringify(value,null,2)+'\n');renameSync(path+'.tmp',path)}
console.log(JSON.stringify({repairs:Object.keys(repairs)}))
