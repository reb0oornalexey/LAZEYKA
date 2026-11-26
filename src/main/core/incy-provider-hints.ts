/**
 * Управление от провайдера подписки через HTTP-заголовки ответа.
 *
 * Чистые функции без Electron: заголовки на входе, структуры на выходе. Что с
 * ними делать (сохранить, применить к узлам, показать) решает движок.
 *
 * Принцип: заголовок — подсказка, а не команда. Провайдер может включить
 * фрагментацию для своих узлов, но не может отключить то, что пользователь
 * включил сам, и пользователь одним переключателем отказывается от всех
 * подсказок (`ignoreProviderSettings`).
 */

import net from 'node:net'
import type { IncyRoutingProfile, IncyRoutingRule } from './incy-engine'
import { sanitizeFragmentPackets, sanitizeRange } from './incy-links'

export type HeaderBag = Record<string, string | string[] | undefined>

export interface ProviderFragmentHint {
  enabled: boolean
  packets?: string
  length?: string
  interval?: string
}

export interface ProviderNoiseHint {
  enabled: boolean
  type?: 'rand' | 'str' | 'hex'
  packet?: string
  delay?: string
}

export interface ProviderResolveHint {
  enabled: boolean
  /** Адрес DoH-сервера (https). */
  dohUrl?: string
  /** IP DoH-сервера — чтобы не искать его имя обычным DNS. */
  dohIp?: string
}

export interface ProviderHints {
  fragment?: ProviderFragmentHint
  noises?: ProviderNoiseHint
  resolve?: ProviderResolveHint
}

export type SortOrderHint = 'none' | 'ping' | 'name'

function header(h: HeaderBag, name: string): string | undefined {
  const v = h[name]
  const s = Array.isArray(v) ? v[0] : v
  const t = s === undefined ? '' : String(s).trim()
  return t === '' ? undefined : t
}

function flag(v: string | undefined): boolean | undefined {
  if (v === undefined) return undefined
  if (/^(1|true|yes|on)$/i.test(v)) return true
  if (/^(0|false|no|off)$/i.test(v)) return false
  return undefined
}

/** Строка noises-packet для rand — диапазон длины; для str/hex — сами данные. */
function sanitizeNoisePacket(type: 'rand' | 'str' | 'hex' | undefined, raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined
  if (type === 'str') return raw.length <= 256 ? raw : undefined
  if (type === 'hex') {
    const h = raw.replace(/\s+/g, '')
    return /^[0-9a-fA-F]{2,512}$/.test(h) && h.length % 2 === 0 ? h : undefined
  }
  return sanitizeRange(raw) ?? undefined
}

/** DoH-адрес: только https, без логина, с настоящим именем хоста. */
export function sanitizeDohUrl(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined
  let u: URL
  try {
    u = new URL(String(raw).trim())
  } catch {
    return undefined
  }
  if (u.protocol !== 'https:' || u.username || u.password || !u.hostname) return undefined
  return u.toString()
}

/** Подсказки фрагментации / шумов / защищённого DNS из заголовков. */
export function parseProviderHints(h: HeaderBag): ProviderHints | undefined {
  const hints: ProviderHints = {}

  const fragEnable = flag(header(h, 'fragmentation-enable'))
  if (fragEnable !== undefined) {
    const packets = sanitizeFragmentPackets(header(h, 'fragmentation-packets'))
    const length = sanitizeRange(header(h, 'fragmentation-length'))
    const interval = sanitizeRange(header(h, 'fragmentation-interval'))
    hints.fragment = {
      enabled: fragEnable,
      ...(packets ? { packets } : {}),
      ...(length ? { length } : {}),
      ...(interval ? { interval } : {})
    }
  }

  const noiseEnable = flag(header(h, 'noises-enable'))
  if (noiseEnable !== undefined) {
    const t = header(h, 'noises-type')?.toLowerCase()
    const type = t === 'rand' || t === 'str' || t === 'hex' ? t : undefined
    const packet = sanitizeNoisePacket(type ?? 'rand', header(h, 'noises-packet'))
    const delay = sanitizeRange(header(h, 'noises-delay'))
    hints.noises = {
      enabled: noiseEnable,
      ...(type ? { type } : {}),
      ...(packet ? { packet } : {}),
      ...(delay ? { delay } : {})
    }
  }

  const resolveEnable = flag(header(h, 'server-address-resolve-enable'))
  if (resolveEnable !== undefined) {
    const dohUrl = sanitizeDohUrl(header(h, 'server-address-resolve-dns-domain'))
    const ipRaw = header(h, 'server-address-resolve-dns-ip')
    const dohIp = ipRaw && net.isIP(ipRaw) ? ipRaw : undefined
    hints.resolve = {
      enabled: resolveEnable,
      ...(dohUrl ? { dohUrl } : {}),
      ...(dohIp ? { dohIp } : {})
    }
  }

  return hints.fragment || hints.noises || hints.resolve ? hints : undefined
}

