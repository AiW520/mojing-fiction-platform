import { retryableImageError, imageModelChain } from './image-fallback.mjs'

// A text timeout/network failure has an unknown billing/result state. Never
// silently issue a second paid request for those errors.
export function retryableTextModelError(code) {
  return /^(?:PROVIDER_HTTP_(?:409|425|429|5\d\d)|PROVIDER_(?:RATE_LIMIT|UNAVAILABLE))$/.test(String(code || ''))
}

export function migrateProduction(db) {
  const indexes = db.prepare('PRAGMA index_list(model_configs)').all()
  if (indexes.some(index => index.unique && db.prepare(`PRAGMA index_info("${index.name}")`).all().map(c => c.name).join(',') === 'provider,kind')) {
    const columns = new Set(db.prepare('PRAGMA table_info(model_configs)').all().map(column => column.name))
    const textRole = columns.has('text_role') ? 'text_role' : "'generation'"
    const reviewDefault = columns.has('review_default') ? 'review_default' : '0'
    db.exec(`BEGIN;
      CREATE TABLE model_configs_next (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, provider TEXT NOT NULL, kind TEXT NOT NULL,
        endpoint TEXT NOT NULL, model TEXT NOT NULL, encrypted_key TEXT, key_hint TEXT,
        enabled INTEGER NOT NULL DEFAULT 1, is_default INTEGER NOT NULL DEFAULT 0,
        text_role TEXT NOT NULL DEFAULT 'generation', review_default INTEGER NOT NULL DEFAULT 0,
        created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO model_configs_next(id,name,provider,kind,endpoint,model,encrypted_key,key_hint,enabled,is_default,text_role,review_default,created_by,created_at,updated_at)
        SELECT id,name,provider,kind,endpoint,model,encrypted_key,key_hint,enabled,is_default,${textRole},${reviewDefault},created_by,created_at,updated_at FROM model_configs;
      DROP TABLE model_configs;
      ALTER TABLE model_configs_next RENAME TO model_configs;
      COMMIT;`)
  }
  if (!db.prepare('PRAGMA table_info(generation_jobs)').all().some(c => c.name === 'model_snapshot')) db.exec('ALTER TABLE generation_jobs ADD COLUMN model_snapshot TEXT')
  if (!db.prepare('PRAGMA table_info(model_configs)').all().some(c => c.name === 'text_role')) db.exec("ALTER TABLE model_configs ADD COLUMN text_role TEXT NOT NULL DEFAULT 'generation'")
  if (!db.prepare('PRAGMA table_info(model_configs)').all().some(c => c.name === 'review_default')) db.exec('ALTER TABLE model_configs ADD COLUMN review_default INTEGER NOT NULL DEFAULT 0')
  const revisionTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='chapter_revisions'").get()
  if (revisionTable && !db.prepare('PRAGMA table_info(chapter_revisions)').all().some(c => c.name === 'source_hash')) db.exec('ALTER TABLE chapter_revisions ADD COLUMN source_hash TEXT')
  if (revisionTable && !db.prepare('PRAGMA table_info(chapter_revisions)').all().some(c => c.name === 'review_model_id')) db.exec('ALTER TABLE chapter_revisions ADD COLUMN review_model_id TEXT')
  db.exec(`CREATE TABLE IF NOT EXISTS text_generation_reviews (
    id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES generation_jobs(id) ON DELETE CASCADE,
    work_id TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE, source_hash TEXT NOT NULL,
    candidate_hash TEXT NOT NULL, review_model_id TEXT, status TEXT NOT NULL DEFAULT 'pending',
    report_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  ); CREATE INDEX IF NOT EXISTS idx_text_generation_reviews_job ON text_generation_reviews(job_id, created_at DESC);`)
  db.exec(`CREATE TABLE IF NOT EXISTS model_config_order (
    model_id TEXT PRIMARY KEY REFERENCES model_configs(id) ON DELETE CASCADE,
    priority INTEGER NOT NULL DEFAULT 1000,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`)
  for (const row of db.prepare('SELECT id FROM model_configs ORDER BY is_default DESC,rowid').all()) {
    db.prepare('INSERT OR IGNORE INTO model_config_order(model_id,priority) VALUES (?,(SELECT COALESCE(MAX(priority),-1)+1 FROM model_config_order))').run(row.id)
  }
  db.exec(`CREATE TABLE IF NOT EXISTS production_settings (id INTEGER PRIMARY KEY CHECK(id = 1), settings_json TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS jobs_dispatch ON generation_jobs(status, created_at);
    UPDATE generation_jobs SET status='success', error_code='SERVER_RESTARTED', finished_at=CURRENT_TIMESTAMP,
      result_json=json_set(result_json,'$.review.status','unknown','$.review.message','审查中断，候选正文已保留；重试前请核对供应商账单')
      WHERE status='running' AND job_type='text_generation' AND json_valid(result_json) AND json_type(result_json,'$.content')='text';
    UPDATE generation_jobs SET status = 'failed', error_code = 'SERVER_RESTARTED', finished_at = CURRENT_TIMESTAMP WHERE status = 'running';`)
}

