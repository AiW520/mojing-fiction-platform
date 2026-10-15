<script setup lang="ts">
type Attempt = { modelId: string; model: string; name?: string; status: string; errorCode?: string; durationMs?: number; resultUnknown?: boolean }
defineProps<{ attempts?: Attempt[] }>()
const labels: Record<string, string> = { running: '调用中', failed: '失败', success: '成功' }
</script>
<template>
  <ol v-if="attempts?.length" class="image-attempts" aria-label="模型尝试记录">
    <li v-for="(attempt,index) in attempts" :key="`${index}-${attempt.modelId}`">
      <span>{{ index + 1 }}. {{ attempt.name || attempt.model }} · {{ labels[attempt.status] || attempt.status }}</span>
      <span v-if="attempt.durationMs !== undefined">{{ (attempt.durationMs / 1000).toFixed(1) }} 秒</span>
      <code v-if="attempt.errorCode">{{ attempt.errorCode }}</code>
      <span v-if="attempt.resultUnknown" class="unknown">供应商结果未知，可能已计费</span>
    </li>
  </ol>
</template>
<style scoped>
.image-attempts{margin:8px 0 0;padding:0;list-style:none;font-size:12px;color:#59636b}.image-attempts li{display:flex;flex-wrap:wrap;gap:4px 12px;padding:4px 0;overflow-wrap:anywhere}.image-attempts code{font-size:11px}.image-attempts .unknown{color:#ad394b}
</style>
