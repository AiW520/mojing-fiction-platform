<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { Check, X, RefreshCw } from 'lucide-vue-next'
const props = defineProps<{ workId: string; api: (path: string, options?: RequestInit) => Promise<any>; apiBase: string; token: string }>()
type Asset = { id: string; title: string; url: string; approvalStatus: string; preview?: string }
const items = ref<Asset[]>([]); const error = ref(''); const busy = ref(false)
let revision = 0
function release() { items.value.forEach(item => { if (item.preview) URL.revokeObjectURL(item.preview) }) }
async function load() {
  const current = ++revision; error.value = ''; busy.value = true
  try {
    const result = await props.api(`/admin-api/works/${props.workId}/assets`)
    const assets = await Promise.all(result.items.filter((item: Asset) => item.url.startsWith('/api/assets/')).map(async (item: Asset) => {
      const response = await fetch(`${props.apiBase}${item.url}`, { headers: { Authorization: `Bearer ${props.token}` }, signal: AbortSignal.timeout(15000) })
      return { ...item, preview: response.ok ? URL.createObjectURL(await response.blob()) : '' }
    }))
    if (current !== revision) { assets.forEach(item => { if (item.preview) URL.revokeObjectURL(item.preview) }); return }
    release(); items.value = assets
  } catch (e) { if (current === revision) error.value = (e as Error).message } finally { if (current === revision) busy.value = false }
}
async function decide(id: string, decision: string) {
  busy.value = true; error.value = ''
  try { await props.api(`/api/works/${props.workId}/assets/${id}/${decision}`, { method: 'POST', body: '{}' }); await load() }
  catch (e) { error.value = (e as Error).message } finally { busy.value = false }
}
watch(() => props.workId, load, { immediate: true })
onBeforeUnmount(() => { revision++; release() })
</script>
<template>
  <div class="creative-images">
    <div class="creative-images-head"><h3>小说配图审核</h3><button class="icon-button" aria-label="刷新配图" :disabled="busy" @click="load"><RefreshCw :size="18" /></button></div>
    <p v-if="error" class="error-banner" role="alert">{{ error }}</p>
    <div v-for="item in items" :key="item.id" class="creative-image">
      <img v-if="item.preview" :src="item.preview" :alt="item.title" />
      <p>{{ item.title }} · {{ item.approvalStatus === 'approved' ? '已审核' : item.approvalStatus === 'rejected' ? '已拒绝' : '待审核' }}</p>
      <div><button class="outline-button" :disabled="busy" @click="decide(item.id, 'reject')"><X :size="16" />拒绝</button><button class="primary-button" :disabled="busy" @click="decide(item.id, 'approve')"><Check :size="16" />通过配图</button></div>
    </div>
    <p v-if="!items.length" class="muted">{{ busy ? '载入配图中' : '没有待处理的生成配图' }}</p>
  </div>
</template>
<style scoped>
.creative-images { margin: 28px 0; border-top: 1px solid #e5e5ea; padding-top: 20px; }.creative-images-head { display: flex; align-items: center; justify-content: space-between; }.creative-images h3 { font-size: 17px; }.creative-image { margin-bottom: 24px; }.creative-image img { display: block; max-width: 100%; max-height: 420px; border-radius: 8px; }.creative-image p { font-size: 13px; color: #6b6b73; }.creative-image > div { display: flex; gap: 12px; flex-wrap: wrap; }
</style>
