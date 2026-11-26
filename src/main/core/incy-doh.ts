/**
 * Поиск адреса VPN-сервера через защищённый DNS (DNS поверх HTTPS, RFC 8484).
 *
 * Зачем: некоторые интернет-провайдеры подменяют ответы обычного DNS для имён
 * VPN-серверов. Запрос в DoH-сервер идёт внутри TLS и подменить его
 * нельзя. Соединение открывается сразу на IP DoH-сервера (имя DoH-сервера
 * тоже не нужно искать обычным DNS), а имя из адреса используется только как
 * SNI и заголовок Host.
 *
 * Модуль не знает про Electron: адрес физического интерфейса («мимо VPN»)
 * приходит параметром, а запрос выполняет подменяемая функция — это нужно для
 * проверки скриптом без сети.
 */

import https from 'node:https'
import net from 'node:net'
import { randomBytes } from 'node:crypto'
import type { IncyNode } from './incy-engine'

/** Время жизни записи в кэше. */
export const DOH_CACHE_MS = 10 * 60 * 1000
export const DOH_TIMEOUT_MS = 5000

/** DoH-сервер, если провайдер не задал свой. */
export const DEFAULT_DOH = { url: 'https://dns.google/dns-query', ip: '8.8.8.8' }

// ---- Сообщение DNS (RFC 1035) ------------------------------------------------

const QTYPE = { A: 1, AAAA: 28 } as const

/** Запрос DNS для имени: заголовок + один вопрос. */
export function buildDnsQuery(name: string, type: 'A' | 'AAAA', id = randomBytes(2).readUInt16BE(0)): Buffer {
  const labels = name.replace(/\.$/, '').split('.')
  const parts: Buffer[] = []
  const header = Buffer.alloc(12)
  header.writeUInt16BE(id, 0)
  header.writeUInt16BE(0x0100, 2) // RD = 1
  header.writeUInt16BE(1, 4) // QDCOUNT
  parts.push(header)
  for (const l of labels) {
    const b = Buffer.from(l, 'ascii')
    if (b.length === 0 || b.length > 63) throw new Error('Недопустимое имя для DNS-запроса')
    parts.push(Buffer.from([b.length]), b)
  }
  parts.push(Buffer.from([0]))
  const tail = Buffer.alloc(4)
  tail.writeUInt16BE(QTYPE[type], 0)
  tail.writeUInt16BE(1, 2) // IN
  parts.push(tail)
  return Buffer.concat(parts)
}

/** Пропустить имя (с учётом сжатия); вернуть позицию после него или -1. */
function skipName(buf: Buffer, pos: number): number {
  let p = pos
  for (let guard = 0; guard < 128; guard++) {
    if (p >= buf.length) return -1
    const len = buf[p]
    if (len === 0) return p + 1
    if ((len & 0xc0) === 0xc0) return p + 2 <= buf.length ? p + 2 : -1
    if (len & 0xc0) return -1
    p += 1 + len
  }
  return -1
}

export interface DnsAnswer {
  type: number
  ttl: number
  address: string
}

function formatIPv6(b: Buffer): string {
  const groups: string[] = []
  for (let i = 0; i < 16; i += 2) groups.push(b.readUInt16BE(i).toString(16))
  return groups.join(':').replace(/(^|:)0(:0)+(:|$)/, '::')
}

/**
 * Разобрать ответ DNS: коды и записи A / AAAA. null — ответ повреждён или не
 * соответствует запросу (чужой идентификатор).
 */
export function parseDnsResponse(buf: Buffer, expectId?: number): { rcode: number; answers: DnsAnswer[] } | null {
  if (buf.length < 12) return null
  if (expectId !== undefined && buf.readUInt16BE(0) !== expectId) return null
  const flags = buf.readUInt16BE(2)
  if ((flags & 0x8000) === 0) return null // это не ответ
  const rcode = flags & 0x000f
  const qd = buf.readUInt16BE(4)
  const an = buf.readUInt16BE(6)
  let p = 12
  for (let i = 0; i < qd; i++) {
    p = skipName(buf, p)
    if (p < 0 || p + 4 > buf.length) return null
    p += 4
  }
  const answers: DnsAnswer[] = []
  for (let i = 0; i < an; i++) {
    p = skipName(buf, p)
    if (p < 0 || p + 10 > buf.length) return null
    const type = buf.readUInt16BE(p)
    const ttl = buf.readUInt32BE(p + 4)
    const rdlen = buf.readUInt16BE(p + 8)
    p += 10
    if (p + rdlen > buf.length) return null
    if (type === QTYPE.A && rdlen === 4) {
      answers.push({ type, ttl, address: `${buf[p]}.${buf[p + 1]}.${buf[p + 2]}.${buf[p + 3]}` })
    } else if (type === QTYPE.AAAA && rdlen === 16) {
      answers.push({ type, ttl, address: formatIPv6(buf.subarray(p, p + 16)) })
    }
    p += rdlen
  }
  return { rcode, answers }
}

// ---- Запрос по HTTPS ---------------------------------------------------------

export type DohTransport = (query: Buffer, opts: DohOptions) => Promise<Buffer>

export interface DohOptions {
  /** Адрес DoH-сервера, https. */
  url: string
  /** IP DoH-сервера: к нему открывается соединение (SNI и Host — из url). */
  ip?: string
  /** Локальный адрес физического адаптера — запрос идёт мимо VPN. */
  localAddress?: string
  timeoutMs?: number
}

