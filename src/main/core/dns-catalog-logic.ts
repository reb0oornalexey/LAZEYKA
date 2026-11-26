/**
 * Каталог встроенных DNS (dns-presets.json): чистая логика без Electron —
 * строгая проверка скачанного файла и сравнение записей. Файл приходит из
 * сети, поэтому ему не верим ни в чём: любой изъян — отбрасываем весь файл.
 */
import net from 'node:net'
import { HUB_URL } from './hub-pure'

export const CATALOG_MAX_BYTES = 64 * 1024
export const CATALOG_MAX_PRESETS = 30
/** Сколько записей может быть в списке «убраны автором» (30 из каталога + встроенные в коде, с запасом). */
export const CATALOG_MAX_REMOVED = 40
export const CATALOG_TIMEOUT_MS = 8000
export const CATALOG_REFRESH_MS = 6 * 60 * 60 * 1000
/**
 * Источники каталога. №1 — LAZEYKA Hub (каталог, который автор меняет из бота и из программы),
 * затем прежние копии в репозитории. Берётся каталог с наибольшей version из всех полученных.
 */
export const CATALOG_URLS = [
  `${HUB_URL}/dns`,
  'https://raw.githubusercontent.com/reb0oornalexey/LAZEYKA/main/dns-presets.json',
  'https://cdn.jsdelivr.net/gh/reb0oornalexey/LAZEYKA@main/dns-presets.json'
]

export interface CatalogPreset {
  id: string
  name: string
  description: string
  ipv4: string[]
  ipv6: string[]
  /** Шаблон DoH (https://…) или пусто — обычный DNS без шифрования. */
  doh: string
  /** Только шифрованно, без возврата к открытому тексту. */
  dohOnly: boolean
  tags: string[]
  site?: string
  /** Дата последней смены адресов (YYYY-MM-DD) — для подписи в карточке. */
  updated?: string
}

/**
 * Запись, которую автор убрал из программы у всех. Формат — отдельное поле верхнего
 * уровня `removed`: прежние версии программы (1.3.x, 2.0 до этой правки) читают из файла
 * только version, updated и presets, а лишние поля молча пропускают, поэтому новый файл
 * они принимают целиком. Встроенные записи при этом остаются в presets (у старых программ
 * они и так есть в коде — пусть хотя бы с актуальными адресами).
 */
export interface CatalogRemoved {
  id: string
  /** Название на момент удаления — для списка «Убранные» (записи может уже не быть в presets). */
  name?: string
  /** Причина от автора, может быть пустой. */
  reason: string
  /** Когда убрана (YYYY-MM-DD или ISO). */
  at?: string
}

export interface Catalog {
  version: number
  /** Дата файла целиком (YYYY-MM-DD или ISO). */
  updated: string
  presets: CatalogPreset[]
  /** Убраны автором у всех. Нет поля в файле — пустой список. */
  removed: CatalogRemoved[]
}

export type CatalogCheck = { ok: true; catalog: Catalog } | { ok: false; reason: string }

// ---- адреса ----------------------------------------------------------------------

function v4Parts(s: string): number[] | null {
  if (!net.isIPv4(s)) return null
  const p = s.split('.').map(Number)
  return p.length === 4 && p.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? p : null
}

/** Публичный IPv4: без частных, loopback, link-local, CGNAT, документации, multicast и зарезервированных. */
export function isPublicIPv4(s: string): boolean {
  const p = v4Parts(s)
  if (!p) return false
  const [a, b, c] = p
  if (a === 0 || a === 10 || a === 127) return false
  if (a >= 224) return false // multicast, зарезервированные, broadcast
  if (a === 100 && b >= 64 && b <= 127) return false // CGNAT
  if (a === 169 && b === 254) return false
  if (a === 172 && b >= 16 && b <= 31) return false
  if (a === 192 && b === 168) return false
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false
  if (a === 192 && b === 88 && c === 99) return false
  if (a === 198 && (b === 18 || b === 19)) return false
  if (a === 198 && b === 51 && c === 100) return false
  if (a === 203 && b === 0 && c === 113) return false
  return true
}

