import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    redirect: '/sessions'
  },
  {
    path: '/sessions',
    name: 'session-list',
    component: () => import('@/pages/SessionList.vue'),
    meta: { title: '场次编排' }
  },
  {
    path: '/sessions/:id/fixtures',
    name: 'fixture-board',
    component: () => import('@/pages/FixtureBoard.vue'),
    meta: { title: '灯位通道配置台' }
  },
  {
    path: '/sessions/:id/cues',
    name: 'cue-timeline',
    component: () => import('@/pages/CueTimeline.vue'),
    meta: { title: 'Cue 编排时间轴' }
  },
  {
    path: '/cues/:id/levels',
    name: 'level-editor',
    component: () => import('@/pages/LevelEditor.vue'),
    meta: { title: '通道电平编辑' }
  },
  {
    path: '/sheets',
    name: 'sheet-list',
    component: () => import('@/pages/SheetList.vue'),
    meta: { title: '排演表生成与导出' }
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/sessions'
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 })
})

router.afterEach((to) => {
  const title = typeof to.meta.title === 'string' ? to.meta.title : ''
  document.title = title ? `${title} · 剧场灯光 Cue 表编排器` : '剧场灯光 Cue 表编排器 · gbcuesheet'
})

export default router
