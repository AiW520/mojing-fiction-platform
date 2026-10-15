<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Check, X, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-vue-next'
const props = defineProps<{ api: (path: string, init?: RequestInit) => Promise<any> }>()
type Comment = { id: string; workTitle: string; author: string; kind: string; rating: number; status: string; content: string; createdAt: string; reports: number }
const comments = ref<Comment[]>([])
const busy = ref(false)
const error = ref('')
const offset = ref(0)
async function load() {
  busy.value = true; error.value = ''
  try { comments.value = (await props.api(`/admin-api/comments?offset=${offset.value}`)).items }
  catch (e: any) { error.value = e.message || '无法加载评论' }
  finally { busy.value = false }
}
async function decide(item: Comment, action: string) {
  if (!window.confirm(action === 'approve' ? '确认通过此内容？' : '确认移除此内容？主题回复也会移除。')) return
  busy.value = true
  try { await props.api(`/admin-api/comments/${item.id}/${action}`, { method: 'POST', body: '{}' }); await load() }
  catch (e: any) { error.value = e.message; busy.value = false }
}
function paginate(step: number) { offset.value = Math.max(0, offset.value + step); load() }
onMounted(load)
</script>
<template>
  <section class="reader-comments">
    <div class="panel-head"><div><h2>读者内容审核</h2><p class="muted">待审核书评、讨论与举报</p></div><button class="icon-button" title="刷新审核队列" :disabled="busy" @click="load"><RefreshCw :size="18"/></button></div>
    <div v-if="error" class="error-banner" role="alert">{{ error }}</div>
    <p v-if="busy" class="muted">正在处理…</p>
    <article v-for="item in comments" :key="item.id" class="reader-comment-row">
      <header><div><strong>{{ item.workTitle }}</strong><p>{{ item.author }} · {{ item.kind === 'review' ? '书评' : '讨论 / 回复' }}{{ item.rating ? ` · ${item.rating}/5` : '' }} · {{ item.createdAt }}</p></div><span class="status-pill" :class="item.reports ? 'limited' : 'active'">{{ item.reports ? `${item.reports} 条举报` : '待审核' }}</span></header>
      <p class="reader-comment-content">{{ item.content }}</p>
      <div class="reader-comment-decisions"><button class="outline-button" :disabled="busy" @click="decide(item,'reject')"><X :size="16"/>移除</button><button class="primary-button" :disabled="busy" @click="decide(item,'approve')"><Check :size="16"/>{{ item.status === 'published' ? '保留 / 处理举报' : '通过' }}</button></div>
    </article>
    <div v-if="!busy && !comments.length && !error" class="empty-state">没有待处理的读者内容</div>
    <div class="reader-comments-pages"><button class="outline-button" :disabled="busy || offset === 0" @click="paginate(-30)"><ChevronLeft :size="16"/>上一页</button><span class="muted">第 {{ offset / 30 + 1 }} 页</span><button class="outline-button" :disabled="busy || comments.length < 30" @click="paginate(30)">下一页<ChevronRight :size="16"/></button></div>
  </section>
</template>
<style scoped>
.panel-head { align-items: flex-start; }.panel-head p { margin: 8px 0 0; }.reader-comment-row { border-top: 1px solid #e5e5ea; padding: 22px 0; }.reader-comment-row header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }.reader-comment-row strong { font-size: 15px; overflow-wrap: anywhere; }.reader-comment-row header p { font-size: 12px; color: #73737b; margin: 8px 0; }.reader-comment-content { font-size: 14px; line-height: 1.9; white-space: pre-wrap; overflow-wrap: anywhere; margin: 14px 0; }.reader-comment-decisions { display: flex; gap: 12px; justify-content: flex-end; }.reader-comments-pages { border-top: 1px solid #e5e5ea; display: flex; justify-content: space-between; gap: 12px; align-items: center; padding-top: 22px; }.reader-comments button { min-height: 44px; }
</style>
