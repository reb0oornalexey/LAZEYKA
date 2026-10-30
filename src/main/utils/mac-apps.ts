/**
 * macOS: приложения для списка ExitLag.
 *
 * На Windows правило — имя процесса (`cs2.exe`). На Mac приложение — это
 * бандл `X.app`, а трафик делают не только его главный файл, но и
 * вспомогательные процессы: сеть Chrome идёт из «Google Chrome Helper», а не
 * из «Google Chrome». Правило по имени главного файла такой трафик не ловит.
 * Поэтому запись списка ExitLag на macOS — это либо ПУТЬ (бандл `.app`,
 * каталог или файл; совпадает со всем, что лежит внутри), либо имя процесса
 * (для тех, чей трафик идёт из чужого бандла, например `com.apple.WebKit.Networking`
 * у Safari). Список процессов собирается по образцу ProcessList.cs из Tunor.
 */
import { execFile } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export interface MacAppEntry {
  /** Название для показа: имя бандла без `.app` или имя файла. */
  title: string
  /** Бандл `.app` или путь к исполняемому файлу. */
  path: string
  /** Что записать в список ExitLag. */
  rule: string
  /** Исполняемые файлы внутри (запущенные — для списка «из запущенных»). */
  names: string[]
  /** Установленное пользователем приложение, а не часть системы. */
  isApp: boolean
}

/** Внешний `.app` в пути (вложенные бандлы помощников принадлежат ему), либо null. */
export function outerBundle(p: string): string | null {
  const at = p.toLowerCase().indexOf('.app/')
  if (at >= 0) return p.slice(0, at + 4)
  return p.toLowerCase().endsWith('.app') ? p : null
}

/** Часть macOS, а не установленное приложение. */
export function isSystemMacPath(p: string): boolean {
  const l = p.toLowerCase()
  return (
    l.startsWith('/system/') ||
    (l.startsWith('/usr/') && !l.startsWith('/usr/local/')) ||
    l.startsWith('/bin/') ||
    l.startsWith('/sbin/') ||
    l.startsWith('/library/apple/') ||
    l.startsWith('/library/privilegedhelpertools/') ||
    l.includes('.xpc/') ||
    l.includes('.systemextension/') ||
    l.includes('.appex/')
  )
}

/** Главное имя приложения первым — список читается как «его собственный». */
function orderNames(names: string[], title: string): string[] {
  return [...names].sort((a, b) => {
    const ta = a.toLowerCase() === title.toLowerCase() ? 0 : 1
    const tb = b.toLowerCase() === title.toLowerCase() ? 0 : 1
    return ta - tb || a.localeCompare(b, undefined, { sensitivity: 'base' })
  })
}

/** Пути процессов из `ps -axo comm=` → приложения (по бандлам). */
export function groupProcessPaths(lines: string[]): MacAppEntry[] {
  const map = new Map<string, MacAppEntry>()
  for (const raw of lines) {
    const p = raw.trim()
    if (!p.startsWith('/')) continue
    const exe = path.posix.basename(p)
    if (!exe) continue
    const bundle = outerBundle(p)
    let entry: MacAppEntry | undefined
    if (bundle) {
      const key = bundle.toLowerCase()
      entry = map.get(key)
      if (!entry) {
        const title = path.posix.basename(bundle).replace(/\.app$/i, '')
        entry = { title, path: bundle, rule: bundle, names: [], isApp: !isSystemMacPath(bundle) }
        map.set(key, entry)
      }
    } else {
      // Одиночные файлы — только пользовательские (брю, свои сборки), не демоны системы.
      if (isSystemMacPath(p) || !/^(\/users\/|\/opt\/|\/usr\/local\/)/i.test(p)) continue
      entry = map.get(p.toLowerCase())
      if (!entry) {
        entry = { title: exe, path: p, rule: p, names: [], isApp: false }
        map.set(p.toLowerCase(), entry)
      }
    }
    if (!entry.names.includes(exe)) entry.names.push(exe)
  }
  return [...map.values()]
    .map((e) => ({ ...e, names: orderNames(e.names, e.title) }))
    .sort((a, b) => Number(b.isApp) - Number(a.isApp) || a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }))
}

function run(file: string, args: string[], timeout = 8000): Promise<string> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => resolve(err ? '' : String(stdout)))
  })
}

/** Запущенные приложения, сгруппированные по бандлам. */
export async function collectRunningMacApps(): Promise<MacAppEntry[]> {
  const out = await run('/bin/ps', ['-axo', 'comm='])
  if (!out) return []
  return groupProcessPaths(out.split('\n'))
}

/** Имена запущенных процессов (последний компонент пути, нижний регистр) — `ps -axo comm=`. */
export async function listRunningProcessNames(): Promise<string[]> {
  const out = await run('/bin/ps', ['-axo', 'comm='])
  const names = new Set<string>()
  for (const line of out.split('\n')) {
    const base = path.posix.basename(line.trim())
    if (base) names.add(base.toLowerCase())
  }
  return [...names]
}

function filesIn(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() || e.isSymbolicLink())
      .map((e) => e.name)
      .filter((n) => !n.startsWith('.'))
  } catch {
    return []
  }
}

