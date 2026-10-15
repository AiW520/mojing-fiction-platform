export function parseSkillResult(exitCode, stdout, stderr) {
  let payload
  try { payload = JSON.parse((exitCode === 0 ? stdout : stderr).trim()) }
  catch { throw new Error('SKILL_OUTPUT_INVALID') }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !Number.isInteger(payload.code) || !Array.isArray(payload.saved_files)) {
    throw new Error('SKILL_OUTPUT_INVALID')
  }
  if (exitCode === 0 && (payload.code !== 0 || !payload.saved_files.length || payload.saved_files.some(path => typeof path !== 'string' || !path.trim()))) {
    throw new Error('SKILL_OUTPUT_INVALID')
  }
  return { code: exitCode, payload }
}

export function skillFailureDiagnostic(payload) {
  const code = payload.code
  const message = String(payload.message || '')
  const category = code >= 400 && code <= 599 ? 'provider_http'
    : /timed?\s*out|timeout/i.test(message) ? 'timeout'
      : /download|base64|image data|image content/i.test(message) ? 'image_result'
        : /key|credential/i.test(message) ? 'credential'
          : /network|connection|SSL|certificate|resolve/i.test(message) ? 'network'
            : 'skill_failure'
  return { code, category, resultUnknown: !['credential'].includes(category) }
}
