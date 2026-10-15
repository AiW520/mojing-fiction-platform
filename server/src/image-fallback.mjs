export function imageErrorCode(error) {
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError' || error?.code === 'ETIMEDOUT' || error?.cause?.code === 'ETIMEDOUT') return 'PROVIDER_TIMEOUT'
  if (error instanceof SyntaxError) return 'PROVIDER_INVALID_JSON'
  if (error?.message === 'fetch failed') return 'PROVIDER_NETWORK_ERROR'
  const message = String(error?.code || error?.message || 'PROVIDER_ERROR')
  return /^[A-Z][A-Z0-9_]{0,79}$/.test(message) ? message : 'IMAGE_EXECUTION_FAILED'
}

export function retryableImageError(code) {
  return /^PROVIDER_HTTP_(401|402|403|404|408|409|425|429|5\d\d)$/.test(code) || [
    'PROVIDER_TIMEOUT', 'PROVIDER_NETWORK_ERROR', 'PROVIDER_KEY_MISSING', 'PROVIDER_EMPTY_OUTPUT',
    'PROVIDER_INVALID_JSON', 'PROVIDER_INVALID_IMAGE', 'PROVIDER_IMAGE_DOWNLOAD_FAILED', 'PROVIDER_OUTPUT_TOO_LARGE'
  ].includes(code)
}

export function imageModelChain(db, primary) {
  const ordered = Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='model_config_order'").get())
  const models = db.prepare(`SELECT m.* FROM model_configs m ${ordered ? 'LEFT JOIN model_config_order o ON o.model_id=m.id' : ''}
    WHERE m.kind='image' AND m.enabled=1 AND m.encrypted_key IS NOT NULL
    ORDER BY ${ordered ? 'COALESCE(o.priority,1000)' : 'm.rowid'} ASC,m.is_default DESC,m.rowid`).all()
  return [primary, ...models.filter(model => model.id !== primary.id)].slice(0, 3)
}
