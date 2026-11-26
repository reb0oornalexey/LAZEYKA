/**
 * Проверка путей из окна программы: файл должен лежать внутри разрешённой
 * папки. Сравнение по настоящим путям (realpath) — ссылки и «..» не помогут
 * выйти наружу. Без Electron — проверяется node-скриптом.
 */
import { realpathSync } from 'node:fs'
import path from 'node:path'

function canon(p: string): string {
  const r = realpathSync.native(p)
  // Windows: регистр букв в путях не важен.
  return process.platform === 'win32' ? r.toLowerCase() : r
}

/**
 * Путь к существующему файлу `name` внутри `dir` или null.
 * `name` — только имя файла (без папок); результат — настоящий путь.
 */
export function resolveFileInside(dir: string, name: unknown): string | null {
  if (typeof name !== 'string' || !name || name.length > 255) return null
  if (name !== path.basename(name) || name !== path.win32.basename(name) || name === '.' || name === '..') return null
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(name)) return null
  let root: string
  let real: string
  try {
    root = canon(dir)
    real = canon(path.join(dir, name))
  } catch {
    return null
  }
  const prefix = root.endsWith(path.sep) ? root : root + path.sep
  if (!real.startsWith(prefix)) return null
  return realpathSync.native(path.join(dir, name))
}

/**
 * Одноразовое разрешение на путь, выбранный пользователем в системном
 * диалоге: окно может передать обратно только тот файл, что вернул диалог,
 * и только в течение `ttlMs`.
 */
export class PickedPathGrant {
  private granted: { path: string; at: number } | null = null
  constructor(private readonly ttlMs = 10 * 60 * 1000) {}

  grant(p: string): void {
    this.granted = { path: p, at: Date.now() }
  }

  /** Тот же путь, что выдал диалог, и не просрочен. */
  check(p: unknown): string | null {
    const g = this.granted
    if (!g || typeof p !== 'string') return null
    if (Date.now() - g.at > this.ttlMs) return null
    return p === g.path ? g.path : null
  }

  clear(): void {
    this.granted = null
  }
}
