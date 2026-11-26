/**
 * Проверка полей формы DNS-сервера прямо при вводе. Без Electron и React —
 * чтобы можно было проверить node-скриптом. Тексты — что именно не так.
 */

const V4_PART = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/

export function isIPv4(v: string): boolean {
  const p = v.split('.')
  return p.length === 4 && p.every((x) => V4_PART.test(x))
}

export function isIPv6(v: string): boolean {
  let s = v
  // Хвост в виде IPv4 (::ffff:1.2.3.4) считается как две группы.
  const lastColon = s.lastIndexOf(':')
  if (s.includes('.') && lastColon >= 0) {
    if (!isIPv4(s.slice(lastColon + 1))) return false
    s = s.slice(0, lastColon + 1) + '0:0'
  }
  if (!/^[0-9a-f:]+$/i.test(s) || s.includes(':::')) return false
  const halves = s.split('::')
  if (halves.length > 2) return false
  const groups = (h: string): string[] => (h === '' ? [] : h.split(':'))
  const a = groups(halves[0])
  const b = halves.length === 2 ? groups(halves[1]) : []
  if ([...a, ...b].some((g) => g.length < 1 || g.length > 4)) return false
  const n = a.length + b.length
  return halves.length === 2 ? n <= 7 : n === 8
}

/** Ошибка поля IPv4 или null. Пустое поле — не ошибка (обязательность проверяется отдельно). */
export function ipv4Error(raw: string): string | null {
  const v = raw.trim()
  if (!v) return null
  if (v.includes(':')) return 'Это адрес IPv6 — его место в блоке IPv6 ниже'
  if (/^https?:\/\//i.test(v) || /[a-z]/i.test(v))
    return 'Нужен IP-адрес из цифр, например 1.1.1.1, а не имя сайта'
  const parts = v.split('.')
  if (parts.length !== 4) return 'Нужно четыре числа через точку, например 1.1.1.1'
  if (parts.some((x) => x === '' || !/^\d+$/.test(x)))
    return 'Между точками должны быть только цифры'
  if (parts.some((x) => Number(x) > 255)) return 'Каждое число — от 0 до 255'
  if (!isIPv4(v)) return 'Лишние нули в начале числа — уберите их'
  return null
}

export function ipv6Error(raw: string): string | null {
  const v = raw.trim()
  if (!v) return null
  if (isIPv4(v)) return 'Это адрес IPv4 — его место в блоке «Адреса» выше'
  if (!v.includes(':')) return 'Адрес IPv6 пишется через двоеточия, например 2606:4700:4700::1111'
  if (!isIPv6(v)) return 'Неверный адрес IPv6, пример: 2606:4700:4700::1111'
  return null
}

/** Шаблон DoH: https-ссылка на сервер. Принимает и запись с {?dns} из инструкций Windows. */
export function dohError(raw: string): string | null {
  const v = raw.trim()
  if (!v) return 'Укажите адрес DoH, например https://dns.example.com/dns-query'
  if (/\s/.test(v)) return 'В адресе не должно быть пробелов'
  if (/^http:\/\//i.test(v)) return 'Нужен https:// — без шифрования DoH не работает'
  if (!/^https:\/\//i.test(v)) return 'Адрес должен начинаться с https://'
  let u: URL
  try {
    u = new URL(v.replace(/\{\?dns\}$/i, ''))
  } catch {
    return 'Не похоже на адрес, пример: https://dns.example.com/dns-query'
  }
  if (!u.hostname.includes('.') && !u.hostname.startsWith('['))
    return 'Не хватает имени сервера, пример: https://dns.example.com/dns-query'
  return null
}

/** Приводит шаблон к виду, который примет главный процесс (убирает {?dns}). */
export const normalizeDoh = (raw: string): string => raw.trim().replace(/\{\?dns\}$/i, '')

export function siteError(raw: string): string | null {
  const v = raw.trim()
  if (!v) return null
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(v) ? v : `https://${v}`)
    if (u.protocol !== 'https:' && u.protocol !== 'http:')
      return 'Ссылка должна начинаться с https://'
    if (!u.hostname.includes('.')) return 'Не похоже на адрес сайта, пример: https://example.com'
    return null
  } catch {
    return 'Не похоже на адрес сайта, пример: https://example.com'
  }
}

export type DnsEnc = 'none' | 'doh' | 'strict'

export interface DnsFormValues {
  name: string
  v4a: string
  v4b: string
  v6a: string
  v6b: string
  doh: string
  site: string
}

export type DnsFormErrors = Partial<Record<keyof DnsFormValues, string>>

export function validateDnsForm(
  f: DnsFormValues,
  enc: DnsEnc,
  opts: { needName: boolean }
): DnsFormErrors {
  const e: DnsFormErrors = {}
  if (opts.needName && !f.name.trim())
    e.name = 'Придумайте название — так сервер будет подписан в списке'
  e.v4a = ipv4Error(f.v4a) ?? (f.v4a.trim() ? undefined : 'Нужен хотя бы основной адрес IPv4')
  e.v4b =
    ipv4Error(f.v4b) ??
    (f.v4b.trim() && f.v4b.trim() === f.v4a.trim() ? 'Совпадает с основным адресом' : undefined)
  e.v6a = ipv6Error(f.v6a) ?? undefined
  e.v6b =
    ipv6Error(f.v6b) ??
    (f.v6b.trim() && f.v6b.trim().toLowerCase() === f.v6a.trim().toLowerCase()
      ? 'Совпадает с основным адресом'
      : undefined)
  if (enc !== 'none') e.doh = dohError(f.doh) ?? undefined
  if (opts.needName) e.site = siteError(f.site) ?? undefined
  for (const k of Object.keys(e) as (keyof DnsFormValues)[]) if (!e[k]) delete e[k]
  return e
}
