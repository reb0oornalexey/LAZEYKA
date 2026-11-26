import { platform } from '@renderer/utils/init'

/**
 * Записи списка ExitLag.
 *
 * Windows — имя процесса (`discord.exe`). macOS — путь (бандл `.app`, каталог
 * или файл: совпадает со всем внутри) либо имя процесса без `.exe`.
 */
export const isMacPlatform = platform === 'darwin'
export const isLinuxPlatform = platform === 'linux'
export const usesExecutablePaths = isMacPlatform || isLinuxPlatform

/** Как показать запись: на Mac — имя приложения без пути и `.app`. */
export function appLabel(entry: string): string {
  if (!usesExecutablePaths) return entry
  const base = entry.replace(/\/+$/, '').split('/').pop() || entry
  return base.replace(/\.app$/i, '')
}

/** Запись списка относится к процессу `name` (на Mac — с путём бандла/файла `rule`)? */
export function entryMatchesProc(entry: string, name: string, rule?: string): boolean {
  const e = entry.toLowerCase()
  if (!usesExecutablePaths) {
    // Как normalizePerAppList в ядре: запись может быть полным путём или именем
    // без .exe (сценарии, ссылки lazeyka://) — сравниваем имя файла с .exe.
    const base = e.split(/[\\/]/).pop()?.trim() ?? ''
    return Boolean(base) && (/\.exe$/.test(base) ? base : `${base}.exe`) === name.toLowerCase()
  }
  const r = (rule ?? name).toLowerCase()
  if (e.startsWith('~/')) {
    // Путь от домашней папки: ядро раскрывает «~», здесь домашней папки нет —
    // сверяем хвост пути у процесса из /Users/<имя>.
    if (r === e || r.startsWith(`${e}/`)) return true
    const rest = e.slice(1)
    const m = /^\/(?:users|home)\/[^/]+(\/.*)$/.exec(r)
    return Boolean(m) && (m![1] === rest || m![1].startsWith(`${rest}/`))
  }
  if (e.startsWith('/')) return r === e || r.startsWith(`${e}/`)
  return e === name.toLowerCase() || r.endsWith(`/${e}`)
}

export function listHasProc(entries: string[], name: string, rule?: string): boolean {
  return entries.some((e) => entryMatchesProc(e, name, rule))
}
