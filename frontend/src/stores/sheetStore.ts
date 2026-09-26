import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { RehearsalSheet, SheetChannelLine, SheetCueLine, SheetDraft } from '@/types/sheet'
import { db } from '@/utils/db'
import { createId } from '@/utils/id'
import { sortFixturesByChannel } from '@/utils/patch'
import { useCueStore } from '@/stores/cueStore'
import { useFixtureStore } from '@/stores/fixtureStore'
import { useLevelStore } from '@/stores/levelStore'

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** 以生成日期 + 序号拼排演表编号 */
function buildSheetNo(sequence: number, generatedAt: Date): string {
  return `RS-${generatedAt.getFullYear()}${pad(generatedAt.getMonth() + 1)}${pad(generatedAt.getDate())}-${pad(sequence)}`
}

/**
 * 排演表仓库：勾选 Cue 生成条目快照并本地留存历史。
 */
export const useSheetStore = defineStore('sheet', () => {
  const sheets = ref<RehearsalSheet[]>([])
  const hydrated = ref(false)

  const sheetsSorted = computed(() =>
    [...sheets.value].sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime())
  )

  function sheetsOfSession(sessionId: string): RehearsalSheet[] {
    return sheetsSorted.value.filter((sheet) => sheet.sessionId === sessionId)
  }

  function sheetById(id: string): RehearsalSheet | null {
    return sheets.value.find((sheet) => sheet.id === id) ?? null
  }

  /** 下一张排演表在当天内的序号 */
  function nextSequence(generatedAt: Date): number {
    const prefix = `RS-${generatedAt.getFullYear()}${pad(generatedAt.getMonth() + 1)}${pad(generatedAt.getDate())}-`
    const used = sheets.value
      .filter((sheet) => sheet.sheetNo.startsWith(prefix))
      .map((sheet) => Number.parseInt(sheet.sheetNo.slice(prefix.length), 10))
      .filter((value) => Number.isFinite(value))
    return used.length === 0 ? 1 : Math.max(...used) + 1
  }

  async function hydrate(): Promise<void> {
    sheets.value = await db.sheets.toArray()
    hydrated.value = true
  }

  /** 依据勾选的 Cue 组装条目快照并落库 */
  async function createSheet(draft: SheetDraft): Promise<RehearsalSheet | null> {
    const cueStore = useCueStore()
    const levelStore = useLevelStore()
    const fixtureStore = useFixtureStore()

    const ordered = cueStore.sortedCuesOfSession(draft.sessionId).filter((cue) => draft.cueIds.includes(cue.id))
    if (ordered.length === 0) return null

    const cueLines: SheetCueLine[] = ordered.map((cue) => {
      const channels: SheetChannelLine[] = sortFixturesByChannel(fixtureStore.fixturesOfSession(draft.sessionId))
        .map((fixture) => {
          const level = levelStore.levelOf(cue.id, fixture.id)
          if (!level) return null
          return {
            channel: fixture.channel,
            position: fixture.position,
            fixtureType: fixture.fixtureType,
            gel: fixture.gel,
            intensity: level.intensity,
            colorTempK: level.colorTempK,
            focusNote: level.focusNote
          }
        })
        .filter((line): line is SheetChannelLine => line !== null)

      return {
        cueId: cue.id,
        cueNo: cue.cueNo,
        label: cue.label,
        trigger: cue.trigger,
        fadeInSec: cue.fadeInSec,
        fadeOutSec: cue.fadeOutSec,
        holdSec: cue.holdSec,
        note: cue.note,
        channels
      }
    })

    const generatedAt = new Date()
    const created: RehearsalSheet = {
      id: createId('sheet'),
      sessionId: draft.sessionId,
      sheetNo: buildSheetNo(nextSequence(generatedAt), generatedAt),
      generatedAt: generatedAt.toISOString(),
      includedCueIds: cueLines.map((line) => line.cueId),
      note: draft.note,
      cueLines
    }
    await db.sheets.put(created)
    sheets.value = [...sheets.value, created]
    return created
  }

  async function removeSheet(id: string): Promise<void> {
    const target = sheetById(id)
    if (!target) return
    await db.sheets.delete(id)
    sheets.value = sheets.value.filter((sheet) => sheet.id !== id)
  }

  async function removeBySession(sessionId: string): Promise<void> {
    const targets = sheetsOfSession(sessionId)
    if (targets.length === 0) return
    await db.sheets.bulkDelete(targets.map((sheet) => sheet.id))
    sheets.value = sheets.value.filter((sheet) => sheet.sessionId !== sessionId)
  }

  return {
    sheets,
    hydrated,
    sheetsSorted,
    sheetsOfSession,
    sheetById,
    hydrate,
    createSheet,
    removeSheet,
    removeBySession
  }
})
