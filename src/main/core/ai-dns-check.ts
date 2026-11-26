/**
 * Проверка нейросетей по DNS: для каждого DNS-сервера с DoH и каждой
 * нейросети — A-запись домена через DoH этого сервера, затем HTTPS-запрос на
 * полученный адрес (SNI и Host — настоящий домен). Так видно, какой DNS
 * реально открывает нейросеть в сети пользователя. Запуск только по кнопке,
 * не более 6 запросов одновременно.
 */
import { net as enet } from 'electron'
import { allProviders, type DohProvider } from './dns-doh'
import { broadcast, httpsGet } from './diag-net'
import {
  SERVICES,
  buildDnsQuery,
  classifyServiceResponse,
  describeNetError,
  isSinkholeIp,
  parseDnsAnswer,
  runPool,
  toBase64Url,
  type ServiceSpec
} from './diag-logic'

export const AI_DNS_PARALLEL = 6
const DOH_TIMEOUT_MS = 5000
const HTTPS_TIMEOUT_MS = 6000

export type AiDnsState = 'open' | 'region' | 'fail'

export interface AiDnsCell {
  providerId: string
  serviceId: string
  state: AiDnsState
  ip: string | null
  ms: number | null
  detail: string
}

export type AiDnsEvent =
  | { kind: 'plan'; providers: { id: string; name: string }[]; services: { id: string; name: string }[] }
  | { kind: 'cell'; providerId: string; serviceId: string; state: AiDnsState | 'running'; ip?: string | null; ms?: number | null; detail?: string }

export interface AiDnsResult {
  checkedAt: number
  providers: { id: string; name: string }[]
  services: { id: string; name: string }[]
  cells: AiDnsCell[]
  /** Лучший DNS: больше всего открывшихся нейросетей, при равенстве — быстрее. null — не открыл никто. */
  bestId: string | null
}

const AI_SPECS: ServiceSpec[] = SERVICES.filter((s) => s.dnsHost)

/** A-записи домена через DoH-сервер (RFC 8484, GET). */
async function dohResolve(provider: DohProvider, name: string): Promise<{ ips: string[]; error?: string }> {
  let u: URL
  try {
    u = new URL(provider.url.replace(/\{\?dns\}$/, ''))
  } catch {
    return { ips: [], error: 'неверный адрес DoH-сервера' }
  }
  u.searchParams.set('dns', toBase64Url(buildDnsQuery(name, Math.floor(Math.random() * 65535))))
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), DOH_TIMEOUT_MS)
  try {
    const res = await enet.fetch(u.toString(), { signal: ac.signal, headers: { accept: 'application/dns-message', 'user-agent': 'LAZEYKA-DNS' } })
    if (!res.ok) return { ips: [], error: `DoH-сервер ответил кодом ${res.status}` }
    const ans = parseDnsAnswer(Buffer.from(await res.arrayBuffer()))
    if (ans.rcode !== 0) return { ips: [], error: ans.rcode === 3 ? 'DNS не знает такого домена' : `DNS вернул ошибку ${ans.rcode}` }
    return { ips: ans.ips }
  } catch (e) {
    return { ips: [], error: ac.signal.aborted ? `DoH-сервер не ответил за ${DOH_TIMEOUT_MS / 1000} с` : describeNetError(e) }
  } finally {
    clearTimeout(timer)
  }
}

async function checkCell(provider: DohProvider, spec: ServiceSpec): Promise<AiDnsCell> {
  const base = { providerId: provider.id, serviceId: spec.id }
  const host = spec.dnsHost as string
  const dns = await dohResolve(provider, host)
  const real = dns.ips.filter((ip) => !isSinkholeIp(ip))
  if (real.length === 0) {
    const detail = dns.error ?? (dns.ips.length ? 'DNS отдаёт заглушку вместо адреса' : 'DNS не вернул адрес')
    return { ...base, state: 'fail', ip: null, ms: null, detail }
  }
  // Один общий бюджет на оба адреса.
  const deadline = Date.now() + HTTPS_TIMEOUT_MS
  let lastError = ''
  for (const ip of real.slice(0, 2)) {
    const left = deadline - Date.now()
    if (left < 800) break
    try {
      const r = await httpsGet(`https://${host}/`, { timeoutMs: left, connectIp: ip, maxBytes: 4096 })
      const cf = String(r.headers['cf-mitigated'] ?? '').toLowerCase() === 'challenge'
      // Для проверки нейросетей по DNS открываем сам сайт: тот же разбор ответа, но отказ по региону — только по признакам в тексте или 403 без проверки браузера.
      const v = classifyServiceResponse({ ...spec, okHosts: [host] }, { status: r.status, finalHost: host, body: r.body, cfChallenge: cf, ms: r.ms })
      if (v.state === 'region') return { ...base, state: 'region', ip, ms: r.ms, detail: 'сервис отвечает отказом по региону' }
      if (v.state === 'down') return { ...base, state: 'fail', ip, ms: r.ms, detail: v.detail }
      return { ...base, state: 'open', ip, ms: r.ms, detail: `открылось за ${r.ms} мс` }
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e)
    }
  }
  return { ...base, state: 'fail', ip: real[0], ms: null, detail: lastError || 'нет соединения' }
}

/** Лучший DNS по результатам: открыто больше всего, при равенстве — меньше среднее время. */
export function pickBest(cells: AiDnsCell[]): string | null {
  const by = new Map<string, { open: number; ms: number }>()
  for (const c of cells) {
    const s = by.get(c.providerId) ?? { open: 0, ms: 0 }
    if (c.state === 'open') {
      s.open++
      s.ms += c.ms ?? 0
    }
    by.set(c.providerId, s)
  }
  let best: string | null = null
  let bs = { open: 0, ms: 0 }
  for (const [id, s] of by) {
    if (s.open === 0) continue
    if (best == null || s.open > bs.open || (s.open === bs.open && s.ms < bs.ms)) {
      best = id
      bs = s
    }
  }
  return best
}

let running = false

export async function runAiDnsCheck(): Promise<AiDnsResult> {
  if (running) throw new Error('Проверка уже идёт')
  running = true
  try {
    const providers = (await allProviders()).filter((p) => p.url)
    const provList = providers.map((p) => ({ id: p.id, name: p.name }))
    const svcList = AI_SPECS.map((s) => ({ id: s.id, name: s.name }))
    broadcast('diag:aiDnsCell', { kind: 'plan', providers: provList, services: svcList } satisfies AiDnsEvent)

    const tasks = providers.flatMap((p) =>
      AI_SPECS.map((s) => async (): Promise<AiDnsCell> => {
        broadcast('diag:aiDnsCell', { kind: 'cell', providerId: p.id, serviceId: s.id, state: 'running' } satisfies AiDnsEvent)
        let cell: AiDnsCell
        try {
          cell = await checkCell(p, s)
        } catch (e) {
          cell = { providerId: p.id, serviceId: s.id, state: 'fail', ip: null, ms: null, detail: e instanceof Error ? e.message : String(e) }
        }
        broadcast('diag:aiDnsCell', { kind: 'cell', ...cell } satisfies AiDnsEvent)
        return cell
      })
    )
    const cells = await runPool(tasks, AI_DNS_PARALLEL)
    return { checkedAt: Date.now(), providers: provList, services: svcList, cells, bestId: pickBest(cells) }
  } finally {
    running = false
  }
}
