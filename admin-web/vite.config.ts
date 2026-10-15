import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const apiTarget = process.env.MOJING_API_PROXY || 'http://127.0.0.1:3000'
export default defineConfig({ plugins: [vue()], server: { fs: { allow: ['..'] }, proxy: {
  '/api': apiTarget, '/admin-api': apiTarget, '/comics': apiTarget,
} } })
