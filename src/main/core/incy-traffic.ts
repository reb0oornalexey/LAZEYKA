/**
 * Учёт трафика по приложениям и список живых соединений (ExitLag →
 * «Приложения» / «Соединения»).
 *
 * Пока туннель поднят, раз в 1.5 с читаем Clash API ядра (`/connections`) и
 * запоминаем по процессу: сколько скачано/отправлено (по приращениям
 * накопительных счётчиков каждого соединения), когда был активен, и сводку по
 * хостам. Данные живут до остановки/нового запуска туннеля.
 */
import path from 'node:path'
import { clashRequest, clashApiActive, onTunnelSession } from './incy-stats'

const SAMPLE_MS = 1500
const MAX_APPS = 300
const MAX_HOSTS = 500

interface RawConn {
  id: string
  upload?: number
  download?: number
  start?: string
  chains?: string[]
  rule?: string
  rulePayload?: string
  metadata?: {
    network?: string
    host?: string
    destinationIP?: string
    destinationPort?: string | number
    processPath?: string
  }
}

export interface HostTraffic {
  host: string
  connections: number
  download: number
  upload: number
  route: string
  lastSeen: number
}

interface AppRec {
  name: string
  download: number
  upload: number
  lastSeen: number
  firstSeen: number
  /** Скорость по последнему замеру, байт/с. */
  downSpeed: number
  upSpeed: number
  /** Открытых соединений сейчас. */
  open: number
  route: string
  hosts: Map<string, HostTraffic>
}

export interface AppTraffic {
  name: string
  download: number
  upload: number
  downSpeed: number
  upSpeed: number
  open: number
  lastSeen: number
  firstSeen: number
  /** «VPN» / «напрямую» / тег — последний маршрут. */
  route: string
  hostCount: number
  /** Только для запрошенного приложения. */
  hosts?: HostTraffic[]
}

export interface LiveConnection {
  id: string
  process: string
  host: string
  port: number
  network: 'tcp' | 'udp' | string
  route: string
  rule: string
  upload: number
  download: number
  /** Начало, мс с эпохи. */
  start: number
}

let apps = new Map<string, AppRec>()
/** id соединения → последние учтённые счётчики. */
let seen = new Map<string, { up: number; down: number }>()
let timer: NodeJS.Timeout | null = null
let lastTickAt = 0
let busy = false

export function routeOf(chains: string[] | undefined): string {
  const c = chains ?? []
  if (c.includes('proxy')) return 'VPN'
  if (c.includes('direct')) return 'напрямую'
  return c[0] ?? '—'
}

function procName(p: string | undefined): string {
  return p ? path.win32.basename(p) : ''
}

function hostOf(m: RawConn['metadata']): string {
  return m?.host || m?.destinationIP || '—'
}

function trim(map: Map<string, { lastSeen: number }>, cap: number): void {
  if (map.size <= cap) return
  const sorted = [...map.entries()].sort((a, b) => a[1].lastSeen - b[1].lastSeen)
  for (let i = 0; i < map.size - cap; i++) map.delete(sorted[i][0])
}

