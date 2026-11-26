/**
 * Имена и подписи стратегий Zapret (Windows: `general*.bat` из папки сборки).
 *
 * Чистая логика без Electron — проверяется node-скриптом. Чтение папки —
 * отдельной функцией `readStrategyDir`, ей нужен только `fs`.
 *
 * Зачем проверка: имя стратегии приходит из конфига, профиля `.lazeyka`,
 * IPC и сценариев, а потом файл запускается через `cmd /c` с правами
 * администратора. Поэтому допускается только имя файла (без путей, «..»,
 * разделителей и двоеточий) из списка реально лежащих в папке стратегий.
 */
import { readdirSync, readFileSync } from 'fs'
import path from 'path'

export interface StrategyDescriptor {
  file: string
  title: string
  description: string
}

const STRATEGY_FILE = /^general[^\\/:*?"<>|\0]*\.bat$/i

/** Только синтаксис: имя файла `general….bat` без путей и опасных символов. */
export function isSafeStrategyFileName(name: unknown): name is string {
  if (typeof name !== 'string') return false
  if (name.length === 0 || name.length > 120) return false
  if (name !== name.trim()) return false
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name)) return false
  if (name.includes('..') || name.includes('/') || name.includes('\\') || name.includes(':')) return false
  if (path.win32.basename(name) !== name || path.posix.basename(name) !== name) return false
  return STRATEGY_FILE.test(name)
}

/**
 * Проверка имени по списку стратегий из папки. Сравнение точное — на
 * Windows имена без учёта регистра, но список берётся из той же папки,
 * поэтому выбранное в интерфейсе имя всегда совпадает побайтно.
 */
export function validateStrategyName(name: unknown, available: readonly string[]): string {
  if (!isSafeStrategyFileName(name)) {
    throw new Error('Недопустимое имя стратегии Zapret — выберите стратегию из списка')
  }
  if (!available.includes(name)) {
    throw new Error(`Стратегия «${name.replace(/\.bat$/i, '')}» не найдена в папке Zapret — выберите её заново`)
  }
  return name
}

/** macOS: идентификаторы стратегий вида `general-alt3` (их сопоставляет resolveMacStrategy). */
const MAC_ID = /^[a-z0-9][a-z0-9-]{0,63}$/

/** Проверка без чтения папки — для мест, где папка ещё не известна (macOS принимает и id, и имя .bat). */
export function isAcceptableStrategyValue(name: unknown, platform: NodeJS.Platform): boolean {
  if (platform === 'darwin') return isSafeStrategyFileName(name) || (typeof name === 'string' && MAC_ID.test(name))
  return isSafeStrategyFileName(name)
}

// ---- Подписи --------------------------------------------------------------------

/** Строки-шум в начале .bat: кодовая страница, служебные команды. */
function isNoiseComment(text: string): boolean {
  const t = text.trim()
  if (!t) return true
  if (/^\d{3,5}\s*-\s*(utf|cp|windows|oem|ansi)/i.test(t)) return true // «65001 - UTF-8»
  if (/^chcp\b/i.test(t)) return true
  if (/^@?echo\b/i.test(t)) return true
  if (/^[-=*#_~ ]+$/.test(t)) return true // разделители
  return false
}

/** Первый осмысленный комментарий (`::` / `REM`) в первых строках .bat, иначе ''. */
export function extractBatDescription(text: string): string {
  const head = text.split(/\r?\n/).slice(0, 12)
  for (const line of head) {
    const m = line.match(/^\s*(?:::|REM\b)\s*(.*)$/i)
    if (!m) continue
    const c = m[1].trim()
    if (isNoiseComment(c)) continue
    // Пометка автора сборки Flowseal — по-русски (интерфейс только на русском).
    if (/^not\s+recommended\b/i.test(c)) return 'Flowseal (автор сборки Zapret) помечает её как нерекомендуемую'
    return c.slice(0, 140)
  }
  return ''
}

/** Короткая подпись по названию сборки Flowseal, когда в файле комментария нет. */
export function strategyFamilyLabel(title: string): string {
  const inner = /\(([^)]*)\)/.exec(title)?.[1]?.trim().toUpperCase() ?? ''
  if (!inner) return /^general$/i.test(title.trim()) ? 'Основная стратегия сборки' : ''
  if (/^FAKE TLS AUTO/.test(inner)) return 'Поддельный TLS с автоподбором'
  if (/^SIMPLE FAKE/.test(inner)) return 'Простая подмена пакетов'
  if (/^EXP/.test(inner)) return 'Экспериментальная'
  if (/^ALT/.test(inner)) return 'Запасной вариант'
  return ''
}

const collator = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' })

/** Естественный порядок: ALT2 перед ALT10. */
export function compareStrategyTitles(a: string, b: string): number {
  // Скобки не учитываем: «(FAKE TLS AUTO)» идёт перед «(FAKE TLS AUTO ALT2)».
  const key = (t: string): string => t.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim()
  return collator.compare(key(a), key(b)) || collator.compare(a, b)
}

export function sortStrategies<T extends { title: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => compareStrategyTitles(a.title, b.title))
}

export function describeStrategy(file: string, batText: string): StrategyDescriptor {
  const title = file.replace(/\.bat$/i, '')
  return { file, title, description: extractBatDescription(batText) || strategyFamilyLabel(title) }
}

/** Windows: стратегии из папки (только `general*.bat`, только обычные имена). */
export function readStrategyDir(dir: string): StrategyDescriptor[] {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  const out: StrategyDescriptor[] = []
  for (const f of names) {
    if (!isSafeStrategyFileName(f)) continue
    let text = ''
    try {
      text = readFileSync(path.join(dir, f), 'utf-8')
    } catch {
      /* подпись будет по имени */
    }
    out.push(describeStrategy(f, text))
  }
  return sortStrategies(out)
}

/** Только имена файлов — для проверки. */
export function listStrategyFiles(dir: string): string[] {
  try {
    return readdirSync(dir).filter((f) => isSafeStrategyFileName(f))
  } catch {
    return []
  }
}
