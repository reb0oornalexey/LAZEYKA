/**
 * «Проверить сайт» — почему сайт грузится долго или не открывается.
 *
 * 1. Страница открывается в скрытом окне — настоящем Chromium, как в браузере.
 *    Записываем все запросы: какие домены страница грузит, сколько ждёт
 *    каждый и какие так и не ответили. Именно так нашёлся cdn.cookielaw.org,
 *    из-за которого HLTV «думал» 40 секунд.
 * 2. Основной домен и проблемные домены проверяем по шагам напрямую (мимо
 *    VPN): DNS → TCP → TLS → ответ. По тому, на каком шаге застревает,
 *    понятно, что это: фильтр DNS, блокировка IP, блокировка по DPI (имя
 *    сайта в TLS) или просто медленный сервер/CDN.
 * 3. Те же домены — через узел VPN (временное ядро), чтобы сравнить.
 * 4. Смотрим, есть ли домен в списках Zapret, и предлагаем добавить.
 */
import { BrowserWindow, app, session as electronSession } from 'electron'
import net from 'node:net'
import tls from 'node:tls'
import dns from 'node:dns'
import path from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { physicalSourceIp, socksConnect, startTempCore, withCoreSlot, type TempCore } from './core-probe'
import { getIncyStatus, loadIncyNodes, appendLog } from './incy-engine'
import { zapretBundleDir } from '../utils/dirs'
import { getZapretStatus } from './zapret'
import { describeSystemDns } from './dns-doh'

export type StepVerdict =
  | 'ok'
  | 'dns-blocked'
  | 'dns-spoofed'
  | 'dns-failed'
  | 'tcp-blocked'
  | 'dpi-blocked'
  | 'tls-failed'
  | 'tcp16-blocked'
  | 'isp-stub'
  | 'slow'
  | 'server-error'

/** Кто не отдаёт домен: файл hosts, DNS-фильтр из настроек или DNS провайдера/роутера. */
export type DnsSource = 'hosts' | 'filter' | 'isp'

export interface HostProbe {
  host: string
  ip: string | null
  dnsMs: number | null
  tcpMs: number | null
  tlsMs: number | null
  ttfbMs: number | null
  error?: string
  verdict: StepVerdict
  /** Для dns-blocked: кто именно режет. */
  dnsSource?: DnsSource
  /** Насколько уверен вывод о блокировке (для DPI/16 КБ). */
  confidence?: 'high' | 'medium' | 'low'
  /** Через VPN: время до TLS-рукопожатия (null — не проверяли или не прошло). */
  vpnMs?: number | null
  vpnError?: string
  zapret: 'listed' | 'excluded' | 'none'
  /** Домен для добавления в Zapret (example.com из cdn.example.com). */
  baseDomain: string
}

export interface PageHost {
  host: string
  requests: number
  failed: number
  /** Запросы, которые так и не завершились за время проверки. */
  hanging: number
  maxMs: number
  /** Блокировал ли домен отрисовку (запросы до готовности документа). */
  early: boolean
}

export interface SiteCheckResult {
  url: string
  host: string
  pageLoadMs: number | null
  pageTimedOut: boolean
  pageError?: string
  pageHosts: PageHost[]
  probes: HostProbe[]
  zapretRunning: boolean
  vpnNode?: string
  viaTunnel: boolean
  verdict: string[]
}

const PAGE_TIMEOUT_MS = 35_000
const STEP_TIMEOUT_MS = 7_000
const SLOW_MS = 3_000

// ---- Zapret: есть ли домен в списках ------------------------------------------

let listsCache: { at: number; general: Set<string>; exclude: Set<string> } | null = null

function readList(file: string): string[] {
  try {
    return readFileSync(file, 'utf-8')
      .split(/\r?\n/)
      .map((l) => l.trim().toLowerCase())
      .filter((l) => l && !l.startsWith('#'))
  } catch {
    return []
  }
}

function zapretLists(): { general: Set<string>; exclude: Set<string> } {
  if (listsCache && Date.now() - listsCache.at < 15_000) return listsCache
  const dir = path.join(zapretBundleDir(), 'lists')
  const general = new Set<string>()
  const exclude = new Set<string>()
  for (const f of ['list-general.txt', 'list-general-user.txt', 'list-google.txt']) {
    for (const l of readList(path.join(dir, f))) general.add(l)
  }
  for (const f of ['list-exclude.txt', 'list-exclude-user.txt']) {
    for (const l of readList(path.join(dir, f))) exclude.add(l)
  }
  listsCache = { at: Date.now(), general, exclude }
  return listsCache
}

