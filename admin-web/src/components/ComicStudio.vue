<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ArrowUp, ArrowDown, Check, ImagePlus, Plus, RefreshCw, Save, Send, Trash2, WandSparkles, ExternalLink, History } from 'lucide-vue-next'
import ImageAttempts from './ImageAttempts.vue'
const props = defineProps<{ api: (path: string, options?: RequestInit) => Promise<any>; apiBase: string; token: string }>()
const emit = defineEmits<{ notify: [message: string]; dirty: [value: boolean] }>()
const options = ref<any>({ works: [], models: [], series: [], canPublish: false }); const episodes = ref<any[]>([]); const active = ref<any>(null); const chapters = ref<any[]>([])
const jobs = ref<any[]>([]); const revisions = ref<any[]>([]); const previews = ref<Record<string,string>>({})
const error = ref(''); const busy = ref(false); const dirty = ref(false); const createOpen = ref(false); const rights = ref(false); const showHistory = ref(false)
const form = ref({ workId: '', chapterId: '', title: '', seriesId: '', seriesTitle: '', episodeNumber: 1, style: '清爽彩色竖向条漫，电影感光影', characters: '', rightsNote: '' })
const panelCount = ref(8); const textModel = ref(''); const imageModel = ref('')
const textModels = computed(() => options.value.models.filter((m: any) => m.kind === 'text'))
const imageModels = computed(() => options.value.models.filter((m: any) => m.kind === 'image' && m.model === 'gpt-image-2'))
const availableWorks = computed(() => options.value.works.filter((work: any) => !episodes.value.some(episode => episode.workId === work.id)))
const availableSeries = computed(() => options.value.series.filter((series: any) => !form.value.workId || series.workId === form.value.workId))
const hasMissingImages = computed(() => active.value?.panels.some((panel: any) => !panel.imageId) ?? false)
const panelStats = computed(() => { const panels = active.value?.panels || []; return { total: panels.length, images: panels.filter((panel: any) => panel.imageId).length, approved: panels.filter((panel: any) => panel.imageId && panel.approved).length } })
const runningJobs = computed(() => jobs.value.filter(job => ['queued','running'].includes(job.status)).length)
const publishReady = computed(() => panelStats.value.total > 0 && panelStats.value.approved === panelStats.value.total && runningJobs.value === 0 && options.value.canPublish)
const publishReason = computed(() => !options.value.canPublish ? '等待内容审核员发布' : runningJobs.value ? '等待生成任务完成' : !panelStats.value.total ? '请完成分镜' : panelStats.value.images < panelStats.value.total ? `${panelStats.value.total - panelStats.value.images} 格待配图` : panelStats.value.approved < panelStats.value.total ? `${panelStats.value.total - panelStats.value.approved} 格待人工审核` : '可以发布')
const episodeGroups = computed(() => {
  const groups = new Map<string, { id: string; title: string; episodes: any[] }>()
  episodes.value.forEach(episode => { const id = episode.seriesId || episode.workId; const group = groups.get(id) || { id, title: episode.seriesTitle || episode.title, episodes: [] as any[] }; group.episodes.push(episode); groups.set(id, group) })
  return [...groups.values()].map(group => ({ ...group, episodes: group.episodes.sort((a, b) => (a.episodeNumber || 1) - (b.episodeNumber || 1)) }))
})
const statuses: Record<string,string> = { queued: '排队中', running: '生成中', success: '已完成', failed: '异常', cancelled: '已取消' }
let alive = true; let timer: ReturnType<typeof setTimeout> | undefined; let previewRevision = 0; let previewController: AbortController | undefined
function changed(value = true) { dirty.value = value; emit('dirty', value) }
function canDiscard() { return !dirty.value || window.confirm('分镜尚未保存，确定放弃修改？') }
async function action(fn: () => Promise<void>) { if (busy.value || !alive) return; busy.value = true; error.value = ''; try { await fn() } catch (e) { if (alive) error.value = (e as Error).message } finally { busy.value = false } }
function clearPreviews() { Object.values(previews.value).forEach(url => URL.revokeObjectURL(url)); previews.value = {} }
async function loadPreviews() {
  previewController?.abort(); const controller = previewController = new AbortController()
  const revision = ++previewRevision; const ids: string[] = [...new Set<string>(active.value?.panels.map((p: any) => p.imageId).filter(Boolean) || [])]; const next: Record<string,string> = {}; let cursor = 0
  await Promise.all(Array.from({ length: Math.min(3, ids.length) }, async () => {
    while (cursor < ids.length && alive && !controller.signal.aborted) {
      const id = ids[cursor++]
      if (previews.value[id]) { next[id] = previews.value[id]; continue }
      try {
        const response = await fetch(`${props.apiBase}/api/comic-media/${id}`, { headers: { Authorization: `Bearer ${props.token}` }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]) })
        if (response.ok) next[id] = URL.createObjectURL(await response.blob())
      } catch { /* Failed images can be retried without discarding the draft. */ }
    }
  }))
  if (!alive || revision !== previewRevision) { Object.entries(next).forEach(([id,url]) => { if (previews.value[id] !== url) URL.revokeObjectURL(url) }); return }
  Object.entries(previews.value).forEach(([id,url]) => { if (!next[id]) URL.revokeObjectURL(url) }); previews.value = next
}
async function loadEpisodes() {
  const result = await props.api('/admin-api/comics')
  if (alive) episodes.value = result.items
}
async function load() {
  await loadEpisodes()
  options.value = await props.api('/admin-api/comics/options')
  if (!textModel.value) textModel.value = textModels.value[0]?.id || ''; if (!imageModel.value) imageModel.value = imageModels.value[0]?.id || ''
}
function chooseSeries() { const selected = options.value.series?.find((series: any) => series.id === form.value.seriesId); form.value.episodeNumber = selected?.nextEpisodeNumber || 1 }
async function loadChapters() { await action(async () => { form.value.chapterId = ''; form.value.seriesId = ''; form.value.episodeNumber = 1; chapters.value = form.value.workId ? (await props.api(`/admin-api/comics/sources/${form.value.workId}`)).chapters : [] }) }
async function startAdaptation(workId: string) {
  if (busy.value || !canDiscard()) return
  form.value.workId = workId
  form.value.chapterId = ''; form.value.seriesId = ''; form.value.seriesTitle = ''; form.value.episodeNumber = 1
  chapters.value = []
  createOpen.value = true
  await loadChapters()
}
async function refresh() {
  if (!active.value) return
  const id = active.value.id; const result = await props.api(`/admin-api/comics/${id}/jobs`)
  if (active.value?.id !== id) return
  jobs.value = result.items
  if (!dirty.value) { const episode = (await props.api(`/admin-api/comics/${id}`)).episode; if (active.value?.id !== id || dirty.value) return; active.value = episode; await loadPreviews() }
}
async function open(id: string) { if (!canDiscard()) return; await action(async () => { previewController?.abort(); previewRevision++; clearPreviews(); active.value = (await props.api(`/admin-api/comics/${id}`)).episode; changed(false); revisions.value = []; showHistory.value = false; await refresh() }) }
async function create() { await action(async () => { const result = await props.api('/admin-api/comics', { method: 'POST', body: JSON.stringify({ ...form.value, chapterId: form.value.chapterId || null, rightsConfirmed: rights.value }) }); active.value = result.episode; episodes.value.unshift(active.value); createOpen.value = false; changed(false); jobs.value = []; clearPreviews(); await load(); emit('notify', '改编草稿已创建') }) }
async function save() { const result = await props.api(`/admin-api/comics/${active.value.id}`, { method: 'PUT', body: JSON.stringify({ version: active.value.version, panels: active.value.panels }) }); active.value = result.episode; changed(false); await loadPreviews(); await load() }
async function saveClick() { await action(async () => { await save(); emit('notify', '分镜已保存') }) }
async function storyboard() { await action(async () => {
  if (dirty.value) await save()
  if (active.value.panels.length && !window.confirm('重新生成分镜将替换当前草稿，旧分镜会保存到历史版本。是否继续？')) return
  await props.api(`/admin-api/comics/${active.value.id}/storyboard`, { method: 'POST', body: JSON.stringify({ version: active.value.version, panelCount: panelCount.value, modelId: textModel.value }) }); emit('notify', '分镜任务已排队'); await refresh()
}) }
async function images(panelId?: string) { await action(async () => {
  if (dirty.value) await save()
  if (panelId && !window.confirm('将再次请求生成这一格，供应商可能收费。是否继续？')) return
  const result = await props.api(`/admin-api/comics/${active.value.id}/images`, { method: 'POST', body: JSON.stringify({ version: active.value.version, modelId: imageModel.value, retryPolicy: 'never', ...(panelId ? { panelIds: [panelId] } : {}) }) }); emit('notify', result.warning || `已提交 ${result.jobIds.length} 格，跳过 ${result.skipped.length} 个进行中的任务`); await refresh()
}) }
function addPanel() { if (active.value.panels.length >= 60) return; active.value.panels.push({ id: crypto.randomUUID(), prompt: '', narration: '', dialogue: '', approved: false, imageId: null }); changed() }
function move(index: number, offset: number) { const panels = active.value.panels; if (index+offset < 0 || index+offset >= panels.length) return; [panels[index],panels[index+offset]] = [panels[index+offset],panels[index]]; changed() }
function remove(index: number) { if (window.confirm('删除这一格？旧版本仍保留。')) { active.value.panels.splice(index,1); changed() } }
async function publish() { if (!publishReady.value) return; await action(async () => { if (dirty.value) await save(); const result = await props.api(`/admin-api/comics/${active.value.id}/publish`, { method: 'POST', body: JSON.stringify({ version: active.value.version }) }); active.value = result.episode; await load(); emit('notify', '条漫已发布') }) }
async function unpublish() { if (!window.confirm('下架后读者将无法访问这话条漫，是否继续？')) return; await action(async () => { await props.api(`/admin-api/comics/${active.value.id}/unpublish`, { method: 'POST', body: '{}' }); await refresh(); await load() }) }
async function history() { await action(async () => { revisions.value = (await props.api(`/admin-api/comics/${active.value.id}/revisions`)).items; showHistory.value = !showHistory.value }) }
async function restore(revisionId: string) { if (!canDiscard()) return; await action(async () => { active.value = (await props.api(`/admin-api/comics/${active.value.id}/restore`, { method: 'POST', body: JSON.stringify({ version: active.value.version, revisionId }) })).episode; changed(false); await refresh() }) }
async function adopt(jobId: string) { await action(async () => { if (dirty.value) await save(); active.value = (await props.api(`/admin-api/comics/${active.value.id}/adopt`, { method: 'POST', body: JSON.stringify({ version: active.value.version, jobId }) })).episode; changed(false); await refresh() }) }
async function poll() { if (!alive) return; try { if (!busy.value && !document.hidden) { await loadEpisodes(); if (active.value) await refresh() } } catch (e) { if (alive) error.value = (e as Error).message } finally { if (alive) timer = setTimeout(poll, runningJobs.value ? 4000 : 15000) } }
onMounted(async () => { await action(load); const query = window.location.hash.split('?')[1]; const id = query && new URLSearchParams(query).get('episodeId'); if (id && episodes.value.some(episode => episode.id === id)) await open(id); if (alive) timer = setTimeout(poll, 4000) })
onBeforeUnmount(() => { alive = false; previewController?.abort(); previewRevision++; if (timer) clearTimeout(timer); clearPreviews() })
</script>
<template>
  <section class="comic-studio">
    <div class="section-toolbar"><p>条漫草稿与发布版本</p><div class="comic-actions"><button class="icon-button" title="刷新" :disabled="busy" @click="action(async () => { await load(); await refresh() })"><RefreshCw :size="17" /></button><button class="outline-button" :disabled="busy || dirty" @click="createOpen = !createOpen"><Plus :size="16" />新建漫画本 / 续作</button></div></div>
    <p v-if="error" class="error-banner" role="alert">{{ error }}</p>
    <form v-if="createOpen" class="comic-create" @submit.prevent="create">
      <label>小说<select v-model="form.workId" required @change="loadChapters"><option value="" disabled>选择作品</option><option v-for="work in options.works" :key="work.id" :value="work.id">{{ work.title }}</option></select></label>
      <label>漫画本<select v-model="form.seriesId" @change="chooseSeries"><option value="">新建漫画本</option><option v-for="series in availableSeries" :key="series.id" :value="series.id">{{ series.title }} · 下一话 {{ series.nextEpisodeNumber }}</option></select></label><label v-if="!form.seriesId">漫画本名称<input v-model="form.seriesTitle" maxlength="120" required /></label><label>话序<input v-model.number="form.episodeNumber" type="number" min="1" max="100000" required /></label>
      <label v-if="chapters.length">章节<select v-model="form.chapterId" required><option value="" disabled>选择章节</option><option v-for="chapter in chapters" :key="chapter.id" :value="chapter.id">{{ chapter.title }}</option></select></label>
      <label>条漫标题<input v-model="form.title" maxlength="120" placeholder="默认使用小说标题" /></label><label>画风<input v-model="form.style" maxlength="2000" required /></label><label>固定角色设定<textarea v-model="form.characters" maxlength="6000" rows="3" /></label><label>改编授权说明<textarea v-model="form.rightsNote" maxlength="2000" rows="2" required /></label><label class="comic-check"><input v-model="rights" type="checkbox" required />确认拥有该作品漫画改编与图片生成的授权</label><button class="primary-button" :disabled="busy"><Save :size="16" />创建草稿</button>
    </form>
    <div class="comic-layout"><aside class="comic-list"><div v-for="group in episodeGroups" :key="group.id" class="comic-list-group"><p class="comic-list-heading">{{ group.title }} · {{ group.episodes.length }} 话</p><button v-for="episode in group.episodes" :key="episode.id" :class="{ selected: active?.id === episode.id }" :disabled="busy" @click="open(episode.id)"><strong>{{ episode.title }}</strong><span>第 {{ episode.episodeNumber || 1 }} 话 · {{ episode.panels.length }} 格 · v{{ episode.version }}</span><small>{{ episode.published ? `已发布 v${episode.publishedVersion}` : '未发布' }}</small></button></div><p v-if="!episodes.length && !availableWorks.length" class="muted">暂无漫画草稿</p><template v-if="availableWorks.length"><p class="comic-list-heading">可改编作品</p><button v-for="work in availableWorks" :key="`work-${work.id}`" class="comic-source" :disabled="busy" @click="startAdaptation(work.id)"><strong>{{ work.title }}</strong><span>尚未创建条漫草稿</span><small>开始改编</small></button></template></aside>
      <div v-if="active" class="comic-editor">
        <div class="comic-toolbar"><h2>{{ active.title }}<small>{{ active.seriesTitle || '漫画草稿' }}{{ active.episodeNumber ? ` · 第 ${active.episodeNumber} 话` : '' }} · 原文 {{ active.sourceLength }} 字 · 草稿 v{{ active.version }}{{ dirty ? ' · 未保存' : '' }}</small></h2><div class="comic-actions"><button class="icon-button" title="历史版本" :disabled="busy" @click="history"><History :size="17" /></button><button class="icon-button" title="保存分镜" :disabled="busy || !active.panels.length" @click="saveClick"><Save :size="17" /></button><button class="primary-button" :disabled="busy || !publishReady" :title="publishReason" @click="publish"><Send :size="16" />审核发布</button><a v-if="active.published" class="outline-button" :href="`${apiBase}/comics/${active.id}`" target="_blank" rel="noopener"><ExternalLink :size="16" />已发布版</a><button v-if="active.published && options.canPublish" class="outline-button" :disabled="busy" @click="unpublish">下架</button></div></div>
        <div class="comic-production-status" aria-live="polite"><span>分镜 {{ panelStats.total }} 格</span><span>图片 {{ panelStats.images }}/{{ panelStats.total }}</span><span>审核 {{ panelStats.approved }}/{{ panelStats.total }}</span><span :class="{ ready: publishReady }">{{ publishReason }}</span></div>
        <div class="comic-controls"><label>文本模型<select v-model="textModel"><option value="" disabled>未配置</option><option v-for="model in textModels" :key="model.id" :value="model.id">{{ model.name }} · {{ model.model }}</option></select></label><label>目标格数<input v-model.number="panelCount" type="number" min="1" max="60" /></label><button class="outline-button" :disabled="busy || !textModel" @click="storyboard"><WandSparkles :size="16" />生成分镜</button><label>图片模型<select v-model="imageModel"><option value="" disabled>未配置</option><option v-for="model in imageModels" :key="model.id" :value="model.id">{{ model.name }} · {{ model.model }}</option></select></label><button class="outline-button" :disabled="busy || !imageModel || !hasMissingImages" @click="images()"><ImagePlus :size="16" />生成缺失图片</button></div>
        <div v-if="showHistory" class="comic-history"><div v-for="revision in revisions" :key="revision.id"><span>v{{ revision.version }} · {{ revision.createdAt }}</span><button class="outline-button" :disabled="busy" @click="restore(revision.id)">恢复到草稿</button></div><p v-if="!revisions.length">暂无历史版本</p></div>
        <div v-for="(panel,index) in active.panels" :key="panel.id" class="panel-editor"><div class="panel-header"><strong>第 {{ index + 1 }} 格</strong><div class="comic-actions"><button class="icon-button" title="上移" :disabled="busy || index === 0" @click="move(index,-1)"><ArrowUp :size="16" /></button><button class="icon-button" title="下移" :disabled="busy || index === active.panels.length-1" @click="move(index,1)"><ArrowDown :size="16" /></button><button class="icon-button" title="删除分镜" :disabled="busy" @click="remove(index)"><Trash2 :size="16" /></button></div></div><div class="panel-body"><div class="panel-fields"><label>画面描述<textarea v-model="panel.prompt" maxlength="3000" rows="4" :disabled="busy" @input="panel.approved = false; changed()" /></label><label>旁白<textarea v-model="panel.narration" maxlength="1000" rows="2" :disabled="busy" @input="panel.approved = false; changed()" /></label><label>对白<textarea v-model="panel.dialogue" maxlength="1000" rows="2" :disabled="busy" @input="panel.approved = false; changed()" /></label><div class="comic-actions"><label v-if="panel.imageId" class="comic-check"><input v-model="panel.approved" type="checkbox" :disabled="busy" @change="changed()" /><Check :size="15" />审核通过</label><button class="outline-button" :disabled="busy || !imageModel" @click="images(panel.id)"><ImagePlus :size="16" />{{ panel.imageId ? '重新生成' : '生成这一格' }}</button></div></div><div class="panel-preview"><p v-if="panel.narration">{{ panel.narration }}</p><img v-if="previews[panel.imageId]" :src="previews[panel.imageId]" alt="漫画画面" /><div v-else class="image-empty">图片待生成</div><p v-if="panel.dialogue" class="panel-dialogue">{{ panel.dialogue }}</p></div></div></div>
        <button class="outline-button add-panel" :disabled="busy || active.panels.length >= 60" @click="addPanel"><Plus :size="16" />添加分镜</button>
        <div class="comic-jobs"><h3>本话任务</h3><div v-for="job in jobs" :key="job.id" class="comic-job"><div><strong>{{ job.type === 'comic_storyboard' ? '编剧分镜' : '分镜图片' }} · {{ statuses[job.status] }}</strong><small v-if="job.errorCode">{{ job.errorCode }}</small><small v-if="job.result?.stale">结果对应旧草稿，尚未应用</small><ImageAttempts :attempts="job.result?.attempts" /></div><button v-if="job.result?.stale" class="outline-button" :disabled="busy" @click="adopt(job.id)">应用结果</button></div><p v-if="!jobs.length" class="muted">暂无生成任务</p></div>
      </div>
    </div>
  </section>
