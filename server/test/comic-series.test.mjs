import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { episodeArgument, episodeDirectory, episodeStatePath, lockEpisode, nextEpisode, saveEpisode } from '../../scripts/comic-series.mjs'
import { assertReviewPassed, blockingReviewIssues, verifyHanLengthReview } from '../../scripts/comic-review-gates.mjs'

test('length verification preserves the report and only resolves a proven length false positive', () => {
  const content = '字'.repeat(1197) + '。'.repeat(173)
  const report = { status:'success', candidateHash:createHash('sha256').update(content).digest('hex'), issues:[
    { severity:'severe', type:'篇幅超限' }, { severity:'blocking', type:'人物伤势' }, { severity:'warning', type:'调度' }
  ] }
  const verified = verifyHanLengthReview(report, content)
  assert.equal(verified.originalReview, report)
  assert.equal(report.issues.length, 3)
  assert.equal(verified.lengthVerification.hanCount, 1197)
  assert.equal(verified.lengthVerification.nonWhitespaceCount, 1370)
  assert.equal(blockingReviewIssues(verified).length, 1)
  assert.throws(() => assertReviewPassed(verified))
  assert.equal(verifyHanLengthReview(report, content + '字'), report)
  for (const changed of ['字'.repeat(1401), '字'.repeat(800), '字'.repeat(1000) + '。'.repeat(401)]) {
    const current = { ...report, candidateHash:createHash('sha256').update(changed).digest('hex') }
    assert.equal(verifyHanLengthReview(current, changed), current)
  }
})

test('review gates block unknown, severe and blocking results', () => {
  assert.equal(blockingReviewIssues({ status: 'unknown' }).length, 1)
  assert.equal(blockingReviewIssues({ status: 'stale', issues: [{ severity: 'severe' }] }).length, 2)
  assert.equal(blockingReviewIssues({ status: 'success', issues: [{ severity: 'warning' }] }).length, 0)
  assert.equal(blockingReviewIssues({ status: 'success', issues: [{ severity: 'severe' }, { severity: 'blocking' }] }).length, 2)
  assert.doesNotThrow(() => assertReviewPassed({ status: 'success', issues: [] }))
  assert.throws(() => assertReviewPassed({ status: 'success', issues: [{ severity: 'severe', reason: 'continuity' }] }), /continuity/)
})

test('episode arguments reject missing, duplicate and unsafe path values', () => {
  assert.equal(episodeArgument(['--start']), null)
  assert.equal(episodeArgument(['--episode', '3', '--start']), 3)
  assert.equal(episodeArgument(['--episode=12']), 12)
  for (const args of [['--episode'], ['--episode=0'], ['--episode=-2'], ['--episode=../2'], ['--episode=2.5'], ['--episode=9007199254740992'], ['--episode=2','--episode=3']]) assert.throws(() => episodeArgument(args))
})

test('series resumes unfinished episodes and advances only after completion', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'comic-series-'))
  try {
    saveEpisode(resolve(root,'state.json'), { status:'complete' })
    assert.equal(nextEpisode(root), 2)
    const third = episodeDirectory(root,3)
    mkdirSync(third)
    saveEpisode(resolve(third,'state.json'), { status:'writing_running' })
    mkdirSync(resolve(root,'episode-4'))
    assert.equal(nextEpisode(root), 3)
    saveEpisode(resolve(third,'state.json'), { status:'complete' })
    assert.equal(nextEpisode(root), 4)
    assert.notEqual(episodeDirectory(root,2), third)
    assert.equal(JSON.parse(readFileSync(resolve(root,'state.json'),'utf8')).status, 'complete')
  } finally { rmSync(root, { recursive:true, force:true }) }
})

test('only one script can submit tasks for an episode, while other episodes remain independent', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'comic-lock-'))
  let release; let other
  try {
    release = lockEpisode(episodeDirectory(root,2))
    assert.throws(() => lockEpisode(episodeDirectory(root,2)), /EPISODE_SCRIPT_LOCKED/)
    other = lockEpisode(episodeDirectory(root,3))
    release()
    assert.equal(existsSync(resolve(episodeDirectory(root,2),'production.lock')), false)
    release = lockEpisode(episodeDirectory(root,2))
    const state = { status:'pending' }
    writeFileSync(resolve(episodeDirectory(root,2),'state.json'), '{invalid')
    saveEpisode(resolve(episodeDirectory(root,2),'state.json'), state)
    assert.equal(JSON.parse(readFileSync(resolve(episodeDirectory(root,2),'state.json'),'utf8')).status, 'pending')
  } finally { release?.(); other?.(); rmSync(root, { recursive:true, force:true }) }
})

test('a published revision advances the series while retaining the original draft', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'comic-revision-'))
  try {
    const directory = episodeDirectory(root,3)
    mkdirSync(resolve(directory,'revision-1'), { recursive:true })
    saveEpisode(resolve(directory,'state.json'), { status:'sample_review_required', episodeId:'old' })
    const revision = resolve(directory,'revision-1','state.json')
    saveEpisode(revision, { status:'complete', episodeId:'new' })
    const pointer = resolve(directory,'published-revision.json')
    writeFileSync(pointer, JSON.stringify({ directory:'revision-1', episodeId:'new' }))
    assert.equal(episodeStatePath(root,3), revision)
    assert.equal(nextEpisode(root),4)
    assert.equal(JSON.parse(readFileSync(resolve(directory,'state.json'),'utf8')).episodeId,'old')
    for (const selection of [{ directory:'../other', episodeId:'new' }, { directory:'revision-1', episodeId:'wrong' }]) {
      writeFileSync(pointer, JSON.stringify(selection))
      assert.throws(() => episodeStatePath(root,3))
    }
    writeFileSync(pointer, JSON.stringify({ directory:'revision-1', episodeId:'new' }))
    saveEpisode(revision, { status:'visual_approved', episodeId:'new' })
    assert.throws(() => episodeStatePath(root,3))
  } finally { rmSync(root, { recursive:true, force:true }) }
})