/** Hostlist winws сравнивает по суффиксу: cdn.example.com совпадает с example.com. */
function suffixMatch(set: Set<string>, host: string): boolean {
  const parts = host.toLowerCase().split('.')
  for (let i = 0; i < parts.length - 1; i++) if (set.has(parts.slice(i).join('.'))) return true
  return false
}

function zapretStateOf(host: string): HostProbe['zapret'] {
  const { general, exclude } = zapretLists()
  if (suffixMatch(exclude, host)) return 'excluded'
  return suffixMatch(general, host) ? 'listed' : 'none'
}

const SECOND_LEVEL = new Set(['co', 'com', 'net', 'org', 'gov', 'edu', 'ac', 'gen', 'msk', 'spb'])
export function baseDomainOf(host: string): string {
  const p = host.toLowerCase().replace(/\.$/, '').split('.')
  if (p.length <= 2) return p.join('.')
  if (p[p.length - 1].length === 2 && SECOND_LEVEL.has(p[p.length - 2])) return p.slice(-3).join('.')
  return p.slice(-2).join('.')
}

// ---- общие помощники --------------------------------------------------------------

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label}: нет ответа за ${Math.round(ms / 1000)} с`)), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      }
    )
  })
}

// ---- DNS: контрольный ответ ------------------------------------------------------

/**
 * Адреса домена у публичного DNS по HTTPS (DoH). Обычный DNS на 8.8.8.8 для
 * контроля не годится: провайдеры в РФ перехватывают весь UDP :53 и отвечают
 * сами, так «чистый» ответ оказывался ответом того же провайдера.
 * Подход как у rkn-block-checker и dpi-detector.
 */
async function dohResolve(host: string): Promise<string[]> {
  const urls = [
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=A`,
    `https://dns.google/resolve?name=${encodeURIComponent(host)}&type=A`
  ]
  for (const url of urls) {
    try {
      const { net: enet } = await import('electron')
      const res = await enet.fetch(url, {
        headers: { accept: 'application/dns-json' },
        signal: AbortSignal.timeout(4000)
      })
      if (!res.ok) continue
      const j = (await res.json()) as { Answer?: { type: number; data: string }[] }
      const ips = (j.Answer ?? []).filter((a) => a.type === 1 && net.isIPv4(a.data)).map((a) => a.data)
      if (ips.length) return ips
      return []
    } catch {
      /* следующий */
    }
  }
  // DoH недоступен — последний шанс обычным DNS (может быть подменён провайдером).
  for (const server of ['8.8.8.8', '1.1.1.1']) {
    try {
      const r = new dns.promises.Resolver({ timeout: 2500, tries: 1 })
      r.setServers([server])
      const a = await r.resolve4(host)
      if (a.length > 0) return a
    } catch {
      /* следующий */
    }
  }
  return []
}

// ---- hosts ---------------------------------------------------------------------

let hostsCache: { at: number; map: Map<string, string> } | null = null

