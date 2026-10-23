/**
 * AmneziaWG / WireGuard: чистые функции без побочных эффектов (удобно тестировать).
 *
 * Обычный WireGuard-хендшейк российские провайдеры режут по DPI. AmneziaWG добавляет
 * «мусорные» пакеты и меняет заголовки — ядро sing-box-lx принимает эти поля прямо
 * в endpoint `type: "wireguard"`.
 */
import { isIPv6 } from 'node:net'
import type { IncyNode } from './incy-engine'

/** Целочисленные поля AmneziaWG 1.x/2.x/3.x (канонические ключи sing-box-lx). */
const AWG_INT_KEYS = [
  'jc', 'jmin', 'jmax', 's1', 's2', 's3', 's4'
] as const
/** Число или диапазон «min-max» (поля AmneziaWG 3.x). */
const AWG_RANGE_KEYS = [
  'content_padding_addition', 'rekey_after_time', 'rekey_timeout',
  'reject_after_time', 'keepalive_timeout', 'max_handshake_attempts'
] as const
/** Строковые поля: заголовки (могут быть диапазоном «123-456»), пакеты-имитаторы, ключ защиты заголовка. */
const AWG_STR_KEYS = ['h1', 'h2', 'h3', 'h4', 'i1', 'i2', 'i3', 'i4', 'i5', 'header_protection_key'] as const
/** Сахар маскировки sing-box-lx: домен, тип имитируемого протокола, профиль браузера. */
const AWG_MASK_KEYS = ['id', 'ip', 'ib'] as const
const AWG_BOOL_KEYS = ['random_trailers', 'disable_cookies'] as const

const CANON = new Map<string, string>()
for (const k of [...AWG_INT_KEYS, ...AWG_RANGE_KEYS, ...AWG_STR_KEYS, ...AWG_MASK_KEYS, ...AWG_BOOL_KEYS]) CANON.set(k.replace(/_/g, ''), k)

const INT_SET: ReadonlySet<string> = new Set(AWG_INT_KEYS)
const BOOL_SET: ReadonlySet<string> = new Set(AWG_BOOL_KEYS)
const RANGE_SET: ReadonlySet<string> = new Set(AWG_RANGE_KEYS)
const MASK_SET: ReadonlySet<string> = new Set(AWG_MASK_KEYS)

export type AwgFields = Record<string, number | string | boolean>

function normalizeKey(k: string): string {
  return k.toLowerCase().replace(/[_\-\s]/g, '')
}

function coerceInt(v: unknown): number | null {
  if (typeof v === 'number') return Number.isInteger(v) && v >= 0 ? v : null
  if (typeof v === 'string' && /^\s*\d+\s*$/.test(v)) return Number(v.trim())
  return null
}

/** Число (в т.ч. «15») → number; «10-20» → строка-диапазон. */
export function coerceIntOrRange(v: unknown): number | string | null {
  const n = coerceInt(v)
  if (n !== null) return n
  if (typeof v === 'string' && /^\s*\d+\s*-\s*\d+\s*$/.test(v)) return v.replace(/\s+/g, '')
  return null
}

function coerceBool(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase()
    if (['on', 'true', 'yes', '1'].includes(s)) return true
    if (['off', 'false', 'no', '0'].includes(s)) return false
  }
  return null
}

function coerceStr(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() === '' ? null : v.trim()
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return null
}

function collect(src: any, out: AwgFields): void {
  if (!src || typeof src !== 'object' || Array.isArray(src)) return
  for (const [rawKey, value] of Object.entries(src)) {
    const key = CANON.get(normalizeKey(rawKey))
    if (!key) continue
    let v: number | string | boolean | null
    if (INT_SET.has(key)) v = coerceInt(value)
    else if (RANGE_SET.has(key)) v = coerceIntOrRange(value)
    else if (BOOL_SET.has(key)) v = coerceBool(value)
    else if (MASK_SET.has(key)) { const s = coerceStr(value); v = s === null ? null : MASK_SET.has(key) && key !== 'id' ? s.toLowerCase() : s }
    else v = coerceStr(value)
    if (v !== null) out[key] = v
  }
}

/**
 * Достаёт поля AmneziaWG из объекта endpoint'а. Понимает верхний уровень, вложенные
 * `amnezia` / `awg` и Xray-стиль (`settings`, `settings.amnezia`). Верхний уровень
 * приоритетнее вложенных. Невалидные значения отбрасываются.
 */
