<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { BookOpen, Check, ChevronLeft, ChevronRight, Download, FileText, Image, RefreshCw, RotateCcw, Save, Sparkles, UploadCloud } from 'lucide-vue-next'
import ImageAttempts from './ImageAttempts.vue'

const props = defineProps<{ api: (path: string, init?: RequestInit) => Promise<any>; apiBase: string; token: string; textReady: boolean; imageReady: boolean }>()
const emit = defineEmits<{ notify: [message: string]; dirty: [value: boolean] }>()
const busy = ref(false); const error = ref(''); const file = ref<File | null>(null); const encoded = ref(''); const preview = ref<any>(null)
const title = ref(''); const author = ref(''); const summary = ref(''); const rightsNote = ref(''); const consent = ref(false); const encoding = ref('auto')
const imports = ref<any[]>([]); const selected = ref<any>(null); const chapter = ref<any>(null); const offset = ref(0); const tab = ref('current'); const editableTitle = ref(''); const editableContent = ref(''); const editing = ref(false)
const instruction = ref(''); const imagePrompt = ref(''); const imageCost = ref(false); const mediaUrls = ref<Record<string, string>>({})
const locked = computed(() => selected.value?.work.status === 'published')
const dirty = computed(() => editing.value && (editableContent.value !== chapter.value?.content || editableTitle.value !== chapter.value?.title))
watch(dirty, value => emit('dirty', value))
const statuses: Record<string, string> = { preview: '待确认', review: '待审核', published: '已发布', queued: '排队中', running: '处理中', success: '完成', failed: '失败', suggested: '待采纳', applied: '已采纳', discarded: '已舍弃', manual: '手动修订', stale: '建议已失效' }
async function action(run: () => Promise<void>) {
  if (busy.value) return
  busy.value = true; error.value = ''
  try { await run() } catch (failure: any) { error.value = failure?.message || '操作失败' } finally { busy.value = false }
}
function canLeave() { return !dirty.value || window.confirm('当前编辑尚未保存，放弃修改？') }
async function blob(path: string) {
  const response = await fetch(`${props.apiBase}${path}`, { headers: { Authorization: `Bearer ${props.token}` }, signal: AbortSignal.timeout(20000) })
  if (!response.ok) throw new Error('无法加载原稿或素材，请刷新登录状态')
  return response.blob()
}
function clearMedia() { Object.values(mediaUrls.value).forEach(url => URL.revokeObjectURL(url)); mediaUrls.value = {} }
async function download(path: string, name: string) { await action(async () => { const url = URL.createObjectURL(await blob(path)); const link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000) }) }
async function refreshMedia() {
  clearMedia()
  for (const media of selected.value?.media || []) mediaUrls.value[media.id] = URL.createObjectURL(await blob(media.url))
}
async function loadChapter(id: string) {
  const result = await props.api(`/admin-api/imports/${selected.value.work.id}/chapters/${id}`)
  chapter.value = result.chapter; editableTitle.value = chapter.value.title; editableContent.value = chapter.value.content; editing.value = false
}
async function refreshSelected() {
  if (!selected.value) return
  const id = chapter.value?.id
  selected.value = await props.api(`/admin-api/imports/${selected.value.work.id}?offset=${offset.value}&limit=50`)
  if (id && !dirty.value) await loadChapter(id)
  await refreshMedia()
}
async function loadList() { imports.value = (await props.api('/admin-api/imports')).items }
async function selectImport(item: any) {
  if (!canLeave()) return
  await action(async () => { editing.value = false; chapter.value = null; selected.value = item; offset.value = 0; imagePrompt.value = ''; await refreshSelected() })
}
async function pick(event: Event) {
  const input = event.target as HTMLInputElement; const next = input.files?.[0]; input.value = ''; if (!next) return
  await action(async () => {
    preview.value = null; encoded.value = ''; file.value = null
    if (!/\.txt$/i.test(next.name) || next.size > 8 * 1024 * 1024 || !next.size) throw new Error('请选择非空 TXT 文件，大小不超过 8MB')
    const base64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1] || ''); reader.onerror = () => reject(new Error('文件读取失败')); reader.readAsDataURL(next) })
    file.value = next; encoded.value = base64; title.value = next.name.replace(/\.txt$/i, ''); consent.value = false
    await previewFile()
  })
}
async function previewFile() { preview.value = null; if (file.value) preview.value = await props.api('/admin-api/imports/preview', { method: 'POST', body: JSON.stringify({ fileName: file.value.name, base64: encoded.value, encoding: encoding.value }) }) }
async function importNovel() {
  await action(async () => {
    if (!file.value || !preview.value || !consent.value || !rightsNote.value.trim()) throw new Error('请预览文件并填写、确认授权信息')
    const result = await props.api('/admin-api/imports', { method: 'POST', body: JSON.stringify({ fileName: file.value.name, base64: encoded.value, sourceHash: preview.value.sourceHash, title: title.value.trim(), author: author.value.trim(), summary: summary.value.trim(), encoding: preview.value.encoding, rightsConfirmed: consent.value, rightsNote: rightsNote.value.trim() }) })
    file.value = null; encoded.value = ''; preview.value = null; consent.value = false; selected.value = result.import; chapter.value = null; offset.value = 0
    await loadList(); await refreshSelected(); emit('notify', '已导入为草稿，原稿完整保留')
  })
}
async function openChapter(id: string) { if (!canLeave()) return; await action(async () => { await loadChapter(id); tab.value = 'current'; instruction.value = '' }) }
async function mutation(suffix: string, payload: any = {}, message = '操作已完成') {
  await action(async () => { await props.api(`/admin-api/imports/${selected.value.work.id}${suffix}`, { method: 'POST', body: JSON.stringify(payload) }); await refreshSelected(); await loadList(); emit('notify', message) })
}
async function saveChapter() {
  await action(async () => { await props.api(`/admin-api/imports/${selected.value.work.id}/chapters/${chapter.value.id}`, { method: 'PUT', body: JSON.stringify({ title: editableTitle.value, content: editableContent.value, sourceContent: chapter.value.content }) }); editing.value = false; await refreshSelected(); emit('notify', '正文已保存，需要重新确认') })
}
async function reviewChapter() {
  if (!window.confirm('将把当前章节和邻章摘录发送给监督审查模型。明确失败时按顺序兜底，最多 3 次调用；超时或网络错误会停止。继续？')) return
  await mutation(`/chapters/${chapter.value.id}/review`, { instruction: instruction.value }, 'AI 审阅已启动')
}
async function applyRevision() {
  if (!window.confirm('将以建议稿替换当前章节；原稿和修订记录仍保留。继续？')) return
  await mutation(`/revisions/${chapter.value.revision.id}/apply`, {}, '建议已采纳，请重新确认本章')
}
async function restoreOriginal() {
  if (!window.confirm('恢复导入时的原文，并取消本章确认？')) return
  await mutation(`/chapters/${chapter.value.id}/restore`, {}, '已恢复原文')
}
async function paginate(direction: number) { if (!canLeave()) return; await action(async () => { offset.value = Math.max(0, offset.value + direction * 50); chapter.value = null; editing.value = false; await refreshSelected() }) }
async function generateImage(kind: string) {
  if (!imageCost.value || !imagePrompt.value.trim()) { error.value = '请填写配图方案并确认生图费用'; return }
  if (!window.confirm('每个素材只调用一次已选图片模型，失败或超时不自动重试。确认生成？')) return
  await mutation('/images', { kind, chapterId: kind === 'scene' ? chapter.value?.id : null, prompt: imagePrompt.value.trim(), title: kind === 'cover' ? '封面' : chapter.value?.title, confirmCost: true }, '生图任务已启动')
}
function beforeUnload(event: BeforeUnloadEvent) { if (dirty.value) { event.preventDefault(); event.returnValue = '' } }
let timer: number | undefined
onMounted(() => {
  window.addEventListener('beforeunload', beforeUnload)
  action(loadList)
  timer = window.setInterval(() => { if (!busy.value && !dirty.value && selected.value?.jobs.some((job: any) => ['queued','running'].includes(job.status))) action(refreshSelected) }, 5000)
})
onUnmounted(() => { window.clearInterval(timer); window.removeEventListener('beforeunload', beforeUnload); clearMedia(); emit('dirty', false) })
</script>

