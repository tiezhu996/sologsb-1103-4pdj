import type { Cue } from '@/types/cue'

/** Cue 编号格式：`Q12` 或 `Q12.5` */
export const CUE_NO_PATTERN = /^Q\d+(?:\.\d+)?$/

/** 非法编号的排序权重，保证排到末尾 */
const INVALID_WEIGHT = Number.MAX_SAFE_INTEGER

/** 归一化输入：去空格、补 Q 前缀、统一大写 */
export function normalizeCueNo(raw: string): string {
  const trimmed = raw.trim().toUpperCase().replace(/\s+/g, '')
  if (!trimmed) return ''
  const body = trimmed.startsWith('Q') ? trimmed.slice(1) : trimmed
  return body ? `Q${body}` : ''
}

/** 是否为合法 Cue 编号 */
export function isValidCueNo(raw: string): boolean {
  return CUE_NO_PATTERN.test(normalizeCueNo(raw))
}

/** 解析编号数值，`Q12.5` → `12.5`；非法编号返回最大安全整数 */
export function parseCueNo(raw: string): number {
  const normalized = normalizeCueNo(raw)
  if (!CUE_NO_PATTERN.test(normalized)) return INVALID_WEIGHT
  const value = Number.parseFloat(normalized.slice(1))
  return Number.isFinite(value) ? value : INVALID_WEIGHT
}

/** 按编号自然序比较：`Q2` < `Q10` < `Q10.5` < `Q11` */
export function compareCueNo(a: string, b: string): number {
  const left = parseCueNo(a)
  const right = parseCueNo(b)
  if (left !== right) return left - right
  return a.localeCompare(b)
}

/** 按落库位次排序，位次相同再按编号自然序（不修改入参） */
export function sortCues(input: readonly Cue[]): Cue[] {
  return [...input].sort(
    (a, b) => a.orderIndex - b.orderIndex || compareCueNo(a.cueNo, b.cueNo) || a.createdAt - b.createdAt
  )
}

/** 依据给定顺序重新计算位次映射 */
export function orderIndexMap(orderedIds: readonly string[]): Map<string, number> {
  const map = new Map<string, number>()
  orderedIds.forEach((id, index) => map.set(id, index + 1))
  return map
}

/** 建议的下一个 Cue 编号：现有最大整数编号 + 1 */
export function suggestNextCueNo(existing: readonly string[]): string {
  let max = 0
  existing.forEach((no) => {
    const value = parseCueNo(no)
    if (value < INVALID_WEIGHT) max = Math.max(max, Math.floor(value))
  })
  return `Q${max + 1}`
}

/** 按编号找出新 Cue 应该插入的位次（0 基） */
export function suggestInsertIndex(cues: readonly Cue[], cueNo: string): number {
  const sorted = sortCues(cues)
  const target = parseCueNo(cueNo)
  for (let index = 0; index < sorted.length; index += 1) {
    if (parseCueNo(sorted[index].cueNo) > target) return index
  }
  return sorted.length
}
