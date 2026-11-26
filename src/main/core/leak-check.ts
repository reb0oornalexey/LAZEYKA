/**
 * «Проверка утечек»: какой адрес видят сайты, какой — мимо VPN, не идёт ли
 * IPv6 в обход туннеля, куда уходят DNS-запросы. Запускается только по кнопке.
 *
 * Адреса узнаём у обычных сервисов определения IP (ipify, Cloudflare trace,
 * icanhazip) — запросом, как у любой программы. «Мимо VPN» — тем же запросом
 * с адреса физического адаптера. «Через узел VPN» — через локальный порт
 * прокси INCY (SOCKS5), если на нём нет логина.
 */
import https from 'node:https'
import os from 'node:os'
import tls from 'node:tls'
import { getIncyStatus, loadIncySettings } from './incy-engine'
import { socksConnect } from './core-probe'
import { getSystemDnsState } from './dns-doh'
import { directSource, httpsGet, physAdapter, plainFetch } from './diag-net'
import { buildLeakVerdict, parseIpResponse, parseTrace, type LeakVerdict } from './diag-logic'

const T = 6000

export interface IpView {
  ip: string | null
  /** Код страны (RU, NL…) и её название по-русски. */
  countryCode: string | null
  country: string | null
}

export interface LeakResult {
  checkedAt: number
  vpn: {
    running: boolean
    mode: 'tun' | 'system_proxy' | 'only_proxy' | null
    routing: 'bypass-ru' | 'global' | 'direct' | null
    exitLag: boolean
    hijackDns: boolean | null
  }
  /** Что видят сайты при обычном запросе. */
  seen: IpView
  /** Адрес мимо VPN (с физического адаптера); measurable=false — измерить нельзя. */
  direct: IpView & { measurable: boolean; reason?: string }
  /** Адрес узла VPN, как его видят сайты при запросе через прокси INCY; null — не измерялось. */
  vpnExit: IpView | null
  v6: {
    seen: string | null
    direct: string | null
    measurable: boolean
  }
  dns: {
    /** DNS-серверы адаптера (без адресов туннеля). */
    system: string[]
    /** Какой DNS задан для туннеля в настройках INCY. */
    tunnel: string | null
  }
  verdict: LeakVerdict
}

function countryName(code: string | null): string | null {
  if (!code) return null
  try {
    return new Intl.DisplayNames(['ru'], { type: 'region' }).of(code) ?? code
  } catch {
    return code
  }
}

const view = (ip: string | null, code: string | null): IpView => ({ ip, countryCode: code, country: countryName(code) })

/** Запрос через SOCKS5 локального прокси INCY, поверх него TLS. */
async function getViaSocks(port: number, url: string): Promise<string> {
  const u = new URL(url)
  const raw = await socksConnect(port, u.hostname, 443, T)
  const sock = tls.connect({ socket: raw, servername: u.hostname })
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      sock.destroy()
      reject(new Error('timeout'))
    }, T)
    const req = https.request(
      { createConnection: () => sock, host: u.hostname, path: `${u.pathname}${u.search}`, method: 'GET', headers: { Host: u.host, 'User-Agent': 'Mozilla/5.0', Connection: 'close' }, agent: false },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (d: Buffer) => chunks.push(d))
        res.on('end', () => {
          clearTimeout(timer)
          resolve(Buffer.concat(chunks).toString('utf-8'))
        })
        res.on('error', reject)
      }
    )
    req.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    req.end()
  })
}

/** IPv4 из ответов трёх сервисов: первый ответивший; страна — из трассы Cloudflare. */
async function seenView(): Promise<IpView> {
  const [ipify, trace, plain] = await Promise.all([
    plainFetch('https://api.ipify.org/?format=json', T).then((r) => parseIpResponse(r.body), () => null),
    plainFetch('https://1.1.1.1/cdn-cgi/trace', T).then((r) => parseTrace(r.body), () => ({ ip: null, loc: null })),
    plainFetch('https://ipv4.icanhazip.com/', T).then((r) => parseIpResponse(r.body), () => null)
  ])
  const v4 = [ipify, trace.ip, plain].find((x): x is string => !!x && !x.includes(':')) ?? null
  return view(v4, trace.loc)
}

