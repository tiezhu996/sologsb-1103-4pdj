import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { Fixture, FixtureDraft, FixturePosition, PatchCheckResult } from '@/types/fixture'
import { DMX_CHANNEL_MAX, DMX_CHANNEL_MIN } from '@/types/fixture'
import { db } from '@/utils/db'
import { createId } from '@/utils/id'
import { buildPatchCheck, emptyPatchCheck, groupFixturesByPosition, sortFixturesByChannel } from '@/utils/patch'
import { useLevelStore } from '@/stores/levelStore'

/** Fixture 可更新字段 */
export type FixturePatch = Partial<Omit<Fixture, 'id' | 'sessionId' | 'createdAt'>>

/** 写入灯位通道的结果 */
export interface FixtureWriteResult {
  ok: boolean
  message: string
  fixture: Fixture | null
}

function validateChannel(channel: number): string | null {
  if (!Number.isInteger(channel)) return '通道号必须为整数'
  if (channel < DMX_CHANNEL_MIN || channel > DMX_CHANNEL_MAX) {
    return `通道号需在 ${DMX_CHANNEL_MIN}-${DMX_CHANNEL_MAX} 之间`
  }
  return null
}

/**
 * 灯位通道仓库：维护配接记录、按灯位分组结果与配接校验结果（冲突 / 过载）。
 */
export const useFixtureStore = defineStore('fixture', () => {
  const fixtures = ref<Fixture[]>([])
  /** 各场次的配接校验结果，跨页共享 */
  const patchChecks = ref<Record<string, PatchCheckResult>>({})
  const hydrated = ref(false)

  const fixturesBySession = computed<Record<string, Fixture[]>>(() => {
    const grouped: Record<string, Fixture[]> = {}
    fixtures.value.forEach((fixture) => {
      if (!grouped[fixture.sessionId]) grouped[fixture.sessionId] = []
      grouped[fixture.sessionId].push(fixture)
    })
    return grouped
  })

  function fixturesOfSession(sessionId: string): Fixture[] {
    return fixturesBySession.value[sessionId] ?? []
  }

  function sortedFixturesOfSession(sessionId: string): Fixture[] {
    return sortFixturesByChannel(fixturesOfSession(sessionId))
  }

  function groupedFixturesOfSession(sessionId: string): Array<{ position: FixturePosition; fixtures: Fixture[] }> {
    return groupFixturesByPosition(fixturesOfSession(sessionId))
  }

  function fixtureById(id: string): Fixture | null {
    return fixtures.value.find((fixture) => fixture.id === id) ?? null
  }

  function usedChannels(sessionId: string): number[] {
    return sortedFixturesOfSession(sessionId).map((fixture) => fixture.channel)
  }

  /** 读取配接校验结果；尚未校准时即时计算并缓存 */
  function patchCheckOf(sessionId: string): PatchCheckResult {
    const cached = patchChecks.value[sessionId]
    if (cached) return cached
    const result = fixturesOfSession(sessionId).length === 0 ? emptyPatchCheck() : buildPatchCheck(fixturesOfSession(sessionId))
    patchChecks.value = { ...patchChecks.value, [sessionId]: result }
    return result
  }

  /** 用外部 hooks 计算的结果覆盖缓存 */
  function applyPatchCheck(sessionId: string, result: PatchCheckResult): void {
    patchChecks.value = { ...patchChecks.value, [sessionId]: result }
  }

  async function hydrate(): Promise<void> {
    fixtures.value = await db.fixtures.toArray()
    hydrated.value = true
  }

  async function addFixture(draft: FixtureDraft): Promise<FixtureWriteResult> {
    const channelError = validateChannel(draft.channel)
    if (channelError) return { ok: false, message: channelError, fixture: null }
    const now = Date.now()
    const created: Fixture = {
      id: createId('fix'),
      sessionId: draft.sessionId,
      channel: draft.channel,
      position: draft.position,
      fixtureType: draft.fixtureType,
      gel: draft.gel,
      patchNote: draft.patchNote,
      createdAt: now,
      updatedAt: now
    }
    await db.fixtures.put(created)
    fixtures.value = [...fixtures.value, created]
    applyPatchCheck(draft.sessionId, buildPatchCheck(fixturesOfSession(draft.sessionId)))
    return {
      ok: true,
      message: `已配接 CH${created.channel}`,
      fixture: created
    }
  }

  async function updateFixture(id: string, patch: FixturePatch): Promise<FixtureWriteResult> {
    const target = fixtureById(id)
    if (!target) return { ok: false, message: '灯位通道不存在', fixture: null }
    if (patch.channel !== undefined) {
      const channelError = validateChannel(patch.channel)
      if (channelError) return { ok: false, message: channelError, fixture: null }
    }
    const next: Fixture = { ...target, ...patch, updatedAt: Date.now() }
    await db.fixtures.put(next)
    fixtures.value = fixtures.value.map((fixture) => (fixture.id === id ? next : fixture))
    applyPatchCheck(target.sessionId, buildPatchCheck(fixturesOfSession(target.sessionId)))
    return { ok: true, message: `已更新 CH${next.channel}`, fixture: next }
  }

  async function removeFixture(id: string): Promise<void> {
    const target = fixtureById(id)
    if (!target) return
    const levelStore = useLevelStore()
    await db.fixtures.delete(id)
    fixtures.value = fixtures.value.filter((fixture) => fixture.id !== id)
    await levelStore.removeByFixture(id)
    applyPatchCheck(target.sessionId, buildPatchCheck(fixturesOfSession(target.sessionId)))
  }

  async function removeBySession(sessionId: string): Promise<void> {
    const targets = fixturesOfSession(sessionId)
    if (targets.length === 0) return
    await db.fixtures.bulkDelete(targets.map((fixture) => fixture.id))
    fixtures.value = fixtures.value.filter((fixture) => fixture.sessionId !== sessionId)
    patchChecks.value = { ...patchChecks.value, [sessionId]: emptyPatchCheck() }
  }

  return {
    fixtures,
    patchChecks,
    hydrated,
    fixturesBySession,
    fixturesOfSession,
    sortedFixturesOfSession,
    groupedFixturesOfSession,
    fixtureById,
    usedChannels,
    patchCheckOf,
    applyPatchCheck,
    hydrate,
    addFixture,
    updateFixture,
    removeFixture,
    removeBySession
  }
})