/** Записи файла hosts: домен → адрес. */
function hostsEntries(): Map<string, string> {
  if (hostsCache && Date.now() - hostsCache.at < 15_000) return hostsCache.map
  const map = new Map<string, string>()
  try {
    const file = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts')
    for (const raw of readFileSync(file, 'utf-8').split(/\r?\n/)) {
      const line = raw.replace(/#.*/, '').trim()
      if (!line) continue
      const [ip, ...names] = line.split(/\s+/)
      for (const n of names) if (!map.has(n.toLowerCase())) map.set(n.toLowerCase(), ip)
    }
  } catch {
    /* нет доступа — не страшно */
  }
  hostsCache = { at: Date.now(), map }
  return map
}

// ---- какой DNS стоит в системе (один раз на проверку) --------------------------

interface SysDnsInfo {
  servers: string[]
  providerId?: string
  providerName?: string
}

const FILTERING_PROVIDERS = new Set(['dns-ai', 'adguard', 'quad9', 'xbox-dns'])

function dnsBlockedText(host: string, info: SysDnsInfo, pub: string | null): { source: DnsSource; text: string } {
  const control = pub ? ` (у публичного DNS адрес есть: ${pub})` : ''
  if (info.providerId && FILTERING_PROVIDERS.has(info.providerId)) {
    return {
      source: 'filter',
      text: `DNS ${info.providerName} не отдаёт ${host}${control} — это его фильтр рекламы и трекеров`
    }
  }
  if (info.providerName) {
    return { source: 'filter', text: `DNS ${info.providerName} не отдаёт ${host}${control}` }
  }
  const who = info.servers.length ? ` (${info.servers.slice(0, 2).join(', ')})` : ''
  return {
    source: 'isp',
    text: `DNS провайдера или роутера${who} не отдаёт ${host}${control} — провайдер блокирует сайт через DNS`
  }
}

// ---- TLS ---------------------------------------------------------------------------

type TlsFail = 'timeout' | 'reset' | 'alert' | 'other'

interface TlsAttempt {
  ok: boolean
  ms: number
  fail?: TlsFail
  error?: string
  socket?: tls.TLSSocket
}

function classifyTlsError(e: unknown): TlsFail {
  const msg = e instanceof Error ? e.message : String(e)
  const code = (e as { code?: string })?.code ?? ''
  if (/нет ответа за|timeout|ETIMEDOUT/i.test(msg) || code === 'ETIMEDOUT') return 'timeout'
  if (/ECONNRESET|socket hang up|соединение закрыто|EPIPE|ECONNABORTED/i.test(msg + code)) return 'reset'
  // Сервер ответил TLS-алертом или прислал что-то не то — путь до сервера живой.
  if (/alert|ERR_SSL|SSL routines|wrong version|handshake failure|unrecognized name/i.test(msg + code)) return 'alert'
  return 'other'
}

/** TCP + TLS-рукопожатие с указанным SNI на конкретный адрес. */
async function tlsAttempt(ip: string, sni: string, src: string | undefined, keep: boolean): Promise<TlsAttempt & { tcpMs?: number; tcpError?: string }> {
  const t0 = performance.now()
  let sock: net.Socket
  try {
    sock = await withTimeout(
      new Promise<net.Socket>((resolve, reject) => {
        const s = net.connect({ host: ip, port: 443, ...(src ? { localAddress: src } : {}) })
        s.once('connect', () => resolve(s))
        s.once('error', reject)
      }),
      STEP_TIMEOUT_MS,
      'TCP'
    )
  } catch (e) {
    return { ok: false, ms: 0, tcpError: e instanceof Error ? e.message : String(e) }
  }
  const tcpMs = Math.round(performance.now() - t0)
  const t1 = performance.now()
  try {
    const ts = await withTimeout(
      new Promise<tls.TLSSocket>((resolve, reject) => {
        const t = tls.connect({ socket: sock, servername: sni, ALPNProtocols: ['http/1.1'], rejectUnauthorized: false })
        t.once('secureConnect', () => resolve(t))
        t.once('error', reject)
        t.once('close', () => reject(new Error('соединение закрыто')))
      }),
      STEP_TIMEOUT_MS,
      'TLS'
    )
    const ms = Math.round(performance.now() - t1)
    if (!keep) ts.destroy()
    return { ok: true, ms, tcpMs, socket: keep ? ts : undefined }
  } catch (e) {
    sock.destroy()
    return { ok: false, ms: Math.round(performance.now() - t1), tcpMs, fail: classifyTlsError(e), error: e instanceof Error ? e.message : String(e) }
  }
}

/** Безобидное имя для контрольного рукопожатия: его DPI точно не режет. */
const CONTROL_SNI = 'www.microsoft.com'

// ---- HTTP: ответ, заглушка провайдера, обрыв на 16–20 КБ --------------------------

const STUB_MARKERS = [
  'доступ ограничен',
  'доступ к запрашиваемому ресурсу',
  'решению роскомнадзора',
  'решением суда',
  'blocked by roskomnadzor',
  'blocked by rkn',
  'rkn.gov.ru',
  'eais.rkn',
  'единый реестр'
]
const STUB_REDIRECT = /\/\/[^/]*(warning\.rt\.ru|blocked|zapret-info|eais\.rkn|stop\.|block\.)/i

/** Ждём `count` строк статуса «HTTP/1.x NNN» в потоке ответа. */
function waitResponses(ts: tls.TLSSocket, buf: { text: string }, count: number, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const have = (): number => (buf.text.match(/HTTP\/1\.[01] \d{3}/g) ?? []).length
    if (have() >= count) return resolve(true)
    const onData = (): void => {
      if (have() >= count) done(true)
    }
    const onEnd = (): void => done(have() >= count)
    const timer = setTimeout(() => done(false), ms)
    const done = (v: boolean): void => {
      clearTimeout(timer)
      ts.off('data', onData)
      ts.off('end', onEnd)
      ts.off('close', onEnd)
      resolve(v)
    }
    ts.on('data', onData)
    ts.once('end', onEnd)
    ts.once('close', onEnd)
  })
}

