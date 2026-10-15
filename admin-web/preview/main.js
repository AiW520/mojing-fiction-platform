import { createApp, reactive, nextTick, compile, h } from 'vue/dist/vue.esm-bundler.js'
import { ArrowLeft, ArrowRight, Minus, Plus, X } from 'lucide-vue-next'
import appStyle from '../../miniprogram/app.scss?inline'
import { sharePreview } from './share.js'
import { environment } from '../../miniprogram/config'

const templates = import.meta.glob('../../miniprogram/pages/**/*.wxml', { query: '?raw', import: 'default', eager: true })
const styles = import.meta.glob('../../miniprogram/pages/**/*.scss', { query: '?inline', import: 'default', eager: true })
const pages = import.meta.glob('../../miniprogram/pages/**/*.ts')
const assets = import.meta.glob('../../miniprogram/assets/**/*.{png,jpg,jpeg,webp,svg}', { query: '?url', import: 'default', eager: true })
let currentPage
let currentPath = ''
let app
let scrollTimer
const pageHost = document.createElement('style')
document.head.append(pageHost)
const base = document.createElement('style')
base.textContent = `body{margin:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}#app{min-height:100vh}button{font:inherit;cursor:pointer;border:0}input,textarea{font:inherit;border:0;outline:0;min-width:0}img{object-fit:cover}.preview-capsule{position:fixed;z-index:100;right:12px;top:9px;height:28px;display:flex;align-items:center;gap:12px;padding:0 13px;background:#ffffffc9;border:1px solid #ddd;border-radius:20px;font-size:13px;color:#333}.preview-capsule a{color:inherit;text-decoration:none}.preview-toast{position:fixed;z-index:200;left:50%;bottom:130px;transform:translateX(-50%);padding:12px 18px;border-radius:14px;background:#222d;color:white;font-size:13px}.reader-scroll,.directory-list,.block-scroll{overflow-y:auto}.story-gallery,.work-tabs{overflow-x:auto}.safe-top{padding-top:48px!important}`
document.head.append(base)
const shareStyle = document.createElement('style')
shareStyle.textContent = '.preview-share-dialog{width:calc(100% - 40px);max-width:420px;box-sizing:border-box;padding:24px;border:1px solid #e5e5ea;border-radius:16px;background:#fff;color:#1d1d1f}.preview-share-dialog::backdrop{background:#0005}.preview-share-dialog h2{font-size:18px;line-height:1.5;overflow-wrap:anywhere}.preview-share-dialog input{width:100%;box-sizing:border-box;min-height:44px;border:1px solid #d2d2d7;border-radius:8px;padding:10px}.preview-share-dialog button{min-height:44px;padding:10px 20px;margin-top:16px;background:#007aff;color:white;border-radius:8px}button[open-type="share"]{touch-action:manipulation}button[open-type="share"]:disabled{cursor:default}'
document.head.append(shareStyle)
const creatorPreviewStyle = document.createElement('style')
creatorPreviewStyle.textContent = '.illustration-scroll{overflow-y:auto;overscroll-behavior:contain}.creator-page input[type="checkbox"],.reader-page input[type="checkbox"]{appearance:none;-webkit-appearance:none;width:46px!important;height:28px;min-height:28px;flex:0 0 46px;margin:0;background:#d1d1d6;border-radius:16px;position:relative;cursor:pointer;transition:background .15s}.creator-page input[type="checkbox"]:checked,.reader-page input[type="checkbox"]:checked{background:#16705b}.creator-page input[type="checkbox"]::after,.reader-page input[type="checkbox"]::after{content:"";position:absolute;width:24px;height:24px;left:2px;top:2px;background:#fff;border-radius:50%;box-shadow:0 1px 3px #0002;transition:transform .15s}.creator-page input[type="checkbox"]:checked::after,.reader-page input[type="checkbox"]:checked::after{transform:translateX(18px)}.creator-page input[type="checkbox"]:focus-visible,.reader-page input[type="checkbox"]:focus-visible{outline:2px solid #16705b;outline-offset:3px}'
document.head.append(creatorPreviewStyle)
const imagePreviewStyle = document.createElement('style')
imagePreviewStyle.textContent = '.preview-image-dialog{box-sizing:border-box;width:calc(100% - 24px);max-width:1100px;padding:12px;border:0;border-radius:8px;background:#202023;color:#fff}.preview-image-dialog::backdrop{background:#000b}.preview-image-toolbar{display:flex;align-items:center;gap:4px;margin-bottom:12px}.preview-image-toolbar span{flex:1;min-width:38px;white-space:nowrap;text-align:center;font-size:13px}.preview-image-toolbar button{display:grid;place-items:center;width:40px;height:44px;flex:0 0 40px;border-radius:4px;background:#39393c;color:#fff}.preview-image-toolbar button:disabled{opacity:.35}.preview-image-stage{height:75vh;overflow:auto;display:grid;align-items:center}.preview-image-stage img{display:block;width:100%;height:auto;object-fit:contain;max-height:75vh}.preview-image-stage.is-zoomed{display:block}.preview-image-stage.is-zoomed img{max-height:none}body:has(.preview-image-dialog[open]){overflow:hidden}'
document.head.append(imagePreviewStyle)
const capsule = document.createElement('div')
capsule.className = 'preview-capsule'
capsule.innerHTML = '<a href="/">管理台</a><span>·</span><a href="/preview/">墨境</a>'
document.body.append(capsule)

