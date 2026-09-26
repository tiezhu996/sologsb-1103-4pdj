import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { Cue, CueDraft } from '@/types/cue'
import { db } from '@/utils/db'
import { createId } from '@/utils/id'
import { orderIndexMap, compareCueNo, sortCues, suggestNextCueNo, parseCueNo } from '@/utils/cueOrder'
import { useLevelStore } from '@/stores/levelStore'

/** Cue 可更新字段 */
export type CuePatch = Partial<Omit<Cue, 'id' | 'sessionId' | 'createdAt'>>

/** 过渡时间批量偏移的作用范围 */
export type FadeShiftScope = 'in' | 'out' | 'both'

/** 尝试恢复回收站 Cue 的结果 */
export type RestoreResult =
  | { ok: true; cue: Cue }
  | { ok: false; reason: 'not-found' | 'not-trashed' | 'cue-no-taken' }

/** 判断 Cue 是否在场次回收站中 */
export function isInTrash(cue: Cue): boolean {
  return typeof cue.deletedAt === 'number'
}

/**
 * Cue 提示点仓库：维护 Cue 时间轴顺序（orderIndex 落库）、排演表勾选集合，
 * 以及每个场次各自独立的回收站（deletedAt 软删除）。
 *
 * 回收站约定：
 * - 退回回收站的 Cue 不出现在时间轴与排演表勾选中，编号继续保留（同号新 Cue 插入会被拦下）；
 * - 回收站里连着提示语、过渡时间与通道电平一起留着，恢复时按原编号放回原来的位次；
 * - 只有整场清空回收站才彻底删除 Cue 并清掉其通道电平；
 * - 删除场次时回收站与里面的电平随场次一道清干净。
 */