</template>
<style scoped>
.comic-production-status{display:flex;gap:12px;flex-wrap:wrap;padding:16px 0;border-bottom:1px solid #e1e4e7;color:#68747c;font-size:13px}.comic-production-status .ready{color:#16705b}.comic-list-group{min-width:0}.comic-list-heading{white-space:normal!important;overflow-wrap:anywhere}@media(max-width:1000px){.comic-list-group{flex:0 0 200px}}
.comic-list-heading{white-space:nowrap;flex-shrink:0;align-self:center}
.comic-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.comic-actions a{text-decoration:none}.comic-create{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;padding:20px 0;border-block:1px solid #dfe3e6;margin-bottom:24px}.comic-studio label{display:flex;flex-direction:column;gap:6px;font-size:13px}.comic-studio input:not([type=checkbox]),.comic-studio textarea,.comic-studio select{padding:9px;border:1px solid #d1d7dc;border-radius:4px;width:100%;box-sizing:border-box;background:white;font:inherit;min-width:0}.comic-studio textarea{resize:vertical}.comic-studio .comic-check{flex-direction:row;align-items:center}.comic-layout{display:grid;grid-template-columns:190px minmax(0,1fr);gap:28px}.comic-list{border-right:1px solid #e1e4e7;padding-right:16px}.comic-list button{display:block;width:100%;text-align:left;border:0;border-bottom:1px solid #e1e4e7;background:transparent;padding:14px 10px;cursor:pointer;overflow-wrap:anywhere}.comic-list button.selected{background:#e8f3ee;border-left:3px solid #26866c}.comic-list span,.comic-list small{display:block;font-size:12px;color:#68747c;margin-top:6px}.comic-list-heading{margin:18px 10px 6px;font-size:12px;color:#68747c;font-weight:600}.comic-source{background:#f7faf8!important;border:1px solid #d5e4dd!important;border-radius:4px;margin-bottom:8px}.comic-source small{color:#26866c}.comic-toolbar{display:flex;flex-wrap:wrap;justify-content:space-between;gap:12px;align-items:center;border-bottom:1px solid #dfe3e6;padding-bottom:18px}.comic-toolbar h2{font-size:19px;margin:0;overflow-wrap:anywhere}.comic-toolbar small{display:block;font-size:12px;font-weight:400;margin-top:5px;color:#68747c}.comic-controls{display:flex;align-items:end;flex-wrap:wrap;gap:12px;padding:20px 0}.comic-controls label{flex:1 1 180px}.comic-controls label:nth-child(2){flex:0 0 90px}.panel-editor{border-block-start:1px solid #dfe3e6;padding:20px 0}.panel-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}.panel-body{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:20px}.panel-fields{display:flex;flex-direction:column;gap:12px}.panel-preview{background:#f6f7f8;align-self:start;overflow-wrap:anywhere}.panel-preview img{width:100%;height:auto;display:block}.panel-preview p{white-space:pre-wrap;margin:0;padding:12px 16px;font-size:14px}.panel-preview .panel-dialogue{border-left:3px solid #29866b;margin:12px}.image-empty{display:grid;place-items:center;aspect-ratio:3/4;background:#edf0f2;color:#7b858b;font-size:13px}.comic-jobs{margin-top:28px;border-top:1px solid #dfe3e6}.comic-jobs h3{font-size:16px}.comic-job,.comic-history>div{display:flex;gap:12px;align-items:center;justify-content:space-between;padding:12px 0;border-bottom:1px solid #e5e7e9}.comic-job strong{font-size:13px}.comic-job small{display:block;color:#b0414f;font-size:12px;overflow-wrap:anywhere}.add-panel{margin:16px 0}.comic-history{padding:12px 0;font-size:13px}@media(max-width:1000px){.comic-layout{grid-template-columns:1fr}.comic-list{display:flex;overflow:auto;border-right:0;border-bottom:1px solid #ddd;gap:8px;padding:0}.comic-list button{min-width:160px;max-width:230px}.panel-body{grid-template-columns:1fr}.panel-preview{width:100%;max-width:450px;margin:auto}}@media(max-width:600px){.comic-create{grid-template-columns:1fr}}
</style>