export function createJobQueue({ db, runners, env = process.env }) {
  const limits = { concurrency: [1,16], textConcurrency: [1,16], imageConcurrency: [1,16], perWorkConcurrency: [1,16], perUserLimit: [1,1000], queueLimit: [1,5000], dailyLimit: [1,10000] }
  const positive = (value, fallback, max) => Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= max ? Number(value) : fallback
  let settings = {
    concurrency: positive(env.MAX_CONCURRENT_GENERATION_JOBS, 4, 16), textConcurrency: 2, imageConcurrency: 2,
    perWorkConcurrency: 2, perUserLimit: positive(env.MAX_ACTIVE_GENERATION_JOBS_PER_USER, 200, 1000),
    queueLimit: positive(env.MAX_QUEUED_GENERATION_JOBS, 500, 5000), dailyLimit: positive(env.MAX_GENERATION_JOBS_PER_DAY, 200, 10000), paused: false,
    ...JSON.parse(db.prepare('SELECT settings_json FROM production_settings WHERE id = 1').get()?.settings_json || '{}')
  }
  const active = new Map()
  let stopping = false
  let pumping = false
  const kindFor = type => /image/.test(type) ? 'image' : 'text'
  const purposeFor = jobType => jobType === 'import_chapter_review' ? 'reviewer' : 'generation'
  const allowedFor = (row, purpose) => row.kind !== 'text' || row.text_role === purpose || row.text_role === 'both'
  function modelChain(primary, purpose) {
    return db.prepare(`SELECT m.*,COALESCE(o.priority,1000) AS priority FROM model_configs m LEFT JOIN model_config_order o ON o.model_id=m.id
      WHERE m.kind = ? AND m.enabled = 1 AND m.encrypted_key IS NOT NULL ORDER BY priority ASC,m.is_default DESC,m.rowid`).all(primary.kind)
      .filter(model => allowedFor(model, purpose))
  }
  function snapshot(job, selectedId) {
    if (job.model_snapshot) return JSON.parse(job.model_snapshot)
    const kind = kindFor(job.job_type)
    const purpose = purposeFor(job.job_type)
    const available = kind === 'image'
      ? db.prepare(`SELECT m.*,COALESCE(o.priority,1000) AS priority FROM model_configs m LEFT JOIN model_config_order o ON o.model_id=m.id
          WHERE m.kind='image' AND m.enabled=1 AND m.encrypted_key IS NOT NULL ORDER BY m.is_default DESC,m.updated_at DESC,m.rowid DESC`).all()
      : modelChain({ kind }, purpose)
    const selected = selectedId
      ? db.prepare('SELECT m.*,COALESCE(o.priority,1000) AS priority FROM model_configs m LEFT JOIN model_config_order o ON o.model_id=m.id WHERE m.id = ? AND m.kind = ? AND m.enabled = 1 AND m.encrypted_key IS NOT NULL').get(selectedId, kind)
      : available.find(item => purpose === 'reviewer' ? item.review_default : item.is_default) || available[0]
    const model = selected && allowedFor(selected, purpose) ? selected : null
    if (!model) throw Object.assign(new Error('所选模型未配置、已停用或类型不匹配'), { code: 'MODEL_NOT_AVAILABLE' })
    model.fallbackModels = model.kind === 'image'
      ? imageModelChain(db, model).filter(item => item.id !== model.id).slice(0, 2)
      : modelChain(model, purpose).filter(item => item.id !== model.id).slice(0, 2)
    if (job.job_type === 'text_generation') {
      const reviewers = modelChain({ kind: 'text' }, 'reviewer')
      const reviewer = reviewers.find(item => item.review_default) || reviewers[0]
      model.reviewModels = reviewer ? [reviewer, ...reviewers.filter(item => item.id !== reviewer.id)].slice(0, 3) : []
    }
    db.prepare('UPDATE generation_jobs SET model_snapshot = ? WHERE id = ?').run(JSON.stringify(model), job.id)
    return model
  }
  function pump() {
    if (pumping || stopping || settings.paused) return
    pumping = true
    try {
      const jobs = db.prepare("SELECT * FROM generation_jobs WHERE status = 'queued' ORDER BY created_at, rowid").all()
      for (const job of jobs) {
        if (active.size >= settings.concurrency) break
        const kind = kindFor(job.job_type)
        const current = [...active.values()]
        if (current.filter(v => v.kind === kind).length >= settings[`${kind}Concurrency`]) continue
        if (job.work_id && current.filter(v => v.workId === job.work_id).length >= settings.perWorkConcurrency) continue
        const run = runners[job.job_type]
        if (!run) {
          db.prepare("UPDATE generation_jobs SET status = 'failed', error_code = 'JOB_TYPE_UNKNOWN', finished_at = CURRENT_TIMESTAMP WHERE id = ?").run(job.id)
          continue
        }
        try { snapshot(job, JSON.parse(job.request_json).modelId) } catch {
          db.prepare("UPDATE generation_jobs SET status = 'failed', error_code = 'MODEL_NOT_AVAILABLE', finished_at = CURRENT_TIMESTAMP WHERE id = ?").run(job.id)
          continue
        }
        // Claim before invoking a runner; queued work survives restarts without reissuing running requests.
        if (!db.prepare("UPDATE generation_jobs SET status = 'running', started_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'queued'").run(job.id).changes) continue
        const promise = Promise.resolve().then(() => runWithModelFallback(job, run)).catch(() => {
          db.prepare("UPDATE generation_jobs SET status = 'failed', error_code = 'JOB_EXECUTION_FAILED', finished_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'running'").run(job.id)
        }).finally(() => { active.delete(job.id); pump() })
        active.set(job.id, { promise, kind, workId: job.work_id })
      }
    } finally { pumping = false }
  }
  async function runWithModelFallback(job, run) {
    const allowFallback = job.job_type !== 'comic_panel_image' && ['image', 'text'].includes(kindFor(job.job_type))
    if (!allowFallback) { await run(job.id); return }
    const original = db.prepare('SELECT model_snapshot FROM generation_jobs WHERE id=?').get(job.id).model_snapshot
    const primary = JSON.parse(original)
    const models = [primary, ...(primary.fallbackModels || [])].slice(0, 3)
    const attempts = []
    try {
      for (const model of models) {
        const attempt = { modelId: model.id, model: model.model, name: model.name, status: 'running', startedAt: new Date().toISOString() }
        attempts.push(attempt)
        const started = Date.now()
        db.prepare("UPDATE generation_jobs SET model_snapshot=?,status='running',error_code=NULL,result_json=?,finished_at=NULL WHERE id=?")
          .run(JSON.stringify({ ...model, ...(job.job_type === 'text_generation' ? { reviewModels: primary.reviewModels || [] } : {}) }), JSON.stringify({ attempts }), job.id)
        await run(job.id)
        const current = db.prepare('SELECT status,error_code,result_json FROM generation_jobs WHERE id=?').get(job.id)
        attempt.status = current.status; attempt.errorCode = current.error_code
        attempt.durationMs = Date.now() - started; attempt.resultUnknown = ['PROVIDER_TIMEOUT', 'PROVIDER_NETWORK_ERROR', 'PROVIDER_HTTP_408'].includes(current.error_code)
        const result = current.result_json ? JSON.parse(current.result_json) : {}
        result.attempts = attempts; result.modelId = model.id; result.model = model.model
        const retry = current.status === 'failed' && (kindFor(job.job_type) === 'text' ? retryableTextModelError(current.error_code) : retryableImageError(current.error_code))
        result.retryExhausted = retry && attempts.length === models.length
        db.prepare('UPDATE generation_jobs SET result_json=? WHERE id=?').run(JSON.stringify(result), job.id)
        if (!retry || stopping) break
      }
    } finally { db.prepare('UPDATE generation_jobs SET model_snapshot=? WHERE id=?').run(original, job.id) }
  }
  return {
    settings: () => ({ ...settings }),
    update(input) {
      const next = { ...settings }
      for (const [key, [min,max]] of Object.entries(limits)) {
        if (input[key] === undefined) continue
        if (!Number.isInteger(input[key]) || input[key] < min || input[key] > max) throw new Error(`${key}: ${min}-${max}`)
        next[key] = input[key]
      }
      if (input.paused !== undefined) {
        if (typeof input.paused !== 'boolean') throw new Error('paused: boolean')
        next.paused = input.paused
      }
      db.prepare('INSERT INTO production_settings(id,settings_json) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET settings_json=excluded.settings_json').run(JSON.stringify(next))
      settings = next
      pump()
      return { ...settings }
    },
    schedule(id, selectedId, deferDispatch = false) {
      const job = db.prepare('SELECT * FROM generation_jobs WHERE id = ?').get(id)
      try { snapshot(job, selectedId || JSON.parse(job.request_json).modelId) } catch (error) {
        db.prepare("UPDATE generation_jobs SET status = 'failed', error_code = 'MODEL_NOT_AVAILABLE', finished_at = CURRENT_TIMESTAMP WHERE id = ?").run(id)
        throw error
      }
      if (deferDispatch) queueMicrotask(pump)
      else pump()
    },
    start: pump,
    async stop() { stopping = true; await Promise.all([...active.values()].map(v => v.promise)) }
  }
}
