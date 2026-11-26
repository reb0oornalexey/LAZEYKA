/**
 * Проверка названия темы для галереи — то же правило, что в главном процессе
 * (src/main/core/hub-pure.ts, themeNameProblem) и на сервере Hub.
 */
import { BUILTIN_PRESETS } from '@renderer/lib/appearance/presets'

const norm = (s: string): string => s.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim()

/** Почему название не подходит, или null. */
export function themeNameProblem(raw: string): string | null {
  const name = raw.trim()
  if (name.length < 3) return 'Название — от 3 знаков'
  if (name.length > 40) return 'Название — до 40 знаков'
  if (BUILTIN_PRESETS.some((p) => norm(p.name) === norm(name))) return 'Так называется встроенная тема — придумайте своё название'
  return null
}
