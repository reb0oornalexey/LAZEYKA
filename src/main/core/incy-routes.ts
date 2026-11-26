/**
 * «Исключённые маршруты»: подсети, которые не должны попадать в туннель TUN.
 * Проверка и нормализация списка CIDR — чистые функции без Electron.
 */

import net from 'node:net'

/** Не больше стольких записей: sing-box обходит список на каждый маршрут. */
export const MAX_EXCLUDED_ROUTES = 64

/** `10.1.0.0/16`, `192.168.1.5` (→ /32), `2001:db8::/32`; иначе null. */
export function normalizeCidr(raw: string): string | null {
  const value = String(raw ?? '').trim()
  if (!value || value.length > 64) return null
  const [ip, prefix, extra] = value.split('/')
  if (extra !== undefined) return null
  const family = net.isIP(ip)
  if (family === 0) return null
  const max = family === 6 ? 128 : 32
  if (prefix === undefined) return `${family === 6 ? ip.toLowerCase() : ip}/${max}`
  if (!/^\d{1,3}$/.test(prefix)) return null
  const n = Number(prefix)
  if (n > max) return null
  return `${family === 6 ? ip.toLowerCase() : ip}/${n}`
}

export interface RoutesCheck {
  /** Нормализованные, без повторов, не больше лимита. */
  valid: string[]
  /** Записи, которые не удалось разобрать (в исходном виде). */
  invalid: string[]
  /** Сколько записей отброшено из-за лимита. */
  overflow: number
}

/** Разобрать список (массив или текст через перевод строки, запятую, `;`). */
export function checkExcludedRoutes(input: string[] | string | undefined | null): RoutesCheck {
  const items = Array.isArray(input) ? input : String(input ?? '').split(/[\s,;]+/)
  const valid: string[] = []
  const invalid: string[] = []
  let overflow = 0
  for (const item of items) {
    const text = String(item ?? '').trim()
    if (!text) continue
    const n = normalizeCidr(text)
    if (!n) {
      invalid.push(text)
      continue
    }
    if (valid.includes(n)) continue
    if (valid.length >= MAX_EXCLUDED_ROUTES) {
      overflow++
      continue
    }
    valid.push(n)
  }
  return { valid, invalid, overflow }
}
