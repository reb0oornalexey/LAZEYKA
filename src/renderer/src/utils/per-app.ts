import { platform } from '@renderer/utils/init'

/**
 * Записи списка ExitLag.
 *
 * Windows — имя процесса (`discord.exe`). macOS — путь (бандл `.app`, каталог
 * или файл: совпадает со всем внутри) либо имя процесса без `.exe`.
 */
export const isMacPlatform = platform === 'darwin'

/** Как показать запись: на Mac — имя приложения без пути и `.app`. */
export function appLabel(entry: string): string {
  if (!isMacPlatform) return entry
  const base = entry.replace(/\/+$/, '').split('/').pop() || entry
  return base.replace(/\.app$/i, '')
}

/** Запись списка относится к процессу `name` (на Mac — с путём бандла/файла `rule`)? */
export function entryMatchesProc(entry: string, name: string, rule?: string): boolean {
  const e = entry.toLowerCase()
  if (!isMacPlatform) return e === name.toLowerCase()
  const r = (rule ?? name).toLowerCase()
  if (e.startsWith('/') || e.startsWith('~/')) return r === e || r.startsWith(`${e}/`)
  return e === name.toLowerCase() || r.endsWith(`/${e}`)
}

export function listHasProc(entries: string[], name: string, rule?: string): boolean {
  return entries.some((e) => entryMatchesProc(e, name, rule))
}
