<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Activity, BookOpen, CheckCircle2, ChevronRight, ClipboardCheck, FileClock, LayoutDashboard, LogOut, RefreshCw, Search, Server, Users, XCircle, Cpu, PlugZap, Save, Plus, Power } from 'lucide-vue-next'
import type { AdminUser, Role, Section } from './types'
import { permissions, roleLabels } from './types'
import NovelImports from './components/NovelImports.vue'
import ReaderComments from './components/ReaderComments.vue'
import CreativeImages from './components/CreativeImages.vue'
import ProductionQueue from './components/ProductionQueue.vue'
import ComicStudio from './components/ComicStudio.vue'
import ObjectStorage from './components/ObjectStorage.vue'

type ModelConfig = { id: string; name: string; provider: string; kind: string; endpoint: string; model: string; keyHint: string; enabled: boolean; isDefault: boolean; reviewDefault: boolean; textRole: string; priority: number }
type Runtime = { environment: string; storage: string; wechatConfigured: boolean; devLoginEnabled: boolean; encryptionConfigured: boolean; imageConfigured: boolean; textConfigured: boolean; reviewConfigured: boolean; stats: { published: number; users: number; runningJobs: number; failedJobs: number } }
type Review = { work: { id: string; title: string; author: string; words: number }; reportId: string | null; issues: Array<{ id: string; severity: string; reason: string; location: string; suggestion: string }>; scores: Record<string, number> | null }
const apiBase = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '')
const pageOrigin = window.location.origin
const previewAvailable = import.meta.env.DEV
const authToken = ref(localStorage.getItem('mojing_admin_token') || '')
const currentRole = ref<Role>('data_viewer')
const userName = ref('管理员')
const active = ref<Section>(window.location.hash.startsWith('#comics') ? 'comics' : 'overview')
const busy = ref(false)
const importsDirty = ref(false)
const message = ref('')
const error = ref('')
const loginAccount = ref('admin@mojing.local')
const loginPassword = ref('')
const search = ref('')
const runtime = ref<Runtime | null>(null)
const users = ref<AdminUser[]>([])
const audit = ref<Array<{ id: string; actor: string; action: string; targetType: string; result: string; createdAt: string }>>([])
const models = ref<ModelConfig[]>([])
const reviews = ref<Review[]>([])
const selectedReview = ref('')
const review = computed(() => reviews.value.find(item => item.work.id === selectedReview.value) || reviews.value[0])
const editing = ref('')
const modelForm = ref({ name: '', provider: 'tuzi', kind: 'image', endpoint: 'https://api.tu-zi.com/coding/images/generations', model: 'gpt-image-2', apiKey: '', enabled: true, isDefault: true, reviewDefault: false, textRole: 'generation', priority: 1000 })
const navItems: Array<{ id: Section; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'overview', label: '总览', icon: LayoutDashboard }, { id: 'models', label: '模型接入', icon: Cpu },
  { id: 'system', label: '服务配置', icon: Server }, { id: 'users', label: '用户与角色', icon: Users },
  { id: 'moderation', label: '内容审核', icon: ClipboardCheck }, { id: 'audit', label: '操作审计', icon: FileClock },
  { id: 'imports', label: '小说导入', icon: BookOpen },
  { id: 'comments', label: '读者内容', icon: ClipboardCheck },
  { id: 'production', label: '生产队列', icon: Activity },
  { id: 'comics', label: '条漫工作室', icon: BookOpen },
]
const can = (section: Section) => permissions[currentRole.value].includes(section)
const visibleUsers = computed(() => users.value.filter(user => `${user.name} ${user.account}`.includes(search.value)))
const checks = computed(() => runtime.value ? [
  { label: '微信正式登录', ready: runtime.value.wechatConfigured, value: runtime.value.wechatConfigured ? 'AppID / AppSecret 已配置' : '等待服务器环境变量' },
  { label: '模型密钥加密', ready: runtime.value.encryptionConfigured, value: runtime.value.encryptionConfigured ? '独立加密密钥已配置' : '开发环境使用临时密钥' },
  { label: '图片模型', ready: runtime.value.imageConfigured, value: runtime.value.imageConfigured ? '图片供应商已接入' : '等待模型配置' },
  { label: '文本模型', ready: runtime.value.textConfigured, value: runtime.value.textConfigured ? '文本供应商已接入' : '等待模型配置' },
  { label: '监督审查模型', ready: runtime.value.reviewConfigured, value: runtime.value.reviewConfigured ? '独立审查已配置' : '等待审查模型配置' },
  { label: '正式环境', ready: runtime.value.environment === 'production', value: runtime.value.environment === 'production' ? '已启用生产模式' : '当前为本地开发服务' },
  { label: '开发登录', ready: !runtime.value.devLoginEnabled, value: runtime.value.devLoginEnabled ? '开发版可用，发布前关闭' : '已关闭' },
] : [])
async function api(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  headers.set('Content-Type', 'application/json')
  if (authToken.value) headers.set('Authorization', `Bearer ${authToken.value}`)
  const response = await fetch(`${apiBase}${path}`, { ...init, headers, signal: AbortSignal.timeout(20000) })
  const payload = await response.json()
  if (response.status === 401) { logout(); throw new Error('登录已过期，请重新登录') }
  if (!response.ok) throw new Error(payload.error?.message || `HTTP ${response.status}`)
  return payload
}
function notify(text: string) { message.value = text; window.setTimeout(() => { message.value = '' }, 4000) }
function logout() { authToken.value = ''; localStorage.removeItem('mojing_admin_token'); runtime.value = null; error.value = '' }
async function loadSection() {
  busy.value = true; error.value = ''
  try {
    runtime.value = await api('/admin-api/system/status')
    if (active.value === 'users') { const payload = await api('/admin-api/users'); users.value = payload.items.map((item: any) => ({ ...item, role: item.roles[0] || 'user', status: item.status === 'active' ? 'active' : 'limited' })) }
    if (active.value === 'models') models.value = (await api('/admin-api/models')).items
    if (active.value === 'audit' || (active.value === 'overview' && can('audit'))) audit.value = (await api('/admin-api/audit-logs')).items
    if (active.value === 'moderation') reviews.value = (await api('/admin-api/moderation/queue')).items
  } catch (failure: any) { error.value = failure.message || '无法连接服务器' }
  finally { busy.value = false }
}
async function switchSection(section: Section) {
  if (!can(section) || section === active.value) return
  if (importsDirty.value && !window.confirm('小说章节尚未保存，确定离开并放弃修改？')) return
  active.value = section; importsDirty.value = false; await loadSection()
}
async function identify() {
  const payload = await api('/api/me')
  const role = payload.roles.find((item: string) => Object.prototype.hasOwnProperty.call(permissions, item))
  if (!role) { logout(); throw new Error('此账号没有管理台权限') }
  currentRole.value = role; userName.value = payload.name
}
async function adminLogin() {
  busy.value = true; error.value = ''
  try {
    const payload = await api('/admin-api/auth/login', { method: 'POST', body: JSON.stringify({ account: loginAccount.value, password: loginPassword.value }) })
    authToken.value = payload.token; localStorage.setItem('mojing_admin_token', payload.token)
    loginPassword.value = ''
    await identify(); await loadSection()
  } catch (failure: any) { error.value = failure.message || '登录失败' }
  finally { busy.value = false }
}
onMounted(async () => { if (authToken.value) try { await identify(); await loadSection() } catch (failure: any) { error.value = failure.message } })
async function updateRole(user: AdminUser, event: Event) {
  const role = (event.target as HTMLSelectElement).value
  try { await api(`/admin-api/users/${user.id}/roles`, { method: 'PATCH', body: JSON.stringify({ role }) }); await loadSection(); notify('角色已更新') }
  catch (failure: any) { error.value = failure.message; await loadSection() }
}
function resetModel() { editing.value = ''; modelForm.value = { name: '', provider: 'tuzi', kind: 'image', endpoint: 'https://api.tu-zi.com/coding/images/generations', model: 'gpt-image-2', apiKey: '', enabled: true, isDefault: true, reviewDefault: false, textRole: 'generation', priority: 1000 } }
function changeKind() {
  modelForm.value.textRole = 'generation'; modelForm.value.reviewDefault = false
  modelForm.value.endpoint = modelForm.value.kind === 'image' ? 'https://api.tu-zi.com/coding/images/generations' : ''
  modelForm.value.model = modelForm.value.kind === 'image' ? 'gpt-image-2' : ''
  modelForm.value.provider = modelForm.value.kind === 'image' ? 'tuzi' : ''
}
function changeTextRole() {
  if (modelForm.value.textRole === 'reviewer') modelForm.value.isDefault = false
  if (modelForm.value.textRole === 'generation') modelForm.value.reviewDefault = false
}
function editModel(model: ModelConfig) { editing.value = model.id; modelForm.value = { name: model.name, provider: model.provider, kind: model.kind, endpoint: model.endpoint, model: model.model, apiKey: '', enabled: model.enabled, isDefault: model.isDefault, reviewDefault: model.reviewDefault, textRole: model.textRole || 'generation', priority: model.priority ?? 1000 } }
async function saveModel() {
  busy.value = true; error.value = ''
  try {
    await api(editing.value ? `/admin-api/models/${editing.value}` : '/admin-api/models', { method: editing.value ? 'PUT' : 'POST', body: JSON.stringify(modelForm.value) })
    modelForm.value.apiKey = ''; await loadSection(); notify('模型配置已保存')
  } catch (failure: any) { error.value = failure.message }
  finally { busy.value = false }
}
async function testModel(model: ModelConfig) {
  busy.value = true; error.value = ''
  try { const result = await api(`/admin-api/models/${model.id}/test`, { method: 'POST', body: '{}' }); notify(result.message) }
  catch (failure: any) { error.value = failure.message }
  finally { busy.value = false }
}
async function toggleModel(model: ModelConfig) {
  try { await api(`/admin-api/models/${model.id}`, { method: 'PUT', body: JSON.stringify({ enabled: !model.enabled }) }); await loadSection() }
  catch (failure: any) { error.value = failure.message }
}
async function decideReview(decision: string) {
  if (!review.value) return
  try { await api(`/admin-api/moderation/${review.value.work.id}/${decision}`, { method: 'POST', body: '{}' }); await loadSection(); notify('审核结果已保存') }
  catch (failure: any) { error.value = failure.message }
}
</script>

