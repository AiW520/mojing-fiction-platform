<script setup lang="ts">
import ImageAttempts from './ImageAttempts.vue'
defineProps<{ review?: any }>()
const labels: Record<string, string> = { pending: '审查中', success: '已完成', stale: '已失效', unknown: '结果未知', unconfigured: '未配置', failed: '失败' }
</script>
<template>
  <details v-if="review" class="text-review">
    <summary>监督审查 · {{ labels[review.status] || review.status }}<template v-if="review.score !== undefined"> · {{ review.score }}/10</template></summary>
    <p v-if="review.message">{{ review.message }}</p>
    <p v-if="review.stale">正文或设定已改变，此报告对应旧版本。</p>
    <p v-if="review.model">{{ review.model }}</p>
    <div v-for="(issue,index) in review.issues || []" :key="index" class="review-issue"><strong>{{ issue.type }} · {{ issue.location }}</strong><p>{{ issue.reason }}</p><p>{{ issue.suggestion }}</p></div>
    <p v-if="review.status === 'success' && !review.issues?.length">未发现问题</p>
    <ImageAttempts :attempts="review.attempts" />
  </details>
</template>
<style scoped>
.text-review{font-size:13px;margin-top:8px;overflow-wrap:anywhere}.text-review summary{cursor:pointer}.text-review p{margin:6px 0;white-space:pre-wrap}.review-issue{padding:10px 0;border-top:1px solid #e3e5e8}
</style>