interface HttpProbe {
  ttfbMs: number | null
  stub: boolean
  status?: number
  error?: string
  /** Соединение замерло после ~16 КБ отправленных данных (блокировка ТСПУ по IP хостинга). */
  tcp16: boolean
}

/**
 * На одном соединении: обычный запрос (время ответа + заглушка провайдера),
 * потом запросы с заголовком-«наполнителем» по 4 КБ. ТСПУ режет соединения с
 * некоторыми хостингами и CDN после 16–20 КБ: первые ответы приходят, а после
 * порога соединение замирает. Метод как в dpi-detector (TCP 16-20).
 */
async function httpProbe(ts: tls.TLSSocket, host: string): Promise<HttpProbe> {
  const buf = { text: '' }
  ts.on('data', (d: Buffer) => {
    if (buf.text.length < 200_000) buf.text += d.toString('latin1')
  })
  ts.on('error', () => void 0)
  const t0 = performance.now()
  ts.write(`GET / HTTP/1.1\r\nHost: ${host}\r\nUser-Agent: Mozilla/5.0\r\nAccept: */*\r\nConnection: keep-alive\r\n\r\n`)
  const first = await waitResponses(ts, buf, 1, STEP_TIMEOUT_MS + 3000)
  if (!first) return { ttfbMs: null, stub: false, tcp16: false, error: 'сервер не ответил' }
  const ttfbMs = Math.round(performance.now() - t0)
  // Даём телу немного дойти — для поиска заглушки хватает начала.
  await new Promise((r) => setTimeout(r, 400))
  const head = buf.text.slice(0, 16_000)
  const status = Number(/HTTP\/1\.[01] (\d{3})/.exec(head)?.[1] ?? 0)
  const location = /\r\nlocation:\s*([^\r\n]+)/i.exec(head)?.[1] ?? ''
  const lower = Buffer.from(head, 'latin1').toString('utf-8').toLowerCase()
  const stub =
    status === 451 ||
    STUB_REDIRECT.test(location) ||
    (head.length < 12_000 && STUB_MARKERS.some((m) => lower.includes(m)))
  if (stub) return { ttfbMs, stub, status, tcp16: false }
  // Сервер закрывает соединение после ответа — замер 16 КБ невозможен.
  if (/\r\nconnection:\s*close/i.test(head) || ts.destroyed) return { ttfbMs, stub, status, tcp16: false }

  const rtt = Math.max(ttfbMs, 300)
  const pad = 'x'.repeat(4000)
  let sent = 0
  for (let i = 0; i < 6; i++) {
    const before = (buf.text.match(/HTTP\/1\.[01] \d{3}/g) ?? []).length
    ts.write(`HEAD / HTTP/1.1\r\nHost: ${host}\r\nUser-Agent: Mozilla/5.0\r\nX-Pad: ${pad}\r\nConnection: keep-alive\r\n\r\n`)
    sent += 4100
    const ok = await waitResponses(ts, buf, before + 1, Math.min(Math.max(rtt * 3, 2000), 6000))
    if (!ok) {
      // Сервер просто закрыл соединение — это не блокировка.
      if (ts.destroyed || ts.readableEnded) return { ttfbMs, stub, status, tcp16: false }
      // Замерло, когда отправлено уже ≥ 12 КБ, а до этого всё отвечало, — подпись ТСПУ.
      return { ttfbMs, stub, status, tcp16: sent >= 12_000 }
    }
    const last = buf.text.slice(-4000)
    if (/\r\nconnection:\s*close/i.test(last)) break
  }
  return { ttfbMs, stub, status, tcp16: false }
}

// ---- пошаговая проверка домена ---------------------------------------------------

