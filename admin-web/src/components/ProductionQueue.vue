<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Save, RefreshCw, XCircle } from 'lucide-vue-next'
import ImageAttempts from './ImageAttempts.vue'
import TextReview from './TextReview.vue'
const props = defineProps<{ api: (path: string, options?: RequestInit) => Promise<any>; editable: boolean }>()
const emit = defineEmits<{ notify: [message: string] }>()
const data = ref<any>({ settings: {}, jobs: [], counts: [] }); const error = ref(''); const busy = ref(false)
const fields = ['concurrency', 'textConcurrency', 'imageConcurrency', 'perWorkConcurrency', 'perUserLimit', 'queueLimit', 'dailyLimit']
const labels: Record<string, string> = { concurrency: '总并发数', textConcurrency: '文本并发数', imageConcurrency: '图片并发数', perWorkConcurrency: '每部作品并发数', perUserLimit: '每账号待处理上限', queueLimit: '全站待处理上限', dailyLimit: '每日任务上限' }
const maxima: Record<string, number> = { concurrency: 16, textConcurrency: 16, imageConcurrency: 16, perWorkConcurrency: 16, perUserLimit: 1000, queueLimit: 5000, dailyLimit: 10000 }
const statuses: Record<string,string> = { queued: '排队中', running: '生成中', success: '已完成', failed: '异常', cancelled: '已取消' }
async function load() { busy.value = true; error.value = ''; try { data.value = await props.api('/admin-api/production') } catch (e) { error.value = (e as Error).message } finally { busy.value = false } }
async function save() { busy.value = true; error.value = ''; try { const input: any = { paused: data.value.settings.paused }; fields.forEach(key => { input[key] = Number(data.value.settings[key]) }); data.value.settings = (await props.api('/admin-api/production', { method: 'PATCH', body: JSON.stringify(input) })).settings; await load(); emit('notify', '队列设置已保存') } catch (e) { error.value = (e as Error).message } finally { busy.value = false } }
async function cancel(id: string) { try { await props.api(`/admin-api/production/${id}/cancel`, { method: 'POST', body: '{}' }); await load() } catch (e) { error.value = (e as Error).message } }
onMounted(load)
</script>
<template>
  <section class="production-queue">
    <div class="section-toolbar"><div><p>多线程生产队列</p><span>图片最多 3 次兜底；文本仅在明确的限流或服务端错误时切换，超时和网络错误会停止并标记结果未知。</span></div><button class="icon-button" title="刷新队列" :disabled="busy" @click="load"><RefreshCw :size="17" /></button></div>
    <p v-if="error" class="error-banner">{{ error }}</p>
    <form v-if="editable" class="queue-settings" @submit.prevent="save"><label v-for="key in fields" :key="key">{{ labels[key] }}<input v-model.number="data.settings[key]" type="number" min="1" :max="maxima[key]" required /></label><label class="queue-pause"><input v-model="data.settings.paused" type="checkbox" />暂停派发</label><button class="primary-button" :disabled="busy"><Save :size="16" />保存设置</button></form>
    <div class="queue-summary"><span v-for="count in data.counts" :key="count.status">{{ statuses[count.status] || count.status }} {{ count.count }}</span></div>
    <div class="table-panel"><div v-for="job in data.jobs" :key="job.id" class="queue-row"><div><strong>{{ job.workTitle || '无作品' }}</strong><span>{{ job.type }} · {{ job.modelName || '模型快照缺失' }}</span><small v-if="job.errorCode">{{ job.errorCode === 'SERVER_RESTARTED' ? '服务中断，供应商结果未知；重试前请核对账单' : job.errorCode }}</small><ImageAttempts :attempts="job.result?.attempts" /><TextReview :review="job.result?.review" /></div><span class="status-pill" :class="job.status === 'success' ? 'active' : job.status === 'failed' ? 'limited' : ''">{{ statuses[job.status] || job.status }}</span><button v-if="editable && job.status === 'queued'" class="icon-button" title="取消排队任务" @click="cancel(job.id)"><XCircle :size="16" /></button></div><div v-if="!data.jobs.length" class="empty-state">暂无生产任务</div></div>
  </section>
</template>
<style scoped>
.queue-settings{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:16px;padding:20px 0;border-block:1px solid #e3e5e8}.queue-settings label{display:flex;flex-direction:column;gap:8px;font-size:13px}.queue-settings input[type=number]{width:100%;padding:9px;border:1px solid #d4d8dc;border-radius:4px;box-sizing:border-box}.queue-settings .queue-pause{flex-direction:row;align-items:center}.queue-summary{display:flex;flex-wrap:wrap;gap:24px;padding:20px 0;font-size:14px}.queue-row{display:grid;grid-template-columns:minmax(0,1fr) auto 36px;gap:16px;padding:16px;border-bottom:1px solid #e3e5e8;align-items:center}.queue-row span,.queue-row small{display:block;font-size:12px;overflow-wrap:anywhere}.queue-row small{color:#ad394b}.queue-row strong{font-size:14px}
@media(max-width:600px){.queue-row{grid-template-columns:minmax(0,1fr) 36px;gap:12px}.queue-row>div{grid-column:1/-1;grid-row:2}.queue-row>.status-pill{grid-column:1;grid-row:1;justify-self:start}.queue-row>.icon-button{grid-column:2;grid-row:1}}
</style>
