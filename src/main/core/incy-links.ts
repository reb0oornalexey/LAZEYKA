/**
 * Разбор дополнительных параметров share-ссылок INCY (VLESS / VMess / Trojan /
 * Hysteria2) — всё, что не входит в базовый набор `parseIncyUri`.
 *
 * Модуль не зависит от Electron и ядер: только строки на входе и поля узла на
 * выходе, поэтому его можно проверять обычным node-скриптом. Неизвестные
 * параметры игнорируются, битые значения — тоже (узел остаётся рабочим, просто
 * без этой опции): ссылка с лишним ключом не должна ломать импорт подписки.
 */

import type { IncyNode } from './incy-engine'

/** Фрагментация, заданная в самой ссылке (`fragmentPackets` и т. д.). */
export interface NodeFragment {
  packets?: string
  length?: string
  interval?: string
}

/** Маски finalmask Xray: тот же объект, что лежит в `streamSettings.finalmask`. */
export interface NodeFinalmask {
  tcp?: unknown[]
  udp?: unknown[]
  quicParams?: Record<string, unknown>
}

/** Значение `packets` фрагментации: tlshello, all, число или диапазон «1-3». */
export function sanitizeFragmentPackets(value: string | undefined | null): string | null {
  const v = String(value ?? '').trim().toLowerCase()
  return /^(tlshello|all|\d+(-\d+)?)$/.test(v) ? v : null
}

/** Диапазон «10-30» или число; всё остальное — null. */
export function sanitizeRange(value: string | undefined | null): string | null {
  const v = String(value ?? '').trim()
  if (!/^\d+(-\d+)?$/.test(v)) return null
  if (v.includes('-')) {
    const [a, b] = v.split('-').map(Number)
    if (a > b) return `${b}-${a}`
  }
  return v
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * `fm` — URL-encoded JSON. URLSearchParams уже раскодировал значение, но
 * бывают ссылки, закодированные дважды, поэтому при неудаче пробуем ещё раз.
 * Принимаем только объект, у которого tcp/udp — массивы объектов с `type`.
 */
export function parseFinalmaskParam(raw: string | null | undefined): NodeFinalmask | null {
  if (!raw) return null
  const attempts = [raw]
  try {
    attempts.push(decodeURIComponent(raw))
  } catch {
    /* значение не закодировано повторно */
  }
  for (const text of attempts) {
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      continue
    }
    if (!isPlainObject(parsed)) continue
    const out: NodeFinalmask = {}
    for (const key of ['tcp', 'udp'] as const) {
      const list = parsed[key]
      if (list === undefined) continue
      if (!Array.isArray(list)) return null
      const masks = list.filter((m) => isPlainObject(m) && typeof m.type === 'string' && m.type)
      if (masks.length !== list.length) return null
      if (masks.length > 0) out[key] = masks
    }
    if (isPlainObject(parsed.quicParams)) out.quicParams = parsed.quicParams
    return out.tcp || out.udp || out.quicParams ? out : null
  }
  return null
}

/**
 * Режим XHTTP по таблице Xray: auto, packet-up, stream-up, stream-one.
 * В ссылках INCY встречаются сокращения: `packet` → packet-up, `connect` →
 * stream-one (одно соединение на оба направления). Неизвестное — не задаём,
 * ядро выберет auto само.
 */
export function normalizeXhttpMode(value: string | null | undefined): string | undefined {
  switch (String(value ?? '').trim().toLowerCase()) {
    case 'auto':
      return 'auto'
    case 'packet':
    case 'packet-up':
      return 'packet-up'
    case 'stream-up':
    case 'stream':
      return 'stream-up'
    case 'stream-one':
    case 'connect':
      return 'stream-one'
    default:
      return undefined
  }
}

