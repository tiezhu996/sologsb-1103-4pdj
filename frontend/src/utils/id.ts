/**
 * 本地主键生成：前缀 + 时间戳（36 进制）+ 随机串，保证同毫秒内多次创建也不冲突。
 */
export function createId(prefix: string): string {
  const time = Date.now().toString(36)
  const random = Math.random().toString(36).slice(2, 8).padEnd(6, '0')
  return `${prefix}_${time}${random}`
}