async function tick(): Promise<void> {
  if (busy || !clashApiActive()) return
  busy = true
  try {
    const data = (await clashRequest('/connections')) as { connections?: RawConn[] } | null
    if (!data || typeof data !== 'object') return
    const now = Date.now()
    const dt = Math.max(0.2, (now - (lastTickAt || now - SAMPLE_MS)) / 1000)
    lastTickAt = now
    const alive = new Set<string>()
    const speed = new Map<string, { d: number; u: number; open: number }>()

    for (const c of data.connections ?? []) {
      alive.add(c.id)
      const name = procName(c.metadata?.processPath)
      const up = Number(c.upload) || 0
      const down = Number(c.download) || 0
      const prev = seen.get(c.id)
      const isNew = !prev
      const dUp = Math.max(0, up - (prev?.up ?? 0))
      const dDown = Math.max(0, down - (prev?.down ?? 0))
      seen.set(c.id, { up, down })
      if (!name) continue

      const key = name.toLowerCase()
      let a = apps.get(key)
      if (!a) {
        a = { name, download: 0, upload: 0, lastSeen: now, firstSeen: now, downSpeed: 0, upSpeed: 0, open: 0, route: '—', hosts: new Map() }
        apps.set(key, a)
      }
      const route = routeOf(c.chains)
      a.download += dDown
      a.upload += dUp
      a.route = route
      a.lastSeen = now
      const sp = speed.get(key) ?? { d: 0, u: 0, open: 0 }
      sp.d += dDown
      sp.u += dUp
      sp.open++
      speed.set(key, sp)

      const host = hostOf(c.metadata)
      let h = a.hosts.get(host)
      if (!h) {
        h = { host, connections: 0, download: 0, upload: 0, route, lastSeen: now }
        a.hosts.set(host, h)
      }
      if (isNew) h.connections++
      h.download += dDown
      h.upload += dUp
      h.route = route
      h.lastSeen = now
    }

    for (const id of seen.keys()) if (!alive.has(id)) seen.delete(id)
    for (const [key, a] of apps) {
      const sp = speed.get(key)
      a.downSpeed = sp ? sp.d / dt : 0
      a.upSpeed = sp ? sp.u / dt : 0
      a.open = sp?.open ?? 0
      trim(a.hosts, MAX_HOSTS)
    }
    trim(apps, MAX_APPS)
  } finally {
    busy = false
  }
}

function start(): void {
  stop()
  timer = setInterval(() => { void tick() }, SAMPLE_MS)
  timer.unref?.()
}

function stop(): void {
  if (timer) clearInterval(timer)
  timer = null
  apps = new Map()
  seen = new Map()
  lastTickAt = 0
}

onTunnelSession((active) => (active ? start() : stop()))

/** Сводка по приложениям (последние активные первыми). Хосты — только для `withHostsOf`. */
export function getAppTraffic(withHostsOf?: string): { active: boolean; apps: AppTraffic[] } {
  const list: AppTraffic[] = [...apps.values()]
    .sort((a, b) => b.lastSeen - a.lastSeen)
    .map((a) => ({
      name: a.name,
      download: a.download,
      upload: a.upload,
      downSpeed: Math.round(a.downSpeed),
      upSpeed: Math.round(a.upSpeed),
      open: a.open,
      lastSeen: a.lastSeen,
      firstSeen: a.firstSeen,
      route: a.route,
      hostCount: a.hosts.size,
      ...(withHostsOf && a.name.toLowerCase() === withHostsOf.toLowerCase()
        ? { hosts: [...a.hosts.values()].sort((x, y) => y.download + y.upload - (x.download + x.upload)).slice(0, 200) }
        : {})
    }))
  return { active: clashApiActive(), apps: list }
}

/** Живой список соединений прямо из ядра. null — туннель не поднят / нет API. */
export async function getConnections(): Promise<LiveConnection[] | null> {
  const data = (await clashRequest('/connections')) as { connections?: RawConn[] } | null
  if (!data || typeof data !== 'object') return null
  return (data.connections ?? []).map((c) => ({
    id: c.id,
    process: procName(c.metadata?.processPath),
    host: hostOf(c.metadata),
    port: Number(c.metadata?.destinationPort) || 0,
    network: String(c.metadata?.network || 'tcp').toLowerCase(),
    route: routeOf(c.chains),
    rule: [c.rule, c.rulePayload].filter(Boolean).join(': '),
    upload: Number(c.upload) || 0,
    download: Number(c.download) || 0,
    start: Date.parse(c.start ?? '') || 0
  }))
}

export async function closeConnection(id: string): Promise<boolean> {
  if (!/^[\w-]{1,64}$/.test(id)) return false
  return (await clashRequest(`/connections/${encodeURIComponent(id)}`, 'DELETE')) !== null
}
