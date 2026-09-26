/** 触发浏览器下载一个纯文本文件 */
export function downloadTextFile(filename: string, text: string): void {
  const blob = new Blob([`\uFEFF${text}`], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

/** 由排演表编号与生成时间拼出导出文件名 */
export function buildSheetFilename(sheetNo: string, generatedAt: string): string {
  const date = new Date(generatedAt)
  const stamp = Number.isNaN(date.getTime())
    ? generatedAt.replace(/[^\d]/g, '').slice(0, 14)
    : `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`
  const safeNo = sheetNo.replace(/[^\w-]/g, '_')
  return `排演表_${safeNo}_${stamp}.txt`
}

/** 复制文本到剪贴板，失败时回退到 execCommand */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 继续走回退方案
  }
  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(textarea)
    return ok
  } catch {
    return false
  }
}