async function probeDirect(host: string, src: string | undefined, sysDns: SysDnsInfo): Promise<HostProbe> {
  const base: HostProbe = {
    host,
    ip: null,
    dnsMs: null,
    tcpMs: null,
    tlsMs: null,
    ttfbMs: null,
    verdict: 'ok',
    zapret: zapretStateOf(host),
    baseDomain: baseDomainOf(host)
  }

  // DNS: системный ответ и контрольный (DoH) — параллельно.
  const hostsIp = hostsEntries().get(host.toLowerCase())
  let t0 = performance.now()
  const [sys, pubList] = await Promise.all([
    withTimeout(dns.promises.lookup(host, { family: 4, all: true }), STEP_TIMEOUT_MS, 'DNS').then(
      (r) => ({ ips: r.map((x) => x.address), err: null as null | { code?: string; message: string } }),
      (e) => ({ ips: [] as string[], err: { code: (e as { code?: string })?.code, message: e instanceof Error ? e.message : String(e) } })
    ),
    dohResolve(host)
  ])
  const pub = pubList[0] ?? null
  if (sys.ips.length === 0) {
    if (hostsIp) {
      base.verdict = 'dns-blocked'
      base.dnsSource = 'hosts'
      base.error = `${host} заблокирован в файле hosts (${hostsIp})`
      return base
    }
    const notFound = /ENOTFOUND|ENODATA|NXDOMAIN/i.test(`${sys.err?.code ?? ''} ${sys.err?.message ?? ''}`)
    if (pub && notFound) {
      const d = dnsBlockedText(host, sysDns, pub)
      base.verdict = 'dns-blocked'
      base.dnsSource = d.source
      base.error = d.text
    } else if (pub) {
      base.verdict = 'dns-failed'
      base.error = `DNS не ответил вовремя (${sys.err?.message ?? 'нет ответа'}); у публичного DNS адрес есть: ${pub}`
    } else {
      base.verdict = 'dns-failed'
      base.error = notFound ? 'такого домена нет ни у одного DNS' : sys.err?.message ?? 'нет ответа'
    }
    return base
  }
  base.dnsMs = Math.round(performance.now() - t0)
  base.ip = sys.ips[0]
  if (/^(0\.0\.0\.0|127\.)/.test(base.ip)) {
    base.verdict = 'dns-blocked'
    if (hostsIp) {
      base.dnsSource = 'hosts'
      base.error = `${host} заблокирован в файле hosts (${hostsIp})`
    } else {
      const d = dnsBlockedText(host, sysDns, pub)
      base.dnsSource = d.source
      base.error = `${d.text}: DNS отвечает ${base.ip}`
    }
    return base
  }
  const dnsMismatch = pubList.length > 0 && !hostsIp && !sys.ips.some((ip) => pubList.includes(ip))

  // TCP + TLS с настоящим именем (с одной повторной попыткой: путь бывает нестабилен).
  let real = await tlsAttempt(base.ip, host, src, true)
  if (real.tcpError) {
    base.error = real.tcpError
    // Адрес от DNS не отвечает, а у публичного DNS другой — DNS подменён.
    if (dnsMismatch && pub) {
      const alt = await tlsAttempt(pub, host, src, false)
      if (alt.ok) {
        base.verdict = 'dns-spoofed'
        base.error = `DNS отдаёт ${base.ip}, а настоящий адрес ${pub} — DNS подменяет адрес сайта`
        return base
      }
    }
    base.verdict = 'tcp-blocked'
    return base
  }
  base.tcpMs = real.tcpMs ?? null
  if (!real.ok && (real.fail === 'timeout' || real.fail === 'reset' || real.fail === 'other')) {
    real = await tlsAttempt(base.ip, host, src, true)
    if (real.tcpMs != null) base.tcpMs = real.tcpMs
  }
  if (!real.ok) {
    base.error = real.error ?? real.tcpError
    if (real.fail === 'alert') {
      // Сервер ответил TLS-ошибкой — путь живой, это проблема сервера, не DPI.
      base.verdict = 'server-error'
      base.error = `сервер ответил ошибкой TLS (${real.error})`
      return base
    }
    // Контроль: тот же адрес, но безобидное имя. Проходит — режут именно имя сайта (DPI).
    const control = await tlsAttempt(base.ip, CONTROL_SNI, src, false)
    const controlAlive = control.ok || control.fail === 'alert'
    if (controlAlive) {
      if (dnsMismatch && pub) {
        const alt = await tlsAttempt(pub, host, src, false)
        if (alt.ok) {
          base.verdict = 'dns-spoofed'
          base.error = `DNS отдаёт ${base.ip}, а настоящий адрес ${pub} — DNS подменяет адрес сайта`
          return base
        }
      }
      base.verdict = 'dpi-blocked'
      base.confidence = 'high'
      base.error = `${real.fail === 'reset' ? 'соединение сбрасывается' : 'рукопожатие виснет'} только с именем ${host}, с другим именем тот же сервер отвечает`
    } else {
      base.verdict = 'tls-failed'
      base.confidence = 'medium'
      base.error = `сервер ${base.ip} не отвечает на TLS ни с каким именем — это не DPI по имени: сервер лежит или заблокирован адрес`
    }
    return base
  }
  base.tlsMs = real.ms

  // Ответ сервера, заглушка провайдера и обрыв на 16–20 КБ.
  const ts = real.socket!
  try {
    const h = await httpProbe(ts, host)
    base.ttfbMs = h.ttfbMs
    if (h.stub) {
      base.verdict = 'isp-stub'
      base.error = `вместо сайта пришла страница блокировки провайдера${h.status ? ` (HTTP ${h.status})` : ''}`
      return base
    }
    if (h.ttfbMs == null) {
      base.verdict = 'server-error'
      base.error = h.error
      return base
    }
    if (h.tcp16) {
      base.verdict = 'tcp16-blocked'
      base.confidence = 'medium'
      base.error = 'соединение замирает после ~16 КБ данных — провайдер режет этот хостинг/CDN по адресу (блокировка «16–20 КБ»)'
      return base
    }
    const total = (base.dnsMs ?? 0) + (base.tcpMs ?? 0) + (base.tlsMs ?? 0) + h.ttfbMs
    if (total > SLOW_MS) base.verdict = 'slow'
  } catch (e) {
    base.error = e instanceof Error ? e.message : String(e)
    base.verdict = 'server-error'
  } finally {
    ts.destroy()
  }
  return base
}