/**
 * Закрепление сертификата: Xray ждёт SHA-256 в шестнадцатеричном виде (можно
 * несколько через запятую; двоеточия openssl допустимы). Иногда в ссылках
 * встречается base64 — переводим его в hex, чтобы закрепление не превратилось
 * в «любой сертификат не подходит».
 */
export function normalizeCertPin(value: string | null | undefined): string | undefined {
  const parts = String(value ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
  const out: string[] = []
  for (const p of parts) {
    const hex = p.replace(/:/g, '')
    if (/^[0-9a-fA-F]{64}$/.test(hex)) {
      out.push(hex.toLowerCase())
      continue
    }
    const b64 = p.replace(/-/g, '+').replace(/_/g, '/')
    if (/^[A-Za-z0-9+/]{43}=?$/.test(b64)) {
      const buf = Buffer.from(b64, 'base64')
      if (buf.length === 32) {
        out.push(buf.toString('hex'))
        continue
      }
    }
    // Один неразборчивый отпечаток обнуляет всё закрепление: лучше без него,
    // чем с заведомо несовпадающим — но об этом узнает пользователь по логу.
    return undefined
  }
  return out.length > 0 ? out.join(',') : undefined
}

/** Ключ ML-DSA-65 и прочие строки Reality: непустая строка без пробелов. */
function cleanToken(value: string | null | undefined): string | undefined {
  const v = String(value ?? '').trim()
  return v && !/\s/.test(v) ? v : undefined
}

function positiveInt(value: string | null | undefined): number | undefined {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 && n < 1_000_000 ? n : undefined
}

/**
 * Параметры, общие для VLESS / VMess / Trojan. `type` (транспорт) здесь не
 * разбирается — это делает `parseTransportParams` в движке.
 */
export function parseShareExtras(params: URLSearchParams): Partial<IncyNode> {
  const out: Partial<IncyNode> = {}

  // --- фрагментация узла ---
  const packets = sanitizeFragmentPackets(params.get('fragmentPackets'))
  const length = sanitizeRange(params.get('fragmentLength'))
  const interval = sanitizeRange(params.get('fragmentInterval'))
  if (packets || length || interval) {
    out.fragment = {
      ...(packets ? { packets } : {}),
      ...(length ? { length } : {}),
      ...(interval ? { interval } : {})
    }
  }

  // --- finalmask ---
  const fm = parseFinalmaskParam(params.get('fm'))
  if (fm) out.finalmask = fm

  // --- TLS / Reality ---
  const ech = params.get('ech')
  if (ech && ech.trim()) out.echConfigList = ech.trim()
  const pin = normalizeCertPin(params.get('pcs'))
  if (pin) out.pinnedCertSha256 = pin
  const vcn = params.get('vcn')
  if (vcn && vcn.trim()) out.verifyCertByName = vcn.trim()
  const pqv = cleanToken(params.get('pqv'))
  if (pqv) out.mldsa65Verify = pqv
  const spx = params.get('spx')
  if (spx && spx.trim()) out.spiderX = spx.trim()

  // --- XHTTP ---
  const mode = normalizeXhttpMode(params.get('mode'))
  if (mode) out.xhttpMode = mode
  const extraRaw = params.get('extra')
  if (extraRaw) {
    for (const text of [extraRaw, (() => { try { return decodeURIComponent(extraRaw) } catch { return '' } })()]) {
      if (!text) continue
      try {
        const parsed: unknown = JSON.parse(text)
        if (isPlainObject(parsed)) {
          out.xhttpExtra = parsed
          break
        }
      } catch {
        /* пробуем следующий вариант */
      }
    }
  }
  // sit / sil — размер и длина таблицы идентификаторов сессии (Xray 26.x).
  // Имена полей в конфиге Xray документацией INCY не раскрыты, поэтому значения
  // только сохраняются в узле и в конфиг не попадают.
  const sit = positiveInt(params.get('sit'))
  if (sit !== undefined) out.sessionIdTable = sit
  const sil = positiveInt(params.get('sil'))
  if (sil !== undefined) out.sessionIdLength = sil

  // --- gRPC ---
  const authority = params.get('authority')
  if (authority && authority.trim()) out.grpcAuthority = authority.trim()

  return out
}

/** `20000-30000,443` или `20000:30000` → `['20000:30000', '443:443']` (server_ports sing-box). */
export function parsePortRangeList(spec: string): string[] {
  return spec
    .split(',')
    .map((p) => p.trim().replace(':', '-'))
    .filter((p) => /^\d+(-\d+)?$/.test(p))
    .filter((p) => p.split('-').every((n) => Number(n) >= 1 && Number(n) <= 65535))
    .map((p) => (p.includes('-') ? p.replace('-', ':') : `${p}:${p}`))
}

/** «100», «100 mbps», «100Mbps» → 100 (Мбит/с); иначе undefined. */
export function parseMbps(value: string | null | undefined): number | undefined {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(?:mbps|mbit\/s|m)?\s*$/i.exec(String(value ?? ''))
  if (!m) return undefined
  const n = Math.round(Number(m[1]))
  return n >= 1 && n <= 100000 ? n : undefined
}

/** Параметры Hysteria2, которых нет в базовом разборе. */
export function parseHysteria2Extras(params: URLSearchParams): Partial<IncyNode> {
  const out: Partial<IncyNode> = {}
  const hopRaw = params.get('mportHopInt') ?? params.get('portHopInt')
  if (hopRaw !== null) {
    const n = Number(hopRaw)
    // Интервал прыжков в секундах; sing-box не принимает меньше 5.
    if (Number.isFinite(n) && n > 0) out.hopInterval = Math.min(3600, Math.max(5, Math.round(n)))
  }
  const pin = normalizeCertPin(params.get('pinSHA256'))
  if (pin) out.pinSha256 = pin
  const up = parseMbps(params.get('up'))
  if (up !== undefined) out.upMbps = up
  const down = parseMbps(params.get('down'))
  if (down !== undefined) out.downMbps = down
  const fm = parseFinalmaskParam(params.get('fm'))
  if (fm) out.finalmask = fm
  return out
}

/**
 * Умеет ли параметры узла только Xray.
 *
 * Такой узел при наличии Xray идёт через него: sing-box эти поля не знает, и
 * узел потерял бы закрепление сертификата, ECH или маски без единого
 * предупреждения. Узлы без новых параметров сюда не попадают — для них выбор
 * ядра остаётся прежним.
 */
export function nodeNeedsXray(node: IncyNode): boolean {
  if (node.protocol === 'hysteria2') {
    return Boolean(node.pinSha256 || node.finalmask)
  }
  if (node.protocol === 'wireguard') return false
  const tlsLike = node.security === 'tls' || node.security === 'reality'
  return Boolean(
    (node.fragment && tlsLike) ||
      node.finalmask ||
      node.echConfigList ||
      node.pinnedCertSha256 ||
      node.verifyCertByName ||
      node.mldsa65Verify ||
      node.spiderX ||
      node.xhttpMode ||
      node.xhttpExtra ||
      node.grpcAuthority
  )
}

/** Список параметров узла, которые работают только на Xray (для строки в логе). */
export function xrayOnlyParamNames(node: IncyNode): string[] {
  const names: string[] = []
  if (node.fragment) names.push('фрагментация')
  if (node.finalmask) names.push('finalmask')
  if (node.echConfigList) names.push('ECH')
  if (node.pinnedCertSha256 || node.pinSha256) names.push('закрепление сертификата')
  if (node.verifyCertByName) names.push('проверка по имени')
  if (node.mldsa65Verify) names.push('ML-DSA-65')
  if (node.spiderX) names.push('spiderX')
  if (node.xhttpMode || node.xhttpExtra) names.push('параметры XHTTP')
  if (node.grpcAuthority) names.push('authority gRPC')
  return names
}