<template>
  <section class="imports-page" :aria-busy="busy">
    <div class="section-toolbar"><p>完本 TXT</p><label class="primary-button file-picker"><UploadCloud :size="18" />选择文件<input type="file" accept=".txt,text/plain" :disabled="busy" aria-label="选择 TXT 文件" @change="pick" /></label></div>
    <div v-if="error" class="error-banner" role="alert">{{ error }}</div>
    <div class="import-grid">
      <form class="import-form" @submit.prevent="importNovel">
        <div v-if="file" class="preview-summary"><FileText :size="22" /><div><strong>{{ file.name }}</strong><span>{{ preview ? `${preview.totalChapters} 章 · ${preview.wordCount} 字 · ${preview.encoding}` : '待解析' }}</span></div></div>
        <label>编码<select v-model="encoding" :disabled="busy" @change="action(previewFile)"><option value="auto">自动识别</option><option value="utf-8">UTF-8</option><option value="gb18030">GB18030 / GBK</option><option value="utf-16le">UTF-16 LE</option><option value="utf-16be">UTF-16 BE</option></select></label>
        <div v-for="warning in preview?.warnings || []" :key="warning" class="import-warning">{{ warning }}</div>
        <label>作品名<input v-model="title" maxlength="120" required :disabled="busy" /></label><label>原作者<input v-model="author" maxlength="80" required :disabled="busy" /></label><label>简介<textarea v-model="summary" rows="3" maxlength="1000" :disabled="busy" /></label><label>授权来源<textarea v-model="rightsNote" rows="2" maxlength="500" required :disabled="busy" /></label><label class="import-consent"><input v-model="consent" type="checkbox" :disabled="busy" />拥有导入、改编、配图及公开发布授权</label>
        <button class="primary-button wide-button" :disabled="busy || !preview || !consent"><BookOpen :size="16" />{{ busy ? '处理中' : '确认分章并导入草稿' }}</button>
        <div v-if="preview" class="chapter-preview"><strong>分章预览</strong><div v-for="item in preview.chapters.slice(0,20)" :key="item.number"><span>{{ item.number }}</span><b>{{ item.title }}</b><em>{{ item.wordCount }} 字</em></div><small v-if="preview.totalChapters > 20">共 {{ preview.totalChapters }} 章，导入后分页查看</small></div>
      </form>
      <div class="import-list"><div class="panel-head"><h2>导入作品</h2><button class="icon-button" title="刷新列表" :disabled="busy" @click="action(loadList)"><RefreshCw :size="18" /></button></div><button v-for="item in imports" :key="item.work.id" class="import-item" :class="{ selected: selected?.work.id === item.work.id }" :disabled="busy" @click="selectImport(item)"><div><strong>{{ item.work.title }}</strong><span>{{ item.chapterCount }} 章 · {{ item.work.words.toLocaleString() }} 字 · {{ statuses[item.source.status] }}</span></div><ChevronRight :size="18" /></button><div v-if="!imports.length" class="empty-state">暂无导入作品</div></div>
    </div>
    <div v-if="selected" class="import-work">
      <div class="work-head"><div><h2>{{ selected.work.title }}</h2><p>{{ selected.source.fileName }} · 已确认 {{ selected.checked }}/{{ selected.chapterCount }} 章 · {{ statuses[selected.source.status] }}</p></div><div class="image-actions"><button class="icon-button" title="刷新作品" :disabled="busy || dirty" @click="action(refreshSelected)"><RefreshCw :size="18" /></button><button class="outline-button" :disabled="busy" @click="download(`/admin-api/imports/${selected.work.id}/source`, selected.source.fileName)"><Download :size="16" />原稿</button><button class="primary-button" :disabled="busy || dirty || locked || selected.checked !== selected.chapterCount" @click="mutation('/submit-review', {}, '已提交审核，请在内容审核中确认发布')"><Check :size="16" />提交审核</button></div></div>
      <div v-for="warning in selected.source.warnings" :key="warning" class="import-warning">{{ warning }}</div>
      <div v-for="job in selected.jobs" :key="job.id" class="job-status" role="status">{{ job.type === 'import_chapter_review' ? '章节审阅' : '图片生成' }} · {{ statuses[job.status] }} <span v-if="job.errorCode">{{ job.errorCode }}</span><ImageAttempts :attempts="job.result?.attempts" /></div>
      <div class="work-body">
        <div><div class="import-pagination"><button class="icon-button" title="上一页章节" :disabled="busy || offset === 0" @click="paginate(-1)"><ChevronLeft :size="18" /></button><span>{{ offset + 1 }}–{{ Math.min(offset + 50, selected.chapterCount) }}</span><button class="icon-button" title="下一页章节" :disabled="busy || offset + 50 >= selected.chapterCount" @click="paginate(1)"><ChevronRight :size="18" /></button></div><div class="chapter-list"><button v-for="item in selected.chapters" :key="item.id" class="chapter-row" :class="{ active: chapter?.id === item.id }" :disabled="busy" @click="openChapter(item.id)"><span>{{ item.chapterNumber }}</span><div><strong>{{ item.title }}</strong><em>{{ item.wordCount }} 字 · {{ statuses[item.revisionStatus] || '原稿' }}</em></div><ChevronRight :size="15" /></button></div></div>
        <div v-if="chapter" class="chapter-editor">
          <div class="editor-head"><div><h3>{{ chapter.title }}</h3><span>{{ chapter.checked ? '已确认当前正文' : '待确认' }}</span></div><div class="editor-actions"><button class="outline-button" :disabled="busy || dirty || locked || !chapter.content.trim()" @click="mutation(`/chapters/${chapter.id}/check`, {}, '本章已确认')"><Check :size="16" />确认本章</button><button class="icon-button" title="恢复导入原文" :disabled="busy || dirty || locked" @click="restoreOriginal"><RotateCcw :size="18" /></button></div></div>
          <div class="compare-tabs" role="tablist"><button v-for="item in [{id:'current',name:'当前正文'},{id:'suggested',name:'AI 建议'},{id:'source',name:'导入原文'}]" :key="item.id" role="tab" :aria-selected="tab === item.id" :class="{ active: tab === item.id }" :disabled="dirty && item.id !== 'current'" @click="tab = item.id">{{ item.name }}</button></div>
          <div v-if="tab === 'current' && editing"><input v-model="editableTitle" aria-label="章节标题" maxlength="120" /><textarea v-model="editableContent" rows="16" aria-label="章节正文" /><div class="image-actions"><button class="primary-button" :disabled="busy || !dirty" @click="saveChapter"><Save :size="16" />保存修改</button><button class="outline-button" :disabled="busy" @click="canLeave() && (editing = false)">取消</button></div></div>
          <div v-else class="text-compare" :style="tab !== 'suggested' ? {gridTemplateColumns:'minmax(0,1fr)'} : {}">
            <article v-if="tab === 'current' || tab === 'source'"><header>{{ tab === 'source' ? '原文留档' : '当前正文' }}<button v-if="tab === 'current'" class="text-button" :disabled="locked || busy" @click="editing = true">编辑</button></header><pre>{{ tab === 'source' ? chapter.sourceContent : chapter.content }}</pre></article>
            <template v-else-if="chapter.revision"><article><header>生成建议时的正文</header><pre>{{ chapter.revision.sourceContent }}</pre></article><article><header>{{ chapter.revision.stale ? '正文已改变，建议已失效' : statuses[chapter.revision.status] }}<button class="text-button" :disabled="busy || locked || chapter.revision.stale || chapter.revision.status !== 'suggested'" @click="applyRevision">采纳</button></header><pre>{{ chapter.revision.suggestedContent }}</pre></article></template><article v-else class="empty-state">暂无 AI 建议</article>
          </div>
          <div v-if="tab === 'suggested'"><div v-for="issue in chapter.revision?.issues || []" :key="issue.reason" class="issue-line"><b>{{ issue.type }} · {{ issue.location }}</b><span>{{ issue.reason }}</span><small>{{ issue.suggestion }}</small></div><textarea v-model="instruction" rows="2" maxlength="1000" placeholder="审阅重点（可选）" aria-label="审阅重点" /><div class="image-actions"><button class="primary-button" :disabled="busy || locked || dirty || !textReady || chapter.content.length > 12000" @click="reviewChapter"><Sparkles :size="16" />{{ textReady ? '审阅当前章节' : '监督审查模型未配置' }}</button></div><p class="muted">{{ chapter.content.length > 12000 ? '本章超过 12000 字符，请人工编辑审阅。' : '单章审阅含邻章摘录，不是整书连续性审稿。' }}</p></div>
          <div class="image-plan"><div><Image :size="18" /><strong>配图方案</strong></div><p v-if="chapter.revision?.imagePlan" class="muted">{{ chapter.revision.imagePlan }}</p><textarea v-model="imagePrompt" rows="3" maxlength="1800" aria-label="配图方案" placeholder="主体、场景、构图、风格及避免元素" /><label class="import-consent"><input v-model="imageCost" type="checkbox" />确认付费调用已选图片模型，每个素材仅一次</label><div class="image-actions"><button class="outline-button" :disabled="busy || locked || !imageReady || !imageCost" @click="generateImage('cover')"><Image :size="16" />生成封面</button><button class="outline-button" :disabled="busy || locked || !imageReady || !imageCost" @click="generateImage('scene')"><Image :size="16" />生成本章插图</button></div><p v-if="!imageReady" class="muted">图片模型尚未配置</p></div>
        </div><div v-else class="empty-state">选择章节</div>
      </div>
      <div class="media-list"><div v-for="media in selected.media" :key="media.id" class="media-item"><img v-if="mediaUrls[media.id]" :src="mediaUrls[media.id]" :alt="media.kind === 'cover' ? '待审核封面' : '待审核章节插图'" /><small>{{ media.kind === 'cover' ? '封面' : '插图' }} · {{ media.approved ? '已通过' : '未通过' }} · WebP {{ Math.round(media.optimizedBytes / 1024) }}KB</small><div class="image-actions"><button class="outline-button" :disabled="busy || locked" @click="mutation(`/images/${media.id}/approve`)"><Check :size="16" />通过</button><button class="outline-button" :disabled="busy || locked" @click="mutation(`/images/${media.id}/reject`)">拒绝</button><button class="icon-button" title="下载原图" :disabled="busy" @click="download(media.originalUrl, `${media.id}.png`)"><Download :size="16" /></button></div></div></div>
    </div>
  </section>
</template>