/** Короткое описание для карточки подписки: «фрагментация tlshello 100-200 …». */
export function describeProviderHints(hints: ProviderHints | undefined): string {
  if (!hints) return ''
  const parts: string[] = []
  const f = hints.fragment
  if (f?.enabled) {
    parts.push(
      ['фрагментация', f.packets, f.length, f.interval ? `${f.interval} мс` : undefined].filter(Boolean).join(' ')
    )
  }
  const n = hints.noises
  if (n?.enabled) {
    parts.push(['шумовые пакеты', n.type, n.type === 'rand' || !n.type ? n.packet : undefined, n.delay ? `${n.delay} мс` : undefined].filter(Boolean).join(' '))
  }
  const r = hints.resolve
  if (r?.enabled) parts.push('поиск адреса сервера через защищённый DNS')
  return parts.join('; ')
}

export function parseSortOrder(h: HeaderBag): SortOrderHint | undefined {
  const v = header(h, 'sort-order')?.toLowerCase()
  return v === 'none' || v === 'ping' || v === 'name' ? v : undefined
}

/** Текст из заголовка: простой или `base64:…`. */
export function decodeHeaderText(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  if (raw.startsWith('base64:')) {
    try {
      const t = Buffer.from(raw.slice(7), 'base64').toString('utf-8').trim()
      return t || undefined
    } catch {
      return raw
    }
  }
  return raw
}

/** Ссылка, которую можно открыть из приложения: только http / https. */
export function safeHttpUrl(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined
  try {
    const u = new URL(String(raw).trim())
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : undefined
  } catch {
    return undefined
  }
}

function isLocalHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase()
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true
  if (net.isIPv4(h)) {
    const [a, b] = h.split('.').map(Number)
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
  }
  if (net.isIPv6(h)) return h === '::1' || h === '::' || /^f[cd]/.test(h) || /^fe80/.test(h)
  return false
}

/**
 * Новый адрес подписки из `new-url` / `new-domain`.
 *
 * Правила: только https, без логина в адресе, не на локальный хост; `new-url`
 * сильнее `new-domain`; при `new-domain` путь и query прежние. Возвращает null,
 * если переноса нет или он невалиден (тогда адрес не меняется).
 */
export function resolveSubscriptionMove(currentUrl: string, h: HeaderBag): string | null {
  let cur: URL
  try {
    cur = new URL(currentUrl)
  } catch {
    return null
  }

  const accept = (u: URL): string | null => {
    if (u.protocol !== 'https:' || u.username || u.password || !u.hostname || isLocalHost(u.hostname)) return null
    const next = u.toString()
    return next === cur.toString() ? null : next
  }

  const newUrl = header(h, 'new-url')
  if (newUrl) {
    try {
      const r = accept(new URL(newUrl))
      if (r) return r
    } catch {
      /* битый new-url — пробуем new-domain */
    }
  }
  const newDomain = header(h, 'new-domain')
  if (newDomain) {
    if (!/^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:\d{1,5})?$/.test(newDomain)) return null
    try {
      const u = new URL(cur.toString())
      u.protocol = 'https:'
      u.host = newDomain
      return accept(u)
    } catch {
      return null
    }
  }
  return null
}

// ---- Профиль маршрутизации от провайдера -------------------------------------

export type RoutingSource =
  | { kind: 'inline'; profile: Record<string, unknown> }
  | { kind: 'url'; url: string }

const MAX_PROFILE_RULES = 300