/** Разворачивает IPv6 в 8 групп. null — не IPv6. */
export function expandIPv6(s: string): number[] | null {
  if (!net.isIPv6(s)) return null
  let t = s.toLowerCase()
  const zone = t.indexOf('%')
  if (zone >= 0) return null // зона (fe80::1%eth0) в каталоге не нужна
  // Хвост вида ::ffff:1.2.3.4 → две группы.
  const m = /^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(t)
  if (m) {
    const q = v4Parts(m[2])
    if (!q) return null
    t = `${m[1]}${((q[0] << 8) | q[1]).toString(16)}:${((q[2] << 8) | q[3]).toString(16)}`
  }
  const halves = t.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  let groups: string[]
  if (halves.length === 2) {
    const fill = 8 - head.length - tail.length
    if (fill < 1) return null
    groups = [...head, ...Array<string>(fill).fill('0'), ...tail]
  } else {
    groups = head
  }
  if (groups.length !== 8) return null
  const out = groups.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN))
  return out.some((n) => Number.isNaN(n)) ? null : out
}

/** Публичный IPv6: только глобальные адреса 2000::/3, кроме документации (2001:db8::/32). */
export function isPublicIPv6(s: string): boolean {
  const g = expandIPv6(s)
  if (!g) return false
  if ((g[0] & 0xe000) !== 0x2000) return false
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false
  if (g[0] === 0x2001 && g[1] === 0) return false // Teredo
  if (g[0] === 0x2002) return false // 6to4: внутри зашит чужой IPv4
  return true
}

const BAD_TLDS = new Set(['local', 'localhost', 'internal', 'lan', 'home', 'corp', 'intranet', 'private', 'test', 'example', 'invalid', 'onion', 'arpa', 'localdomain'])

/** Имя хоста: настоящее доменное имя из интернета либо публичный IP. */
export function isPublicHost(hostRaw: string): boolean {
  const host = hostRaw.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '')
  if (!host || host.length > 253) return false
  if (net.isIPv4(host)) return isPublicIPv4(host)
  if (net.isIPv6(host)) return isPublicIPv6(host)
  if (/^[0-9.]+$/.test(host) || /^0x/i.test(host)) return false // «странные» записи IPv4 (2130706433, 0x7f.1)
  const labels = host.split('.')
  if (labels.length < 2) return false
  if (!labels.every((l) => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(l))) return false
  const tld = labels[labels.length - 1]
  if (BAD_TLDS.has(tld) || /^[0-9]+$/.test(tld)) return false
  return true
}

/** Шаблон DoH: https, без логина и ссылки на частные сети. Возвращает нормализованную строку или null. */
export function normalizeDohUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  let v = raw.trim()
  if (v.length === 0 || v.length > 200 || hasSpaceOrControl(v)) return null
  v = v.replace(/\{\?dns\}$/, '')
  let u: URL
  try {
    u = new URL(v)
  } catch {
    return null
  }
  if (u.protocol !== 'https:') return null
  if (u.username || u.password || u.search || u.hash) return null
  if (u.port && u.port !== '443') return null
  if (!isPublicHost(u.hostname)) return null
  return u.toString()
}

function normalizeSiteUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const v = raw.trim()
  if (!v || v.length > 200 || hasSpaceOrControl(v)) return null
  try {
    const u = new URL(v)
    if (u.protocol !== 'https:' || u.username || u.password) return null
    if (!isPublicHost(u.hostname)) return null
    return u.toString()
  } catch {
    return null
  }
}

// ---- проверка файла --------------------------------------------------------------

const ID_RE = /^[a-z0-9][a-z0-9-]{1,31}$/
const TAG_RE = /^[a-zа-яё0-9_-]{1,24}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/
/** Управляющий символ (в том числе разделители строк Unicode). */
function hasControl(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 32 || c === 127 || c === 0x2028 || c === 0x2029) return true
  }
  return false
}

