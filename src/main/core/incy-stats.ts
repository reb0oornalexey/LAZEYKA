/**
 * Traffic and session statistics for the INCY tunnel.
 *
 * Before this module the numbers on the Statistics tab were structurally
 * incapable of being right: `sessionBytesSent`, `sessionBytesReceived` and the
 * two totals lived in a plain object that nothing ever wrote to, so the UI
 * rendered four permanent zeroes. Only `connectionCount` moved, and even that
 * was lost on restart because nothing was persisted.
 *
 * Two pieces make it real:
 *
 *  1. sing-box publishes counters over its Clash-compatible API. The topology
 *     planner has always reserved a port for it (`ports.clashApi`), but the
 *     config never enabled it. It is enabled now, bound to loopback with a
 *     random secret, and polled once a second.
 *
 *  2. Everything is written to disk — lifetime totals plus a rolling window of
 *     the last 14 days — so the weekly chart survives a restart and "Сбросить
 *     за сегодня" has something to reset.
 *
 * Xray-only topologies have no Clash API. Rather than showing zeroes there,
 * `hasLiveTraffic()` reports whether counters are actually flowing so the UI
 * can say so instead of lying with a chart.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { dataDir } from '../utils/dirs'

export interface IncyDayStat {
  /** Local calendar day, `YYYY-MM-DD`. */
  date: string
  bytesSent: number
  bytesReceived: number
  durationSec: number
  connections: number
}

export interface IncyStatsSnapshot {
  sessionBytesSent: number
  sessionBytesReceived: number
  totalBytesSent: number
  totalBytesReceived: number
  connectedDurationSec: number
  connectionCount: number
  lastConnectedTime?: number
  /** Wall-clock seconds spent connected across every session, ever. */
  totalDurationSec: number
  /** Oldest first, at most `HISTORY_DAYS` entries. */
  history: IncyDayStat[]
  /** False when the active topology cannot report traffic (Xray-only). */
  trafficAvailable: boolean
}

const HISTORY_DAYS = 14

interface PersistedStats {
  totalBytesSent: number
  totalBytesReceived: number
  totalDurationSec: number
  connectionCount: number
  lastConnectedTime?: number
  history: IncyDayStat[]
}

function statsFile(): string {
  return path.join(dataDir(), 'incy-stats.json')
}

function todayKey(at = new Date()): string {
  // Local date, not ISO/UTC: a session at 01:00 MSK belongs to that day as the
  // user sees it, and `toISOString()` would file it under the previous one.
  const y = at.getFullYear()
  const m = String(at.getMonth() + 1).padStart(2, '0')
  const d = String(at.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function emptyPersisted(): PersistedStats {
  return {
    totalBytesSent: 0,
    totalBytesReceived: 0,
    totalDurationSec: 0,
    connectionCount: 0,
    history: []
  }
}

let persisted: PersistedStats | null = null
let saveTimer: NodeJS.Timeout | null = null

function load(): PersistedStats {
  if (persisted) return persisted
  try {
    const raw = JSON.parse(readFileSync(statsFile(), 'utf-8')) as Partial<PersistedStats>
    persisted = {
      ...emptyPersisted(),
      ...raw,
      history: Array.isArray(raw.history) ? raw.history : []
    }
  } catch {
    persisted = emptyPersisted()
  }
  return persisted
}

/**
 * Batched write.
 *
 * Counters move every second while connected; writing the file each time would
 * mean 3600 disk writes an hour for data nobody reads until the tab is opened.
 */
function scheduleSave(): void {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    flushStats()
  }, 5000)
  saveTimer.unref?.()
}

export function flushStats(): void {
  if (!persisted) return
  try {
    const file = statsFile()
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(persisted), 'utf-8')
  } catch {
    /* stats are not worth surfacing an error for */
  }
}

function dayEntry(store: PersistedStats, key = todayKey()): IncyDayStat {
  let entry = store.history.find((h) => h.date === key)
  if (!entry) {
    entry = { date: key, bytesSent: 0, bytesReceived: 0, durationSec: 0, connections: 0 }
    store.history.push(entry)
    store.history.sort((a, b) => a.date.localeCompare(b.date))
    while (store.history.length > HISTORY_DAYS) store.history.shift()
  }
  return entry
}

// ---- Live session ---------------------------------------------------------

interface LiveSession {
  startedAt: number
  /** Counter values the core reported at the start, to subtract its own base. */
  baseUp: number
  baseDown: number
  up: number
  down: number
  /** Last value folded into the persisted totals, so we only add the delta. */
  committedUp: number
  committedDown: number
  committedSec: number
  available: boolean
}

let session: LiveSession | null = null
let poller: NodeJS.Timeout | null = null
let apiPort = 0
let apiSecret = ''

/** Secret for `experimental.clash_api`, regenerated for every tunnel. */
export function newClashSecret(): string {
  apiSecret = randomBytes(16).toString('hex')
  return apiSecret
}