function notification(title) { const node = document.createElement('div'); node.className = 'preview-toast'; node.textContent = title; document.body.append(node); setTimeout(() => node.remove(), 2500) }
function nativeUrl(url) { return `/preview/?page=${encodeURIComponent(url)}` }
const developmentApiOrigin = new URL(environment.development.apiBase).origin
function resolveApiUrl(url) {
  const parsed = new URL(url, location.origin)
  return parsed.origin === developmentApiOrigin ? `${parsed.pathname}${parsed.search}${parsed.hash}` : url
}
function resolveImage(url) { return assets[`../../miniprogram${url}`] || (url ? resolveApiUrl(url) : url) }
window.wx = {
  getStorageSync: key => { try { return JSON.parse(localStorage.getItem(key) || 'null') } catch { return null } },
  setStorageSync: (key, value) => localStorage.setItem(key, JSON.stringify(value)),
  removeStorageSync: key => localStorage.removeItem(key),
  getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
  getSystemInfoSync: () => ({ windowWidth: innerWidth, windowHeight: innerHeight, screenHeight: innerHeight, statusBarHeight: 0, safeArea: { top: 0, bottom: innerHeight } }),
  request: options => { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), options.timeout || 15000); fetch(resolveApiUrl(options.url), { method: options.method || 'GET', headers: options.header, body: options.method && options.method !== 'GET' ? JSON.stringify(options.data) : undefined, signal: controller.signal }).then(async response => options.success?.({ statusCode: response.status, data: await response.json() })).catch(error => options.fail?.(error)).finally(() => clearTimeout(timer)) },
  nextTick: callback => nextTick(callback),
  pageScrollTo: options => { window.scrollTo({ top: options.scrollTop || 0, behavior: options.duration ? 'smooth' : 'instant' }); options.success?.(); options.complete?.() },
  showToast: options => notification(options.title),
  showModal: options => { if (options.showCancel === false) { alert(`${options.title}\n${options.content}`); options.success?.({ confirm: true, cancel: false }) } else { const confirm = window.confirm(`${options.title}\n${options.content}`); options.success?.({ confirm, cancel: !confirm }) } },
  showActionSheet: options => { const value = prompt(options.itemList.map((text,index) => `${index + 1}. ${text}`).join('\n')); const index = Number(value) - 1; if (index >= 0 && index < options.itemList.length) options.success?.({ tapIndex: index }) },
  setClipboardData: options => navigator.clipboard.writeText(options.data).then(() => options.success?.()),
  navigateTo: options => { currentPage?.onHide?.(); location.href = nativeUrl(options.url) },
  redirectTo: options => { currentPage?.onUnload?.(); location.replace(nativeUrl(options.url)) },
  downloadFile: options => { fetch(resolveApiUrl(options.url), { headers: options.header }).then(async response => { const blob = await response.blob(); options.success?.({ statusCode: response.status, tempFilePath: URL.createObjectURL(blob) }) }).catch(error => options.fail?.(error)) },
  previewImage: options => {
    const urls = (options.urls?.length ? options.urls : [options.current]).filter(Boolean)
    if (!urls.length) return
    const trigger = document.activeElement
    let index = Math.max(0, urls.indexOf(options.current)); let zoom = 1
    const iconApps = []
    const dialog = document.createElement('dialog')
    dialog.className = 'preview-image-dialog'
    dialog.setAttribute('aria-label', '漫画画面')
    const toolbar = document.createElement('div'); toolbar.className = 'preview-image-toolbar'
    const stage = document.createElement('div'); stage.className = 'preview-image-stage'
    const image = document.createElement('img')
    image.alt = '漫画画面'
    const count = document.createElement('span'); count.setAttribute('aria-live', 'polite')
    function control(label, icon, action) {
      const button = document.createElement('button'); button.type = 'button'; button.title = label; button.setAttribute('aria-label', label); button.onclick = action
      const iconApp = createApp({ render: () => h(icon, { size: 20 }) }); iconApp.mount(button); iconApps.push(iconApp); return button
    }
    const previous = control('上一张', ArrowLeft, () => change(-1))
    const following = control('下一张', ArrowRight, () => change(1))
    const smaller = control('缩小', Minus, () => resize(-.5))
    const larger = control('放大', Plus, () => resize(.5))
    const close = control('关闭', X, () => dialog.close())
    function resize(delta) { zoom = Math.max(1, Math.min(3, zoom + delta)); stage.classList.toggle('is-zoomed', zoom > 1); image.style.width = `${zoom * 100}%`; smaller.disabled = zoom === 1; larger.disabled = zoom === 3 }
    function show() { image.src = resolveImage(urls[index]); count.textContent = `${index + 1} / ${urls.length}`; previous.disabled = index === 0; following.disabled = index === urls.length - 1; zoom = 1; resize(0); stage.scrollTo(0, 0) }
    function change(delta) { index = Math.max(0, Math.min(urls.length - 1, index + delta)); show() }
    dialog.addEventListener('keydown', event => { if (['ArrowLeft','ArrowRight','+','-'].includes(event.key)) { event.preventDefault(); if (event.key === 'ArrowLeft') change(-1); else if (event.key === 'ArrowRight') change(1); else resize(event.key === '+' ? .5 : -.5) } })
    toolbar.append(previous, following, count, smaller, larger, close); stage.append(image); dialog.append(toolbar, stage)
    dialog.addEventListener('close', () => { iconApps.forEach(item => item.unmount()); dialog.remove(); trigger?.focus() }, { once: true })
    show()
    document.body.append(dialog); dialog.showModal()
  },
  reLaunch: options => { currentPage?.onUnload?.(); location.href = nativeUrl(options.url) },
  navigateBack: options => { const from = document.referrer ? new URL(document.referrer) : null; if (history.length > 1 && from?.origin === location.origin && from.pathname.startsWith('/preview/')) { currentPage?.onUnload?.(); history.back() } else options?.fail?.() },
  stopPullDownRefresh() {}, showShareMenu() {}, hideShareMenu() {},
}
document.addEventListener('click', event => {
  const button = event.target.closest('button[open-type="share"]')
  if (!button || button.disabled) return
  event.preventDefault()
  const payload = currentPage?.onShareAppMessage?.()
  if (payload) sharePreview(payload, notification)
  else notification('此页面暂不可分享')
})

