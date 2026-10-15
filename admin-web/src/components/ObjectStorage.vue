<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Save, PlugZap, RefreshCw } from 'lucide-vue-next'

const props = defineProps<{ api: (path: string, init?: RequestInit) => Promise<any> }>()
const emit = defineEmits<{ notify: [message: string] }>()
const busy = ref(false)
const loaded = ref(false)
const dirty = ref(false)
const error = ref('')
const form = ref({ endpoint: '', region: '', bucket: '', prefix: '', forcePathStyle: true, enabled: false, accessKeyId: '', secretAccessKey: '', sessionToken: '', clearCredentials: false, clearSessionToken: false })
const credentialsConfigured = ref(false)
const lastTest = ref<any>(null)
function apply(config: any) {
  form.value = { endpoint: config.endpoint, region: config.region, bucket: config.bucket, prefix: config.prefix, forcePathStyle: config.forcePathStyle, enabled: config.enabled, accessKeyId: '', secretAccessKey: '', sessionToken: '', clearCredentials: false, clearSessionToken: false }
  credentialsConfigured.value = config.credentialsConfigured
  lastTest.value = config.lastTest
  dirty.value = false
  loaded.value = true
}
async function load() {
  busy.value = true; error.value = ''
  try { apply((await props.api('/admin-api/storage')).config) }
  catch (e) { error.value = (e as Error).message }
  finally { busy.value = false }
}
async function save() {
  busy.value = true; error.value = ''
  try {
    apply((await props.api('/admin-api/storage', { method: 'PUT', body: JSON.stringify(form.value) })).config)
    emit('notify', '对象存储配置已保存')
  } catch (e) { error.value = (e as Error).message }
  finally { busy.value = false }
}
async function test() {
  busy.value = true; error.value = ''
  try { lastTest.value = (await props.api('/admin-api/storage/test', { method: 'POST', body: '{}' })).result }
  catch (e) { error.value = (e as Error).message }
  finally { busy.value = false }
}
onMounted(load)
</script>

<template>
  <div class="storage-settings">
    <div class="panel-head"><h2>对象存储 · S3</h2><button class="icon-button" type="button" title="重新读取配置" :disabled="busy" @click="load"><RefreshCw :size="17" /></button></div>
    <div v-if="error" class="error-banner" role="alert">{{ error }}</div>
    <form v-if="loaded" @submit.prevent="save" @input="dirty = true">
      <fieldset :disabled="busy">
        <div class="storage-grid">
          <label class="full">Endpoint<input v-model="form.endpoint" type="url" placeholder="https://s3.example.com" required maxlength="2048" /></label>
          <label>Region<input v-model="form.region" placeholder="us-east-1" required maxlength="63" /></label>
          <label>Bucket<input v-model="form.bucket" required maxlength="63" /></label>
          <label class="full">路径前缀<input v-model="form.prefix" placeholder="mojing/media/" maxlength="512" /></label>
          <label>Access Key ID<input v-model="form.accessKeyId" type="password" autocomplete="new-password" :placeholder="credentialsConfigured ? '留空保留原凭据' : '尚未配置'" maxlength="4096" /></label>
          <label>Secret Access Key<input v-model="form.secretAccessKey" type="password" autocomplete="new-password" :placeholder="credentialsConfigured ? '留空保留原凭据' : '尚未配置'" maxlength="4096" /></label>
          <label class="full">Session Token（可选）<input v-model="form.sessionToken" type="password" autocomplete="new-password" placeholder="留空保留原 Token" maxlength="4096" /></label>
          <label>寻址方式<select v-model="form.forcePathStyle"><option :value="true">Path Style</option><option :value="false">Virtual Hosted Style</option></select></label>
        </div>
        <div class="storage-toggles">
          <label><input v-model="form.enabled" type="checkbox" />启用连接配置</label>
          <label><input v-model="form.clearSessionToken" type="checkbox" />清除 Session Token</label>
          <label><input v-model="form.clearCredentials" type="checkbox" />清除全部凭据</label>
        </div>
        <div class="storage-actions"><button class="primary-button" type="submit"><Save :size="17" />保存配置</button><button class="outline-button" type="button" :disabled="dirty || !credentialsConfigured" @click="test"><PlugZap :size="17" />测试连接</button><span class="muted">{{ dirty ? '有未保存的修改' : credentialsConfigured ? '凭据已配置' : '凭据待配置' }}</span></div>
      </fieldset>
    </form>
    <p v-if="lastTest" class="storage-result" role="status"><span class="status-pill" :class="lastTest.status === 'success' && !lastTest.stale ? 'active' : 'limited'">{{ lastTest.stale ? '已过期' : lastTest.status === 'success' ? '连接成功' : '连接失败' }}</span>{{ lastTest.message }}<time>{{ new Date(lastTest.checkedAt).toLocaleString('zh-CN') }}</time></p>
    <p class="muted">媒体存储：当前仍使用平台数据库；尚未迁移到对象存储。</p>
  </div>
</template>

<style scoped>
.storage-settings { margin-top: 28px; border-top: 1px solid #dce1e5; padding-top: 20px; }
fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
.storage-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; max-width: 860px; }
label { display: flex; flex-direction: column; gap: 8px; font-size: 13px; }
.full { grid-column: 1 / -1; }
input, select { width: 100%; box-sizing: border-box; min-width: 0; padding: 10px 12px; border: 1px solid #d4dade; border-radius: 6px; background: white; font: inherit; color: #252c31; }
.storage-toggles, .storage-actions { display: flex; flex-wrap: wrap; gap: 16px; align-items: center; margin-top: 20px; }
.storage-toggles label { flex-direction: row; align-items: center; }
.storage-toggles input { width: 16px; height: 16px; }
.storage-result { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; font-size: 13px; overflow-wrap: anywhere; }
time { color: #69757b; }
@media (max-width: 600px) { .storage-grid { grid-template-columns: minmax(0, 1fr); } }
</style>
