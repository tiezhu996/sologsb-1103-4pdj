<script setup lang="ts">
import { computed, h, watch } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import {
  NConfigProvider,
  NDialogProvider,
  NMenu,
  NMessageProvider,
  darkTheme,
  dateZhCN,
  zhCN,
  type GlobalThemeOverrides,
  type MenuOption
} from 'naive-ui'
import { useCueStore } from '@/stores/cueStore'
import { useSessionStore } from '@/stores/sessionStore'

const route = useRoute()
const sessionStore = useSessionStore()
const cueStore = useCueStore()

const themeOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: '#f2b544',
    primaryColorHover: '#f7c869',
    primaryColorPressed: '#d99b2c',
    primaryColorSuppl: '#f2b544',
    bodyColor: '#0e1015',
    cardColor: '#141822',
    modalColor: '#171b26',
    popoverColor: '#171b26',
    tableColor: '#141822'
  },
  Card: {
    borderColor: 'rgba(255, 255, 255, 0.08)'
  },
  Layout: {
    color: '#0e1015',
    siderColor: '#101319'
  }
}

/** 侧边导航：详情页入口依赖「当前场次」 */
const menuOptions = computed<MenuOption[]>(() => {
  const sessionId = sessionStore.currentSessionId
  const sessionTitle = sessionStore.currentSession ? sessionStore.currentSession.title : '未选择场次'
  return [
    {
      label: () => h(RouterLink, { to: '/sessions' }, { default: () => '场次编排' }),
      key: 'sessions'
    },
    {
      label: () =>
        h(
          RouterLink,
          { to: sessionId ? `/sessions/${sessionId}/fixtures` : '/sessions' },
          { default: () => '灯位通道配置台' }
        ),
      key: 'fixtures',
      disabled: !sessionId
    },
    {
      label: () =>
        h(RouterLink, { to: sessionId ? `/sessions/${sessionId}/cues` : '/sessions' }, { default: () => 'Cue 编排时间轴' }),
      key: 'cues',
      disabled: !sessionId
    },
    {
      label: () => h(RouterLink, { to: '/sheets' }, { default: () => '排演表生成与导出' }),
      key: 'sheets'
    },
    {
      type: 'group',
      label: '当前场次',
      key: 'current-group',
      children: [
        {
          label: () => h('span', { class: 'app-sider__current' }, sessionTitle),
          key: 'current-session',
          disabled: true
        }
      ]
    }
  ]
})

const activeKey = computed(() => {
  const path = route.path
  if (path.startsWith('/sheets')) return 'sheets'
  if (path.includes('/fixtures')) return 'fixtures'
  if (path.includes('/cues') || path.includes('/levels')) return 'cues'
  return 'sessions'
})

/** 进入详情路由时同步当前场次，保证侧边导航与跨页状态一致 */
watch(
  () => route.params.id,
  (id) => {
    if (typeof id !== 'string' || !id) return
    if (sessionStore.sessionById(id)) {
      sessionStore.setCurrentSession(id)
      return
    }
    const cue = cueStore.cueById(id)
    if (cue) sessionStore.setCurrentSession(cue.sessionId)
  },
  { immediate: true }
)

const currentSessionLabel = computed(() => {
  const session = sessionStore.currentSession
  if (!session) return '尚未选择场次'
  return `${session.order}. ${session.title}`
})
</script>

<template>
  <NConfigProvider :theme="darkTheme" :theme-overrides="themeOverrides" :locale="zhCN" :date-locale="dateZhCN">
    <NMessageProvider>
      <NDialogProvider>
        <div class="app-shell">
          <aside class="app-sider">
            <div class="app-sider__brand">
              <div class="app-sider__logo" aria-hidden="true">
                <svg viewBox="0 0 48 48" width="34" height="34">
                  <path d="M24 5 L37 22 H11 Z" fill="#f2b544" />
                  <circle cx="24" cy="29" r="4.6" fill="#f2b544" opacity="0.9" />
                  <path d="M14 38 h20 l-3.4 8 H17.4 Z" fill="#3fbf9f" opacity="0.85" />
                </svg>
              </div>
              <div class="app-sider__titles">
                <p class="app-sider__name">剧场灯光 Cue 表编排器</p>
                <p class="app-sider__code">gbcuesheet</p>
              </div>
            </div>

            <NMenu :options="menuOptions" :value="activeKey" :root-indent="18" :indent="14" />

            <div class="app-sider__footer">
              <p class="app-sider__footer-label">当前场次</p>
              <p class="app-sider__footer-value">{{ currentSessionLabel }}</p>
              <p class="app-sider__footer-note">数据仅保存在本机浏览器（IndexedDB）</p>
            </div>
          </aside>

          <main class="app-main">
            <RouterView v-slot="{ Component }">
              <Transition name="page-fade" mode="out-in">
                <component :is="Component" />
              </Transition>
            </RouterView>
          </main>
        </div>
      </NDialogProvider>
    </NMessageProvider>
  </NConfigProvider>
</template>

<style scoped>
.app-shell {
  display: flex;
  min-height: 100vh;
  background: radial-gradient(circle at 12% 0%, rgba(242, 181, 68, 0.07), transparent 42%), #0e1015;
}

.app-sider {
  display: flex;
  flex-direction: column;
  gap: 18px;
  width: 248px;
  flex: none;
  padding: 20px 14px;
  border-right: 1px solid rgba(255, 255, 255, 0.07);
  background: rgba(16, 19, 25, 0.92);
  position: sticky;
  top: 0;
  height: 100vh;
  overflow-y: auto;
}

.app-sider__brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 6px;
}

.app-sider__titles {
  display: flex;
  flex-direction: column;
}

.app-sider__name {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.3px;
}

.app-sider__code {
  margin: 2px 0 0;
  font-size: 11px;
  color: rgba(242, 181, 68, 0.75);
  letter-spacing: 1px;
}

.app-sider__footer {
  margin-top: auto;
  padding: 12px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.app-sider__footer-label {
  margin: 0;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
}

.app-sider__footer-value {
  margin: 4px 0 0;
  font-size: 13px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.86);
  line-height: 1.5;
}

.app-sider__footer-note {
  margin: 8px 0 0;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.32);
  line-height: 1.5;
}

.app-main {
  flex: 1;
  min-width: 0;
}

:deep(.app-sider__current) {
  color: rgba(242, 181, 68, 0.85);
}

.page-fade-enter-active,
.page-fade-leave-active {
  transition: opacity 0.16s ease, transform 0.16s ease;
}

.page-fade-enter-from,
.page-fade-leave-to {
  opacity: 0;
  transform: translateY(6px);
}
</style>
