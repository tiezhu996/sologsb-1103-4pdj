/** 灯位方位：面光 / 耳光 / 顶排 / 侧光 / 地排 */
export const FIXTURE_POSITIONS = ['面光', '耳光', '顶排', '侧光', '地排'] as const
export type FixturePosition = (typeof FIXTURE_POSITIONS)[number]

/** 灯具类型 */
export const FIXTURE_TYPES = ['成像灯', '聚光灯', '染色灯', '追光'] as const
export type FixtureType = (typeof FIXTURE_TYPES)[number]

/** 各灯位的识别色，用于通道标签色块与分组标题 */
export const POSITION_COLORS: Record<FixturePosition, string> = {
  面光: '#f2b544',
  耳光: '#e07b39',
  顶排: '#4ea1f2',
  侧光: '#7c5cf0',
  地排: '#3fbf9f'
}

/** DMX 通道号取值范围 */
export const DMX_CHANNEL_MIN = 1
export const DMX_CHANNEL_MAX = 512

/** 单灯位允许的最大通道数量，超出视为灯位过载 */
export const POSITION_LOAD_LIMIT = 6

/** 灯位通道（Fixture）：一个 DMX 通道与物理灯位的配接记录 */
export interface Fixture {
  /** 主键 */
  id: string
  /** 所属场次 */
  sessionId: string
  /** DMX 通道号 */
  channel: number
  /** 灯位方位 */
  position: FixturePosition
  /** 灯具类型 */
  fixtureType: FixtureType
  /** 色纸编号，例如 `R02` / `L201` */
  gel: string
  /** 配接备注：灯号、吊杆、调光回路等 */
  patchNote: string
  createdAt: number
  updatedAt: number
}

/** 新建 / 编辑灯位通道时提交的字段集合 */
export type FixtureDraft = Omit<Fixture, 'id' | 'createdAt' | 'updatedAt'>

/** 同一场次内重复的通道号 */
export interface ChannelConflict {
  channel: number
  /** 冲突的灯位通道 id 列表 */
  fixtureIds: string[]
  /** 冲突项的展示名，例如 `CH12 · 面光 · 成像灯` */
  labels: string[]
}

/** 单个灯位的通道负载情况 */
export interface PositionLoad {
  position: FixturePosition
  count: number
  limit: number
  overloaded: boolean
}

/** 配接校验结果，由 fixtureStore 统一维护 */
export interface PatchCheckResult {
  conflicts: ChannelConflict[]
  loads: PositionLoad[]
  hasConflict: boolean
  hasOverload: boolean
  checkedAt: number
}

/** 生成一个空的灯位通道草稿 */
export function createEmptyFixtureDraft(sessionId: string, channel = DMX_CHANNEL_MIN): FixtureDraft {
  return {
    sessionId,
    channel,
    position: '面光',
    fixtureType: '成像灯',
    gel: '',
    patchNote: ''
  }
}
