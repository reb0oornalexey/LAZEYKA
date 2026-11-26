/**
 * Тест ingest-серверов: время TCP-соединения, 5 попыток на сервер, медиана и разброс.
 * Соединение привязано к адресу физического адаптера (Windows), чтобы замер шёл мимо VPN, как пойдёт стрим.
 */
import net from 'node:net'
import dns from 'node:dns'
import { performance } from 'node:perf_hooks'
import { physicalSourceIp } from './core-probe'
import { median, spread, parseTwitchIngests, TWITCH_FALLBACK, YOUTUBE_SERVERS, isValidHost, type IngestServer } from './streamer-logic'

export interface IngestList {
  servers: IngestServer[]
  /** Список Twitch получен с сайта (true) или взят встроенный (false). */
  twitchLive: boolean
}

export interface IngestResult {
  id: string
  samples: number[]
  medianMs: number | null
  spreadMs: number
  lost: number
  error?: string
}

export interface IngestRun {
  results: IngestResult[]
  /** Замер шёл с адреса физического адаптера (мимо VPN). */
  direct: boolean
}

export interface IngestProgress {
  done: number
  total: number
  result: IngestResult
}

const ATTEMPTS = 5
const PARALLEL = 6
const TIMEOUT_MS = 2500

let twitchCache: { at: number; servers: IngestServer[] } | null = null

async function loadTwitch(): Promise<{ servers: IngestServer[]; live: boolean }> {
  if (twitchCache && Date.now() - twitchCache.at < 60 * 60_000) return { servers: twitchCache.servers, live: true }
  try {
    const res = await fetch('https://ingest.twitch.tv/ingests', { signal: AbortSignal.timeout(6000), headers: { Accept: 'application/json' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const servers = parseTwitchIngests(await res.json())
    if (servers.length === 0) throw new Error('пустой список')
    twitchCache = { at: Date.now(), servers }
    return { servers, live: true }
  } catch {
    return { servers: TWITCH_FALLBACK, live: false }
  }
}

export async function listIngests(): Promise<IngestList> {
  const tw = await loadTwitch()
  return { servers: [...tw.servers, ...YOUTUBE_SERVERS], twitchLive: tw.live }
}

function connectOnce(ip: string, port: number, localAddress?: string): Promise<number | null> {
  return new Promise((resolve) => {
    const start = performance.now()
    const s = net.createConnection({ host: ip, port, ...(localAddress ? { localAddress } : {}) })
    const done = (v: number | null): void => {
      s.destroy()
      resolve(v)
    }
    s.setTimeout(TIMEOUT_MS, () => done(null))
    s.once('connect', () => done(Math.max(1, Math.round(performance.now() - start))))
    s.once('error', () => done(null))
  })
}

async function resolveIp(host: string): Promise<string | null> {
  if (net.isIPv4(host)) return host
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      dns.promises.lookup(host, { family: 4 }).then((r) => r.address),
      new Promise<null>((r) => {
        timer = setTimeout(() => r(null), 3000)
      })
    ])
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function measure(s: IngestServer, src: string | undefined): Promise<IngestResult> {
  const ip = await resolveIp(s.host)
  if (!ip) return { id: s.id, samples: [], medianMs: null, spreadMs: 0, lost: ATTEMPTS, error: 'адрес не найден' }
  const samples: number[] = []
  for (let i = 0; i < ATTEMPTS; i++) {
    const r = await connectOnce(ip, s.port, src)
    if (r != null) samples.push(r)
  }
  return {
    id: s.id,
    samples,
    medianMs: median(samples),
    spreadMs: spread(samples),
    lost: ATTEMPTS - samples.length,
    ...(samples.length === 0 ? { error: 'не отвечает' } : {})
  }
}

let running = false

export async function runIngestTest(servers: IngestServer[], onProgress: (p: IngestProgress) => void): Promise<IngestRun> {
  if (running) throw new Error('Проверка уже идёт')
  const list = servers.filter((s) => s && isValidHost(s.host) && s.port >= 1 && s.port <= 65535).slice(0, 80)
  if (list.length === 0) throw new Error('Нет серверов для проверки')
  running = true
  try {
    const src = (await physicalSourceIp()) ?? undefined
    const results: IngestResult[] = []
    let next = 0
    const worker = async (): Promise<void> => {
      while (next < list.length) {
        const s = list[next++]
        const result = await measure(s, src)
        results.push(result)
        onProgress({ done: results.length, total: list.length, result })
      }
    }
    await Promise.all(Array.from({ length: Math.min(PARALLEL, list.length) }, worker))
    return { results, direct: Boolean(src) }
  } finally {
    running = false
  }
}
