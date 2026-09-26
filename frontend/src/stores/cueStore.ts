import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { Cue, CueDraft } from '@/types/cue'
import { db } from '@/utils/db'
import { createId } from '@/utils/id'
import { orderIndexMap, compareCueNo, sortCues, suggestInsertIndex, suggestNextCueNo } from '@/utils/cueOrder'
import { useLevelStore } from '@/stores/levelStore'

/** Cue 可更新字段 */
export type CuePatch = Partial<Omit<Cue, 'id' | 'sessionId' | 'createdAt'>>

/** 过渡时间批量偏移的作用范围 */
export type FadeShiftScope = 'in' | 'out' | 'both'

/**
 * Cue 提示点仓库：维护 Cue 时间轴顺序（orderIndex 落库）与排演表勾选导出集合。
 */
export const useCueStore = defineStore('cue', () => {
  const cues = ref<Cue[]>([])
  /** 排演表勾选集合，跨页共享 */
  const selectedCueIds = ref<string[]>([])
  const hydrated = ref(false)

  const cuesBySession = computed<Record<string, Cue[]>>(() => {
    const grouped: Record<string, Cue[]> = {}
    cues.value.forEach((cue) => {
      if (!grouped[cue.sessionId]) grouped[cue.sessionId] = []
      grouped[cue.sessionId].push(cue)
    })
    return grouped
  })

  function cuesOfSession(sessionId: string): Cue[] {
    return cuesBySession.value[sessionId] ?? []
  }

  function sortedCuesOfSession(sessionId: string): Cue[] {
    return sortCues(cuesOfSession(sessionId))
  }

  function cueById(id: string): Cue | null {
    return cues.value.find((cue) => cue.id === id) ?? null
  }

  function nextCueNo(sessionId: string): string {
    return suggestNextCueNo(cuesOfSession(sessionId).map((cue) => cue.cueNo))
  }

  function isCueNoTaken(sessionId: string, cueNo: string, exceptCueId?: string): boolean {
    return cuesOfSession(sessionId).some((cue) => cue.id !== exceptCueId && cue.cueNo === cueNo)
  }

  async function hydrate(): Promise<void> {
    cues.value = await db.cues.toArray()
    hydrated.value = true
  }

  /** 新建 Cue：不传 orderIndex 时按 cueNo 自动定位落库位次 */
  async function addCue(draft: CueDraft): Promise<Cue> {
    const siblings = cuesOfSession(draft.sessionId)
    const insertIndex = draft.orderIndex ?? suggestInsertIndex(siblings, draft.cueNo)
    const shifting = sortedCuesOfSession(draft.sessionId).slice(insertIndex)
    const now = Date.now()
    const created: Cue = {
      id: createId('cue'),
      sessionId: draft.sessionId,
      cueNo: draft.cueNo,
      label: draft.label,
      trigger: draft.trigger,
      fadeInSec: draft.fadeInSec,
      fadeOutSec: draft.fadeOutSec,
      holdSec: draft.holdSec,
      note: draft.note,
      orderIndex: insertIndex + 1,
      createdAt: now,
      updatedAt: now
    }

    await db.transaction('rw', db.cues, async () => {
      await db.cues.put(created)
      for (const cue of shifting) {
        await db.cues.put({ ...cue, orderIndex: cue.orderIndex + 1, updatedAt: now })
      }
    })

    const shiftedIds = new Set(shifting.map((cue) => cue.id))
    cues.value = [
      ...cues.value.map((cue) => (shiftedIds.has(cue.id) ? { ...cue, orderIndex: cue.orderIndex + 1, updatedAt: now } : cue)),
      created
    ]
    return created
  }

  /** 更新 Cue；改动 cueNo 时按编号重新落位 */
  async function updateCue(id: string, patch: CuePatch): Promise<Cue | null> {
    const target = cueById(id)
    if (!target) return null
    const next: Cue = { ...target, ...patch, updatedAt: Date.now() }
    await db.cues.put(next)
    cues.value = cues.value.map((cue) => (cue.id === id ? next : cue))

    if (patch.cueNo && patch.cueNo !== target.cueNo) {
      await sortByCueNo(target.sessionId)
    }
    return next
  }

  /** 删除 Cue 并级联清理其通道电平 */
  async function removeCue(id: string): Promise<void> {
    const target = cueById(id)
    if (!target) return
    const levelStore = useLevelStore()
    await db.cues.delete(id)
    cues.value = cues.value.filter((cue) => cue.id !== id)
    selectedCueIds.value = selectedCueIds.value.filter((cueId) => cueId !== id)
    await levelStore.removeByCue(id)
    await persistOrder(target.sessionId, sortedCuesOfSession(target.sessionId).map((cue) => cue.id))
  }

  /** 复制某条 Cue 的参数为新的一条（紧随其后） */
  async function duplicateCue(id: string): Promise<Cue | null> {
    const source = cueById(id)
    if (!source) return null
    const created = await addCue({
      sessionId: source.sessionId,
      cueNo: suggestNextCueNo(cuesOfSession(source.sessionId).map((cue) => cue.cueNo)),
      label: `${source.label || 'Cue'}（副本）`,
      trigger: source.trigger,
      fadeInSec: source.fadeInSec,
      fadeOutSec: source.fadeOutSec,
      holdSec: source.holdSec,
      note: source.note
    })
    const ordered = sortedCuesOfSession(source.sessionId)
    const sourceIndex = ordered.findIndex((cue) => cue.id === source.id)
    const createdIndex = ordered.findIndex((cue) => cue.id === created.id)
    const nextOrder = ordered.map((cue) => cue.id)
    nextOrder.splice(createdIndex, 1)
    nextOrder.splice(sourceIndex + 1, 0, created.id)
    await persistOrder(source.sessionId, nextOrder)
    return created
  }

  /** 复制上一条 Cue 的过渡参数到当前 Cue */
  async function copyPreviousParams(id: string): Promise<boolean> {
    const target = cueById(id)
    if (!target) return false
    const ordered = sortedCuesOfSession(target.sessionId)
    const index = ordered.findIndex((cue) => cue.id === target.id)
    if (index <= 0) return false
    const previous = ordered[index - 1]
    await updateCue(id, {
      trigger: previous.trigger,
      fadeInSec: previous.fadeInSec,
      fadeOutSec: previous.fadeOutSec,
      holdSec: previous.holdSec
    })
    return true
  }

  /** 批量偏移一场戏内全部 Cue 的过渡时间，结果下限为 0 */
  async function shiftFades(sessionId: string, deltaSec: number, scope: FadeShiftScope): Promise<number> {
    const targets = sortedCuesOfSession(sessionId)
    if (targets.length === 0) return 0
    const now = Date.now()
    const shifted = targets.map<Cue>((cue) => {
      const nextIn = scope === 'out' ? cue.fadeInSec : Math.max(0, Math.round((cue.fadeInSec + deltaSec) * 10) / 10)
      const nextOut = scope === 'in' ? cue.fadeOutSec : Math.max(0, Math.round((cue.fadeOutSec + deltaSec) * 10) / 10)
      return { ...cue, fadeInSec: nextIn, fadeOutSec: nextOut, updatedAt: now }
    })
    await db.cues.bulkPut(shifted)
    const patched = new Map(shifted.map((cue) => [cue.id, cue]))
    cues.value = cues.value.map((cue) => patched.get(cue.id) ?? cue)
    return shifted.length
  }

  /** 把当前顺序写入 orderIndex */
  async function persistOrder(sessionId: string, orderedIds: readonly string[]): Promise<void> {
    const orderMap = orderIndexMap(orderedIds)
    const now = Date.now()
    const changed: Cue[] = []
    cuesOfSession(sessionId).forEach((cue) => {
      const nextIndex = orderMap.get(cue.id)
      if (nextIndex !== undefined && nextIndex !== cue.orderIndex) {
        changed.push({ ...cue, orderIndex: nextIndex, updatedAt: now })
      }
    })
    if (changed.length === 0) return
    await db.cues.bulkPut(changed)
    const patched = new Map(changed.map((cue) => [cue.id, cue]))
    cues.value = cues.value.map((cue) => patched.get(cue.id) ?? cue)
  }

  /** 拖拽重排：按传入 id 顺序落库 */
  async function reorderCues(sessionId: string, orderedIds: readonly string[]): Promise<void> {
    await persistOrder(sessionId, orderedIds)
  }

  /** 按 cueNo 自动排序并落库 */
  async function sortByCueNo(sessionId: string): Promise<void> {
    const ordered = [...cuesOfSession(sessionId)].sort((a, b) => compareCueNo(a.cueNo, b.cueNo))
    await persistOrder(sessionId, ordered.map((cue) => cue.id))
  }

  /** 相对移动一位 */
  async function moveCue(id: string, direction: -1 | 1): Promise<void> {
    const target = cueById(id)
    if (!target) return
    const ordered = sortedCuesOfSession(target.sessionId).map((cue) => cue.id)
    const index = ordered.indexOf(id)
    const nextIndex = index + direction
    if (index < 0 || nextIndex < 0 || nextIndex >= ordered.length) return
    const swapped = [...ordered]
    swapped[index] = ordered[nextIndex]
    swapped[nextIndex] = ordered[index]
    await persistOrder(target.sessionId, swapped)
  }

  async function removeBySession(sessionId: string): Promise<void> {
    const ids = cuesOfSession(sessionId).map((cue) => cue.id)
    if (ids.length === 0) return
    const levelStore = useLevelStore()
    await db.cues.bulkDelete(ids)
    cues.value = cues.value.filter((cue) => cue.sessionId !== sessionId)
    selectedCueIds.value = selectedCueIds.value.filter((cueId) => !ids.includes(cueId))
    await levelStore.removeByCues(ids)
  }

  function isSelected(cueId: string): boolean {
    return selectedCueIds.value.includes(cueId)
  }

  async function toggleSelected(cueId: string): Promise<void> {
    selectedCueIds.value = isSelected(cueId)
      ? selectedCueIds.value.filter((id) => id !== cueId)
      : [...selectedCueIds.value, cueId]
  }

  function setSelection(cueIds: readonly string[]): void {
    selectedCueIds.value = [...cueIds]
  }

  function selectAll(cueIds: readonly string[]): void {
    const merged = new Set([...selectedCueIds.value, ...cueIds])
    selectedCueIds.value = Array.from(merged)
  }

  function clearSelection(): void {
    selectedCueIds.value = []
  }

  /** 某场次被勾选的 Cue（按时间轴顺序） */
  function selectedOfSession(sessionId: string): Cue[] {
    return sortedCuesOfSession(sessionId).filter((cue) => isSelected(cue.id))
  }

  return {
    cues,
    selectedCueIds,
    hydrated,
    cuesBySession,
    cuesOfSession,
    sortedCuesOfSession,
    cueById,
    nextCueNo,
    isCueNoTaken,
    hydrate,
    addCue,
    updateCue,
    removeCue,
    duplicateCue,
    copyPreviousParams,
    shiftFades,
    persistOrder,
    reorderCues,
    sortByCueNo,
    moveCue,
    removeBySession,
    isSelected,
    toggleSelected,
    setSelection,
    selectAll,
    clearSelection,
    selectedOfSession
  }
})
