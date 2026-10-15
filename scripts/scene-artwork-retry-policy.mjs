export function isProviderBlocked(message) {
  return /(?:API (?:401|403)|credential|余额|quota|insufficient|billing limit)/i.test(message)
}

export function shouldRetryGeneration(message) {
  if (isProviderBlocked(message) || /(?:safety system|safety_violations|API (?:400|404|422))/.test(message)) return false
  return /(?:API (?:408|425|429|500|502|503|504)|timed out|timeout|Generation failed or timed out|connection|network|hostname could not be resolved|returned invalid JSON|returned no image data)/i.test(message)
}

export function retryDelay(attempt) {
  return Math.min(60000, 2000 * (2 ** Math.min(attempt - 1, 5)))
}
