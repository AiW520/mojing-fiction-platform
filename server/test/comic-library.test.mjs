import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { comicSeries, createPublicComicSources } from '../src/comic-library.mjs'

test('legacy episodes merge into stable book entries and sort by episode number', () => {
  const input = [
    { id:'red-2', title:'赤潮 · 第2话', ownerId:'author', workId:'work-2', panelCount:3 },
    { id:'red-1', title:'赤潮 · 第一话', ownerId:'author', workId:'work-1', panelCount:4 },
    { id:'rain-1', title:'雨停之前，底片未干 · 第1话', ownerId:'author', workId:'rain', panelCount:2 },
  ]
  const [red, rain] = comicSeries(input)
  assert.equal(red.title, '赤潮')
  assert.deepEqual(red.episodes.map(episode => episode.id), ['red-1', 'red-2'])
  assert.equal(red.episodeCount, 2)
  assert.equal(red.panelCount, 7)
  assert.equal(red.latestEpisodeId, 'red-2')
  assert.equal(comicSeries(input)[0].id, red.id)
  assert.equal(rain.title, '雨停之前，底片未干')
})

test('public source catalogs retain stale entries during partial outages and safely proxy validated data', async () => {
  const origins = ['https://one.comics.test', 'https://two.comics.test']
  const sourceKey = createHash('sha256').update(origins[0]).digest('hex').slice(0, 12)
  let failing = false
  let allFailing = false
  const requests = []
  const fetchTransport = async (url, options) => {
    requests.push({ url: String(url), options })
    if (allFailing) return new Response('unavailable', { status:503 })
    if (String(url).endsWith('/api/comics/one-1')) return Response.json({ episode:{ id:'one-1', title:'赤潮 · 第1话', version:2, panels:[{ id:'panel-1', imageId:'image-1', narration:'', dialogue:'', imageWidth:640, imageHeight:960 }] } })
    if (String(url).startsWith(origins[0]) && failing) return new Response('unavailable', { status:503 })
    if (String(url).startsWith(origins[0])) return Response.json({ items:[
      { id:'one-1', title:'赤潮 · 第1话', panelCount:1, coverUrl:'/api/comic-media/cover-1' },
      { id:'one-2', title:'赤潮 · 第2话', panelCount:1, coverUrl:'/api/comic-media/cover-2' },
    ] })
    return Response.json({ items:[{ id:'two-1', title:'独立作品', panelCount:1, coverUrl:'/api/comic-media/cover-3' }] })
  }
  const sources = createPublicComicSources(JSON.stringify(origins), fetchTransport)
  try {
    const first = await sources.list()
    assert.equal(first.partial, false)
    assert.equal(first.items.length, 2)
    assert.equal(first.items[0].episodeCount, 2)
    const remoteId = `remote_${sourceKey}_one-1`
    failing = true
    const partial = await sources.list(true)
    assert.equal(partial.partial, true)
    assert.equal(partial.items.find(item => item.id === first.items[0].id).episodeCount, 2)
    assert.ok(sources.resolves(remoteId))
    assert.equal(sources.resolves('remote_aaaaaaaaaaaa_one-1'), false)
    const snapshot = await sources.episode(remoteId)
    assert.equal(snapshot.episode.id, remoteId)
    assert.equal(snapshot.episode.panels[0].imageId, `remote_${sourceKey}_image-1`)
    allFailing = true
    const offline = await sources.list(true)
    assert.equal(offline.partial, true)
    assert.equal(offline.items.length, 2)
    assert.ok(requests.every(request => request.options.redirect === 'error'))
  } finally { /* no external state is created */ }
})

test('public source rejects unsafe catalog identifiers, malformed snapshots and oversized responses', async () => {
  let catalog = { items:[{ id:'bad/id', title:'Bad', panelCount:1 }] }
  const sources = createPublicComicSources(JSON.stringify(['https://safe.comics.test']), async () => Response.json(catalog))
  await assert.rejects(sources.list(), /漫画来源暂时无法连接/)
  catalog = { items:[{ id:'episode-1', title:'Work · 第1话', panelCount:1, coverUrl:'https://evil.test/image' }] }
  const valid = await sources.list(true)
  assert.equal(valid.items[0].coverUrl, '')
  const unsafeId = valid.items[0].episodes[0].id
  const hostile = createPublicComicSources(JSON.stringify(['https://safe.comics.test']), async () => Response.json({ episode:{ id:'episode-1', title:'Bad', version:1, panels:[{ id:'panel-1', imageId:'../../outside', narration:'', dialogue:'' }] } }))
  await assert.rejects(hostile.episode(unsafeId), /Invalid comic panel/)
})
