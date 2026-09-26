import type { Fixture, FixturePosition } from '@/types/fixture'
import { FIXTURE_POSITIONS, POSITION_LOAD_LIMIT } from '@/types/fixture'
import type { ChannelConflict, PatchCheckResult, PositionLoad } from '@/types/fixture'

/** 通道标签展示名，例如 `CH12 · 面光 · 成像灯` */
export function fixtureLabel(fixture: Fixture): string {
  return `CH${fixture.channel} · ${fixture.position} · ${fixture.fixtureType}`
}

/** 按通道号升序排列（不修改入参） */
export function sortFixturesByChannel(input: readonly Fixture[]): Fixture[] {
  return [...input].sort((a, b) => a.channel - b.channel || a.createdAt - b.createdAt)
}

/** 按灯位分组，分组内部按通道号排序；分组顺序固定为灯位定义顺序 */
export function groupFixturesByPosition(input: readonly Fixture[]): Array<{ position: FixturePosition; fixtures: Fixture[] }> {
  const sorted = sortFixturesByChannel(input)
  return FIXTURE_POSITIONS.map((position) => ({
    position,
    fixtures: sorted.filter((fixture) => fixture.position === position)
  }))
}

/** 检测同场次内重复的通道号 */
export function detectChannelConflicts(input: readonly Fixture[]): ChannelConflict[] {
  const buckets = new Map<number, Fixture[]>()
  input.forEach((fixture) => {
    const bucket = buckets.get(fixture.channel)
    if (bucket) bucket.push(fixture)
    else buckets.set(fixture.channel, [fixture])
  })
  const conflicts: ChannelConflict[] = []
  buckets.forEach((fixtures, channel) => {
    if (fixtures.length > 1) {
      const ordered = sortFixturesByChannel(fixtures)
      conflicts.push({
        channel,
        fixtureIds: ordered.map((fixture) => fixture.id),
        labels: ordered.map(fixtureLabel)
      })
    }
  })
  return conflicts.sort((a, b) => a.channel - b.channel)
}

/** 检测各灯位通道数量是否过载 */
export function detectPositionLoads(input: readonly Fixture[]): PositionLoad[] {
  const counter = new Map<FixturePosition, number>()
  FIXTURE_POSITIONS.forEach((position) => counter.set(position, 0))
  input.forEach((fixture) => counter.set(fixture.position, (counter.get(fixture.position) ?? 0) + 1))
  return FIXTURE_POSITIONS.map((position) => {
    const count = counter.get(position) ?? 0
    return { position, count, limit: POSITION_LOAD_LIMIT, overloaded: count > POSITION_LOAD_LIMIT }
  })
}

/** 汇总一次完整的配接校验 */
export function buildPatchCheck(input: readonly Fixture[]): PatchCheckResult {
  const conflicts = detectChannelConflicts(input)
  const loads = detectPositionLoads(input)
  return {
    conflicts,
    loads,
    hasConflict: conflicts.length > 0,
    hasOverload: loads.some((load) => load.overloaded),
    checkedAt: Date.now()
  }
}

/** 空校验结果，用于尚未配接的场次 */
export function emptyPatchCheck(): PatchCheckResult {
  return {
    conflicts: [],
    loads: FIXTURE_POSITIONS.map((position) => ({
      position,
      count: 0,
      limit: POSITION_LOAD_LIMIT,
      overloaded: false
    })),
    hasConflict: false,
    hasOverload: false,
    checkedAt: Date.now()
  }
}