/** Время до TLS-рукопожатия через узел VPN (одно временное ядро на все домены). */
async function probeViaVpn(tc: TempCore, host: string): Promise<{ ms: number | null; error?: string }> {
  const t0 = performance.now()
  try {
    const raw = await socksConnect(tc.port, host, 443, STEP_TIMEOUT_MS)
    await withTimeout(
      new Promise<void>((resolve, reject) => {
        const t = tls.connect({ socket: raw, servername: host, ALPNProtocols: ['http/1.1'], rejectUnauthorized: false })
        t.once('secureConnect', () => {
          t.destroy()
          resolve()
        })
        t.once('error', reject)
      }),
      STEP_TIMEOUT_MS,
      'TLS через VPN'
    )
    return { ms: Math.round(performance.now() - t0) }
  } catch (e) {
    return { ms: null, error: e instanceof Error ? e.message : String(e) }
  }
}

// ---- загрузка страницы в скрытом окне ---------------------------------------

async function loadPage(url: string): Promise<{
  loadMs: number | null
  timedOut: boolean
  error?: string
  hosts: PageHost[]
}> {
  const partition = `site-check-${Date.now()}`
  const ses = electronSession.fromPartition(partition, { cache: false })
  // UA без «Electron/LAZEYKA» — иначе Cloudflare часто показывает проверку.
  ses.setUserAgent(app.userAgentFallback.replace(/\s?(Electron|lazeyka|LAZEYKA)\/\S+/gi, ''))
  const reqs = new Map<number, { host: string; start: number; end?: number; failed?: boolean }>()
  const t0 = Date.now()
  let docReadyAt: number | null = null
  ses.webRequest.onBeforeRequest((d, cb) => {
    try {
      const h = new URL(d.url).host
      if (h) reqs.set(d.id, { host: h, start: Date.now() })
    } catch {
      /* data:, blob: */
    }
    cb({})
  })
  ses.webRequest.onCompleted((d) => {
    const r = reqs.get(d.id)
    if (r) r.end = Date.now()
  })
  ses.webRequest.onErrorOccurred((d) => {
    const r = reqs.get(d.id)
    if (r) {
      r.end = Date.now()
      r.failed = !/ERR_ABORTED/.test(d.error)
    }
  })

  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: { partition, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
  })
  win.webContents.setAudioMuted(true)
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  let loadMs: number | null = null
  let error: string | undefined
  let timedOut = false
  try {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        timedOut = true
        resolve()
      }, PAGE_TIMEOUT_MS)
      win.webContents.once('dom-ready', () => {
        docReadyAt = Date.now()
      })
      win.webContents.once('did-finish-load', () => {
        loadMs = Date.now() - t0
        clearTimeout(timer)
        // Ещё пара секунд — на запросы после загрузки.
        setTimeout(resolve, 2500)
      })
      win.webContents.once('did-fail-load', (_e, code, desc, _u, isMain) => {
        if (!isMain) return
        error = `${desc} (${code})`
        clearTimeout(timer)
        resolve()
      })
      win.loadURL(url).catch(() => void 0)
    })
  } finally {
    const now = Date.now()
    const by = new Map<string, PageHost>()
    for (const r of reqs.values()) {
      const p = by.get(r.host) ?? { host: r.host, requests: 0, failed: 0, hanging: 0, maxMs: 0, early: false }
      p.requests++
      if (r.failed) p.failed++
      if (!r.end) p.hanging++
      p.maxMs = Math.max(p.maxMs, (r.end ?? now) - r.start)
      if (docReadyAt == null || r.start <= docReadyAt) p.early = true
      by.set(r.host, p)
    }
    try {
      win.destroy()
    } catch {
      /* noop */
    }
    void ses.clearStorageData().catch(() => void 0)
    return {
      loadMs,
      timedOut,
      error,
      hosts: [...by.values()].sort((a, b) => b.hanging - a.hanging || b.maxMs - a.maxMs)
    }
  }
}

