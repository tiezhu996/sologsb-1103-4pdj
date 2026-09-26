import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from '@/App.vue'
import router from '@/router'
import { useCueStore } from '@/stores/cueStore'
import { useFixtureStore } from '@/stores/fixtureStore'
import { useLevelStore } from '@/stores/levelStore'
import { useSessionStore } from '@/stores/sessionStore'
import { useSheetStore } from '@/stores/sheetStore'
import '@/styles/global.css'

/**
 * 应用启动：先把 IndexedDB 中的本地数据全部载入 Pinia，再挂载视图，
 * 保证每个页面首帧读到的都是完整状态（页面只读 store）。
 */
async function bootstrap(): Promise<void> {
  const app = createApp(App)
  const pinia = createPinia()

  app.use(pinia)
  app.use(router)

  try {
    await Promise.all([
      useSessionStore(pinia).hydrate(),
      useFixtureStore(pinia).hydrate(),
      useCueStore(pinia).hydrate(),
      useLevelStore(pinia).hydrate(),
      useSheetStore(pinia).hydrate()
    ])
  } catch (error) {
    console.error('[gbcuesheet] 本地数据载入失败，将以空数据启动：', error)
  }

  app.mount('#app')
}

void bootstrap()