/** Настоящий транспорт: POST application/dns-message. */
export const httpsTransport: DohTransport = (query, opts) =>
  new Promise<Buffer>((resolve, reject) => {
    let u: URL
    try {
      u = new URL(opts.url)
    } catch {
      return reject(new Error('Неверный адрес DoH'))
    }
    if (u.protocol !== 'https:') return reject(new Error('DoH только по https'))
    const req = https.request(
      {
        host: opts.ip || u.hostname,
        port: u.port ? Number(u.port) : 443,
        path: `${u.pathname}${u.search}`,
        method: 'POST',
        servername: net.isIP(u.hostname) ? undefined : u.hostname,
        ...(opts.localAddress ? { localAddress: opts.localAddress } : {}),
        headers: {
          Host: u.host,
          Accept: 'application/dns-message',
          'Content-Type': 'application/dns-message',
          'Content-Length': query.length
        },
        timeout: opts.timeoutMs ?? DOH_TIMEOUT_MS
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume()
          return reject(new Error(`DoH ответил HTTP ${res.statusCode}`))
        }
        const chunks: Buffer[] = []
        let size = 0
        res.on('data', (c: Buffer) => {
          size += c.length
          if (size > 16 * 1024) {
            req.destroy(new Error('Слишком длинный ответ DoH'))
            return
          }
          chunks.push(c)
        })
        res.on('end', () => resolve(Buffer.concat(chunks)))
        res.on('error', reject)
      }
    )
    req.on('timeout', () => req.destroy(new Error('Тайм-аут DoH')))
    req.on('error', reject)
    req.end(query)
  })

/** Адреса хоста через DoH: сначала A, затем AAAA. Пусто — ответа нет. */
export async function dohLookup(
  host: string,
  opts: DohOptions,
  transport: DohTransport = httpsTransport
): Promise<string[]> {
  const found: string[] = []
  for (const type of ['A', 'AAAA'] as const) {
    const id = randomBytes(2).readUInt16BE(0)
    let reply: Buffer
    try {
      reply = await transport(buildDnsQuery(host, type, id), opts)
    } catch (e) {
      if (type === 'A') throw e
      break
    }
    const parsed = parseDnsResponse(reply, id)
    if (!parsed) {
      if (type === 'A') throw new Error('DoH вернул неразборчивый ответ')
      break
    }
    if (parsed.rcode !== 0 && type === 'A') throw new Error(`DoH: код ответа ${parsed.rcode}`)
    for (const a of parsed.answers) if (!found.includes(a.address)) found.push(a.address)
    // IPv4 найден — IPv6 не нужен: адрес сервера берётся первым из списка.
    if (type === 'A' && found.length > 0) break
  }
  return found
}

// ---- Кэш и выбор настроек ----------------------------------------------------

const cache = new Map<string, { ips: string[]; expires: number }>()

export function clearDohCache(): void {
  cache.clear()
}

/** Настройки DoH для узла или null, если функция не включена. */
export function pickDohConfig(
  node: Pick<IncyNode, 'providerHints'>,
  settings: { ignoreProviderSettings?: boolean; secureServerLookup?: boolean }
): { url: string; ip?: string; source: 'provider' | 'user' } | null {
  const hint = settings.ignoreProviderSettings ? undefined : node.providerHints?.resolve
  if (hint?.enabled && hint.dohUrl) {
    return { url: hint.dohUrl, ip: hint.dohIp, source: 'provider' }
  }
  if (settings.secureServerLookup) {
    return { url: DEFAULT_DOH.url, ip: DEFAULT_DOH.ip, source: 'user' }
  }
  return null
}

/**
 * Адреса сервера через DoH с кэшем на 10 минут. Возвращает null при любой
 * неудаче — вызывающий код тогда использует обычный DNS и пишет строку в лог.
 */
export async function resolveViaDoh(
  host: string,
  cfg: { url: string; ip?: string },
  opts: { localAddress?: string; now?: number; transport?: DohTransport; onError?: (e: unknown) => void } = {}
): Promise<string[] | null> {
  const now = opts.now ?? Date.now()
  const key = `${cfg.url}|${cfg.ip ?? ''}|${host.toLowerCase()}`
  const hit = cache.get(key)
  if (hit && hit.expires > now) return hit.ips
  try {
    const ips = await dohLookup(
      host,
      { url: cfg.url, ip: cfg.ip, localAddress: opts.localAddress, timeoutMs: DOH_TIMEOUT_MS },
      opts.transport
    )
    if (ips.length === 0) return null
    cache.set(key, { ips, expires: now + DOH_CACHE_MS })
    return ips
  } catch (e) {
    opts.onError?.(e)
    return null
  }
}

/**
 * Узел, у которого адрес сервера заменён на IP, найденный через DoH.
 *
 * Имя сервера переносится туда, где оно нужно по смыслу: SNI и заголовок Host.
 * Иначе TLS-рукопожатие пошло бы с IP вместо имени и сервер его отверг.
 * Узлы с готовым исходящим от провайдера (rawOutbound) не трогаются.
 */
export function pinNodeToIp(node: IncyNode, ip: string): IncyNode {
  if (node.rawOutbound || !node.server || net.isIP(node.server)) return node
  const host = node.server
  const next: IncyNode = { ...node, server: ip }
  if (node.security === 'tls' || node.security === 'reality') next.sni = node.sni || host
  if (node.protocol === 'hysteria2') next.sni = node.sni || host
  if (node.network === 'ws' || node.network === 'httpupgrade' || node.network === 'xhttp') {
    next.wsHost = node.wsHost || host
  }
  return next
}