function hasSpaceOrControl(s: string): boolean {
  return /\s/.test(s) || hasControl(s)
}

function cleanText(v: unknown, max: number, allowEmpty = false): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (s.length > max || hasControl(s)) return null
  if (!allowEmpty && s.length === 0) return null
  return s
}

function strList(v: unknown, max: number, test: (s: string) => boolean): string[] | null {
  if (v === undefined) return []
  if (!Array.isArray(v) || v.length > max) return null
  const out: string[] = []
  for (const x of v) {
    if (typeof x !== 'string') return null
    const s = x.trim()
    if (!test(s)) return null
    if (!out.includes(s)) out.push(s)
  }
  return out
}

/**
 * Проверка текста каталога. Известный id или новый — не важно: любая запись
 * обязана иметь корректные поля, иначе отбрасывается весь файл.
 */
export function validateCatalog(text: string): CatalogCheck {
  const bytes = Buffer.byteLength(text, 'utf-8')
  if (bytes === 0) return { ok: false, reason: 'пустой файл' }
  if (bytes > CATALOG_MAX_BYTES) return { ok: false, reason: 'файл больше 64 КБ' }
  let raw: unknown
  try {
    raw = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
  } catch {
    return { ok: false, reason: 'не JSON' }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'корень — не объект' }
  const o = raw as Record<string, unknown>
  if (typeof o.version !== 'number' || !Number.isInteger(o.version) || o.version < 1 || o.version > 100000) {
    return { ok: false, reason: 'неверная version' }
  }
  const updated = cleanText(o.updated, 40)
  if (!updated || !DATE_RE.test(updated)) return { ok: false, reason: 'неверная дата updated' }
  if (!Array.isArray(o.presets)) return { ok: false, reason: 'presets — не список' }
  if (o.presets.length === 0) return { ok: false, reason: 'presets пуст' }
  if (o.presets.length > CATALOG_MAX_PRESETS) return { ok: false, reason: 'больше 30 записей' }

  const seen = new Set<string>()
  const presets: CatalogPreset[] = []
  for (const item of o.presets) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return { ok: false, reason: 'запись — не объект' }
    const p = item as Record<string, unknown>
    const id = typeof p.id === 'string' ? p.id : ''
    if (!ID_RE.test(id) || id.startsWith('custom-')) return { ok: false, reason: `неверный id «${String(p.id).slice(0, 40)}»` }
    if (seen.has(id)) return { ok: false, reason: `повтор id ${id}` }
    seen.add(id)
    const name = cleanText(p.name, 60)
    if (!name) return { ok: false, reason: `${id}: неверное name` }
    const description = cleanText(p.description ?? '', 240, true)
    if (description === null) return { ok: false, reason: `${id}: неверное description` }
    const ipv4 = strList(p.ipv4, 2, isPublicIPv4)
    if (!ipv4 || ipv4.length === 0) return { ok: false, reason: `${id}: ipv4 — нужен 1–2 публичных адреса` }
    const ipv6 = strList(p.ipv6, 2, isPublicIPv6)
    if (!ipv6) return { ok: false, reason: `${id}: неверный ipv6` }
    let doh = ''
    if (p.doh !== undefined && p.doh !== '') {
      const n = normalizeDohUrl(p.doh)
      if (!n) return { ok: false, reason: `${id}: неверный doh` }
      doh = n
    }
    if (p.dohOnly !== undefined && typeof p.dohOnly !== 'boolean') return { ok: false, reason: `${id}: dohOnly — не true/false` }
    const dohOnly = p.dohOnly === true
    if (dohOnly && !doh) return { ok: false, reason: `${id}: dohOnly без doh` }
    const tags = strList(p.tags, 8, (s) => TAG_RE.test(s))
    if (!tags) return { ok: false, reason: `${id}: неверные tags` }
    let site: string | undefined
    if (p.site !== undefined && p.site !== '') {
      const s = normalizeSiteUrl(p.site)
      if (!s) return { ok: false, reason: `${id}: неверный site` }
      site = s
    }
    let pUpdated: string | undefined
    if (p.updated !== undefined && p.updated !== '') {
      const d = cleanText(p.updated, 40)
      if (!d || !DATE_RE.test(d)) return { ok: false, reason: `${id}: неверная дата updated` }
      pUpdated = d
    }
    presets.push({ id, name, description, ipv4, ipv6, doh, dohOnly, tags, site, updated: pUpdated })
  }
  const rm = parseRemoved(o.removed)
  if (!rm.ok) return rm
  return { ok: true, catalog: { version: o.version, updated, presets, removed: rm.list } }
}