async function directView(src: string | null): Promise<IpView> {
  const opts = { timeoutMs: T, ...(src ? { localAddress: src } : {}) }
  const [ipify, trace] = await Promise.all([
    httpsGet('https://api.ipify.org/?format=json', opts).then((r) => parseIpResponse(r.body), () => null),
    httpsGet('https://1.1.1.1/cdn-cgi/trace', opts).then((r) => parseTrace(r.body), () => ({ ip: null, loc: null }))
  ])
  return view([ipify, trace.ip].find((x): x is string => !!x && !x.includes(':')) ?? null, trace.loc)
}

/** Глобальный IPv6 адаптера с этим IPv4. */
function globalV6Of(iface: string | null): string | null {
  if (!iface) return null
  const a = os.networkInterfaces()[iface]?.find((x) => x.family === 'IPv6' && !x.internal && /^[23]/.test(x.address))
  return a?.address ?? null
}

export async function runLeakCheck(): Promise<LeakResult> {
  const st = getIncyStatus()
  const settings = loadIncySettings()
  const running = st.state === 'running'
  const vpn: LeakResult['vpn'] = {
    running,
    mode: running ? st.connectionMode : null,
    routing: running ? st.routingMode : null,
    exitLag: !!st.exitLagActive,
    hijackDns: running ? !!settings.hijackDns : null
  }

  const ds = await directSource()
  const adapter = ds.measurable && process.platform === 'win32' ? await physAdapter() : { ip: null, iface: null }
  const v6Src = adapter.iface ? globalV6Of(adapter.iface) : null

  const proxyPort = running && !settings.socksAuth ? settings.mixedPort || 20808 : 0

  const [seen, direct, v6Seen, v6Direct, vpnExit, dnsState] = await Promise.all([
    seenView(),
    ds.measurable ? directView(ds.ip) : Promise.resolve(view(null, null)),
    plainFetch('https://api6.ipify.org/?format=json', T).then((r) => parseIpResponse(r.body), () => null),
    ds.measurable && v6Src
      ? httpsGet('https://api6.ipify.org/?format=json', { timeoutMs: T, localAddress: v6Src, family: 6 }).then((r) => parseIpResponse(r.body), () => null)
      : Promise.resolve(null),
    proxyPort
      ? getViaSocks(proxyPort, 'https://www.cloudflare.com/cdn-cgi/trace').then(
          (t) => {
            const tr = parseTrace(t)
            return view(tr.ip, tr.loc)
          },
          () => null
        )
      : Promise.resolve(null),
    getSystemDnsState().catch(() => null)
  ])

  const dnsSystem = (dnsState?.servers ?? []).filter((a) => !/^(172\.19\.0\.|127\.|::1|fe80|fdfe:dcba)/i.test(a))
  const tunnelDns = running ? (settings.vpnDns === 'Custom' ? settings.customDns || 'свой' : settings.vpnDns) || null : null

  // IPv6 «мимо VPN» не измерить, если у физического адаптера нет глобального адреса:
  // тогда считаем, что настоящего IPv6 нет (null), а не «неизвестно».
  const v6Measurable = ds.measurable
  const verdict = buildLeakVerdict({
    vpn,
    seenV4: seen.ip,
    directV4: ds.measurable ? direct.ip : undefined,
    v6Seen,
    v6Direct: v6Measurable ? v6Direct : undefined,
    dnsServers: dnsSystem
  })

  return {
    checkedAt: Date.now(),
    vpn,
    seen,
    direct: { ...direct, measurable: ds.measurable, reason: ds.reason },
    vpnExit,
    v6: { seen: v6Seen, direct: v6Measurable ? v6Direct : null, measurable: v6Measurable },
    dns: { system: dnsSystem, tunnel: tunnelDns },
    verdict
  }
}
