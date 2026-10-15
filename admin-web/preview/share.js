export function previewShareData(payload, origin) {
  const route = new URL(payload.path || '/pages/home/index', origin)
  if (!['/pages/home/index', '/pages/book/detail', '/pages/reader/index'].includes(route.pathname)) throw new Error('分享页面不可用')
  const query = new URLSearchParams()
  for (const key of ['id', 'workId', 'chapterId']) if (route.searchParams.has(key)) query.set(key, route.searchParams.get(key))
  query.set('shared', '1')
  const page = `${route.pathname}?${query}`
  return { title: payload.title || '墨境', url: `${origin}/preview/?page=${encodeURIComponent(page)}` }
}

let sharing = false
export async function sharePreview(payload, notify) {
  if (sharing) return
  sharing = true
  try {
    const data = previewShareData(payload, location.origin)
    if (navigator.share) {
      try { await navigator.share(data); return }
      catch (error) { if (error.name === 'AbortError') return }
    }
    try { await navigator.clipboard.writeText(data.url); notify('阅读链接已复制'); return }
    catch { /* Some browsers prohibit clipboard access. Keep the link selectable. */ }
    const dialog = document.createElement('dialog')
    dialog.className = 'preview-share-dialog'
    const heading = document.createElement('h2'); heading.textContent = data.title
    const input = document.createElement('input'); input.value = data.url; input.readOnly = true; input.setAttribute('aria-label', '阅读链接')
    input.onclick = () => input.select()
    const close = document.createElement('button'); close.textContent = '关闭'; close.onclick = () => dialog.close()
    dialog.append(heading, input, close); document.body.append(dialog)
    dialog.addEventListener('close', () => dialog.remove(), { once: true })
    dialog.showModal(); input.focus(); input.select()
  } catch { notify('分享暂不可用，请重试') }
  finally { sharing = false }
}
