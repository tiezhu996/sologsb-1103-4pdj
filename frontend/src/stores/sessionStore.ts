import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { Session, SessionDraft, SessionStat } from '@/types/session'
import { db } from '@/utils/db'
import { createId } from '@/utils/id'
import { sumCues } from '@/utils/fade'
import { useCueStore } from '@/stores/cueStore'
import { useFixtureStore } from '@/stores/fixtureStore'
import { useLevelStore } from '@/stores/levelStore'
import { useSheetStore } from '@/stores/sheetStore'

/** 场次统计：Cue 数量 / 过渡总时长 / 灯位通道数量 */
function emptyStat(): SessionStat {
  return { cueCount: 0, totalFadeSec: 0, fixtureCount: 0 }
}

/**
 * 场次仓库：维护场次列表、当前场次与调序，并负责跨表级联清理。
 */
export const useSessionStore = defineStore('session', () => {
  const sessions = ref<Session[]>([])
  const currentSessionId = ref<string | null>(null)
  const hydrated = ref(false)

  const sortedSessions = computed(() =>
    [...sessions.value].sort((a, b) => a.order - b.order || a.createdAt - b.createdAt)
  )

  const currentSession = computed<Session | null>(
    () => sessions.value.find((session) => session.id === currentSessionId.value) ?? null
  )

  function sessionById(id: string): Session | null {
    return sessions.value.find((session) => session.id === id) ?? null
  }

  function statOf(sessionId: string): SessionStat {
    const cueStore = useCueStore()
    const fixtureStore = useFixtureStore()
    if (!sessionById(sessionId)) return emptyStat()
    const cues = cueStore.cuesOfSession(sessionId)
    return {
      cueCount: cues.length,
      totalFadeSec: sumCues(cues).totalSec,
      fixtureCount: fixtureStore.fixturesOfSession(sessionId).length
    }
  }

  function setCurrentSession(id: string | null): void {
    currentSessionId.value = id && sessionById(id) ? id : null
  }

  /** 数据库里的场次存在时把当前场次落到第一场 */
  function ensureCurrentSession(): void {
    if (currentSessionId.value && sessionById(currentSessionId.value)) return
    currentSessionId.value = sortedSessions.value.length > 0 ? sortedSessions.value[0].id : null
  }

  async function hydrate(): Promise<void> {
    sessions.value = await db.sessions.toArray()
    hydrated.value = true
    ensureCurrentSession()
  }

  async function createSession(draft: SessionDraft): Promise<Session> {
    const now = Date.now()
    const maxOrder = sessions.value.reduce((max, session) => Math.max(max, session.order), 0)
    const created: Session = {
      id: createId('ses'),
      title: draft.title.trim() || `未命名场次 ${maxOrder + 1}`,
      order: maxOrder + 1,
      scriptPage: draft.scriptPage.trim(),
      plannedStart: draft.plannedStart,
      plannedEnd: draft.plannedEnd,
      stageNote: draft.stageNote.trim(),
      createdAt: now,
      updatedAt: now
    }
    await db.sessions.put(created)
    sessions.value = [...sessions.value, created]
    currentSessionId.value = created.id
    return created
  }

  async function updateSession(id: string, patch: Partial<SessionDraft>): Promise<Session | null> {
    const target = sessionById(id)
    if (!target) return null
    const next: Session = { ...target, ...patch, updatedAt: Date.now() }
    await db.sessions.put(next)
    sessions.value = sessions.value.map((session) => (session.id === id ? next : session))
    return next
  }

  /** 删除场次并级联清理灯位通道、Cue（含电平）与排演表 */
  async function removeSession(id: string): Promise<void> {
    const target = sessionById(id)
    if (!target) return
    const cueStore = useCueStore()
    const fixtureStore = useFixtureStore()
    const levelStore = useLevelStore()
    const sheetStore = useSheetStore()

    const cueIds = cueStore.cuesOfSession(id).map((cue) => cue.id)
    await db.sessions.delete(id)
    sessions.value = sessions.value.filter((session) => session.id !== id)
    await levelStore.removeByCues(cueIds)
    await cueStore.removeBySession(id)
    await fixtureStore.removeBySession(id)
    await sheetStore.removeBySession(id)
    await renumber()
    if (currentSessionId.value === id) {
      currentSessionId.value = sortedSessions.value.length > 0 ? sortedSessions.value[0].id : null
    }
  }

  /** 上移 / 下移场次 */
  async function moveSession(id: string, direction: -1 | 1): Promise<void> {
    const ordered = sortedSessions.value.map((session) => session.id)
    const index = ordered.indexOf(id)
    const nextIndex = index + direction
    if (index < 0 || nextIndex < 0 || nextIndex >= ordered.length) return
    const swapped = [...ordered]
    swapped[index] = ordered[nextIndex]
    swapped[nextIndex] = ordered[index]
    const now = Date.now()
    const changed: Session[] = []
    swapped.forEach((sessionId, position) => {
      const session = sessionById(sessionId)
      if (session && session.order !== position + 1) {
        changed.push({ ...session, order: position + 1, updatedAt: now })
      }
    })
    if (changed.length === 0) return
    await db.sessions.bulkPut(changed)
    const patched = new Map(changed.map((session) => [session.id, session]))
    sessions.value = sessions.value.map((session) => patched.get(session.id) ?? session)
  }

  /** 把 order 规范化为 1..n 连续序号 */
  async function renumber(): Promise<void> {
    const ordered = [...sessions.value].sort((a, b) => a.order - b.order || a.createdAt - b.createdAt)
    const now = Date.now()
    const changed: Session[] = []
    ordered.forEach((session, index) => {
      if (session.order !== index + 1) {
        changed.push({ ...session, order: index + 1, updatedAt: now })
      }
    })
    if (changed.length === 0) return
    await db.sessions.bulkPut(changed)
    const patched = new Map(changed.map((session) => [session.id, session]))
    sessions.value = sessions.value.map((session) => patched.get(session.id) ?? session)
  }

  return {
    sessions,
    currentSessionId,
    hydrated,
    sortedSessions,
    currentSession,
    sessionById,
    statOf,
    setCurrentSession,
    ensureCurrentSession,
    hydrate,
    createSession,
    updateSession,
    removeSession,
    moveSession,
    renumber
  }
})