/** Поле removed: необязательное; если есть — строго проверяется, как и presets. */
function parseRemoved(v: unknown): { ok: true; list: CatalogRemoved[] } | { ok: false; reason: string } {
  if (v === undefined || v === null) return { ok: true, list: [] }
  if (!Array.isArray(v)) return { ok: false, reason: 'removed — не список' }
  if (v.length > CATALOG_MAX_REMOVED) return { ok: false, reason: 'removed: больше 40 записей' }
  const seen = new Set<string>()
  const list: CatalogRemoved[] = []
  for (const item of v) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return { ok: false, reason: 'removed: запись — не объект' }
    const r = item as Record<string, unknown>
    const id = typeof r.id === 'string' ? r.id : ''
    if (!ID_RE.test(id) || id.startsWith('custom-')) return { ok: false, reason: `removed: неверный id «${String(r.id).slice(0, 40)}»` }
    if (seen.has(id)) return { ok: false, reason: `removed: повтор id ${id}` }
    seen.add(id)
    let name: string | undefined
    if (r.name !== undefined && r.name !== '') {
      const n = cleanText(r.name, 60)
      if (!n) return { ok: false, reason: `removed ${id}: неверное name` }
      name = n
    }
    const reason = cleanText(r.reason ?? '', 200, true)
    if (reason === null) return { ok: false, reason: `removed ${id}: неверная причина` }
    let at: string | undefined
    if (r.at !== undefined && r.at !== '') {
      const d = cleanText(r.at, 40)
      if (!d || !DATE_RE.test(d)) return { ok: false, reason: `removed ${id}: неверная дата` }
      at = d
    }
    list.push({ id, ...(name ? { name } : {}), reason, ...(at ? { at } : {}) })
  }
  return { ok: true, list }
}

/** id, убранные автором (из каталога). */
export function removedIds(cat: Pick<Catalog, 'removed'> | null | undefined): Set<string> {
  return new Set((cat?.removed ?? []).map((r) => r.id))
}

// ---- сравнение ---------------------------------------------------------------------

/** Подпись «что реально ставится в систему»: адреса и шаблон DoH. */
export function addrSignature(p: { ipv4?: string[]; ipv6?: string[]; doh?: string }): string {
  return JSON.stringify([[...(p.ipv4 ?? [])], [...(p.ipv6 ?? [])], p.doh ?? ''])
}

/** Все адреса записи (IPv4 + IPv6) одним списком. */
export function allAddrs(p: { ipv4?: string[]; ipv6?: string[] }): string[] {
  return [...(p.ipv4 ?? []), ...(p.ipv6 ?? [])]
}

/** Какие записи изменили адреса или DoH между двумя каталогами (по id). */
export function changedPresetIds(prev: Catalog | null, next: Catalog): string[] {
  if (!prev) return []
  const before = new Map(prev.presets.map((p) => [p.id, addrSignature(p)]))
  return next.presets.filter((p) => before.has(p.id) && before.get(p.id) !== addrSignature(p)).map((p) => p.id)
}

/** Из нескольких проверенных каталогов — с наибольшей version (при равной — первый по порядку источников). */
export function pickNewest<T extends { catalog: Catalog }>(list: T[]): T | null {
  let best: T | null = null
  for (const x of list) if (!best || x.catalog.version > best.catalog.version) best = x
  return best
}