function decodeProfileJson(text: string): Record<string, unknown> | null {
  const t = text.trim()
  if (!t) return null
  const candidates: string[] = []
  if (t.startsWith('{')) candidates.push(t)
  try {
    candidates.push(Buffer.from(t.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8'))
  } catch {
    /* не base64 */
  }
  for (const c of candidates) {
    try {
      const parsed: unknown = JSON.parse(c)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
    } catch {
      /* следующий вариант */
    }
  }
  return null
}

/**
 * Заголовок `routing` (base64 профиля или ссылка) / `autorouting` (ссылка с
 * `incy://autorouting/onadd/…`). Возвращает либо готовый профиль, либо адрес,
 * который нужно скачать. Всё остальное — null.
 */
export function parseRoutingHeader(h: HeaderBag): RoutingSource | null {
  const raw = header(h, 'routing') ?? header(h, 'autorouting')
  if (!raw) return null
  let payload = raw.trim()
  const link = /^[a-z][a-z0-9+.-]*:\/\/(?:auto)?routing\/(?:onadd|add)\/(.+)$/is.exec(payload)
  if (link) payload = link[1].trim()
  else {
    const short = /^[a-z][a-z0-9+.-]*:\/\/(?:onadd|routing)\/(.+)$/is.exec(payload)
    if (short) payload = short[1].trim()
  }
  if (/^https:\/\//i.test(payload)) {
    try {
      const u = new URL(payload)
      if (u.protocol === 'https:' && !u.username && !u.password && !isLocalHost(u.hostname)) {
        return { kind: 'url', url: u.toString() }
      }
    } catch {
      /* битый адрес */
    }
    return null
  }
  if (/^http:\/\//i.test(payload) || /^incy:/i.test(payload)) return null
  const profile = decodeProfileJson(payload)
  return profile ? { kind: 'inline', profile } : null
}

/** Тело, скачанное по адресу из `autorouting`: JSON или base64 от JSON. */
export function parseRoutingBody(body: string): Record<string, unknown> | null {
  return decodeProfileJson(body)
}

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean) : []
}

/** Запись списка INCY → значение правила LAZEYKA; null — формат не поддерживается. */
function ruleValue(entry: string): string | null {
  const e = entry.trim()
  if (!e || e.length > 253) return null
  if (/^(keyword|regexp):/i.test(e)) return null
  if (/^(domain|full):/i.test(e)) return e.replace(/^(domain|full):/i, '') || null
  if (/^(geosite|geoip):/i.test(e)) return e
  if (/\s/.test(e)) return null
  return e
}

/**
 * Профиль INCY (JSON с DirectSites / ProxySites / … ) → профиль маршрутизации
 * LAZEYKA. Переносятся только списки и признак GlobalProxy; DNS, геобазы и
 * подмена hosts провайдера не применяются — это отдельные настройки туннеля.
 */
export function routingProfileFromProvider(
  src: Record<string, unknown>,
  id: string,
  title: string
): IncyRoutingProfile | null {
  const groups: [string, IncyRoutingRule['action']][] = [
    ['BlockSites', 'block'],
    ['BlockIp', 'block'],
    ['DirectSites', 'direct'],
    ['DirectIp', 'direct'],
    ['ProxySites', 'proxy'],
    ['ProxyIp', 'proxy']
  ]
  const rules: IncyRoutingRule[] = []
  const seen = new Set<string>()
  let skipped = 0
  for (const [key, action] of groups) {
    for (const entry of strList(src[key])) {
      const value = ruleValue(entry)
      if (!value) {
        skipped++
        continue
      }
      const dedupe = `${action}|${value.toLowerCase()}`
      if (seen.has(dedupe)) continue
      if (rules.length >= MAX_PROFILE_RULES) {
        skipped++
        continue
      }
      seen.add(dedupe)
      rules.push({ id: `${id}-${rules.length + 1}`, value, action, enabled: true })
    }
  }
  const hasKnownKeys = groups.some(([k]) => Array.isArray(src[k])) || typeof src.GlobalProxy === 'string'
  if (!hasKnownKeys) return null

  // GlobalProxy=false — «через VPN только список ProxySites/ProxyIp»: остальное
  // идёт напрямую, а это ровно режим «Напрямую» с правилами пользователя выше.
  const globalProxy = String(src.GlobalProxy ?? 'true').toLowerCase() !== 'false'
  const providerName = typeof src.Name === 'string' && src.Name.trim() ? src.Name.trim().slice(0, 60) : ''
  return {
    id,
    name: `От провайдера (${title.slice(0, 40)})`,
    description:
      `Профиль маршрутизации, который передал провайдер${providerName ? ` («${providerName}»)` : ''}. ` +
      'Переносятся списки сайтов и адресов; DNS, геобазы и hosts провайдера не применяются.' +
      (skipped > 0 ? ` Пропущено записей неподдерживаемого вида или сверх лимита: ${skipped}.` : ''),
    mode: globalProxy ? 'global' : 'direct',
    geoRouting: true,
    rules
  }
}
