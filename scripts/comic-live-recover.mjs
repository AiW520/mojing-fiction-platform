import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { copyFileSync,readFileSync,existsSync } from 'node:fs'
import { resolve } from 'node:path'

const output=resolve('artifacts/comic-live-smoke')
const manifest=JSON.parse(readFileSync(resolve(output,'manifest.json'),'utf8'))
const db=new DatabaseSync(resolve(output,'data/mojing.sqlite'),{ readOnly:true })
try {
  const recovered=[['9e83085b-9c2a-4b91-a78e-d34dacced964','tuzi-1791463062-86ea5336.png'],['cf3b9fbe-1bd3-4ecb-aaa3-26dea6189cff','tuzi-1791463137-f81d064e.png']]
  for (const [jobId,filename] of recovered) {
    if (!manifest.jobIds.includes(jobId)) throw new Error('Unexpected recovery job')
    const job=db.prepare('SELECT request_json FROM generation_jobs WHERE id=?').get(jobId)
    const prompt=JSON.parse(job.request_json).prompt
    const target=resolve(output,'images',`panel-${createHash('sha256').update(prompt).digest('hex').slice(0,16)}.png`)
    if (!existsSync(target)) copyFileSync(resolve(output,'images',filename),target)
  }
  console.log('Recovered two existing paid outputs into the exact-prompt cache; no model requests.')
} finally { db.close() }