// ---- главная функция ---------------------------------------------------------

function normalizeUrl(input: string): string {
  const v = input.trim()
  if (!v) throw new Error('Введите адрес сайта')
  const withProto = /^[a-z]+:\/\//i.test(v) ? v : `https://${v}`
  const u = new URL(withProto)
  if (!/^https?:$/.test(u.protocol)) throw new Error('Нужен адрес сайта (http/https)')
  return u.toString()
}

export async function checkSite(input: string): Promise<SiteCheckResult> {
  const url = normalizeUrl(input)
  const host = new URL(url).host
  const incy = getIncyStatus()
  const viaTunnel = incy.state === 'running' && incy.connectionMode === 'tun' && !incy.exitLagActive
  const src = (await physicalSourceIp()) ?? undefined
  const sysDns: SysDnsInfo = await describeSystemDns().catch(() => ({ servers: [] }))

  const page = await loadPage(url)

  // Какие домены разбирать подробно: основной + зависшие/упавшие/медленные.
  const problemHosts = page.hosts
    .filter((h) => h.host !== host && (h.hanging > 0 || h.failed > 0 || h.maxMs > SLOW_MS))
    .slice(0, 6)
    .map((h) => h.host)
  const toProbe = [host, ...problemHosts]
  const probes = await Promise.all(toProbe.map((h) => probeDirect(h, src, sysDns)))

  // Через VPN — только то, что напрямую не в порядке (и основной домен).
  let vpnNode: string | undefined
  const nodeId = incy.activeNodeId ?? incy.selectedNodeId
  const node = nodeId ? loadIncyNodes().find((n) => n.id === nodeId) : undefined
  const needVpn = probes.filter((p, i) => i === 0 || p.verdict !== 'ok')
  if (node && needVpn.length > 0) {
    vpnNode = node.name
    await withCoreSlot(async () => {
      let tc: TempCore | null = null
      try {
        tc = await startTempCore(node)
        for (const p of needVpn) {
          const r = await probeViaVpn(tc, p.host)
          p.vpnMs = r.ms
          p.vpnError = r.error
        }
      } catch (e) {
        for (const p of needVpn) p.vpnError = e instanceof Error ? e.message : String(e)
      } finally {
        tc?.stop()
      }
    }).catch(() => void 0)
  }

  const zapretRunning = getZapretStatus().state === 'running'
  const verdict: string[] = []
  const describe = (p: HostProbe): string | null => {
    const z =
      p.zapret === 'listed'
        ? zapretRunning
          ? ' Домен уже в списке Zapret, но текущая стратегия его не пробивает — попробуйте другую стратегию или VPN.'
          : ' Домен в списке Zapret, но Zapret выключен — включите его.'
        : p.zapret === 'excluded'
          ? ' Домен в списке исключений Zapret (Flowseal исключает его специально).'
          : ' Добавьте домен в Zapret — кнопка ниже.'
    const vpn = p.vpnMs != null ? ` Через VPN — ${p.vpnMs} мс.` : ''
    switch (p.verdict) {
      case 'dns-blocked':
        if (p.dnsSource === 'hosts')
          return `${p.host}: ${p.error}. Это запись в вашем файле hosts (её добавила какая-то программа или блокировщик рекламы). Уберите её, если сайт нужен.`
        if (p.dnsSource === 'filter')
          return `${p.host}: ${p.error}. Обычно это реклама или аналитика, и сайт работает без неё. Zapret тут не поможет; если без домена что-то ломается — смените DNS в настройках.`
        return `${p.host}: ${p.error}. Zapret тут не поможет — включите шифрованный DNS (DoH) в настройках, например Cloudflare или DNS-AI.${vpn}`
      case 'dns-spoofed':
        return `${p.host}: ${p.error}. Включите шифрованный DNS (DoH) в настройках.${vpn}`
      case 'dns-failed':
        return `${p.host}: ${p.error}.`
      case 'tcp-blocked':
        return `${p.host}: не устанавливается даже соединение с ${p.ip} — заблокирован IP-адрес или сервер недоступен. Zapret тут обычно не помогает, нужен VPN.${vpn}`
      case 'dpi-blocked':
        return `${p.host}: ${p.error} — провайдер режет сайт по имени (DPI).${z}${vpn}`
      case 'tls-failed':
        return `${p.host}: ${p.error}.${vpn}`
      case 'tcp16-blocked':
        return `${p.host}: ${p.error}. Zapret это обычно не лечит — нужен VPN.${vpn}`
      case 'isp-stub':
        return `${p.host}: ${p.error}.${z}${vpn}`
      case 'slow':
        return `${p.host}: открывается, но медленно (${(p.dnsMs ?? 0) + (p.tcpMs ?? 0) + (p.tlsMs ?? 0) + (p.ttfbMs ?? 0)} мс) — похоже на замедление у провайдера или медленный сервер/CDN.${vpn}`
      case 'server-error':
        return `${p.host}: ${p.error ?? 'сервер не ответил'} — путь до сервера живой, проблема на стороне сайта.${vpn}`
      default:
        return null
    }
  }
  for (const p of probes) {
    const d = describe(p)
    if (d) verdict.push(d)
  }
  const blockers = page.hosts.filter((h) => h.host !== host && h.hanging > 0 && h.early)
  if (page.timedOut || (page.loadMs ?? 0) > 10_000) {
    verdict.unshift(
      `Страница загружалась ${page.timedOut ? 'дольше 35 с' : `${Math.round((page.loadMs ?? 0) / 1000)} с`}.` +
        (blockers.length
          ? ` Она ждёт ответа от: ${blockers.map((b) => b.host).join(', ')} — пока они не ответят, страница не дорисуется.`
          : '')
    )
  } else if (page.loadMs != null) {
    const onlyDnsFilter = probes.every((p) => p.verdict === 'ok' || (p.verdict === 'dns-blocked' && p.dnsSource !== 'isp'))
    verdict.unshift(
      `Страница загрузилась за ${(page.loadMs / 1000).toFixed(1)} с` +
        (verdict.length === 0 ? ', проблем не найдено.' : onlyDnsFilter ? ' — нормально; ниже только то, что режет DNS-фильтр или файл hosts.' : '.')
    )
  }
  if (page.error) verdict.unshift(`Страница не открылась: ${page.error}.`)
  if (viaTunnel) verdict.push('Сейчас включён полный VPN (TUN): страница открывалась через него. Для чистой проверки провайдера отключите VPN.')

  appendLog(
    `[проверка сайта] ${host}: загрузка ${page.timedOut ? '>35 с' : page.loadMs != null ? `${page.loadMs} мс` : page.error ?? '—'}; ` +
      probes.map((p) => `${p.host}=${p.verdict}`).join(', '),
    'app'
  )

  return {
    url,
    host,
    pageLoadMs: page.loadMs,
    pageTimedOut: page.timedOut,
    pageError: page.error,
    pageHosts: page.hosts.slice(0, 25),
    probes,
    zapretRunning,
    vpnNode,
    viaTunnel,
    verdict
  }
}

/** Добавить домены в свой список Zapret и перезапустить его, если работает. */
export async function addSitesToZapret(domains: string[]): Promise<{ added: number; restarted: boolean }> {
  const { addHostsToZapretUserList } = await import('./zapret-iplist')
  const clean = [...new Set(domains.map((d) => baseDomainOf(d)).filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d)))]
  const added = addHostsToZapretUserList(clean)
  listsCache = null
  let restarted = false
  if (added > 0 && getZapretStatus().state === 'running') {
    const { restartZapret } = await import('./zapret')
    await restartZapret()
    restarted = true
  }
  return { added, restarted }
}

export function isZapretBundlePresent(): boolean {
  return existsSync(path.join(zapretBundleDir(), 'lists'))
}
