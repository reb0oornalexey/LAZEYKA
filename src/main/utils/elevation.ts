import { execFile } from 'child_process'
import { app } from 'electron'
import { promisify } from 'util'

const execFilePromise = promisify(execFile)

let isAdminCached: boolean | null = null

export async function isRunningAsAdmin(): Promise<boolean> {
  if (isAdminCached !== null) {
    return isAdminCached
  }

  // macOS/Linux: «админ» — это root (uid 0). Обычный пользователь на Mac
  // работает без повышения; привилегированные операции — через root-хелпер
  // (следующий этап порта).
  if (process.platform !== 'win32') {
    isAdminCached = process.getuid?.() === 0
    return isAdminCached
  }

  // 1. fltmc.exe is the most reliable check across all Windows editions and tweaks
  try {
    await execFilePromise('fltmc.exe', [], { timeout: 2000 })
    isAdminCached = true
    return true
  } catch { /* proceed to next check */ }

  // 2. fsutil check
  try {
    await execFilePromise('fsutil.exe', ['dirty', 'query', process.env.SystemDrive || 'C:'], { timeout: 2000 })
    isAdminCached = true
    return true
  } catch { /* proceed to next check */ }

  // 3. net session fallback
  try {
    await execFilePromise('net.exe', ['session'], { timeout: 2000 })
    isAdminCached = true
    return true
  } catch {
    isAdminCached = false
    return false
  }
}


/** Флаг, который получает перезапущенная с повышением копия: защита от бесконечного цикла. */
export const ELEVATED_FLAG = '--lazeyka-elevated'

/** Аргумент командной строки Windows: в кавычки, если есть пробелы/кавычки. */
function quoteWinArg(a: string): string {
  if (a !== '' && !/[\s"]/.test(a)) return a
  return `"${a.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`
}

/** Строка PowerShell в одинарных кавычках. */
function psQuote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`
}

/**
 * Перезапускает приложение с правами администратора через UAC.
 * Возвращает true, если повышенная копия запущена (текущей пора выходить);
 * false — пользователь отказал в UAC или запуск не удался.
 *
 * Блокировку единственного экземпляра отпускаем ДО запуска: повышенная копия
 * стартует, пока мы ещё живы, и иначе сама бы увидела «уже запущено» и вышла.
 */
export async function relaunchElevated(): Promise<boolean> {
  // macOS: перезапуска с повышением нет — root-хелпер появится в следующем этапе.
  if (process.platform !== 'win32') return false
  const args = [...process.argv.slice(1).filter((a) => a !== ELEVATED_FLAG), ELEVATED_FLAG]
  const argList = args.map((a) => psQuote(quoteWinArg(a))).join(',')
  const command =
    `Start-Process -FilePath ${psQuote(process.execPath)} -ArgumentList @(${argList}) -Verb RunAs -ErrorAction Stop`
  try {
    app.releaseSingleInstanceLock()
  } catch { /* не критично */ }
  try {
    await execFilePromise(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', command],
      { windowsHide: true, timeout: 120000 }
    )
    return true
  } catch {
    // Отказ в UAC (Start-Process бросает исключение) или PowerShell недоступен.
    return false
  }
}
