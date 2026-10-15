import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

export function verifyHanLengthReview(review, content) {
  if (review?.status !== 'success' || review.candidateHash !== createHash('sha256').update(content).digest('hex')) return review
  const hanCount = [...content].filter(character => /\p{Script=Han}/u.test(character)).length
  const nonWhitespaceCount = [...content].filter(character => !/\s/u.test(character)).length
  if (hanCount < 900 || hanCount > 1400 || nonWhitespaceCount > 1400) return review
  const resolvedIssues = (review.issues || []).filter(issue => issue.severity === 'severe' && issue.type === '篇幅超限')
  if (!resolvedIssues.length) return review
  return { ...review, issues:review.issues.filter(issue => !resolvedIssues.includes(issue)), originalReview:review,
    lengthVerification:{ method:'Unicode Script=Han and non-whitespace code points', min:900, max:1400, hanCount, nonWhitespaceCount, candidateHash:review.candidateHash, resolvedIssues } }
}

export function blockingReviewIssues(review) {
  const issues = (review?.issues || []).filter(issue => ['blocking', 'severe'].includes(issue.severity))
  if (!review || review.status !== 'success') issues.unshift({ severity: 'blocking', reason: 'Review did not complete successfully' })
  return issues
}

export function assertReviewPassed(review, message = 'Story review must pass before acceptance') {
  const issues = blockingReviewIssues(review)
  assert.equal(issues.length, 0, `${message}: ${issues.map(issue => issue.reason || issue.severity).join('; ')}`)
}
