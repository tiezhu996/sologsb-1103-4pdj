import { computed, toValue, watch, type ComputedRef, type MaybeRefOrGetter } from 'vue'
import type { ChannelConflict, PatchCheckResult, PositionLoad } from '@/types/fixture'
import { useFixtureStore } from '@/stores/fixtureStore'
import { buildPatchCheck, emptyPatchCheck } from '@/utils/patch'

/** `useChannelConflict` 暴露的配接校验视图 */
export interface UseChannelConflictReturn {
  /** 完整校验结果 */
  result: ComputedRef<PatchCheckResult>
  /** 重复通道号 */
  conflicts: ComputedRef<ChannelConflict[]>
  /** 各灯位负载 */
  loads: ComputedRef<PositionLoad[]>
  /** 重复通道号集合，便于列表高亮 */
  conflictChannels: ComputedRef<number[]>
  /** 重复通道的灯位通道 id 集合 */
  conflictFixtureIds: ComputedRef<string[]>
  hasConflict: ComputedRef<boolean>
  hasOverload: ComputedRef<boolean>
  /** 提示文案，可直接渲染 */
  messages: ComputedRef<string[]>
}

/**
 * 检测同场次重复通道号与灯位过载并给出提示。
 * 结果会写回 fixtureStore，供其他页面复用（被灯位配置台消费）。
 */
export function useChannelConflict(sessionId: MaybeRefOrGetter<string>): UseChannelConflictReturn {
  const fixtureStore = useFixtureStore()

  const result = computed<PatchCheckResult>(() => {
    const fixtures = fixtureStore.fixturesOfSession(toValue(sessionId))
    return fixtures.length === 0 ? emptyPatchCheck() : buildPatchCheck(fixtures)
  })

  const conflicts = computed(() => result.value.conflicts)
  const loads = computed(() => result.value.loads)
  const conflictChannels = computed(() => conflicts.value.map((item) => item.channel))
  const conflictFixtureIds = computed(() => conflicts.value.flatMap((item) => item.fixtureIds))
  const hasConflict = computed(() => result.value.hasConflict)
  const hasOverload = computed(() => result.value.hasOverload)

  const messages = computed<string[]>(() => {
    const list: string[] = []
    if (hasConflict.value) {
      list.push(`通道号重复：${conflicts.value.map((item) => `CH${item.channel}（${item.labels.length} 个配接）`).join('、')}`)
    }
    const overloaded = loads.value.filter((load) => load.overloaded)
    if (overloaded.length > 0) {
      list.push(`灯位过载：${overloaded.map((load) => `${load.position} ${load.count}/${load.limit}`).join('、')}`)
    }
    return list
  })

  watch(
    result,
    (value) => {
      fixtureStore.applyPatchCheck(toValue(sessionId), value)
    },
    { immediate: true }
  )

  return {
    result,
    conflicts,
    loads,
    conflictChannels,
    conflictFixtureIds,
    hasConflict,
    hasOverload,
    messages
  }
}
