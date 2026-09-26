import Dexie, { type Table } from 'dexie'
import type { Cue } from '@/types/cue'
import type { Fixture } from '@/types/fixture'
import type { CueLevel } from '@/types/level'
import type { RehearsalSheet } from '@/types/sheet'
import type { Session } from '@/types/session'

/** IndexedDB 数据库名 */
export const DB_NAME = 'gbcuesheet'
/** 当前数据结构版本号，与 db.version() 对应 */
export const DB_VERSION = 2

/** 单键值元数据表，记录结构版本等本地状态 */
export interface AppMetaRecord {
  key: string
  value: string
  updatedAt: number
}

/**
 * 浏览器本地持久化：IndexedDB（Dexie）。
 * - v1：场次 / 灯位通道 / Cue / 通道电平 / 排演表 五张表
 * - v2：场次补充 updatedAt 索引、排演表补充 sheetNo 索引与条目快照、新增 appMeta 元数据表，
 *       并对既有数据执行升级迁移（补齐字段、规范化遗留编号）
 */
export class CueSheetDatabase extends Dexie {
  sessions!: Table<Session, string>
  fixtures!: Table<Fixture, string>
  cues!: Table<Cue, string>
  levels!: Table<CueLevel, string>
  sheets!: Table<RehearsalSheet, string>
  appMeta!: Table<AppMetaRecord, string>

  constructor() {
    super(DB_NAME)

    this.version(1).stores({
      sessions: 'id, order, createdAt',
      fixtures: 'id, sessionId, channel, [sessionId+channel]',
      cues: 'id, sessionId, cueNo, orderIndex, [sessionId+orderIndex]',
      levels: 'id, cueId, fixtureId, [cueId+fixtureId]',
      sheets: 'id, sessionId, generatedAt'
    })

    this.version(2)
      .stores({
        sessions: 'id, order, createdAt, updatedAt',
        fixtures: 'id, sessionId, channel, [sessionId+channel]',
        cues: 'id, sessionId, cueNo, orderIndex, [sessionId+orderIndex]',
        levels: 'id, cueId, fixtureId, [cueId+fixtureId]',
        sheets: 'id, sessionId, sheetNo, generatedAt',
        appMeta: 'key'
      })
      .upgrade(async (transaction) => {
        const now = Date.now()
        await transaction
          .table('sessions')
          .toCollection()
          .modify((session: Session) => {
            if (!session.updatedAt) session.updatedAt = session.createdAt || now
            if (typeof session.order !== 'number') session.order = 1
          })
        await transaction
          .table('cues')
          .toCollection()
          .modify((cue: Cue) => {
            if (typeof cue.orderIndex !== 'number') cue.orderIndex = 1
            if (typeof cue.holdSec !== 'number') cue.holdSec = 0
          })
        await transaction
          .table('sheets')
          .toCollection()
          .modify((sheet: RehearsalSheet) => {
            if (!sheet.sheetNo) sheet.sheetNo = 'RS-LEGACY'
            if (!Array.isArray(sheet.cueLines)) sheet.cueLines = []
            if (!Array.isArray(sheet.includedCueIds)) sheet.includedCueIds = []
          })
      })
  }
}

/** 全局唯一的数据库实例 */
export const db = new CueSheetDatabase()

/** 读取元数据 */
export async function readMeta(key: string): Promise<string | null> {
  const record = await db.appMeta.get(key)
  return record ? record.value : null
}

/** 写入元数据 */
export async function writeMeta(key: string, value: string): Promise<void> {
  await db.appMeta.put({ key, value, updatedAt: Date.now() })
}

/** 清空全部本地数据（含结构版本回落重开） */
export async function clearAllData(): Promise<void> {
  await db.transaction('rw', [db.sessions, db.fixtures, db.cues, db.levels, db.sheets, db.appMeta], async () => {
    await Promise.all([
      db.sessions.clear(),
      db.fixtures.clear(),
      db.cues.clear(),
      db.levels.clear(),
      db.sheets.clear(),
      db.appMeta.clear()
    ])
  })
}
