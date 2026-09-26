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
 * 删除的 Cue 进入本场回收站（trashedAt 标记）：不占时间轴与排演表勾选，编号保留、
 * 通道电平不动；恢复时按原编号放回原位次；清空回收站才级联清掉通道电平。
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

  /** 时间轴上的 Cue（不含回收站） */
  function cuesOfSession(sessionId: string): Cue[] {
    return (cuesBySession.value[sessionId] ?? []).filter((cue) => cue.trashedAt === null)
  }

  /** 回收站中的 Cue，按进入时间倒序（最近删除的排在前面） */
  function trashedCuesOfSession(sessionId: string): Cue[] {
    return (cuesBySession.value[sessionId] ?? [])
      .filter((cue) => cue.trashedAt !== null)
      .sort((a, b) => (b.trashedAt ?? 0) - (a.trashedAt ?? 0))
  }

  /** 时间轴 + 回收站的全部 Cue（编号占用判定与级联清理用） */
  function allCuesOfSession(sessionId: string): Cue[] {
    return cuesBySession.value[sessionId] ?? []
  }

  function sortedCuesOfSession(sessionId: string): Cue[] {
    return sortCues(cuesOfSession(sessionId))
  }

  function cueById(id: string): Cue | null {
    return cues.value.find((cue) => cue.id === id) ?? null
  }

  /** 建议的下一个编号：回收站占用的编号同样跳过 */
  function nextCueNo(sessionId: string): string {
    return suggestNextCueNo(allCuesOfSession(sessionId).map((cue) => cue.cueNo))
  }

  /** 编号是否被占用：回收站中的编号也算占用，避免恢复回来撞号 */
  function isCueNoTaken(sessionId: string, cueNo: string, exceptCueId?: string): boolean {
    return allCuesOfSession(sessionId).some((cue) => cue.id !== exceptCueId && cue.cueNo === cueNo)
  }

  /** 编号是否正躺在回收站里（占用的一种，提示语引导去恢复或清空） */
  function isCueNoTrashed(sessionId: string, cueNo: string): boolean {
    return trashedCuesOfSession(sessionId).some((cue) => cue.cueNo === cueNo)
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
      trashedAt: null,
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

  /**
   * 删除 Cue：移入本场回收站。提示语、过渡时间与通道电平全部保留，
   * 落库位次冻结为原位次供恢复时放回；回收站中的编号仍被占用。
   */
  async function trashCue(id: string): Promise<void> {
    const target = cueById(id)
    if (!target || target.trashedAt !== null) return
    const now = Date.now()
    const trashed: Cue = { ...target, trashedAt: now, updatedAt: now }
    await db.cues.put(trashed)
    cues.value = cues.value.map((cue) => (cue.id === id ? trashed : cue))
    selectedCueIds.value = selectedCueIds.value.filter((cueId) => cueId !== id)
    // 时间轴上剩余的 Cue 重排为连续位次；回收站中的位次保持冻结
    await persistOrder(target.sessionId, sortedCuesOfSession(target.sessionId).map((cue) => cue.id))
  }

  /** 从回收站恢复：按原编号放回原落库位次（其后 Cue 顺移一位），通道电平照旧保留 */
  async function restoreCue(id: string): Promise<Cue | null> {
    const target = cueById(id)
    if (!target || target.trashedAt === null) return null
    const siblings = sortedCuesOfSession(target.sessionId)
    // 冻结的落库位次（1 基）转为 0 基插入位置，超出当前长度时落到末尾
    const insertIndex = Math.min(Math.max(target.orderIndex - 1, 0), siblings.length)
    const shifting = siblings.slice(insertIndex)
    const now = Date.now()
    const restored: Cue = { ...target, trashedAt: null, orderIndex: insertIndex + 1, updatedAt: now }

    await db.transaction('rw', db.cues, async () => {
      await db.cues.put(restored)
      for (const cue of shifting) {
        await db.cues.put({ ...cue, orderIndex: cue.orderIndex + 1, updatedAt: now })
      }
    })

    const shiftedIds = new Set(shifting.map((cue) => cue.id))
    cues.value = cues.value.map((cue) => {
      if (cue.id === id) return restored
      return shiftedIds.has(cue.id) ? { ...cue, orderIndex: cue.orderIndex + 1, updatedAt: now } : cue
    })
    return restored
  }

  /** 清空本场回收站：彻底删除其中的 Cue，并级联清掉它们的通道电平 */
  async function emptyTrash(sessionId: string): Promise<number> {
    const trashed = trashedCuesOfSession(sessionId)
    if (trashed.length === 0) return 0
    const levelStore = useLevelStore()
    const ids = trashed.map((cue) => cue.id)
    await db.cues.bulkDelete(ids)
    const removed = new Set(ids)
    cues.value = cues.value.filter((cue) => !removed.has(cue.id))
    selectedCueIds.value = selectedCueIds.value.filter((cueId) => !removed.has(cueId))
    await levelStore.removeByCues(ids)
    return ids.length
  }

  /** 复制某条 Cue 的参数为新的一条（紧随其后） */
  async function duplicateCue(id: string): Promise<Cue | null> {
    const source = cueById(id)
    if (!source) return null
    const created = await addCue({
      sessionId: source.sessionId,
      cueNo: suggestNextCueNo(allCuesOfSession(source.sessionId).map((cue) => cue.cueNo)),
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

  /** 场次删除时的级联：时间轴与回收站中的 Cue 连同通道电平一道清干净 */
  async function removeBySession(sessionId: string): Promise<void> {
    const ids = allCuesOfSession(sessionId).map((cue) => cue.id)
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
    trashedCuesOfSession,
    allCuesOfSession,
    sortedCuesOfSession,
    cueById,
    nextCueNo,
    isCueNoTaken,
    isCueNoTrashed,
    hydrate,
    addCue,
    updateCue,
    trashCue,
    restoreCue,
    emptyTrash,
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