export const useCueStore = defineStore('cue', () => {
  const cues = ref<Cue[]>([])
  /** 排演表勾选集合，跨页共享 */
  const selectedCueIds = ref<string[]>([])
  const hydrated = ref(false)

  /** 含回收站在内的场次分组，仅用于编号占用、级联删除等内部判断 */
  const allCuesBySession = computed<Record<string, Cue[]>>(() => {
    const grouped: Record<string, Cue[]> = {}
    cues.value.forEach((cue) => {
      if (!grouped[cue.sessionId]) grouped[cue.sessionId] = []
      grouped[cue.sessionId].push(cue)
    })
    return grouped
  })

  /** 时间轴上的 Cue 分组（回收站中的 Cue 已排除） */
  const cuesBySession = computed<Record<string, Cue[]>>(() => {
    const grouped: Record<string, Cue[]> = {}
    cues.value.forEach((cue) => {
      if (isInTrash(cue)) return
      if (!grouped[cue.sessionId]) grouped[cue.sessionId] = []
      grouped[cue.sessionId].push(cue)
    })
    return grouped
  })

  /** 时间轴上的 Cue（不含回收站） */
  function cuesOfSession(sessionId: string): Cue[] {
    return cuesBySession.value[sessionId] ?? []
  }

  /** 含回收站在内的该场次全部 Cue，用于编号查重等 */
  function allCuesOfSession(sessionId: string): Cue[] {
    return allCuesBySession.value[sessionId] ?? []
  }

  function sortedCuesOfSession(sessionId: string): Cue[] {
    return sortCues(cuesOfSession(sessionId))
  }

  /** 某场次回收站中的 Cue，按退回时间先后排列（同刻按编号自然序） */
  function trashedOfSession(sessionId: string): Cue[] {
    return allCuesOfSession(sessionId)
      .filter(isInTrash)
      .sort((a, b) => (a.deletedAt as number) - (b.deletedAt as number) || compareCueNo(a.cueNo, b.cueNo))
  }

  /** 按 id 查找 Cue，回收站中的也查得到（电平编辑页据此识别被退回的 Cue） */
  function cueById(id: string): Cue | null {
    return cues.value.find((cue) => cue.id === id) ?? null
  }

  /** 建议的下一条 Cue 编号：回收站里保留的编号同样占位，不会给出撞号的建议 */
  function nextCueNo(sessionId: string): string {
    return suggestNextCueNo(allCuesOfSession(sessionId).map((cue) => cue.cueNo))
  }

  /** 编号是否已被占用：时间轴与回收站中的 Cue 都算占用，避免恢复时撞号 */
  function isCueNoTaken(sessionId: string, cueNo: string, exceptCueId?: string): boolean {
    return allCuesOfSession(sessionId).some((cue) => cue.id !== exceptCueId && cue.cueNo === cueNo)
  }

  /** 该编号是否正被回收站里的 Cue 占着（现场插入同号 Cue 时给出去回收站处理的提示） */
  function trashedCueWithNo(sessionId: string, cueNo: string): Cue | null {
    return allCuesOfSession(sessionId).find((cue) => isInTrash(cue) && cue.cueNo === cueNo) ?? null
  }

  async function hydrate(): Promise<void> {
    cues.value = await db.cues.toArray()
    hydrated.value = true
  }

  /** 新建 Cue：编号在时间轴与回收站中都不能重复；位次在活跃 Cue 中按 cueNo 定位 */
  async function addCue(draft: CueDraft): Promise<Cue> {
    if (isCueNoTaken(draft.sessionId, draft.cueNo)) {
      throw new Error(`Cue 编号 ${draft.cueNo} 已被占用（含回收站中保留的编号）`)
    }
    const activeSorted = sortedCuesOfSession(draft.sessionId)
    const insertIndex = draft.orderIndex ?? suggestInsertIndexFor(activeSorted, draft.cueNo)
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
      orderIndex: 0,
      createdAt: now,
      updatedAt: now
    }

    // 回收站中的 Cue 可能在任意位次留下空洞，这里按活跃 Cue 的新顺序重新落位次
    const { ordered, indexOfCreated } = mergeInsert(activeSorted, created, insertIndex)
    const toWrite = assignOrderIndices(ordered)
    created.orderIndex = toWrite[indexOfCreated].orderIndex

    await db.transaction('rw', db.cues, async () => {
      for (const cue of toWrite) await db.cues.put(cue)
    })

    const patched = new Map(toWrite.map((cue) => [cue.id, cue]))
    cues.value = [...cues.value.map((cue) => patched.get(cue.id) ?? cue), created]
    return created
  }

  /** 更新 Cue；回收站中的 Cue 不允许就地改动（恢复后再编辑），改动 cueNo 时重新落位 */
  async function updateCue(id: string, patch: CuePatch): Promise<Cue | null> {
    const target = cueById(id)
    if (!target || isInTrash(target)) return null
    if (patch.cueNo && patch.cueNo !== target.cueNo && isCueNoTaken(target.sessionId, patch.cueNo, id)) {
      throw new Error(`Cue 编号 ${patch.cueNo} 已被占用（含回收站中保留的编号）`)
    }
    const next: Cue = { ...target, ...patch, updatedAt: Date.now() }
    await db.cues.put(next)
    cues.value = cues.value.map((cue) => (cue.id === id ? next : cue))

    if (patch.cueNo && patch.cueNo !== target.cueNo) {
      await sortByCueNo(target.sessionId)
    }
    return next
  }

  /** 退回场次回收站：从时间轴与勾选集合移除，编号 / 位次 / 提示语 / 过渡时间 / 通道电平原样保留 */
  async function trashCue(id: string): Promise<void> {
    const target = cueById(id)
    if (!target || isInTrash(target)) return
    const now = Date.now()
    const next: Cue = { ...target, deletedAt: now, updatedAt: now }
    await db.cues.put(next)
    cues.value = cues.value.map((cue) => (cue.id === id ? next : cue))
    selectedCueIds.value = selectedCueIds.value.filter((cueId) => cueId !== id)
  }

  /** 从回收站恢复：编号若已被新 Cue 占用则拒绝；按原位次插回时间轴，通道电平照旧在 */
  async function restoreCue(id: string): Promise<RestoreResult> {
    const target = cueById(id)
    if (!target) return { ok: false, reason: 'not-found' }
    if (!isInTrash(target)) return { ok: false, reason: 'not-trashed' }
    const activeSorted = sortedCuesOfSession(target.sessionId)
    if (activeSorted.some((cue) => cue.cueNo === target.cueNo)) {
      return { ok: false, reason: 'cue-no-taken' }
    }

    const now = Date.now()
    // 找第一条位次更靠后的活跃 Cue 作为后继；位次相同时按编号自然序裁决，
    // 保证同一位次上退回的多条 Cue 恢复后仍按编号有序落回
    const successor = activeSorted.find(
      (cue) => cue.orderIndex > target.orderIndex || (cue.orderIndex === target.orderIndex && compareCueNo(cue.cueNo, target.cueNo) > 0)
    )
    const restored: Cue = { ...target, deletedAt: undefined, updatedAt: now }
    const ordered = [...activeSorted]
    if (successor) ordered.splice(ordered.indexOf(successor), 0, restored)
    else ordered.push(restored)
    const toWrite = assignOrderIndices(ordered)

    await db.transaction('rw', db.cues, async () => {
      for (const cue of toWrite) await db.cues.put(cue)
    })
    const patched = new Map(toWrite.map((cue) => [cue.id, cue]))
    cues.value = cues.value.map((cue) => patched.get(cue.id) ?? cue)
    return { ok: true, cue: restored }
  }

  /** 彻底删除单条回收站 Cue：连同其通道电平一起清走（仅限回收站内） */
  async function deleteCuePermanent(id: string): Promise<void> {
    const target = cueById(id)
    if (!target || !isInTrash(target)) return
    const levelStore = useLevelStore()
    await db.cues.delete(id)
    cues.value = cues.value.filter((cue) => cue.id !== id)
    await levelStore.removeByCue(id)
  }

  /** 整场清空回收站：彻底删除该场次所有回收站 Cue，并清掉它们的通道电平 */
  async function emptyTrash(sessionId: string): Promise<number> {
    const trashed = trashedOfSession(sessionId)
    if (trashed.length === 0) return 0
    const ids = trashed.map((cue) => cue.id)
    const levelStore = useLevelStore()
    await db.cues.bulkDelete(ids)
    cues.value = cues.value.filter((cue) => !ids.includes(cue.id))
    await levelStore.removeByCues(ids)
    return ids.length
  }

  /** 复制某条 Cue 的参数为新的一条（紧随其后） */
  async function duplicateCue(id: string): Promise<Cue | null> {
    const source = cueById(id)
    if (!source || isInTrash(source)) return null
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
    if (!target || isInTrash(target)) return false
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

  /** 批量偏移一场戏内全部 Cue 的过渡时间，结果下限为 0（不影响回收站中的 Cue） */
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

  /** 把当前顺序写入 orderIndex（只重排时间轴上的 Cue，回收站的位次保留） */
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
    if (!target || isInTrash(target)) return
    const ordered = sortedCuesOfSession(target.sessionId).map((cue) => cue.id)
    const index = ordered.indexOf(id)
    const nextIndex = index + direction
    if (index < 0 || nextIndex < 0 || nextIndex >= ordered.length) return
    const swapped = [...ordered]
    swapped[index] = ordered[nextIndex]
    swapped[nextIndex] = ordered[index]
    await persistOrder(target.sessionId, swapped)
  }

  /** 删除场次：连时间轴、回收站里的 Cue 与全部通道电平一道清干净 */
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

  /** 某场次被勾选的 Cue（按时间轴顺序；回收站 Cue 不在勾选范围） */
  function selectedOfSession(sessionId: string): Cue[] {
    return sortedCuesOfSession(sessionId).filter((cue) => isSelected(cue.id))
  }

  return {
    cues,
    selectedCueIds,
    hydrated,
    cuesBySession,
    cuesOfSession,
    allCuesOfSession,
    sortedCuesOfSession,
    trashedOfSession,
    cueById,
    nextCueNo,
    isCueNoTaken,
    trashedCueWithNo,
    hydrate,
    addCue,
    updateCue,
    trashCue,
    restoreCue,
    deleteCuePermanent,
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

/** 按 cueNo 在已排好序的活跃 Cue 中找出插入位次（0 基） */
function suggestInsertIndexFor(sortedCues: readonly Cue[], cueNo: string): number {
  const target = parseCueNo(cueNo)
  for (let index = 0; index < sortedCues.length; index += 1) {
    if (parseCueNo(sortedCues[index].cueNo) > target) return index
  }
  return sortedCues.length
}

/** 把待插入 Cue 放进指定位次，返回新顺序与新 Cue 在其中的位置 */
function mergeInsert(sortedCues: readonly Cue[], created: Cue, insertIndex: number): { ordered: Cue[]; indexOfCreated: number } {
  const clamped = Math.max(0, Math.min(insertIndex, sortedCues.length))
  const ordered = [...sortedCues]
  ordered.splice(clamped, 0, created)
  return { ordered, indexOfCreated: clamped }
}

/** 按数组顺序重写 orderIndex 为连续位次（从 1 开始），返回新对象数组 */
function assignOrderIndices(ordered: readonly Cue[]): Cue[] {
  return ordered.map((cue, index) => ({ ...cue, orderIndex: index + 1 }))
}