<template>
  <div v-if="!authToken" class="login-screen">
    <form class="login-panel" @submit.prevent="adminLogin">
      <div class="brand-mark">墨</div><h1>墨境管理台</h1><p>登录你的管理员账号</p>
      <label>账号<input v-model="loginAccount" autocomplete="username" required /></label>
      <label>密码<input v-model="loginPassword" type="password" autocomplete="current-password" required /></label>
      <div v-if="error" class="error-banner" role="alert">{{ error }}</div>
      <button class="primary-button login-submit" :disabled="busy">{{ busy ? '正在连接' : '登录' }}</button>
      <a v-if="previewAvailable" href="/preview/" class="preview-link">打开小程序界面预览 <ChevronRight :size="14" /></a>
    </form>
  </div>
  <div v-else class="app-shell">
    <aside class="sidebar">
      <div class="brand"><div class="brand-mark">墨</div><div><strong>墨境</strong><span>内容管理</span></div></div>
      <nav class="nav-list"><button v-for="item in navItems.filter(item => can(item.id))" :key="item.id" class="nav-item" :class="{ active: active === item.id }" @click="switchSection(item.id)"><component :is="item.icon" :size="19" /><span>{{ item.label }}</span></button></nav>
      <div class="sidebar-bottom"><div class="role-card"><div class="avatar">{{ userName.slice(0,1) }}</div><div><strong>{{ userName }}</strong><span>{{ roleLabels[currentRole] }}</span></div></div><button class="logout" @click="logout"><LogOut :size="17" />退出登录</button></div>
    </aside>
    <main class="main-area">
      <header class="topbar"><div><div class="eyebrow">墨境 / 管理台</div><h1>{{ navItems.find(item => item.id === active)?.label }}</h1></div><div class="top-actions"><span class="connection-indicator"><i :class="{ ready: runtime }"></i>{{ runtime ? '服务已连接' : '未连接' }}</span><button class="icon-button" title="刷新" :disabled="busy" @click="loadSection"><RefreshCw :size="19" /></button></div></header>
      <div class="content-section">
        <div v-if="error" class="error-banner" role="alert">{{ error }}</div>
        <section v-if="active === 'overview'">
          <div class="intro-row"><div><p>作品与服务概览</p><span>{{ new Date().toLocaleDateString('zh-CN') }}</span></div><a v-if="previewAvailable" href="/preview/" class="outline-button"><BookOpen :size="16" />小程序预览</a></div>
          <div class="metric-grid"><div v-for="item in [{label:'已发布作品',value:runtime?.stats.published},{label:'用户',value:runtime?.stats.users},{label:'生成中任务',value:runtime?.stats.runningJobs},{label:'近24小时失败',value:runtime?.stats.failedJobs}]" :key="item.label" class="metric"><span>{{ item.label }}</span><strong>{{ item.value ?? '—' }}</strong></div></div>
          <div class="panel-head"><h2>服务状态</h2><button class="text-button" @click="switchSection('system')">查看配置 <ChevronRight :size="15" /></button></div>
          <div class="status-list"><div v-for="item in checks" :key="item.label" class="status-row"><CheckCircle2 v-if="item.ready" :size="20" class="success"/><Activity v-else :size="20" class="pending"/><div><strong>{{ item.label }}</strong><span>{{ item.value }}</span></div><span class="status-pill" :class="item.ready ? 'active' : 'limited'">{{ item.ready ? '就绪' : '待配置' }}</span></div></div>
          <div v-if="audit.length" class="recent-audit"><div class="panel-head"><h2>最近操作</h2></div><div v-for="item in audit.slice(0,5)" :key="item.id" class="activity-row"><FileClock :size="16" /><div><strong>{{ item.action }}</strong><span>{{ item.actor }} · {{ item.createdAt }}</span></div></div></div>
        </section>
        <section v-else-if="active === 'system'">
          <div class="section-toolbar"><div><p>连接你的服务器</p><span>配置状态来自当前 API，密钥不在浏览器中回显。</span></div></div>
          <div class="service-address"><Server :size="22"/><div><strong>{{ apiBase || pageOrigin }}</strong><span>{{ runtime?.environment === 'production' ? '生产环境' : '开发环境' }} · {{ runtime?.storage }}</span></div></div>
          <div class="status-list"><div v-for="item in checks" :key="item.label" class="status-row"><CheckCircle2 v-if="item.ready" :size="20" class="success"/><Activity v-else :size="20" class="pending"/><div><strong>{{ item.label }}</strong><span>{{ item.value }}</span></div><span class="status-pill" :class="item.ready ? 'active' : 'limited'">{{ item.ready ? '就绪' : '待配置' }}</span></div></div>
          <div class="deployment-note"><h2>发布配置</h2><p>服务器需要 HTTPS 域名、微信 AppID / AppSecret 和持久化数据目录。模型供应商在「模型接入」中配置。小程序的体验版、正式版域名在 miniprogram/deployment.json 中填写。</p><p>当前支持单台服务器部署，微信云开发不是必需。上线前关闭开发登录，配置独立加密密钥并备份数据。</p></div>
          <ObjectStorage v-if="currentRole === 'super_admin'" :api="api" @notify="notify" />
        </section>
        <NovelImports v-else-if="active === 'imports'" :api="api" :api-base="apiBase" :token="authToken" :text-ready="!!runtime?.reviewConfigured" :image-ready="!!runtime?.imageConfigured" @notify="notify" @dirty="importsDirty = $event" />
        <ReaderComments v-else-if="active === 'comments'" :api="api" />
        <ProductionQueue v-else-if="active === 'production'" :api="api" :editable="can('models')" @notify="notify" />
        <ComicStudio v-else-if="active === 'comics'" :api="api" :api-base="apiBase" :token="authToken" @notify="notify" @dirty="importsDirty = $event" />
        <section v-else-if="active === 'models'">
          <div class="section-toolbar"><div><p>模型供应商</p><span>文本与图片分别配置，连接检查不会生成收费素材。</span></div><button class="outline-button" @click="resetModel"><Plus :size="16"/>新增</button></div>
          <p class="muted">生成与监督审查各最多 3 次收费调用；超时或网络错误会停止并标记结果未知。未配置审查模型时保留候选并显示未审查状态。</p>
          <div class="model-layout">
            <div class="model-list"><div v-for="model in models" :key="model.id" class="model-card"><div class="model-card-header"><Cpu :size="23"/><div><strong>{{ model.name }}</strong><span>{{ model.kind === 'image' ? '图片' : '文本' }} · {{ model.model }} · 兜底顺序 {{ model.priority }}<em v-if="model.kind === 'text'"> · {{ model.textRole === 'reviewer' ? '审查' : model.textRole === 'both' ? '生成+审查' : '生成' }}</em></span></div><span class="status-pill" :class="model.enabled ? 'active' : 'limited'">{{ model.enabled ? '启用' : '停用' }}</span></div><div class="model-endpoint">{{ model.endpoint }}</div><div class="model-footer"><span>{{ model.keyHint }} {{ model.isDefault ? (model.kind === 'text' ? '· 默认生成' : '· 默认') : '' }} {{ model.reviewDefault ? '· 默认审查' : '' }}</span><div class="model-actions"><button class="icon-button" title="编辑配置" @click="editModel(model)"><Save :size="17"/></button><button class="icon-button" title="检查模型列表" :disabled="busy" @click="testModel(model)"><PlugZap :size="17"/></button><button class="icon-button" :title="model.enabled ? '停用' : '启用'" @click="toggleModel(model)"><Power :size="17"/></button></div></div></div><div v-if="!models.length" class="empty-state">还没有模型配置</div></div>
            <form class="model-editor" @submit.prevent="saveModel">
              <h2>{{ editing ? '编辑配置' : '接入供应商' }}</h2><label>名称<input v-model="modelForm.name" required /></label><div class="form-grid"><label>类型<select v-model="modelForm.kind" :disabled="!!editing" @change="changeKind"><option value="image">图片生成</option><option value="text">文本生成</option></select></label><label>供应商<input v-model="modelForm.provider" required /></label></div>
              <label>HTTPS 接口<input v-model="modelForm.endpoint" type="url" required :placeholder="modelForm.kind === 'text' ? 'https://供应商域名/v1/chat/completions' : 'https://供应商域名/v1/images/generations'" /></label><label>模型<input v-model="modelForm.model" required /></label>
              <label v-if="modelForm.kind === 'text'">文本用途<select v-model="modelForm.textRole" aria-label="文本用途" @change="changeTextRole"><option value="generation">正文生成</option><option value="reviewer">监督审查</option><option value="both">生成与审查</option></select></label>
              <label>兜底顺序<input v-model.number="modelForm.priority" type="number" min="0" max="100000" required /></label>
              <label>API Key<input v-model="modelForm.apiKey" type="password" autocomplete="new-password" :required="!editing" placeholder="留空保留原密钥" /></label>
              <div class="model-toggles"><label><input v-model="modelForm.enabled" type="checkbox" />启用</label><label><input v-model="modelForm.isDefault" type="checkbox" :disabled="modelForm.kind === 'text' && modelForm.textRole === 'reviewer'" />{{ modelForm.kind === 'text' ? '默认生成' : '默认' }}</label><label v-if="modelForm.kind === 'text'"><input v-model="modelForm.reviewDefault" type="checkbox" :disabled="modelForm.textRole === 'generation'" />默认审查</label></div>
              <button class="primary-button save-model" :disabled="busy"><Save :size="17"/>{{ busy ? '保存中' : '保存配置' }}</button>
            </form>
          </div>
        </section>
        <section v-else-if="active === 'users'"><div class="section-toolbar"><p>{{ users.length }} 位用户</p><div class="search-box"><Search :size="16"/><input v-model="search" placeholder="搜索用户" /></div></div><div class="table-panel"><div v-for="user in visibleUsers" :key="user.id" class="member-row"><div class="member-cell"><div class="member-avatar">{{ user.name.slice(0,1) }}</div><div><strong>{{ user.name }}</strong><span>{{ user.account }}</span></div></div><select :value="user.role" :disabled="currentRole !== 'super_admin'" @change="updateRole(user,$event)"><option v-for="(label,role) in roleLabels" :key="role" :value="role">{{ label }}</option></select><span class="muted">{{ user.works }} 部作品</span></div></div></section>
        <section v-else-if="active === 'moderation'"><div class="section-toolbar"><p>{{ reviews.length }} 部待审核作品</p></div><div class="review-layout"><div class="review-list"><button v-for="item in reviews" :key="item.work.id" class="review-item" :class="{ selected: review?.work.id === item.work.id }" @click="selectedReview = item.work.id"><div><strong>{{ item.work.title }}</strong><span>{{ item.work.author }} · {{ item.work.words }} 字</span><em>{{ item.issues.length }} 个未解决问题</em></div><ChevronRight :size="16"/></button></div><div v-if="review" class="review-panel"><h2>{{ review.work.title }}</h2><p class="muted">{{ review.work.author }} · {{ review.work.words }} 字</p><div v-for="issue in review.issues" :key="issue.id" class="issue-line"><span class="severity severe">{{ issue.severity }}</span><div><strong>{{ issue.reason }}</strong><p>{{ issue.location }}</p><p>{{ issue.suggestion }}</p></div></div><div v-if="!review.issues.length" class="empty-state">{{ review.reportId ? '没有未解决的问题' : '此作品尚未生成审稿报告' }}</div><CreativeImages :work-id="review.work.id" :api="api" :api-base="apiBase" :token="authToken" /><div class="review-actions"><button class="outline-button" @click="decideReview('reject')"><XCircle :size="16"/>退回修改</button><button class="primary-button" :disabled="!review.reportId || review.issues.some(item => ['blocking','severe'].includes(item.severity))" @click="decideReview('approve')"><CheckCircle2 :size="16"/>通过审核</button></div></div></div></section>
        <section v-else><div class="section-toolbar"><p>{{ audit.length }} 条最近记录</p><span>只读审计</span></div><div class="table-panel"><div v-for="item in audit" :key="item.id" class="audit-row"><span class="muted">{{ item.createdAt }}</span><strong>{{ item.actor }}</strong><span>{{ item.action }}</span><span class="status-pill" :class="item.result === 'success' ? 'active' : 'limited'">{{ item.result === 'success' ? '成功' : '失败' }}</span></div><div v-if="!audit.length" class="empty-state">暂无操作记录</div></div></section>
      </div>
    </main>
    <div v-if="message" class="toast-message" role="status"><CheckCircle2 :size="18"/>{{ message }}</div>
  </div>
</template>