export function extractAwgFields(obj: any): AwgFields {
  const out: AwgFields = {}
  if (!obj || typeof obj !== 'object') return out
  const settings = obj.settings && typeof obj.settings === 'object' ? obj.settings : null
  // от менее приоритетного к более приоритетному
  collect(settings?.amnezia, out)
  collect(settings?.awg, out)
  collect(settings, out)
  collect(obj.amnezia, out)
  collect(obj.awg, out)
  collect(obj, out)
  return out
}

/**
 * Правила sing-box-lx для сахара маскировки: i1 несовместим с id/ip/ib,
 * ip=quic требует id, ib допустим только с ip=quic. Бросает Error по-русски.
 */
export function validateAwgFields(f: AwgFields): void {
  const hasMask = 'id' in f || 'ip' in f || 'ib' in f
  if (f.i1 !== undefined && hasMask) {
    throw new Error('В конфиге одновременно заданы I1 и Id/Ip/Ib — они конфликтуют. Оставьте что-то одно.')
  }
  if (f.ip !== undefined && !['quic', 'dns', 'stun', 'sip'].includes(String(f.ip))) {
    throw new Error(`Неизвестное значение Ip «${f.ip}»: допустимы quic, dns, stun, sip.`)
  }
  if (f.ip === 'quic' && !f.id) throw new Error('Ip=quic требует поле Id (домен для имитации QUIC).')
  if (f.ib !== undefined && f.ip !== 'quic') throw new Error('Ib (профиль браузера) допустим только вместе с Ip=quic.')
  if (f.ib !== undefined && !['chrome', 'firefox', 'curl'].includes(String(f.ib))) {
    throw new Error(`Неизвестное значение Ib «${f.ib}»: допустимы chrome, firefox, curl.`)
  }
}

/** Есть ли у узла WireGuard поля AmneziaWG. */
export function isAwgNode(node: Pick<IncyNode, 'protocol' | 'rawOutbound'>): boolean {
  if (node.protocol !== 'wireguard' && node.rawOutbound?.type !== 'wireguard') return false
  return Object.keys(extractAwgFields(node.rawOutbound)).length > 0
}

// ---------------------------------------------------------------------------
// Cloudflare WARP
// ---------------------------------------------------------------------------

export const WARP_PUBLIC_KEY = 'bmXOC+F1FxEMF9dyiK2H5/1SUtzH0JuVo51h2wPfgyo='

export function isCloudflareWarpPeer(host: string, publicKey: string): boolean {
  if (publicKey === WARP_PUBLIC_KEY) return true
  return /^162\.159\.(19[23])\.\d+$|^188\.114\.(9[6-9])\.\d+$|(^|\.)cloudflareclient\.com$/i.test(host || '')
}

// ---------------------------------------------------------------------------
// Разбор .conf
// ---------------------------------------------------------------------------

/** Похож ли текст на конфиг WireGuard/AmneziaWG. */
export function looksLikeWireGuardConf(text: string): boolean {
  return /\[\s*interface\s*\]/i.test(text) && /^\s*privatekey\s*=/im.test(text)
}

function checkKey(value: string | undefined, label: string): string {
  if (!value) throw new Error(`В конфиге WireGuard нет поля ${label}.`)
  const v = value.trim()
  const ok = v.length === 44 && v.endsWith('=') && /^[A-Za-z0-9+/]{43}=$/.test(v) && Buffer.from(v, 'base64').length === 32
  if (!ok) {
    throw new Error(`Поле ${label} повреждено: ключ WireGuard — это 44 символа base64 (сейчас ${v.length}). Проверьте, что файл скопирован целиком.`)
  }
  return v
}

function splitEndpoint(ep: string): { host: string; port: number } | null {
  const m = /^\[?([^\]]+?)\]?:(\d{1,5})$/.exec(ep.trim())
  if (!m) return null
  const port = Number(m[2])
  return port >= 1 && port <= 65535 ? { host: m[1], port } : null
}

function parseReserved(v: string | undefined): number[] | undefined {
  if (!v) return undefined
  const s = v.trim()
  const nums = s.split(/[\s,]+/).filter(Boolean)
  if (nums.length === 3 && nums.every((n) => /^\d+$/.test(n) && Number(n) <= 255)) return nums.map(Number)
  try {
    const b = Buffer.from(s, 'base64')
    if (b.length === 3) return [b[0], b[1], b[2]]
  } catch {
    /* не base64 */
  }
  throw new Error('Поле Reserved должно содержать три числа 0–255 (например «1, 2, 3») или base64 из трёх байт.')
}

interface ConfSections {
  iface: Record<string, string>
  peer: Record<string, string>
  commentName: string | null
}