function attributeExpression(value) {
  const pieces = []; let end = 0
  for (const match of value.matchAll(/{{([\s\S]*?)}}/g)) { if (match.index > end) pieces.push(JSON.stringify(value.slice(end,match.index))); pieces.push(`(${match[1]})`); end = match.index + match[0].length }
  if (end < value.length) pieces.push(JSON.stringify(value.slice(end)))
  return pieces.join(' + ') || JSON.stringify(value)
}
function toVue(source) {
  return source.replace(/<\/?(view|text|scroll-view|image|block)\b/g, (match, tag) => match.replace(tag, { view:'div',text:'span','scroll-view':'div',image:'img',block:'template' }[tag]))
    .replace(/<switch\b/g, '<input type="checkbox"').replace(/<\/switch>/g, '')
    .replace(/\bwx:key="[^"]*"/g, '')
    .replace(/<[^>]*\bwx:for="{{(.*?)}}"[^>]*>/g, (tag, collection) => {
      const item = tag.match(/\bwx:for-item="([^"]+)"/)?.[1] || 'item'
      const index = tag.match(/\bwx:for-index="([^"]+)"/)?.[1] || 'index'
      return tag.replace(/\bwx:for="{{(.*?)}}"/, `v-for="(${item}, ${index}) in ${collection}"`).replace(/\s+wx:for-(item|index)="[^"]+"/g, '')
    })
    .replace(/\blazy-load\b/g, 'loading="lazy"')
    .replace(/\bmode="aspectFit"/g, 'style="object-fit:contain"')
    .replace(/\bwx:(if|elif)="{{(.*?)}}"/g, (_,kind,expr) => `${kind === 'if' ? 'v-if' : 'v-else-if'}="${expr}"`)
    .replace(/\bwx:else\b/g, 'v-else')
    .replace(/\b(bindtap|catchtap)="([^"]+)"/g, (_,kind,method) => `@click${kind === 'catchtap' ? '.stop' : ''}="event('${method}',$event)"`)
    .replace(/\bbind(input|change|confirm|scroll|load|error)="([^"]+)"/g, (_,kind,method) => `@${kind === 'confirm' ? 'keydown.enter' : kind}="event('${method}',$event)"`)
    .replace(/(?<![:\w-])(class|style|src|value|checked|placeholder|disabled|id|aria-[\w-]+|data-[\w-]+|scroll-top|scroll-into-view)="([^"]*{{[^"]*)"/g, (_,name,value) => `:${name}="${attributeExpression(value).replace(/"/g,'&quot;')}"`)
    .replace(/(<img\b[^>]*?)\s:src="([^"]*)"/g, '$1 :src="resolveImage($2)"')
    .replace(/(<img\b[^>]*?)\ssrc="([^"]*)"/g, (_, tag, url) => `${tag} :src="resolveImage(${JSON.stringify(url).replace(/"/g, '&quot;')})"`)
    .replace(/(<input\b[^>]*)(?:\s+focus)([\s/>])/g, '$1 autofocus$2')
}
function installPage(definition) {
  const state = reactive(definition.data || {})
  currentPage = { ...definition, data: state, setData(values) {
    for (const [key, value] of Object.entries(values)) {
      const segments = key.replace(/\[(\d+)\]/g, '.$1').split('.')
      let parent = state
      for (const segment of segments.slice(0, -1)) parent = parent[segment]
      parent[segments.at(-1)] = value
    }
    nextTick(() => syncScroll())
  },
    createSelectorQuery() { let selector; let callback; return { select(value) { selector=value;return this }, boundingClientRect(fn) { callback=fn;return this }, exec() { const node=document.querySelector(selector); callback?.(node ? { height:node.getBoundingClientRect().height } : null) } } },
  }
  const source = toVue(templates[`../../miniprogram/${currentPath}.wxml`])
  app?.unmount()
  app = createApp({ render: compile(source), setup() { return { resolveImage, ...Object.fromEntries(Object.keys(state).map(key => [key, { __v_isRef: true, get value() { return state[key] } }])), event(method,event) { const detail = { value:event.target.type === 'checkbox' ? event.target.checked : event.target.value, scrollTop:event.target.scrollTop, scrollHeight:event.target.scrollHeight }; currentPage[method]?.({ currentTarget:{ dataset:{ ...event.currentTarget.dataset } }, detail }); if (method === 'onReaderScroll') clearTimeout(scrollTimer) } } } })
  app.mount('#app')
}
window.Page = installPage
function syncScroll() {
  document.querySelectorAll('[scroll-top]').forEach(node => { const top=Number(node.getAttribute('scroll-top')); if (currentPage.__lastScroll !== top) { node.scrollTop=top;currentPage.__lastScroll=top } })
  document.querySelectorAll('[scroll-into-view]').forEach(node => {
    const id=node.getAttribute('scroll-into-view')
    if(id && id!==node.__lastInto){ const target=document.getElementById(id); if(target) node.scrollTop=target.offsetTop-node.firstElementChild.offsetTop; node.__lastInto=id }
    if(!id) node.__lastInto=''
  })
  document.querySelectorAll('textarea').forEach(node => { node.style.height='auto';node.style.height=`${node.scrollHeight}px` })
}
function updateUnits() {
  const scss = styles[`../../miniprogram/${currentPath}.scss`] || ''
  pageHost.textContent = `${appStyle}\n${scss}`.replace(/(-?[\d.]+)rpx/g, (_,value) => `${Number(value) * Math.min(innerWidth, 750) / 750}px`).replace(/(^|[}\n])\s*page\s*{/g,'$1body {').replace(/\bview\b/g,'div').replace(/\btext\b(?=\s|\{|:|\.|#|,)/g,'span').replace(/\bimage\b/g,'img')
}
const target = new URLSearchParams(location.search).get('page') || '/pages/home/index'
const [route, query] = target.split('?')
currentPath = route.replace(/^\//,'')
if (!pages[`../../miniprogram/${currentPath}.ts`]) currentPath = 'pages/home/index'
updateUnits()
await pages[`../../miniprogram/${currentPath}.ts`]()
await currentPage?.onLoad?.(Object.fromEntries(new URLSearchParams(query || '')))
await currentPage?.onShow?.()
window.addEventListener('resize', () => {updateUnits();currentPage?.onResize?.()})
document.addEventListener('visibilitychange', () => { if(document.hidden) currentPage?.onHide?.() })
window.addEventListener('pagehide', () => currentPage?.onUnload?.())
let pageScrollFrame = 0
window.addEventListener('scroll', () => { if (!pageScrollFrame) pageScrollFrame = requestAnimationFrame(() => { pageScrollFrame = 0; currentPage?.onPageScroll?.({ scrollTop:window.scrollY }) }) }, { passive:true })
