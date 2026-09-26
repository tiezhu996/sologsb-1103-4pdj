import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: {
    port: 21803,
    host: true
  },
  preview: {
    port: 21803
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    // 全部样式合成单文件：避免路由级 CSS 预加载在部分浏览器上抛出 preload 报错
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        // 依赖统一进 vendor：页面按路由懒加载，第三方库单独成块避免重复打包
        manualChunks(id: string): string | undefined {
          return id.includes('node_modules') ? 'vendor' : undefined
        }
      }
    }
  }
})