function commit(): void {
  if (!session) return
  const store = load()
  const day = dayEntry(store)

  const dUp = Math.max(0, session.up - session.committedUp)
  const dDown = Math.max(0, session.down - session.committedDown)
  const elapsed = Math.floor((Date.now() - session.startedAt) / 1000)
  const dSec = Math.max(0, elapsed - session.committedSec)

  if (dUp || dDown || dSec) {
    store.totalBytesSent += dUp
    store.totalBytesReceived += dDown
    store.totalDurationSec += dSec
    day.bytesSent += dUp
    day.bytesReceived += dDown
    day.durationSec += dSec
    session.committedUp = session.up
    session.committedDown = session.down
    session.committedSec = elapsed
    scheduleSave()
  }
}

/**
 * Ask sing-box for its cumulative counters.
 *
 * `/connections` carries `downloadTotal`/`uploadTotal` for the whole process,
 * which is what we want — `/traffic` is a streaming endpoint of per-second
 * rates and would need a long-lived socket.
 */
function pollOnce(): void {
  if (!session || !apiPort) return
  const req = http.request(
    {
      host: '127.0.0.1',
      port: apiPort,
      path: '/connections',
      method: 'GET',
      timeout: 2000,
      headers: apiSecret ? { Authorization: `Bearer ${apiSecret}` } : undefined
    },
    (res) => {
      let body = ''
      res.setEncoding('utf-8')
      res.on('data', (c) => {
        // Guard against a pathological response; we only need the two numbers
        // at the top of the object.
        if (body.length < 2_000_000) body += c
      })
      res.on('end', () => {
        if (!session) return
        try {
          const data = JSON.parse(body) as { downloadTotal?: number; uploadTotal?: number }
          const up = Number(data.uploadTotal) || 0
          const down = Number(data.downloadTotal) || 0
          if (session.baseUp < 0) {
            session.baseUp = up
            session.baseDown = down
          }
          session.up = Math.max(0, up - session.baseUp)
          session.down = Math.max(0, down - session.baseDown)
          session.available = true
          commit()
        } catch {
          /* malformed body: skip this tick */
        }
      })
    }
  )
  req.on('error', () => {
    /* core not up yet, or no Clash API in this topology */
  })
  req.on('timeout', () => req.destroy())
  req.end()
}

/**
 * Begin a session. `clashPort` is 0 for topologies without a Clash API — the
 * session still tracks duration and connection count, just not bytes.
 */
export function beginSession(clashPort: number): void {
  endSession()
  apiPort = clashPort
  session = {
    startedAt: Date.now(),
    baseUp: -1,
    baseDown: -1,
    up: 0,
    down: 0,
    committedUp: 0,
    committedDown: 0,
    committedSec: 0,
    available: false
  }
  const store = load()
  store.connectionCount += 1
  store.lastConnectedTime = Date.now()
  dayEntry(store).connections += 1
  scheduleSave()

  if (clashPort > 0) {
    poller = setInterval(pollOnce, 1000)
    poller.unref?.()
    // Do not wait a full second for the first sample.
    setTimeout(pollOnce, 300)
  }
}

export function endSession(): void {
  if (poller) {
    clearInterval(poller)
    poller = null
  }
  if (session) {
    commit()
    session = null
  }
  apiPort = 0
  flushStats()
}

export function getStatsSnapshot(): IncyStatsSnapshot {
  const store = load()
  // Fold in whatever the live session has accumulated but not yet committed,
  // so the tab never shows a value that lags a few seconds behind reality.
  if (session) commit()
  return {
    sessionBytesSent: session?.up ?? 0,
    sessionBytesReceived: session?.down ?? 0,
    totalBytesSent: store.totalBytesSent,
    totalBytesReceived: store.totalBytesReceived,
    connectedDurationSec: session ? Math.floor((Date.now() - session.startedAt) / 1000) : 0,
    connectionCount: store.connectionCount,
    lastConnectedTime: store.lastConnectedTime,
    totalDurationSec: store.totalDurationSec,
    history: [...store.history],
    trafficAvailable: session ? session.available : true
  }
}

/** Wipe everything: totals, history, connection count. */
export function resetAllStats(): IncyStatsSnapshot {
  persisted = emptyPersisted()
  if (session) {
    session.committedUp = session.up
    session.committedDown = session.down
    session.committedSec = Math.floor((Date.now() - session.startedAt) / 1000)
  }
  flushStats()
  return getStatsSnapshot()
}

/**
 * Wipe today's row only.
 *
 * Lifetime totals are reduced by exactly today's contribution, so "всего"
 * stays consistent with the sum of the remaining days instead of drifting.
 */
export function resetTodayStats(): IncyStatsSnapshot {
  const store = load()
  const key = todayKey()
  const idx = store.history.findIndex((h) => h.date === key)
  if (idx >= 0) {
    const day = store.history[idx]
    store.totalBytesSent = Math.max(0, store.totalBytesSent - day.bytesSent)
    store.totalBytesReceived = Math.max(0, store.totalBytesReceived - day.bytesReceived)
    store.totalDurationSec = Math.max(0, store.totalDurationSec - day.durationSec)
    store.connectionCount = Math.max(0, store.connectionCount - day.connections)
    store.history.splice(idx, 1)
  }
  if (session) {
    session.committedUp = session.up
    session.committedDown = session.down
    session.committedSec = Math.floor((Date.now() - session.startedAt) / 1000)
  }
  flushStats()
  return getStatsSnapshot()
}