function readSections(text: string): ConfSections {
  const iface: Record<string, string> = {}
  const peer: Record<string, string> = {}
  let commentName: string | null = null
  let section: 'interface' | 'peer' | 'other' | null = null
  let peerCount = 0

  for (const rawLine of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    if (line.startsWith('#') || line.startsWith(';')) {
      const m = /^[#;]\s*name\s*=\s*(.+)$/i.exec(line)
      if (m && !commentName) commentName = m[1].trim()
      continue
    }
    const sec = /^\[\s*([^\]]+?)\s*\]$/.exec(line)
    if (sec) {
      const n = sec[1].toLowerCase()
      if (n === 'interface') section = 'interface'
      else if (n === 'peer') {
        peerCount++
        section = peerCount === 1 ? 'peer' : 'other' // берём первый пир
      } else section = 'other'
      continue
    }
    const eq = line.indexOf('=')
    if (eq < 0 || !section || section === 'other') continue
    const key = line.slice(0, eq).trim().toLowerCase()
    const value = line.slice(eq + 1).replace(/\s+[#;].*$/, '').trim()
    if (!key) continue
    ;(section === 'interface' ? iface : peer)[key] = value
  }
  return { iface, peer, commentName }
}

/**
 * Разбирает .conf WireGuard / AmneziaWG в узел INCY (endpoint sing-box, тег `proxy`).
 * Бросает Error с понятным русским сообщением, если конфиг неполный или повреждён.
 */
export function parseWireGuardConf(text: string, name?: string): IncyNode {
  const { iface, peer, commentName } = readSections(String(text ?? ''))

  if (!/\[\s*interface\s*\]/i.test(text)) throw new Error('Это не конфиг WireGuard: нет секции [Interface].')
  const privateKey = checkKey(iface['privatekey'], 'PrivateKey')
  if (!/\[\s*peer\s*\]/i.test(text)) throw new Error('В конфиге WireGuard нет секции [Peer].')
  const publicKey = checkKey(peer['publickey'], 'PublicKey')
  const psk = peer['presharedkey'] ? checkKey(peer['presharedkey'], 'PresharedKey') : undefined

  if (!peer['endpoint']) throw new Error('В конфиге WireGuard нет поля Endpoint (адрес сервера host:порт).')
  const ep = splitEndpoint(peer['endpoint'])
  if (!ep) throw new Error(`Не удалось разобрать Endpoint «${peer['endpoint']}»: ожидается host:порт.`)

  const address = (iface['address'] || '172.16.0.2/32')
    .split(',')
    .map((a) => a.trim())
    .filter(Boolean)
    .map((a) => (a.includes('/') ? a : `${a}/${isIPv6(a) ? 128 : 32}`))
  if (address.length === 0) throw new Error('Поле Address в [Interface] пустое.')

  const mtu = iface['mtu'] ? Number(iface['mtu']) : NaN
  const reserved = parseReserved(peer['reserved'] ?? iface['reserved'])
  const allowed = (peer['allowedips'] || '0.0.0.0/0, ::/0').split(',').map((a) => a.trim()).filter(Boolean)

  // AmneziaWG-поля живут в [Interface]; extractAwgFields понимает JC/Jmin/H1/I1/RekeyAfterTime и т.д.
  const awg = extractAwgFields(iface)
  validateAwgFields(awg)
  const keepalive = coerceIntOrRange(peer['persistentkeepalive'])

  const isWarp = isCloudflareWarpPeer(ep.host, publicKey)
  const isAwg = Object.keys(awg).length > 0
  const fallbackName = isWarp
    ? isAwg ? 'Cloudflare WARP (AmneziaWG)' : 'Cloudflare WARP (WireGuard)'
    : isAwg ? 'WireGuard (AmneziaWG)' : 'WireGuard'
  const nodeName = (name || commentName || '').trim() || fallbackName

  const rawOutbound = {
    type: 'wireguard',
    tag: 'proxy',
    address,
    private_key: privateKey,
    peers: [
      {
        address: ep.host,
        port: ep.port,
        public_key: publicKey,
        ...(psk ? { pre_shared_key: psk } : {}),
        allowed_ips: allowed,
        ...(reserved ? { reserved } : {}),
        ...(keepalive !== null && keepalive !== 0 ? { persistent_keepalive_interval: keepalive } : {})
      }
    ],
    ...(Number.isInteger(mtu) && mtu >= 576 && mtu <= 1500 ? { mtu } : {}),
    ...awg
  }

  return {
    id: `node-wg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: nodeName,
    description: `Импортировано из .conf • ${ep.host}:${ep.port}${isAwg ? ' • AmneziaWG' : ''}`,
    protocol: 'wireguard',
    server: ep.host,
    port: ep.port,
    latencyMs: null,
    rawOutboundDialect: 'sing-box',
    rawOutbound
  } as IncyNode
}
