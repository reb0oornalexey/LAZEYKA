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

export type StepVerdict =
  | 'ok'
  | 'dns-blocked'
  | 'dns-failed'
  | 'tcp-blocked'
  | 'dpi-blocked'
  | 'slow'
  | 'server-error'

export interface HostProbe {
  host: string
  ip: string | null
  dnsMs: number | null
  tcpMs: number | null
  tlsMs: number | null
  ttfbMs: number | null
  error?: string
  verdict: StepVerdict
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

// ---- пошаговая проверка домена напрямую --------------------------------------

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

async function probeDirect(host: string, src?: string): Promise<HostProbe> {
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
  // DNS
  let t0 = performance.now()
  try {
    const r = await withTimeout(dns.promises.lookup(host, { family: 4 }), STEP_TIMEOUT_MS, 'DNS')
    base.ip = r.address
    base.dnsMs = Math.round(performance.now() - t0)
  } catch (e) {
    base.error = e instanceof Error ? e.message : String(e)
    base.verdict = 'dns-failed'
    return base
  }
  if (/^(0\.0\.0\.0|127\.)/.test(base.ip)) {
    base.verdict = 'dns-blocked'
    base.error = `DNS отвечает ${base.ip} — домен заблокирован фильтром в вашем DNS (реклама/трекеры)`
    return base
  }
  // TCP
  t0 = performance.now()
  let sock: net.Socket
  try {
    sock = await withTimeout(
      new Promise<net.Socket>((resolve, reject) => {
        const s = net.connect({ host: base.ip!, port: 443, ...(src ? { localAddress: src } : {}) })
        s.once('connect', () => resolve(s))
        s.once('error', reject)
      }),
      STEP_TIMEOUT_MS,
      'TCP'
    )
    base.tcpMs = Math.round(performance.now() - t0)
  } catch (e) {
    base.error = e instanceof Error ? e.message : String(e)
    base.verdict = 'tcp-blocked'
    return base
  }
  // TLS с именем сайта — здесь срабатывает блокировка по DPI
  t0 = performance.now()
  let ts: tls.TLSSocket
  try {
    ts = await withTimeout(
      new Promise<tls.TLSSocket>((resolve, reject) => {
        const t = tls.connect({ socket: sock, servername: host, ALPNProtocols: ['http/1.1'], rejectUnauthorized: false })
        t.once('secureConnect', () => resolve(t))
        t.once('error', reject)
        t.once('close', () => reject(new Error('соединение закрыто')))
      }),
      STEP_TIMEOUT_MS,
      'TLS'
    )
    base.tlsMs = Math.round(performance.now() - t0)
  } catch (e) {
    sock.destroy()
    base.error = e instanceof Error ? e.message : String(e)
    base.verdict = 'dpi-blocked'
    return base
  }
  // Первый байт ответа
  t0 = performance.now()
  try {
    await withTimeout(
      new Promise<void>((resolve, reject) => {
        ts.once('data', () => resolve())
        ts.once('error', reject)
        ts.write(`HEAD / HTTP/1.1\r\nHost: ${host}\r\nUser-Agent: Mozilla/5.0\r\nConnection: close\r\n\r\n`)
      }),
      STEP_TIMEOUT_MS + 3000,
      'ответ'
    )
    base.ttfbMs = Math.round(performance.now() - t0)
    const total = (base.dnsMs ?? 0) + (base.tcpMs ?? 0) + (base.tlsMs ?? 0) + base.ttfbMs
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

  const page = await loadPage(url)

  // Какие домены разбирать подробно: основной + зависшие/упавшие/медленные.
  const problemHosts = page.hosts
    .filter((h) => h.host !== host && (h.hanging > 0 || h.failed > 0 || h.maxMs > SLOW_MS))
    .slice(0, 6)
    .map((h) => h.host)
  const toProbe = [host, ...problemHosts]
  const probes = await Promise.all(toProbe.map((h) => probeDirect(h, src)))

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
        return `${p.host}: ${p.error}. Это не провайдер, а ваш DNS (DNS-AI, AdGuard и т. п.). Если сайту он нужен — смените DNS в настройках.`
      case 'dns-failed':
        return `${p.host}: DNS не отвечает (${p.error}).`
      case 'tcp-blocked':
        return `${p.host}: не устанавливается даже соединение с ${p.ip} — заблокирован IP-адрес. Zapret тут обычно не помогает, нужен VPN.${vpn}`
      case 'dpi-blocked':
        return `${p.host}: соединение есть, но рукопожатие TLS виснет — провайдер режет сайт по имени (DPI).${z}${vpn}`
      case 'slow':
        return `${p.host}: открывается, но медленно (${(p.dnsMs ?? 0) + (p.tcpMs ?? 0) + (p.tlsMs ?? 0) + (p.ttfbMs ?? 0)} мс) — похоже на замедление у провайдера или медленный сервер/CDN.${vpn}`
      case 'server-error':
        return `${p.host}: соединение и TLS в порядке, но сервер не ответил (${p.error}).${vpn}`
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
  } else if (page.loadMs != null && verdict.length === 0) {
    verdict.push(`Страница загрузилась за ${(page.loadMs / 1000).toFixed(1)} с, проблем не найдено.`)
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