/**
 * Исполняемые файлы бандла: `Contents/MacOS/*` и то же у вложенных
 * приложений-помощников (`…/Helpers/X Helper.app`, `.xpc`, LoginItems) — трафик
 * может идти из любого из них.
 */
export function bundleExecutables(bundlePath: string): string[] {
  const names = new Set<string>()
  const addMacOs = (root: string): void => {
    for (const n of filesIn(path.join(root, 'Contents', 'MacOS'))) names.add(n)
  }
  addMacOs(bundlePath)
  let visited = 0
  const walk = (dir: string, depth: number): void => {
    if (depth > 6 || visited > 4000) return
    let entries: import('node:fs').Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      visited++
      // Символьные ссылки (Versions/Current) не обходим — иначе дубли и циклы.
      if (!e.isDirectory()) continue
      const full = path.join(dir, e.name)
      if (/\.(app|xpc)$/i.test(e.name)) addMacOs(full)
      if (e.name === 'Resources' || e.name === 'PlugIns' || e.name === 'MacOS') continue
      walk(full, depth + 1)
    }
  }
  walk(path.join(bundlePath, 'Contents'), 0)
  return orderNames([...names], path.basename(bundlePath).replace(/\.app$/i, ''))
}

/** Имя главного файла бандла из Info.plist (`CFBundleExecutable`). */
export async function bundleMainExecutable(bundlePath: string): Promise<string | null> {
  const plist = path.join(bundlePath, 'Contents', 'Info.plist')
  if (!existsSync(plist)) return null
  const out = (await run('/usr/bin/plutil', ['-extract', 'CFBundleExecutable', 'raw', '-o', '-', plist], 4000)).trim()
  return out || null
}

/** Что выбрано в диалоге «Обзор»: приложение-бандл или одиночный файл. */
export async function describePickedPath(picked: string): Promise<{ rule: string; title: string; names: string[] } | null> {
  const bundle = outerBundle(picked)
  if (bundle && existsSync(bundle)) {
    const title = path.basename(bundle).replace(/\.app$/i, '')
    const names = bundleExecutables(bundle)
    const main = await bundleMainExecutable(bundle)
    if (main && !names.includes(main)) names.unshift(main)
    return { rule: bundle, title, names }
  }
  try {
    if (!statSync(picked).isFile()) return null
  } catch {
    return null
  }
  const name = path.basename(picked)
  return { rule: picked, title: name, names: [name] }
}

// ---- записи списка ExitLag ------------------------------------------------------

export function expandHome(p: string): string {
  return p === '~' ? os.homedir() : p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p
}

/**
 * Запись списка → каноничный вид: абсолютный путь (для бандла — до внешнего
 * `.app`, без завершающего `/`) либо имя процесса без пути.
 */
export function normalizeMacEntry(raw: string): string | null {
  let v = expandHome(String(raw ?? '').trim())
  if (!v) return null
  if (v.startsWith('/')) {
    v = v.replace(/\/+$/, '')
    return outerBundle(v) ?? (v || null)
  }
  // «Discord.app» без пути — приложение из /Applications, если оно там есть.
  if (/\.app$/i.test(v) && !v.includes('/')) {
    const inApps = path.join('/Applications', v)
    return existsSync(inApps) ? inApps : v.replace(/\.app$/i, '')
  }
  const base = v.split('/').pop()?.trim() ?? ''
  return base || null
}

export function normalizeMacPerAppList(list?: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of list ?? []) {
    const e = normalizeMacEntry(raw)
    if (!e) continue
    const key = e.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(e)
  }
  return out
}

const RE_ESC = /[.*+?^${}()|[\]\\]/g
const esc = (s: string): string => s.replace(RE_ESC, '\\$&')

/**
 * Одно регулярное выражение для `process_path_regex` (Go RE2, без учёта
 * регистра): пути совпадают со всем содержимым каталога, имена — с последним
 * компонентом пути процесса.
 */
export function macEntriesRegex(entries: string[]): string {
  const paths = entries.filter((e) => e.startsWith('/')).map(esc)
  const names = entries.filter((e) => !e.startsWith('/')).map(esc)
  const parts: string[] = []
  if (paths.length > 0) parts.push(`^(?:${paths.join('|')})(?:/|$)`)
  if (names.length > 0) parts.push(`(?:^|/)(?:${names.join('|')})$`)
  return `(?i)(?:${parts.join('|')})`
}

/** Тот же отбор, что делает регулярное выражение — для окна «в списке» и проверки ExitLag. */
export function macEntryMatches(entry: string, procPath: string): boolean {
  const p = procPath.toLowerCase()
  const e = entry.toLowerCase()
  if (e.startsWith('/')) return p === e || p.startsWith(`${e}/`)
  return p === e || p.endsWith(`/${e}`)
}

/** Клиенты Telegram (бандл или имя) — им нужен путь локального TgWsProxy. */
const MAC_TELEGRAM = new Set(['telegram', 'telegram desktop', 'ayugram', 'kotatogram', '64gram', 'unigram', 'materialgram'])

export function isMacTelegramEntry(entry: string): boolean {
  const base = path.posix.basename(entry).replace(/\.app$/i, '').toLowerCase()
  return MAC_TELEGRAM.has(base)
}
