import { getEnvironment } from '../config'

type ShareWork = { id?: string; title: string; status?: string; coverImage?: string }
type ShareChapter = { id: string; title: string }

export function shareImage(image?: string) {
  if (!image) return undefined
  if (image.startsWith('/assets/')) return image
  if (image.startsWith('/api/assets/')) return `${getEnvironment().apiBase}${image}`
  return /^https:\/\//.test(image) ? image : undefined
}

export function shareContent(work: ShareWork, workId: string, chapter?: ShareChapter | null, reader = false) {
  const params = [`${reader ? 'workId' : 'id'}=${encodeURIComponent(workId)}`]
  if (reader && chapter) params.push(`chapterId=${encodeURIComponent(chapter.id)}`)
  params.push('shared=1')
  const query = params.join('&')
  const title = (chapter ? `《${work.title}》· ${chapter.title}` : `《${work.title}》· 墨境`).slice(0, 80)
  const imageUrl = shareImage(work.coverImage)
  return { title, path: `${reader ? '/pages/reader/index' : '/pages/book/detail'}?${query}`, query, ...(imageUrl ? { imageUrl } : {}) }
}

export function defaultShare(): { title: string; path: string; query: string; imageUrl?: string } { return { title: '墨境 · 好故事，慢慢读', path: '/pages/home/index', query: '' } }

export function isTimelinePreview() {
  // Scene 1154 is WeChat's public timeline single-page preview, without login APIs.
  return typeof wx.getLaunchOptionsSync === 'function' && wx.getLaunchOptionsSync().scene === 1154
}

export function setShareMenu(ready: boolean) {
  const menus: Array<'shareAppMessage' | 'shareTimeline'> = ['shareAppMessage', 'shareTimeline']
  if (ready) wx.showShareMenu({ menus, fail: () => {} })
  else wx.hideShareMenu({ menus, fail: () => {} })
}
