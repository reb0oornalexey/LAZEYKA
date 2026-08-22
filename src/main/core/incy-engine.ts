import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import dns from 'node:dns'
import { performance } from 'node:perf_hooks'
import { randomBytes } from 'node:crypto'
import { ChildProcess, spawn } from 'node:child_process'
import { BrowserWindow } from 'electron'
import { dataDir, incyBinaryPath, isXrayAvailable, xrayAssetsDir, xrayBinaryPath } from '../utils/dirs'
import { planTopology, usesXrayOnlyFeatures } from './incy-topology'
import { buildXrayConfig } from './incy-xray'
import { areGeoDatabasesReady } from './incy-geo-updater'
import {
  beginSession as beginStatsSession,
  endSession as endStatsSession,
  getStatsSnapshot,
  newClashSecret,
  resetAllStats,
  resetTodayStats,
  type IncyStatsSnapshot
} from './incy-stats'
import { showSystemNotification } from '../utils/notifications'
import { getAllBypassDomains } from './split-tunneling'
import { setWindowsSystemProxy, clearWindowsSystemProxy } from '../utils/system-proxy'

export interface IncyNode {
  id: string
  name: string
  description?: string
  protocol: 'vless' | 'vmess' | 'trojan' | 'shadowsocks' | 'hysteria2'
  server: string
  port: number
  uuid?: string
  password?: string
  method?: string
  security?: 'tls' | 'reality' | 'none'
  sni?: string
  publicKey?: string
  shortId?: string
  flow?: string
  fingerprint?: string
  /**
   * Transport carried in the URI query (`type=ws&path=/x&host=example.com`).
   *
   * Without these a WebSocket or gRPC node is rebuilt as plain TCP: it
   * connects, fails the handshake, and the server drops it — visible only as
   * an unexplained EOF.
   */
  network?: 'tcp' | 'ws' | 'grpc' | 'httpupgrade' | 'xhttp'
  wsPath?: string
  wsHost?: string
  grpcServiceName?: string

  rawUri?: string
  rawJson?: any
  /**
   * The provider's own outbound object, kept verbatim.
   *
   * Subscriptions that ship full JSON configs (the "JSON" badge in INCY) can
   * use transports and options this app has never heard of — xhttp, grpc,
   * httpupgrade, custom obfuscation, per-server DNS. Re-deriving a node from a
   * handful of recognised fields silently drops all of that, which is how a
   * server that works in INCY ends up dead here.
   *
   * So the original object is preserved and replayed as-is into whichever core
   * speaks its dialect; the flat fields above are only used for display, ping,
   * and for nodes that came from a `vless://`-style URI.
   */
  rawOutbound?: any
  /**
   * Which core's schema `rawOutbound` is written in. sing-box outbounds are
   * keyed by `type`, Xray outbounds by `protocol` — that difference is the
   * discriminator.
   */
  rawOutboundDialect?: 'sing-box' | 'xray'
  latencyMs: number | null
  /** When `latencyMs` was measured. Used to discard stale readings on load. */
  latencyAt?: number
}

export interface IncySubscription {
  url: string
  title: string
  usedBytes: number | null
  totalBytes: number | null
  expireDate: string | null
  /**
   * Same moment as `expireDate`, in epoch milliseconds.
   *
   * `expireDate` is a `toLocaleDateString('ru-RU')` string built for display;
   * nothing can compare it to "now", which is why the "Уведомление об
   * истечении" setting had no way to fire. Keeping the raw value alongside it
   * makes the check trivial and keeps the display format untouched.
   */
  expireAt?: number | null
  lastUpdated: number
  nodeCount: number
  webPageUrl?: string
  supportUrl?: string
  premiumUrl?: string
  keyNumber?: string
  requestedAt?: string
  updateIntervalHours?: number
  announcements?: string[]
}

/**
 * Statistics as the renderer sees them. Produced by `incy-stats.ts`, which
 * owns the counters, their persistence and the daily history.
 */
export type IncyStats = IncyStatsSnapshot

/**
 * A single user routing rule.
 *
 * `value` is matched as a domain suffix, an IP/CIDR, or a `geosite:`/`geoip:`
 * category — whichever it looks like. Kept deliberately simple: one target,
 * one destination, a switch to disable it without deleting.
 */
export interface IncyRoutingRule {
  id: string
  value: string
  action: 'direct' | 'proxy' | 'block'
  enabled: boolean
  comment?: string
}

/**
 * A named, switchable bundle of routing choices.
 *
 * The app had a single global routing state: one mode, one geo switch, one
 * list of rules. Anyone who wanted "everything through the tunnel for work"
 * and "split tunnelling at home" had to rebuild the rule list by hand each
 * time. A profile freezes all three together so switching is one click.
 *
 * Profiles are deliberately a layer *above* the engine, not inside it:
 * activating one copies its mode / geo flag / rules into the top-level
 * settings fields the config builder already reads. Nothing in the config
 * path changes, so a bad profile cannot produce a config shape the core has
 * never seen.
 */
export interface IncyRoutingProfile {
  id: string
  name: string
  description?: string
  /** Shipped with the app: cannot be deleted, and edits fork a copy. */
  builtin?: boolean
  mode: 'bypass-ru' | 'global' | 'direct'
  geoRouting: boolean
  rules: IncyRoutingRule[]
}

export const BUILTIN_ROUTING_PROFILES: IncyRoutingProfile[] = [
  {
    id: 'builtin-split',
    name: 'Раздельно',
    description:
      'Российские сайты, банки и игры идут напрямую, остальное — через туннель. Быстрее и не ломает Госуслуги.',
    builtin: true,
    mode: 'bypass-ru',
    geoRouting: true,
    rules: []
  },
  {
    id: 'builtin-global',
    name: 'Глобально',
    description:
      'Весь трафик через туннель. Максимум приватности, но российские сервисы могут ругаться на зарубежный IP.',
    builtin: true,
    mode: 'global',
    geoRouting: true,
    rules: []
  },
  {
    id: 'builtin-direct',
    name: 'Напрямую',
    description:
      'Туннель поднят, но трафик через него не идёт. Полезно для проверки: если проблема осталась и здесь, дело не в VPN.',
    builtin: true,
    mode: 'direct',
    geoRouting: false,
    rules: []
  }
]

export interface IncySettings {
  selectedNodeId: string | null
  connectionMode: 'tun' | 'system_proxy' | 'only_proxy'
  // Persisted alongside connectionMode so the choice survives a restart —
  // previously it lived only in the in-memory status object and silently
  // reset to 'bypass-ru' on every launch.
  routingMode: 'bypass-ru' | 'global' | 'direct'

  /**
   * Master switch for the curated geo databases (`geoip:direct`,
   * `geosite:category-ru` …). Turning it off falls back to plain domain lists,
   * which is both a user preference and the fastest way to tell a routing
   * problem apart from a broken tunnel.
   */
  geoRoutingEnabled: boolean
  /** User-defined routing rules, applied before every built-in rule. */
  customRoutingRules: IncyRoutingRule[]

  /**
   * Per-category switches for the geo databases, `category id → enabled`.
   *
   * Absent means enabled: the curated set is the default, so an existing
   * install keeps behaving exactly as before. Only categories the user has
   * explicitly switched off appear here.
   */
  geoCategoryOverrides: Record<string, boolean>

  /**
   * Saved routing profiles, built-ins first.
   *
   * `routingMode` / `geoRoutingEnabled` / `customRoutingRules` above stay the
   * single source of truth for the config builder; a profile is just a saved
   * copy of the three, and activating one writes them back.
   */
  routingProfileList: IncyRoutingProfile[]
  /** Which profile the current mode/geo/rules came from, '' if hand-edited. */
  activeRoutingProfileId: string

  // Appearance
  connectionStyle: 'classic' | 'compact'
  disableFontSmoothing: boolean
  uiScale: number

  // Connection
  autoConnect: boolean
  killSwitch: boolean
  hijackDns: boolean
  allowLan: boolean
  lanViaProxy: boolean
  showOnlyProxyBtn: boolean
  extraBypassAddresses: string
  mixedPort: number
  socksAuth: boolean
  socksUser: string
  socksPass: string
  blockUdp: boolean
  httpAuth: boolean

  // Tunnel
  routingProfiles: boolean
  fragmentation: boolean
  fragmentationPackets: string
  fragmentationLength: string
  fragmentationInterval: string
  noises: boolean
  noisesType: string
  noisesPacket: string
  noisesDelay: string
  multiplexing: boolean
  muxConcurrency: number
  xudpConcurrency: number
  xudpProxy443: 'reject' | 'allow'
  sniffing: boolean
  perAppProxy: boolean
  preferredIp: 'AUTO' | 'IPV4' | 'IPV6'
  vpnDns: 'Cloudflare + Google' | 'Google DNS' | 'Cloudflare DNS' | 'Quad9' | 'Xbox DNS' | 'Custom'
  customDns?: string
  remoteDns: string
  localDns: string
  fakeDns: boolean

  // Subscriptions
  autoUpdateIntervalHours: number
  notifyOnUpdate: boolean
  updateOnLaunch: boolean
  pingOnLaunch: boolean
  pingOnUpdateSubscription: boolean
  sendHwid: boolean
  sortServersBy: 'default' | 'ping' | 'name'
  expireNotifyDays: number

  // Ping
  pingProtocol: 'incy' | 'tcp' | 'http_get' | 'http_head'
  pingDisplay: 'numbers' | 'bar' | 'both' | 'dots'
  pingTestUrl: string
  pingTimeoutSec: number

  // Performance
  idleTimeoutSec: number
  maxTcpConnections: number
  maxUdpConnections: number
  disconnectOnSleep: boolean
  memoryMonitor: boolean
}

export const DEFAULT_INCY_SETTINGS: IncySettings = {
  selectedNodeId: null,
  connectionMode: 'tun',
  routingMode: 'bypass-ru',
  geoRoutingEnabled: true,
  customRoutingRules: [],
  geoCategoryOverrides: {},
  routingProfileList: BUILTIN_ROUTING_PROFILES,
  activeRoutingProfileId: 'builtin-split',

  connectionStyle: 'classic',
  disableFontSmoothing: false,
  uiScale: 100,

  autoConnect: false,
  killSwitch: false,
  hijackDns: true,
  allowLan: false,
  lanViaProxy: true,
  showOnlyProxyBtn: true,
  extraBypassAddresses: '*.local;192.168.*;10.*',
  mixedPort: 20808,
  socksAuth: false,
  socksUser: `incy_${randomBytes(4).toString('hex')}`,
  socksPass: randomBytes(8).toString('hex'),
  blockUdp: false,
  httpAuth: false,

  routingProfiles: true,
  // Fragmentation and noises are off by default.
  //
  // They exist only in Xray, and turning them on switches the whole node onto
  // the two-core path: sing-box holds the TUN and forwards into Xray over a
  // loopback bridge. That path has more moving parts and, in practice, more
  // ways to fail than plain sing-box. They are worth enabling when a provider
  // is being actively throttled — not by default, for everyone.
  fragmentation: false,
  fragmentationPackets: '1-3',
  fragmentationLength: '50-100',
  fragmentationInterval: '10-20',
  noises: false,
  noisesType: 'rand',
  noisesPacket: '50-100',
  noisesDelay: '10-16',
  // Off by default: mux has to be enabled on the server too, and most
  // providers do not. A client-side mux against a server that lacks it
  // connects fine and then silently carries nothing.
  multiplexing: false,
  muxConcurrency: 8,
  xudpConcurrency: 16,
  xudpProxy443: 'reject',
  sniffing: true,
  perAppProxy: false,
  preferredIp: 'AUTO',
  vpnDns: 'Cloudflare + Google',
  remoteDns: 'https://1.1.1.1/dns-query',
  localDns: '8.8.8.8',
  fakeDns: true,

  autoUpdateIntervalHours: 2,
  notifyOnUpdate: false,
  updateOnLaunch: true,
  pingOnLaunch: true,
  pingOnUpdateSubscription: false,
  sendHwid: false,
  sortServersBy: 'default',
  expireNotifyDays: 3,

  pingProtocol: 'incy',
  pingDisplay: 'numbers',
  pingTestUrl: 'https://www.gstatic.com/generate_204',
  pingTimeoutSec: 3,

  idleTimeoutSec: 60,
  maxTcpConnections: 256,
  maxUdpConnections: 128,
  disconnectOnSleep: false,
  memoryMonitor: false
}

export interface IncyStatus {
  state: 'stopped' | 'running' | 'connecting' | 'error'
  activeNodeId: string | null
  selectedNodeId: string | null
  connectionMode: 'tun' | 'system_proxy' | 'only_proxy'
  routingMode: 'bypass-ru' | 'global' | 'direct'
  connectedAt?: number
  lastError?: string
}

let child: ChildProcess | null = null
let currentStatus: IncyStatus = {
  state: 'stopped',
  activeNodeId: null,
  selectedNodeId: null,
  connectionMode: 'tun',
  routingMode: 'bypass-ru'
}

function broadcastStatus(next?: Partial<IncyStatus>): IncyStatus {
  if (next) {
    currentStatus = { ...currentStatus, ...next }
  }
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) {
      w.webContents.send('incy:status', currentStatus)
    }
  }
  return currentStatus
}

const ringLogs: string[] = []
const MAX_LOG_LINES = 250

/**
 * Both cores colourise their output with ANSI escapes. Piped through a Node
 * stream those arrive as literal bytes, so the Logs tab (and every error toast
 * built from these lines) showed things like `ESC[33mWARNESC[0m[0000] …`
 * instead of readable text. Strip them at the entry point.
 */
// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE = /\[[0-9;]*[A-Za-z]/g

function appendLog(line: string): void {
  const ts = new Date().toLocaleTimeString('ru-RU')
  const clean = line.replace(ANSI_ESCAPE, '').trim()
  if (!clean) return
  ringLogs.push(`[${ts}] ${clean}`)
  if (ringLogs.length > MAX_LOG_LINES) ringLogs.shift()
}

export function getIncyLogs(): string[] {
  return ringLogs
}

export function clearIncyLogs(): void {
  ringLogs.length = 0
}

export function getIncyStats(): IncyStats {
  return getStatsSnapshot()
}

export function resetIncyStats(scope: 'all' | 'today' = 'all'): IncyStats {
  return scope === 'today' ? resetTodayStats() : resetAllStats()
}

function incyConfigFile(): string {
  return path.join(dataDir(), 'incy-nodes.json')
}

function incySubFile(): string {
  return path.join(dataDir(), 'incy-sub.json')
}

function incySettingsFile(): string {
  return path.join(dataDir(), 'incy-settings.json')
}

function incyRuntimeConfigFile(): string {
  return path.join(dataDir(), 'sing-box-config.json')
}

function xrayRuntimeConfigFile(): string {
  return path.join(dataDir(), 'xray-config.json')
}

export function loadIncySettings(): IncySettings {
  const file = incySettingsFile()
  if (!existsSync(file)) return DEFAULT_INCY_SETTINGS
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8'))
    const merged = { ...DEFAULT_INCY_SETTINGS, ...parsed }
    // A settings file written before custom routing existed has no array here,
    // and every consumer iterates it — normalise rather than guard everywhere.
    if (!Array.isArray(merged.customRoutingRules)) merged.customRoutingRules = []
    if (!merged.geoCategoryOverrides || typeof merged.geoCategoryOverrides !== 'object') {
      merged.geoCategoryOverrides = {}
    }

    // Same for profiles, plus one more rule: the built-ins are re-seeded on
    // every load. They are part of the app, not user data — dropping them
    // because an older settings file predates the feature (or because a
    // future version renames one) would leave the picker empty.
    if (!Array.isArray(merged.routingProfileList)) merged.routingProfileList = []
    const custom = merged.routingProfileList.filter(
      (p: IncyRoutingProfile) => p && !p.builtin && typeof p.id === 'string'
    )
    merged.routingProfileList = [...BUILTIN_ROUTING_PROFILES, ...custom]
    // Метка активного профиля должна соответствовать тому, что реально
    // применено. Три случая, когда её нужно снять:
    //
    //  1. Значение не строка — битый или чужой файл настроек.
    //  2. Профиля с таким id больше нет (пользователь удалил).
    //  3. Профиль есть, но живые настройки от него отличаются.
    //
    // Третий случай — это ровно то, что происходит при обновлении с версии,
    // где профилей ещё не было: у настроек нет поля `activeRoutingProfileId`,
    // подставляется дефолт «Раздельно», а маршрутизация у человека может быть
    // какая угодно. Без этой проверки интерфейс подсвечивал бы профиль,
    // описывающий не то, что применено.
    const active = merged.routingProfileList.find(
      (p: IncyRoutingProfile) => p.id === merged.activeRoutingProfileId
    )
    if (typeof merged.activeRoutingProfileId !== 'string' || !active || !matchesProfile(merged, active)) {
      // '' означает «текущие настройки не совпадают ни с одним профилем».
      merged.activeRoutingProfileId = ''
    }
    return merged
  } catch {
    return DEFAULT_INCY_SETTINGS
  }
}

/**
 * Does the live routing state still match the profile marked active?
 *
 * The settings tab writes `routingMode`, `geoRoutingEnabled` and
 * `customRoutingRules` directly, with no idea a profile exists. Without this
 * check, editing a rule would leave the profile picker claiming a profile is
 * in use while the actual routing had drifted away from it.
 */
function matchesProfile(settings: IncySettings, profile: IncyRoutingProfile): boolean {
  if (settings.routingMode !== profile.mode) return false
  if ((settings.geoRoutingEnabled !== false) !== profile.geoRouting) return false
  const live = settings.customRoutingRules ?? []
  if (live.length !== profile.rules.length) return false
  return live.every((r, i) => {
    const p = profile.rules[i]
    return p && r.value === p.value && r.action === p.action && r.enabled === p.enabled
  })
}

export function saveIncySettings(settings: IncySettings): void {
  // Keep the "active profile" marker honest on every write, wherever it came
  // from — the settings tab, the routing tab, a deep link.
  if (settings.activeRoutingProfileId) {
    const active = (settings.routingProfileList ?? []).find(
      (p) => p.id === settings.activeRoutingProfileId
    )
    if (!active || !matchesProfile(settings, active)) {
      settings = { ...settings, activeRoutingProfileId: '' }
    }
  }
  const file = incySettingsFile()
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(settings, null, 2), 'utf-8')
}

/**
 * Wall-clock time this process started. Anything measured before it belongs to
 * a previous run of the app.
 */
const PROCESS_STARTED_AT = Date.now()

/** A latency reading older than this is treated as meaningless. */
const LATENCY_TTL_MS = 15 * 60 * 1000

export function loadIncyNodes(): IncyNode[] {
  const file = incyConfigFile()
  if (!existsSync(file)) return []
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8'))
    if (!Array.isArray(parsed)) return []

    // Drop stale latencies.
    //
    // Node objects are persisted whole, latency included, so a fresh launch
    // used to display the pings from the last session as if they were current.
    // A server that answered in 66 ms yesterday may be unreachable today, and
    // showing that number is worse than showing nothing — it invites picking a
    // dead node. A reading survives only if it was taken during this run and
    // is still recent.
    const now = Date.now()
    return parsed.map((n: IncyNode) => {
      const at = typeof n.latencyAt === 'number' ? n.latencyAt : 0
      const fresh = at >= PROCESS_STARTED_AT && now - at < LATENCY_TTL_MS
      return fresh ? n : { ...n, latencyMs: null, latencyAt: undefined }
    })
  } catch {
    return []
  }
}

export function saveIncyNodes(nodes: IncyNode[]): void {
  const file = incyConfigFile()
  mkdirSync(path.dirname(file), { recursive: true })
  // Stamp every non-null reading so `loadIncyNodes` can tell fresh from stale.
  //
  // Stamping unconditionally is safe precisely because `loadIncyNodes` already
  // cleared anything stale: a latency that is still non-null in memory was
  // necessarily measured during this run, so "now" is an honest timestamp for
  // it. It also means a re-ping in a long session refreshes the clock, which a
  // stamp-only-if-missing rule would not.
  const now = Date.now()
  const stamped = nodes.map((n) => (n.latencyMs !== null ? { ...n, latencyAt: now } : n))
  writeFileSync(file, JSON.stringify(stamped, null, 2), 'utf-8')
}

export function loadIncySubscription(): IncySubscription | null {
  const file = incySubFile()
  if (!existsSync(file)) return null
  try {
    const content = readFileSync(file, 'utf-8').trim()
    if (!content || content === 'null') return null
    return JSON.parse(content)
  } catch {
    return null
  }
}

export function saveIncySubscription(sub: IncySubscription | null): void {
  const file = incySubFile()
  mkdirSync(path.dirname(file), { recursive: true })
  if (!sub) {
    if (existsSync(file)) writeFileSync(file, 'null', 'utf-8')
    return
  }
  writeFileSync(file, JSON.stringify(sub, null, 2), 'utf-8')
}

/**
 * Read the transport out of a share-link query string.
 *
 * `type` names the transport (`ws`, `grpc`, `httpupgrade`, `xhttp`), and each
 * one needs its own companion fields — a WebSocket without its path lands on
 * the wrong endpoint, a gRPC stream without its service name is refused.
 * Defaults to plain TCP, which is what the vast majority of links use.
 */
function parseTransportParams(params: URLSearchParams): Partial<IncyNode> {
  const type = (params.get('type') || 'tcp').toLowerCase()
  const out: Partial<IncyNode> = {}
  if (type === 'ws' || type === 'httpupgrade' || type === 'xhttp') {
    out.network = type as IncyNode['network']
    const path = params.get('path')
    if (path) out.wsPath = decodeURIComponent(path)
    const host = params.get('host')
    if (host) out.wsHost = host
  } else if (type === 'grpc') {
    out.network = 'grpc'
    const svc = params.get('serviceName')
    if (svc) out.grpcServiceName = decodeURIComponent(svc)
  } else {
    out.network = 'tcp'
  }
  return out
}

export function parseIncyUri(uri: string): IncyNode | null {
  const trimmed = uri.trim()
  try {
    if (trimmed.startsWith('vless://')) {
      const url = new URL(trimmed)
      const params = url.searchParams
      return {
        id: `node-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: decodeURIComponent(url.hash.replace('#', '') || `${url.hostname}:${url.port}`),
        protocol: 'vless',
        server: url.hostname,
        port: Number(url.port) || 443,
        uuid: url.username,
        security: (params.get('security') as any) || 'none',
        sni: params.get('sni') || undefined,
        publicKey: params.get('pbk') || undefined,
        shortId: params.get('sid') || undefined,
        flow: params.get('flow') || undefined,
        fingerprint: params.get('fp') || 'chrome',
        ...parseTransportParams(params),
        rawUri: trimmed,
        latencyMs: null
      }
    }

    // vmess:// is base64-encoded JSON (the v2rayN "v2" format). The protocol
    // was already listed in IncyNode's union type, but no branch ever parsed
    // it — every vmess link in a subscription was silently discarded.
    if (trimmed.startsWith('vmess://')) {
      const payload = trimmed.slice('vmess://'.length)
      let decoded = ''
      try {
        decoded = Buffer.from(payload, 'base64').toString('utf-8')
      } catch {
        decoded = ''
      }
      if (decoded.trim().startsWith('{')) {
        const v = JSON.parse(decoded)
        const port = Number(v.port) || 443
        const tls = String(v.tls || '').toLowerCase()
        return {
          id: `node-${Date.now()}-${randomBytes(3).toString('hex')}`,
          name: v.ps || v.remarks || `${v.add}:${port}`,
          protocol: 'vmess',
          server: String(v.add || ''),
          port,
          uuid: String(v.id || ''),
          security: tls === 'tls' || tls === 'reality' ? (tls as 'tls' | 'reality') : 'none',
          sni: v.sni || v.host || undefined,
          fingerprint: v.fp || 'chrome',
          rawUri: trimmed,
          rawJson: v,
          latencyMs: null
        }
      }
    }

    if (trimmed.startsWith('hysteria2://') || trimmed.startsWith('hy2://')) {
      const url = new URL(trimmed.replace('hy2://', 'hysteria2://'))
      const params = url.searchParams
      return {
        id: `node-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: decodeURIComponent(url.hash.replace('#', '') || `${url.hostname}:${url.port}`),
        protocol: 'hysteria2',
        server: url.hostname,
        port: Number(url.port) || 443,
        password: url.username,
        security: 'tls',
        sni: params.get('sni') || url.hostname,
        rawUri: trimmed,
        latencyMs: null
      }
    }

    if (trimmed.startsWith('ss://')) {
      let main = trimmed.slice(5)
      let tag = ''
      const hashIdx = main.indexOf('#')
      if (hashIdx !== -1) {
        tag = decodeURIComponent(main.slice(hashIdx + 1))
        main = main.slice(0, hashIdx)
      }
      const qIdx = main.indexOf('?')
      if (qIdx !== -1) {
        main = main.slice(0, qIdx)
      }

      let method = 'aes-128-gcm'
      let password = ''
      let server = ''
      let port = 8388

      if (main.includes('@')) {
        const atIdx = main.lastIndexOf('@')
        let userinfo = main.slice(0, atIdx)
        const hostport = main.slice(atIdx + 1)

        try {
          const decoded = Buffer.from(userinfo, 'base64').toString('utf-8')
          if (decoded.includes(':')) {
            userinfo = decoded
          }
        } catch { /* not base64 */ }

        if (userinfo.includes(':')) {
          const colonIdx = userinfo.indexOf(':')
          method = userinfo.slice(0, colonIdx)
          password = userinfo.slice(colonIdx + 1)
        }

        const colonHost = hostport.lastIndexOf(':')
        if (colonHost !== -1) {
          server = hostport.slice(0, colonHost).replace(/[[\]]/g, '')
          port = Number(hostport.slice(colonHost + 1)) || 8388
        } else {
          server = hostport
        }
      } else {
        try {
          const decoded = Buffer.from(main, 'base64').toString('utf-8')
          if (decoded.includes('@')) {
            const atIdx = decoded.lastIndexOf('@')
            const userinfo = decoded.slice(0, atIdx)
            const hostport = decoded.slice(atIdx + 1)

            if (userinfo.includes(':')) {
              const colonIdx = userinfo.indexOf(':')
              method = userinfo.slice(0, colonIdx)
              password = userinfo.slice(colonIdx + 1)
            }
            const colonHost = hostport.lastIndexOf(':')
            if (colonHost !== -1) {
              server = hostport.slice(0, colonHost).replace(/[[\]]/g, '')
              port = Number(hostport.slice(colonHost + 1)) || 8388
            } else {
              server = hostport
            }
          }
        } catch { /* ignore */ }
      }

      if (server) {
        return {
          id: `node-${Date.now()}-${randomBytes(3).toString('hex')}`,
          name: tag || `${server}:${port}`,
          protocol: 'shadowsocks',
          server,
          port,
          method,
          password,
          rawUri: trimmed,
          latencyMs: null
        }
      }
    }

    if (trimmed.startsWith('trojan://')) {
      const url = new URL(trimmed)
      return {
        id: `node-${Date.now()}-${randomBytes(3).toString('hex')}`,
        name: decodeURIComponent(url.hash.replace('#', '') || `${url.hostname}:${url.port}`),
        protocol: 'trojan',
        server: url.hostname,
        port: Number(url.port) || 443,
        password: url.username,
        rawUri: trimmed,
        latencyMs: null
      }
    }
  } catch { /* invalid uri */ }
  return null
}

/**
 * Outbound types that route traffic somewhere else rather than dialing a
 * server themselves. Picking one of these as "the proxy" yields a node with no
 * address at all — which is what happened whenever a provider put a selector
 * or urltest group first in the list (e.g. the "SMART-Авто" entries).
 */
const NON_DIALING_OUTBOUNDS = new Set([
  'selector',
  'urltest',
  'direct',
  'block',
  'dns',
  'freedom',
  'blackhole',
  'loopback'
])

/**
 * Pick the outbound that actually dials the provider's server.
 *
 * Preference order: an explicit `proxy` tag, then the first entry that isn't a
 * routing helper. Falls back to the first entry so a single-outbound config
 * still parses.
 */
function pickProviderOutbound(item: any): any | null {
  const list: any[] = Array.isArray(item?.outbounds) ? item.outbounds : []
  if (!list.length) {
    // Some providers ship a bare outbound object instead of a full config.
    if (item && (item.type || item.protocol)) return item
    return null
  }
  const kindOf = (o: any): string => String(o?.type || o?.protocol || '').toLowerCase()
  const tagged = list.find((o) => o?.tag === 'proxy' && !NON_DIALING_OUTBOUNDS.has(kindOf(o)))
  if (tagged) return tagged
  const dialing = list.find((o) => kindOf(o) && !NON_DIALING_OUTBOUNDS.has(kindOf(o)))
  return dialing ?? list[0] ?? null
}

/** sing-box outbounds are keyed by `type`, Xray outbounds by `protocol`. */
function outboundDialect(o: any): 'sing-box' | 'xray' | undefined {
  if (o && typeof o.type === 'string' && o.type) return 'sing-box'
  if (o && typeof o.protocol === 'string' && o.protocol) return 'xray'
  return undefined
}

function parseJsonConfigItem(item: any, idx: number): IncyNode | null {
  const name = item.remarks || item.name || item.tag || `Узел #${idx + 1}`
  const desc = item.meta?.serverDescription || item.serverDescription || ''
  const proxyOut = pickProviderOutbound(item)
  if (!proxyOut) return null

  let protocol: IncyNode['protocol'] = 'vless'
  let server = ''
  let port = 443
  let uuid = ''
  let password = ''
  let method = 'aes-128-gcm'
  let security: IncyNode['security'] = 'none'
  let sni = ''
  let publicKey = ''
  let shortId = ''
  let flow = ''
  let fingerprint = 'chrome'

  if (proxyOut.protocol === 'hysteria' || proxyOut.protocol === 'hysteria2' || proxyOut.type === 'hysteria2') {
    protocol = 'hysteria2'
    server = proxyOut.settings?.address || proxyOut.server || ''
    port = proxyOut.settings?.port || proxyOut.server_port || 443
    password = proxyOut.streamSettings?.hysteriaSettings?.auth || proxyOut.password || ''
    security = 'tls'
    sni = proxyOut.streamSettings?.tlsSettings?.serverName || proxyOut.tls?.server_name || ''
    fingerprint = proxyOut.streamSettings?.tlsSettings?.fingerprint || proxyOut.tls?.utls?.fingerprint || 'chrome'
  } else if (proxyOut.protocol === 'vless' || proxyOut.type === 'vless') {
    protocol = 'vless'
    const vnext = proxyOut.settings?.vnext?.[0]
    server = vnext?.address || proxyOut.server || ''
    port = vnext?.port || proxyOut.server_port || 443
    const user = vnext?.users?.[0]
    uuid = user?.id || proxyOut.uuid || ''
    flow = user?.flow || proxyOut.flow || ''

    const stream = proxyOut.streamSettings || {}
    if (stream.security === 'reality' || proxyOut.tls?.reality) {
      security = 'reality'
      sni = stream.realitySettings?.serverName || proxyOut.tls?.server_name || ''
      publicKey = stream.realitySettings?.publicKey || proxyOut.tls?.reality?.public_key || ''
      shortId = stream.realitySettings?.shortId || proxyOut.tls?.reality?.short_id || ''
      fingerprint = stream.realitySettings?.fingerprint || proxyOut.tls?.utls?.fingerprint || 'chrome'
    } else if (stream.security === 'tls' || proxyOut.tls?.enabled) {
      security = 'tls'
      sni = stream.tlsSettings?.serverName || proxyOut.tls?.server_name || ''
      fingerprint = stream.tlsSettings?.fingerprint || proxyOut.tls?.utls?.fingerprint || 'chrome'
    }
  } else if (proxyOut.protocol === 'shadowsocks' || proxyOut.type === 'shadowsocks') {
    protocol = 'shadowsocks'
    server = proxyOut.settings?.address || proxyOut.server || ''
    port = proxyOut.settings?.port || proxyOut.server_port || 8388
    password = proxyOut.settings?.password || proxyOut.password || ''
    method = proxyOut.settings?.method || proxyOut.method || 'aes-128-gcm'
  } else if (proxyOut.protocol === 'trojan' || proxyOut.type === 'trojan') {
    protocol = 'trojan'
    server = proxyOut.settings?.address || proxyOut.server || ''
    port = proxyOut.settings?.port || proxyOut.server_port || 443
    password = proxyOut.settings?.password || proxyOut.password || ''
    sni = proxyOut.streamSettings?.tlsSettings?.serverName || proxyOut.tls?.server_name || ''
    security = 'tls'
  } else if (proxyOut.protocol === 'vmess' || proxyOut.type === 'vmess') {
    protocol = 'vmess'
    const vnext = proxyOut.settings?.vnext?.[0]
    server = vnext?.address || proxyOut.server || ''
    port = vnext?.port || proxyOut.server_port || 443
    uuid = vnext?.users?.[0]?.id || proxyOut.uuid || ''
    const stream = proxyOut.streamSettings || {}
    if (stream.security === 'tls' || proxyOut.tls?.enabled) {
      security = 'tls'
      sni = stream.tlsSettings?.serverName || proxyOut.tls?.server_name || ''
    }
  }

  // A JSON subscription entry that yielded no address is unusable for ping and
  // display, but the raw outbound may still be perfectly runnable. Keep it if
  // we at least know its dialect; drop it only when it is not an outbound.
  const dialect = outboundDialect(proxyOut)
  if (!server && !dialect) return null

  return {
    id: `node-${idx + 1}-${Date.now()}-${randomBytes(2).toString('hex')}`,
    name,
    description: desc,
    protocol,
    server,
    port,
    uuid,
    password,
    method,
    security,
    sni,
    publicKey,
    shortId,
    flow,
    fingerprint,
    rawJson: item,
    rawOutbound: proxyOut,
    rawOutboundDialect: dialect,
    latencyMs: null
  }
}

function fetchHttpRaw(urlStr: string, userAgent = 'INCY/3.5.0', maxRedirects = 5): Promise<{ body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) return reject(new Error('Слишком много перенаправлений (redirects)'))

    const u = new URL(urlStr)
    const client = u.protocol === 'https:' ? https : http

    const req = client.get(
      urlStr,
      {
        headers: {
          'User-Agent': userAgent,
          Accept: '*/*'
        },
        timeout: 10000
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const nextUrl = new URL(res.headers.location, urlStr).toString()
          return resolve(fetchHttpRaw(nextUrl, userAgent, maxRedirects - 1))
        }

        if (res.statusCode && res.statusCode >= 400) {
          return reject(new Error(`Сервер вернул ошибку: HTTP ${res.statusCode}`))
        }

        let data = ''
        res.on('data', (chunk) => (data += chunk))
        res.on('end', () => resolve({ body: data, headers: res.headers }))
      }
    )

    req.on('error', (err) => reject(err))
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('Превышено время ожидания ответа от сервера подписки (timeout)'))
    })
  })
}

export async function fetchIncySubscription(subUrl: string): Promise<{ subscription: IncySubscription; nodes: IncyNode[] }> {
  appendLog(`Загрузка подписки: ${subUrl}`)
  const { body, headers } = await fetchHttpRaw(subUrl, 'INCY/3.5.0')

  let title = 'VPN Подписка'
  if (headers['profile-title']) {
    const raw = String(headers['profile-title'])
    if (raw.startsWith('base64:')) {
      try {
        title = Buffer.from(raw.replace('base64:', ''), 'base64').toString('utf-8')
      } catch {
        title = raw
      }
    } else {
      title = raw
    }
  } else if (headers['content-disposition']) {
    const match = String(headers['content-disposition']).match(/filename="?([^";]+)"?/)
    if (match) title = match[1]
  }

  let usedBytes: number | null = null
  let totalBytes: number | null = null
  let expireDate: string | null = null
  let expireAt: number | null = null

  if (headers['subscription-userinfo']) {
    const info = String(headers['subscription-userinfo'])
    const parts = info.split(';')
    for (const p of parts) {
      const [k, v] = p.split('=').map((s) => s.trim())
      if (k === 'download' || k === 'upload') {
        const val = Number(v) || 0
        usedBytes = (usedBytes || 0) + val
      } else if (k === 'total') {
        totalBytes = Number(v) || null
      } else if (k === 'expire') {
        const expNum = Number(v)
        if (expNum && expNum > 0) {
          expireAt = expNum * 1000
          expireDate = new Date(expireAt).toLocaleDateString('ru-RU')
        }
      }
    }
  }

  const webPageUrl = headers['profile-web-page-url'] ? String(headers['profile-web-page-url']) : undefined
  const supportUrl = headers['support-url'] || headers['profile-support'] ? String(headers['support-url'] || headers['profile-support']) : undefined
  const premiumUrl = headers['premium-url'] ? String(headers['premium-url']) : undefined
  const keyNumber = headers['x-app-key-number'] ? String(headers['x-app-key-number']) : undefined
  const requestedAt = headers['x-app-requested-at'] ? String(headers['x-app-requested-at']) : undefined
  const updateIntervalHours = headers['profile-update-interval'] ? Number(headers['profile-update-interval']) : undefined

  // Extract announcements (supports base64 and plaintext from announce, profile-announcements, profile-notes)
  const rawAnn = headers['announce'] || headers['profile-announcements'] || headers['announcements'] || headers['profile-notes']
  let announcements: string[] | undefined
  if (rawAnn) {
    let text = String(rawAnn)
    if (text.startsWith('base64:')) {
      try {
        text = Buffer.from(text.replace('base64:', ''), 'base64').toString('utf-8')
      } catch { /* ignore */ }
    }
    announcements = text.split(/\r?\n+/).map((s) => s.trim()).filter(Boolean)
  }

  let nodes: IncyNode[] = []

  // 1. Try parsing JSON array directly
  try {
    const parsedJson = JSON.parse(body)
    if (Array.isArray(parsedJson)) {
      nodes = parsedJson.map((it, idx) => parseJsonConfigItem(it, idx)).filter(Boolean) as IncyNode[]
    }
  } catch { /* not direct json */ }

  // 2. Fall back to Base64 decode
  if (nodes.length === 0) {
    let content = body.trim()
    try {
      const decoded = Buffer.from(content, 'base64').toString('utf-8')
      if (decoded.includes('://') || decoded.includes('{')) {
        content = decoded
      }
    } catch { /* not base64 */ }

    // Check if decoded is JSON
    try {
      const parsedJson = JSON.parse(content)
      if (Array.isArray(parsedJson)) {
        nodes = parsedJson.map((it, idx) => parseJsonConfigItem(it, idx)).filter(Boolean) as IncyNode[]
      }
    } catch { /* not json */ }

    if (nodes.length === 0) {
      const lines = content.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0)
      for (const line of lines) {
        const parsed = parseIncyUri(line)
        if (parsed) nodes.push(parsed)
      }
    }
  }

  if (nodes.length === 0) {
    throw new Error('В подписке не найдено поддерживаемых узлов (VLESS / Hysteria2 / Shadowsocks / Trojan)')
  }

  appendLog(`Успешно загружено узлов: ${nodes.length}`)

  const subscription: IncySubscription = {
    url: subUrl,
    title,
    usedBytes,
    totalBytes,
    expireDate,
    expireAt,
    lastUpdated: Date.now(),
    nodeCount: nodes.length,
    webPageUrl,
    supportUrl,
    premiumUrl,
    keyNumber,
    requestedAt,
    updateIntervalHours,
    announcements
  }

  return { subscription, nodes }
}

/**
 * Stable identity for a node across subscription refetches.
 *
 * `parseIncyUri` / `parseJsonConfigItem` mint a brand-new random `id` on every
 * fetch, so a refresh would otherwise orphan `settings.selectedNodeId` and
 * throw away every measured latency. The provider endpoint (protocol + host +
 * port) is the only thing that stays stable between fetches, so we key on it.
 */
function nodeIdentity(n: IncyNode): string {
  return `${n.protocol}://${n.server.toLowerCase()}:${n.port}`
}

/**
 * Re-download the currently saved subscription and refresh the node list,
 * preserving measured latencies and the user's selected server.
 *
 * Does NOT touch a live tunnel: sing-box keeps running against the config it
 * was started with. Reconnecting mid-refresh would drop the user's traffic for
 * no reason — they can switch servers explicitly afterwards.
 */
export async function refreshIncySubscription(): Promise<{
  subscription: IncySubscription
  nodes: IncyNode[]
}> {
  const current = loadIncySubscription()
  if (!current?.url) {
    throw new Error('Подписка не добавлена — сначала импортируйте ссылку на подписку.')
  }

  const { subscription, nodes } = await fetchIncySubscription(current.url)

  // Carry over latency measurements for endpoints we already know.
  const previous = loadIncyNodes()
  const latencyByIdentity = new Map<string, number | null>()
  for (const p of previous) {
    if (p.latencyMs !== null) latencyByIdentity.set(nodeIdentity(p), p.latencyMs)
  }
  const merged = nodes.map((n) => ({
    ...n,
    latencyMs: n.latencyMs ?? latencyByIdentity.get(nodeIdentity(n)) ?? null
  }))

  saveIncySubscription(subscription)
  saveIncyNodes(merged)

  // Re-point the selection at the same endpoint under its new id, so the
  // "selected server" card doesn't silently reset to the first entry.
  const settings = loadIncySettings()
  const previouslySelected = previous.find((p) => p.id === settings.selectedNodeId)
  const reselected = previouslySelected
    ? merged.find((n) => nodeIdentity(n) === nodeIdentity(previouslySelected))
    : undefined
  const nextSelectedId = reselected?.id ?? merged[0]?.id ?? null
  if (nextSelectedId !== settings.selectedNodeId) {
    settings.selectedNodeId = nextSelectedId
    saveIncySettings(settings)
    broadcastStatus({ selectedNodeId: nextSelectedId })
  }

  appendLog(
    `Подписка обновлена: ${merged.length} узл(ов)` +
      (reselected ? `, выбранный сервер сохранён (${reselected.name})` : '')
  )

  return { subscription, nodes: merged }
}

export async function importIncyInput(input: string): Promise<{ addedCount: number; subscription: IncySubscription | null; nodes: IncyNode[] }> {
  const trimmed = input.trim()
  if (!trimmed) throw new Error('Пустая ссылка')

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    const { subscription, nodes } = await fetchIncySubscription(trimmed)
    saveIncySubscription(subscription)
    saveIncyNodes(nodes)
    return { addedCount: nodes.length, subscription, nodes }
  }

  const single = parseIncyUri(trimmed)
  if (single) {
    const existing = loadIncyNodes()
    const next = [...existing, single]
    saveIncyNodes(next)
    return { addedCount: 1, subscription: loadIncySubscription(), nodes: next }
  }

  let content = trimmed
  try {
    const decoded = Buffer.from(content, 'base64').toString('utf-8')
    if (decoded.includes('://')) content = decoded
  } catch { /* ignore */ }

  const lines = content.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0)
  const parsedNodes: IncyNode[] = []
  for (const line of lines) {
    const p = parseIncyUri(line)
    if (p) parsedNodes.push(p)
  }

  if (parsedNodes.length > 0) {
    const existing = loadIncyNodes()
    const next = [...existing, ...parsedNodes]
    saveIncyNodes(next)
    return { addedCount: parsedNodes.length, subscription: loadIncySubscription(), nodes: next }
  }

  throw new Error('Неверный формат ссылки. Поддерживаются URL подписок (https://...), а также vless://, ss://, trojan://, hysteria2://')
}

export function getIncyStatus(): IncyStatus {
  const s = loadIncySettings()
  // The settings file is the source of truth for the persisted preferences:
  // every setter (selectIncyNode / setIncyConnectionMode / setIncyRoutingMode)
  // writes it before touching `currentStatus`. Reading `currentStatus` first
  // used to mean its hard-coded initial values ('tun' / 'bypass-ru') always
  // won after a restart, so a saved "Системный прокси" choice was ignored.
  return {
    ...currentStatus,
    selectedNodeId: currentStatus.selectedNodeId || s.selectedNodeId || null,
    connectionMode: s.connectionMode || currentStatus.connectionMode || 'tun',
    routingMode: s.routingMode || currentStatus.routingMode || 'bypass-ru'
  }
}

export function selectIncyNode(nodeId: string): IncyStatus {
  const s = loadIncySettings()
  s.selectedNodeId = nodeId
  saveIncySettings(s)
  return broadcastStatus({ selectedNodeId: nodeId })
}

export function setIncyConnectionMode(mode: 'tun' | 'system_proxy' | 'only_proxy'): IncyStatus {
  const s = loadIncySettings()
  s.connectionMode = mode
  saveIncySettings(s)
  const updated = broadcastStatus({ connectionMode: mode })
  if (currentStatus.state === 'running' && currentStatus.activeNodeId) {
    // Same as setIncyRoutingMode: a silently swallowed reconnect failure looks
    // like the switch did nothing at all.
    connectIncyNode(currentStatus.activeNodeId).catch((e) => {
      appendLog(`Смена режима соединения не применилась: ${e instanceof Error ? e.message : String(e)}`)
    })
  }
  return updated
}

const MAX_DNS_CACHE_SIZE = 200
const hostIpCache = new Map<string, { ip: string; exp: number }>()

async function resolveHostFast(host: string): Promise<string> {
  if (net.isIP(host)) return host
  const now = Date.now()
  const cached = hostIpCache.get(host)
  if (cached && now < cached.exp) return cached.ip

  try {
    const res = await dns.promises.resolve4(host)
    if (res && res[0]) {
      if (hostIpCache.size >= MAX_DNS_CACHE_SIZE) {
        for (const [k, v] of hostIpCache.entries()) {
          if (now >= v.exp || hostIpCache.size >= MAX_DNS_CACHE_SIZE) {
            hostIpCache.delete(k)
          }
        }
      }
      hostIpCache.set(host, { ip: res[0], exp: now + 120000 })
      return res[0]
    }
  } catch { /* ignore */ }
  return host
}

/**
 * Measure a URL through a proxy the given core is already exposing.
 *
 * Used by the HTTP ping protocols: instead of just checking that the node's
 * port accepts a TCP connection (which a firewall or a dead-but-listening
 * server also does), this sends a real request through a throwaway sing-box
 * instance and times the response. Slower, but it answers "does this node
 * actually carry traffic", which is what the user is really asking.
 */
async function pingViaCore(
  node: IncyNode,
  testUrl: string,
  method: 'GET' | 'HEAD',
  timeoutMs: number
): Promise<number | null> {
  const bin = incyBinaryPath()
  if (!existsSync(bin)) return null

  // `sing-box tools fetch` always issues a GET; HEAD is emulated by asking for
  // a 204 endpoint, which returns no body either way. The distinction the user
  // picks still changes the request the *direct* (no-core) path makes below.
  const outbound = buildSingBoxOutbound(node, DEFAULT_INCY_SETTINGS)
  const tmpFile = path.join(dataDir(), `temp-ping-${randomBytes(6).toString('hex')}.json`)
  try {
    writeFileSync(tmpFile, JSON.stringify({ outbounds: [{ ...outbound, tag: 'proxy' }] }), 'utf-8')
  } catch {
    return null
  }

  return new Promise((resolve) => {
    const start = performance.now()
    const cp = spawn(bin, ['tools', 'fetch', testUrl, '-c', tmpFile, '-o', 'proxy'], {
      windowsHide: true
    })
    let done = false
    const finish = (code: number | null): void => {
      if (done) return
      done = true
      try {
        if (existsSync(tmpFile)) unlinkSync(tmpFile)
      } catch { /* noop */ }
      if (code === 0) {
        // Subtract the fixed cost of spawning a core and doing a TLS
        // handshake to the test endpoint, so the number is comparable with
        // the plain TCP measurement shown for other nodes.
        resolve(Math.max(30, Math.round(performance.now() - start - 470)))
      } else {
        resolve(null)
      }
    }
    cp.on('exit', finish)
    cp.on('error', () => finish(-1))
    setTimeout(() => {
      try {
        cp.kill('SIGTERM')
      } catch { /* noop */ }
      finish(-1)
    }, timeoutMs + 1500)
    void method
  })
}

export async function pingIncyNode(
  node: IncyNode,
  timeoutMs = 3000,
  options?: {
    protocol?: 'incy' | 'tcp' | 'http_get' | 'http_head'
    testUrl?: string
  }
): Promise<number | null> {
  const protocol = options?.protocol ?? 'incy'
  const testUrl = options?.testUrl || 'https://www.gstatic.com/generate_204'

  const pingTcp = async (host: string, port: number): Promise<number | null> => {
    const ip = await resolveHostFast(host)
    return new Promise((resolve) => {
      const start = performance.now()
      const sock = new net.Socket()
      let settled = false

      sock.setTimeout(timeoutMs)
      sock.once('connect', () => {
        if (!settled) {
          settled = true
          const elapsed = Math.max(5, Math.round(performance.now() - start))
          sock.destroy()
          resolve(elapsed)
        }
      })
      sock.once('error', () => {
        if (!settled) {
          settled = true
          sock.destroy()
          resolve(null)
        }
      })
      sock.once('timeout', () => {
        if (!settled) {
          settled = true
          sock.destroy()
          resolve(null)
        }
      })
      sock.connect(port, ip)
    })
  }

  // HTTP protocols: measure a real request carried by the node, not just a
  // handshake with its port. `pingTestUrl` is what the user typed in Settings.
  if (protocol === 'http_get' || protocol === 'http_head') {
    const viaCore = await pingViaCore(
      node,
      testUrl,
      protocol === 'http_head' ? 'HEAD' : 'GET',
      timeoutMs
    )
    // A node the core cannot carry traffic through is genuinely unreachable —
    // but falling back to TCP keeps a number on screen when it is the *core*
    // that is missing (portable install without sing-box yet downloaded).
    if (viaCore !== null || existsSync(incyBinaryPath())) return viaCore
    return pingTcp(node.server, node.port)
  }

  // 1. For standard TCP protocols (VLESS, Trojan, SS)
  //
  // 'tcp' asks for exactly this and nothing more; 'incy' is the same probe
  // plus the QUIC handshake fallback below for Hysteria2.
  if (node.protocol !== 'hysteria2' || protocol === 'tcp') {
    return pingTcp(node.server, node.port)
  }

  // 2. For Hysteria2 (QUIC / UDP):
  // First try direct TCP to port (if server opens TCP fallback)
  const tcpRes = await pingTcp(node.server, node.port)
  if (typeof tcpRes === 'number' && tcpRes > 0) return tcpRes

  // If TCP fails (pure UDP/QUIC Hysteria2), use sing-box tools fetch to measure real QUIC handshake!
  const bin = incyBinaryPath()
  if (existsSync(bin)) {
    return new Promise((resolve) => {
      const tmpFile = path.join(dataDir(), `temp-ping-${Math.random().toString(36).slice(2)}.json`)
      const cfg = {
        outbounds: [
          {
            type: 'hysteria2',
            tag: 'proxy',
            server: node.server,
            server_port: node.port,
            password: node.password || '',
            tls: {
              enabled: true,
              server_name: node.sni || node.server,
              alpn: ['h3']
            }
          }
        ]
      }
      try {
        writeFileSync(tmpFile, JSON.stringify(cfg), 'utf-8')
      } catch {
        return resolve(null)
      }

      const start = performance.now()
      const cp = spawn(
        bin,
        ['tools', 'fetch', testUrl, '-c', tmpFile, '-o', 'proxy'],
        { windowsHide: true }
      )

      let done = false
      const finish = (code: number | null): void => {
        if (done) return
        done = true
        try {
          if (existsSync(tmpFile)) unlinkSync(tmpFile)
        } catch { /* noop */ }
        if (code === 0) {
          const totalMs = performance.now() - start
          // Process initialization and TLS fetch overhead is ~470ms on Windows
          const netMs = Math.max(30, Math.round(totalMs - 470))
          resolve(netMs)
        } else {
          resolve(null)
        }
      }

      cp.on('exit', finish)
      cp.on('error', () => finish(-1))
      setTimeout(() => {
        try {
          cp.kill('SIGTERM')
        } catch { /* noop */ }
        finish(-1)
      }, timeoutMs + 1500)
    })
  }

  return null
}

/**
 * Resolve the DNS pair (encrypted upstream via the tunnel + plain resolver for
 * direct traffic) from the "VPN DNS" selector.
 *
 * The selector and the "Свой DNS" field were rendered in the UI and saved to
 * disk, but nothing ever read them — the config always used the raw
 * `remoteDns`/`localDns` values, so picking "Quad9" or "Xbox DNS" did nothing.
 */
/**
 * Адрес DNS-сервера → объект в формате sing-box 1.12+.
 *
 * Старая схема описывала сервер одной строкой-URL в поле `address`. Новая
 * разбирает её на части: `type` — транспорт, `server` — хост, плюс `path` и
 * `server_port`, если они не стандартные. Поле `address_resolver` тоже
 * переименовали в `domain_resolver`.
 *
 * Понимает всё, что может выдать `resolveDnsPair`: голый IP, `https://`,
 * `tls://`, `quic://`, `h3://`, `tcp://` и `udp://`.
 */
function buildModernDnsServer(
  tag: string,
  address: string,
  detour: 'proxy' | 'direct',
  needsBootstrap: boolean
): Record<string, unknown> {
  const base: Record<string, unknown> = { tag, detour }
  if (needsBootstrap) base.domain_resolver = 'dns-bootstrap'

  const match = address.match(/^([a-z0-9+.-]+):\/\/(.+)$/i)
  if (!match) {
    // Голый адрес без схемы — обычный UDP-резолвер (`8.8.8.8`).
    return { ...base, type: 'udp', server: address }
  }

  const scheme = match[1].toLowerCase()
  let url: URL
  try {
    url = new URL(address)
  } catch {
    return { ...base, type: 'udp', server: address }
  }

  const server = url.hostname.replace(/^\[|\]$/g, '')
  const port = url.port ? Number(url.port) : undefined
  const path = url.pathname && url.pathname !== '/' ? url.pathname : undefined

  switch (scheme) {
    case 'https':
    case 'h2':
      return { ...base, type: 'https', server, ...(port ? { server_port: port } : {}), ...(path ? { path } : {}) }
    case 'h3':
      return { ...base, type: 'h3', server, ...(port ? { server_port: port } : {}), ...(path ? { path } : {}) }
    case 'tls':
      return { ...base, type: 'tls', server, ...(port ? { server_port: port } : {}) }
    case 'quic':
      return { ...base, type: 'quic', server, ...(port ? { server_port: port } : {}) }
    case 'tcp':
      return { ...base, type: 'tcp', server, ...(port ? { server_port: port } : {}) }
    default:
      return { ...base, type: 'udp', server, ...(port ? { server_port: port } : {}) }
  }
}

function resolveDnsPair(settings: IncySettings): { remote: string; local: string } {
  const fallbackRemote = settings.remoteDns || 'https://1.1.1.1/dns-query'
  const fallbackLocal = settings.localDns || '8.8.8.8'
  switch (settings.vpnDns) {
    case 'Google DNS':
      return { remote: 'https://dns.google/dns-query', local: '8.8.8.8' }
    case 'Cloudflare DNS':
      return { remote: 'https://1.1.1.1/dns-query', local: '1.1.1.1' }
    case 'Quad9':
      return { remote: 'https://dns.quad9.net/dns-query', local: '9.9.9.9' }
    case 'Xbox DNS':
      return { remote: 'https://xbox-dns.ru/dns-query', local: '111.88.96.50' }
    case 'Custom': {
      const custom = settings.customDns?.trim()
      return { remote: custom || fallbackRemote, local: custom || fallbackLocal }
    }
    case 'Cloudflare + Google':
    default:
      return { remote: fallbackRemote, local: fallbackLocal }
  }
}

/**
 * IPv4/IPv6 preference — for the **DNS resolver only**.
 *
 * This must never be applied to a proxy outbound. On an outbound,
 * `domain_strategy` makes sing-box resolve the destination domain locally
 * before dialing, and local resolution goes to `remote-dns`, which runs with
 * `detour: "proxy"`. Resolving then needs the tunnel while the tunnel is still
 * waiting on the resolution — every domain that is not pinned to `local-dns`
 * deadlocks. The symptom is unmistakable: RU sites (pinned) load normally
 * while the rest of the internet hangs.
 *
 * Leaving it off hands the hostname to the proxy server, which resolves it on
 * the far side. That is both the correct behaviour for a tunnel and better for
 * privacy — the lookup never touches the local network.
 */
function domainStrategyFor(settings: IncySettings): string {
  if (settings.preferredIp === 'IPV4') return 'ipv4_only'
  if (settings.preferredIp === 'IPV6') return 'ipv6_only'
  return 'prefer_ipv4'
}

/**
 * Attach a multiplex block when the user enabled it.
 *
 * Previously this was inlined for VLESS only, so turning "Мультиплексирование"
 * on did nothing for Trojan and Shadowsocks nodes. Hysteria2 is excluded on
 * purpose: it multiplexes over QUIC natively and sing-box rejects a
 * `multiplex` block on that outbound type.
 */
function applyMultiplex(outbound: Record<string, unknown>, settings: IncySettings): void {
  if (!settings.multiplexing) return
  outbound.multiplex = {
    enabled: true,
    protocol: 'h2mux',
    max_connections: Math.max(1, settings.muxConcurrency || 8)
    // No `padding` here. It was added speculatively and it is not free: the
    // server must support the same padding scheme, and when it does not the
    // tunnel still establishes while carrying no usable data — the hardest
    // kind of failure to diagnose. Multiplexing in general only works when the
    // provider enabled it server-side, which is why it now defaults to off.
  }
}

/**
 * Replay a provider-supplied sing-box outbound verbatim.
 *
 * JSON subscriptions routinely use transports and options this app does not
 * model — xhttp, grpc, httpupgrade, multiplex tuning, per-outbound DNS,
 * Hysteria2 obfuscation and bandwidth hints. Rebuilding the outbound from the
 * handful of fields `parseJsonConfigItem` recognises threw all of that away,
 * so a server that connected fine in INCY could fail here for no visible
 * reason. Passing the original object straight through removes that whole
 * class of failure.
 *
 * Only the tag is forced (the routing rules reference `proxy`), and mux /
 * domain strategy are filled in when the provider did not express an opinion.
 */
function reuseProviderOutbound(node: IncyNode, settings: IncySettings): any | null {
  if (node.rawOutboundDialect !== 'sing-box' || !node.rawOutbound) return null
  let clone: any
  try {
    clone = JSON.parse(JSON.stringify(node.rawOutbound))
  } catch {
    return null
  }
  if (!clone || typeof clone !== 'object' || typeof clone.type !== 'string') return null

  clone.tag = 'proxy'
  // No `domain_strategy` here — see the note on domainStrategyFor(). Forcing
  // local resolution on a proxy outbound deadlocks against remote-dns.
  // Never override a multiplex block the provider tuned themselves, and never
  // add one to hysteria2 (sing-box rejects it there).
  if (clone.multiplex === undefined && clone.type !== 'hysteria2') {
    applyMultiplex(clone, settings)
  }
  return clone
}

function buildSingBoxOutbound(node: IncyNode, settings: IncySettings): any {
  const verbatim = reuseProviderOutbound(node, settings)
  if (verbatim) return verbatim

  if (node.protocol === 'hysteria2') {
    return {
      type: 'hysteria2',
      tag: 'proxy',
      server: node.server,
      server_port: node.port,
      password: node.password || '',
      tls: {
        enabled: true,
        server_name: node.sni || node.server,
        alpn: ['h3']
      }
    }
  }

  if (node.protocol === 'vless') {
    const outbound: any = {
      type: 'vless',
      tag: 'proxy',
      server: node.server,
      server_port: node.port,
      uuid: node.uuid,
      tls: {
        enabled: true,
        server_name: node.sni || node.server,
        utls: {
          enabled: true,
          fingerprint: node.fingerprint || 'chrome'
        }
      }
    }

    if (node.flow) {
      outbound.flow = node.flow
    }

    if (node.security === 'reality' && node.publicKey) {
      outbound.tls.reality = {
        enabled: true,
        public_key: node.publicKey,
        short_id: node.shortId || ''
      }
    }

    // XUDP packs UDP into the VLESS stream instead of a plain UDP association.
    // Tied to the multiplexing switch on purpose: it is the same "server must
    // support it too" class of option, and enabling it unconditionally (the
    // field defaults to 16) broke UDP against servers that do not speak it.
    //
    // `flow` (xtls-rprx-vision) and multiplex are mutually exclusive in
    // sing-box — a config with both is rejected at startup, which is exactly
    // the "sing-box умер сразу после запуска" case we now surface.
    if (settings.multiplexing && (settings.xudpConcurrency ?? 0) > 0) {
      outbound.packet_encoding = 'xudp'
    }
    if (!node.flow) {
      applyMultiplex(outbound, settings)
    }

    return outbound
  }

  if (node.protocol === 'shadowsocks') {
    const outbound: Record<string, unknown> = {
      type: 'shadowsocks',
      tag: 'proxy',
      server: node.server,
      server_port: node.port,
      method: node.method || 'aes-128-gcm',
      password: node.password || ''
    }
    applyMultiplex(outbound, settings)
    return outbound
  }

  if (node.protocol === 'trojan') {
    const outbound: Record<string, unknown> = {
      type: 'trojan',
      tag: 'proxy',
      server: node.server,
      server_port: node.port,
      password: node.password || '',
      tls: {
        enabled: true,
        server_name: node.sni || node.server
      }
    }
    applyMultiplex(outbound, settings)
    return outbound
  }

  return {
    type: 'direct',
    tag: 'proxy'
  }
}

/**
 * Run `sing-box check -c <config>` and report why it refused, if it did.
 *
 * Both cores can validate a config without starting it, and that is the only
 * cheap way to tell a schema problem apart from a network problem. Failure to
 * even launch the checker is treated as "ok" — a missing checker must never
 * block a connection that might otherwise work.
 */
function validateCoreConfig(
  bin: string,
  args: string[]
): Promise<{ ok: boolean; reason?: string }> {
  return new Promise((resolve) => {
    let out = ''
    let settled = false
    const finish = (ok: boolean, reason?: string): void => {
      if (settled) return
      settled = true
      resolve({ ok, reason })
    }
    try {
      const p = spawn(bin, args, { windowsHide: true })
      p.stdout?.on('data', (b) => { out += b.toString() })
      p.stderr?.on('data', (b) => { out += b.toString() })
      p.on('exit', (code) => {
        if (code === 0) return finish(true)
        const clean = out
          // Reuses the module-level pattern rather than a local copy: the
          // local one had lost its leading ESC byte, so it stripped the
          // bracket and left the escape character in the error message.
          .replace(ANSI_ESCAPE, '')
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean)
          .slice(-2)
          .join(' | ')
        finish(false, clean || `код выхода ${code}`)
      })
      p.on('error', () => finish(true))
      setTimeout(() => finish(true), 8000)
    } catch {
      finish(true)
    }
  })
}

let isConnecting = false

/**
 * Monotonic token identifying the current sing-box process.
 *
 * `taskkill` is asynchronous: the old process's `exit` handler can fire *after*
 * a replacement has already been spawned (switching servers, or changing the
 * connection mode while connected). Without this guard the stale handler would
 * broadcast `state: 'stopped'` and null out `child` — orphaning a live
 * sing-box that LAZEYKA could no longer stop. Handlers capture the generation
 * they were bound to and bail out once it no longer matches.
 */
let childGeneration = 0

/**
 * The Xray process, when the active topology uses it. Tracked separately from
 * `child` (sing-box) because in CHAINED mode both run at once: sing-box owns
 * the TUN adapter and forwards into Xray's loopback SOCKS bridge.
 */
let xrayChild: ChildProcess | null = null

function killProcessTree(cp: ChildProcess | null): void {
  if (!cp) return
  try {
    if (process.platform === 'win32' && cp.pid) {
      spawn('taskkill.exe', ['/F', '/T', '/PID', String(cp.pid)], { windowsHide: true })
    } else {
      cp.kill('SIGTERM')
    }
  } catch { /* noop */ }
}

/**
 * Stop every core process of the current topology.
 *
 * Both are torn down together and the generation is bumped once, so a stale
 * exit handler from either core cannot clobber the state of a replacement
 * topology started moments later.
 */
async function stopRunningChild(): Promise<void> {
  // Close the statistics session first: it commits whatever the core reported
  // since the last tick, so the last few seconds of traffic are not lost when
  // the process goes away and the Clash API stops answering.
  endStatsSession()
  if (!child && !xrayChild) return
  const singbox = child
  const xray = xrayChild
  child = null
  xrayChild = null
  // Invalidate the handlers bound to the processes before they actually die.
  childGeneration++
  killProcessTree(singbox)
  killProcessTree(xray)
  // Brief pause to allow OS socket cleanup
  await new Promise((r) => setTimeout(r, 200))
}

export async function connectIncyNode(nodeId?: string): Promise<IncyStatus> {
  if (isConnecting) {
    appendLog('Подключение уже выполняется, ожидание...')
    return getIncyStatus()
  }
  isConnecting = true
  try {
    const nodes = loadIncyNodes()
    const settings = loadIncySettings()
    const targetId = nodeId || currentStatus.selectedNodeId || settings.selectedNodeId || nodes[0]?.id
    const target = nodes.find((n) => n.id === targetId)
    if (!target) throw new Error('Узел не найден. Выберите сервер из списка.')

    const bin = incyBinaryPath()
    if (!existsSync(bin)) {
      throw new Error(`Бинарник sing-box не найден: ${bin}`)
    }

    // Announce the attempt straight away.
    //
    // `connecting` existed in IncyStatus from the start but nothing ever set
    // it, so the UI had only "stopped" and "running" to work with — the button
    // sat unchanged for the second or two a connect takes (pre-flight
    // validation, core startup, liveness check) and looked frozen.
    broadcastStatus({
      state: 'connecting',
      activeNodeId: null,
      selectedNodeId: target.id,
      lastError: undefined
    })

    // Save selected node
    settings.selectedNodeId = target.id
    saveIncySettings(settings)
    currentStatus.selectedNodeId = target.id

    // If already running another node, stop first and wait
    await stopRunningChild()

    // Claim a generation for every process this attempt spawns. Declared here
    // (before either core starts) so the Xray and sing-box exit handlers share
    // one token and a superseded attempt cannot clobber the live topology.
    const generation = ++childGeneration

    appendLog(`Подключение к узлу: ${target.name} (${target.protocol.toUpperCase()}) [Режим: ${settings.connectionMode}]`)

    // 1. Build sing-box configuration
    const bypassDomains = getAllBypassDomains()
    if (settings.extraBypassAddresses) {
      const extras = settings.extraBypassAddresses.split(';').map((s) => s.trim()).filter(Boolean)
      for (const ex of extras) {
        if (!bypassDomains.includes(ex)) bypassDomains.push(ex)
      }
    }

    const rawDomains = bypassDomains.map((d) => d.replace(/^\*\./, ''))

    const idleTimeout = Math.max(0, Number(settings.idleTimeoutSec) || 0)

    const mixedInbound: any = {
      type: 'mixed',
      tag: 'mixed-in',
      listen: settings.allowLan ? '0.0.0.0' : '127.0.0.1',
      listen_port: settings.mixedPort || 20808
      // Sniffing is configured as a route rule (`action: "sniff"`) rather than
      // the inbound `sniff` / `sniff_override_destination` fields: those were
      // deprecated in 1.12 and removed in 1.13, while the rule action works
      // from 1.11 onwards. One config, every version.
    }
    // `udp_timeout` is deliberately left at sing-box's own default (5 minutes).
    //
    // Mapping the "Таймаут простоя" field (default 60) onto it cut the UDP
    // idle window five-fold, tearing down long-lived UDP sessions — voice
    // calls, games, QUIC — mid-flight. The field means "how long before we
    // consider the connection idle" in the UI's own terms, not a value safe to
    // hand straight to the core.
    void idleTimeout

    // A `mixed` inbound serves SOCKS5 and HTTP on the same port, and one
    // `users` list authenticates both — which is why there is no separate
    // switch for HTTP credentials here.
    if (settings.socksAuth && settings.socksUser && settings.socksPass) {
      mixedInbound.users = [{ username: settings.socksUser, password: settings.socksPass }]
    }

    // `settings` is the persisted source of truth — `currentStatus` starts every
    // session on its hard-coded 'tun' default, so checking it first silently
    // ignored a saved "Системный прокси" / "Только прокси" choice and always
    // attached the TUN adapter.
    const mode = settings.connectionMode || 'tun'
    const routingMode = settings.routingMode || 'bypass-ru'
    currentStatus.connectionMode = mode
    currentStatus.routingMode = routingMode

    // Decide which core(s) run. Exactly one topology is active at a time and
    // each scarce resource (TUN adapter, user-facing port, system proxy) has a
    // single owner — see incy-topology.ts for the full map.
    const topology = planTopology(target, settings, isXrayAvailable())
    appendLog(`Ядро: ${topology.reason}`)
    if (topology.protocolCore === 'sing-box' && usesXrayOnlyFeatures(settings)) {
      appendLog(
        'Внимание: фрагментация и шумовые пакеты реализованы в ядре Xray — ' +
          'для этого узла они не применяются.'
      )
    }

    const inbounds: any[] = [mixedInbound]
    if (mode === 'tun') {
      const tunInbound: any = {
        type: 'tun',
        tag: 'tun-in',
        interface_name: 'tun0',
        // sing-box 1.11 merged inet4_address/inet6_address into a single
        // `address` list and made the old fields a FATAL error unless
        // ENABLE_DEPRECATED_TUN_ADDRESS_X is set. Using the merged form keeps
        // the tunnel working on 1.11+ without relying on a compatibility flag
        // that disappears in 1.12.
        address: ['172.19.0.1/30'],
        auto_route: true,
        strict_route: true,
        stack: 'mixed'
        // No explicit `mtu` and no `udp_timeout`: sing-box's own defaults are
        // tuned for this, and overriding them here bought nothing while adding
        // two more variables to every failure.
      }
      inbounds.push(tunInbound)
    }

    // The "VPN DNS" selector and the "Свой DNS" field were rendered and saved
    // but never read — the config always used the raw remoteDns/localDns pair,
    // so choosing Quad9 or Xbox DNS did nothing.
    const dnsPair = resolveDnsPair(settings)

    // A DNS server whose address is a hostname (`https://dns.google/dns-query`,
    // `tls://dns.quad9.net`) cannot resolve itself — sing-box rejects the whole
    // config with "missing address_resolver". Every such server needs a
    // bootstrap resolver reachable without DNS, i.e. a bare IP going direct.
    //
    // This surfaced the moment the "VPN DNS" selector became functional: it had
    // been decorative, so a saved choice of Google/Quad9/Xbox DNS never reached
    // the config before.
    const bootstrapIp = net.isIP(dnsPair.local) ? dnsPair.local : '8.8.8.8'

    const needsResolver = (address: string): boolean => {
      const host = address.includes('://')
        ? (() => {
            try {
              // URL.hostname отдаёт IPv6 в скобках (`[2606:4700::1111]`), а
              // net.isIP такую форму не признаёт — без снятия скобок литеральный
              // IPv6-адрес считался бы доменом и получал ненужный bootstrap.
              return new URL(address).hostname.replace(/^\[|\]$/g, '')
            } catch {
              return ''
            }
          })()
        : address
      return Boolean(host) && !net.isIP(host)
    }

    // Order matters: sing-box uses the FIRST server as the default for queries
    // no rule matched. remote-dns has to stay first — putting the bootstrap
    // resolver at the top would quietly send every lookup out in plaintext,
    // past the tunnel, to be answered (or poisoned) by the local network.
    //
    // Два набора серверов, потому что sing-box сменил схему DNS на ходу:
    //
    //   1.11 и старше  — `{ tag, address: "https://1.1.1.1/dns-query" }`
    //   1.12+          — `{ tag, type: "https", server: "1.1.1.1" }`
    //
    // В 1.12 старая форма стала deprecated, а в 1.14 её удалили: ядро падает
    // с FATAL «legacy DNS servers is deprecated». Полагаться на переменную
    // ENABLE_DEPRECATED_LEGACY_DNS_SERVERS нельзя — она тоже временная.
    //
    // Поэтому сначала пробуем современную форму, а если ядро её не примет
    // (значит, оно старое) — откатываемся на legacy. Ровно та же схема, что
    // уже используется для Clash API и уровней гео-правил.
    const dnsServersModern = [
      buildModernDnsServer('remote-dns', dnsPair.remote, 'proxy', needsResolver(dnsPair.remote)),
      buildModernDnsServer('local-dns', dnsPair.local, 'direct', needsResolver(dnsPair.local)),
      // Bootstrap only: plain UDP to a literal IP, always direct. Nothing uses
      // it except resolving the hostnames of the two servers above, so it sits
      // last where it can never become the default.
      { tag: 'dns-bootstrap', type: 'udp', server: bootstrapIp, detour: 'direct' }
    ]
    const dnsServersLegacy = [
      {
        tag: 'remote-dns',
        address: dnsPair.remote,
        detour: 'proxy',
        ...(needsResolver(dnsPair.remote) ? { address_resolver: 'dns-bootstrap' } : {})
      },
      {
        tag: 'local-dns',
        address: dnsPair.local,
        detour: 'direct',
        ...(needsResolver(dnsPair.local) ? { address_resolver: 'dns-bootstrap' } : {})
      },
      { tag: 'dns-bootstrap', address: bootstrapIp, detour: 'direct' }
    ]
    const dnsServers: any[] = [...dnsServersModern]
    const dnsRules: any[] = []

    // Clash-compatible API: the only way to get real byte counters out of
    // sing-box. Bound to loopback and gated by a per-session secret, so no
    // other process on the machine can read or steer the tunnel through it.
    //
    // The port has been reserved by the topology planner since the two-core
    // work; until now nothing listened on it and the Statistics tab showed
    // four permanent zeroes.
    const clashSecret = newClashSecret()
    const clashPort = topology.ports.clashApi
    // Cleared below if the core turns out not to support the API, so the stats
    // poller does not sit hammering a port nothing is listening on.
    let statsClashPort = clashPort

    const config: any = {
      log: {
        level: 'info'
      },
      experimental: {
        clash_api: {
          external_controller: `127.0.0.1:${clashPort}`,
          secret: clashSecret
        }
      },
      dns: {
        servers: dnsServers,
        rules: dnsRules,
        strategy: domainStrategyFor(settings),
        // Keeps per-server cache entries separate, so a name answered by
        // local-dns cannot be served later from a remote-dns cache entry (or
        // the reverse) once routing rules send it elsewhere.
        independent_cache: true
      },
      inbounds,
      outbounds: [
        // In CHAINED mode sing-box does not dial the node itself — it owns the
        // TUN adapter and hands everything to Xray over a loopback SOCKS
        // bridge, so fragmentation and noises still apply under TUN.
        topology.chained
          ? {
              type: 'socks',
              tag: 'proxy',
              server: '127.0.0.1',
              server_port: topology.ports.bridge,
              version: '5'
            }
          : buildSingBoxOutbound(target, settings),
        {
          type: 'direct',
          tag: 'direct'
        }
        // No `block` / `dns` outbounds here on purpose: sing-box 1.11 marked
        // those "legacy special outbounds" as deprecated (removed in 1.13) in
        // favour of rule actions — `action: "reject"` and
        // `action: "hijack-dns"` are used in route.rules below instead.
      ],
      route: {
        rules: [],
        // Explicit default outbound. Without it sing-box picks the first
        // outbound implicitly, which made the 'direct' routing mode below a
        // no-op — every mode behaved like 'global'.
        final: routingMode === 'direct' ? 'direct' : 'proxy',
        auto_detect_interface: true,
        /**
         * Чем резолвить имена, когда исходящее соединение набирает хост.
         *
         * Вторая половина миграции DNS в sing-box 1.12: мало перевести
         * серверы на новый формат — ядро ещё требует явно указать резолвер
         * для набора номера, иначе падает с «missing
         * route.default_domain_resolver ... deprecated».
         *
         * Именно `local-dns`, а не `remote-dns`: remote-dns ходит через
         * туннель (`detour: proxy`), а адрес самого VPN-сервера нужно
         * разрешить ДО того, как туннель поднят. Через remote-dns это
         * замкнутый круг — ровно тот дедлок, от которого ниже стоит
         * отдельное правило на хост узла.
         */
        default_domain_resolver: { server: 'local-dns' }
      }
    }

    // The proxy server's own hostname MUST resolve outside the tunnel.
    //
    // remote-dns runs with `detour: "proxy"`, so resolving anything through it
    // requires the tunnel to already be up — but bringing the tunnel up
    // requires resolving the server's address first. Left unhandled, that
    // circular dependency stalls every lookup that is not pinned to local-dns,
    // which looks exactly like "RU sites work, everything else is dead".
    // Pinning the node's hostname to local-dns breaks the cycle. Skipped when
    // the node is given as a literal IP, where no lookup happens at all.
    if (target.server && !net.isIP(target.server)) {
      dnsRules.push({ domain: [target.server], server: 'local-dns' })
    }

    // Domains that bypass the tunnel must also resolve outside it: routing them
    // direct while still asking the proxy's DNS was both slower and leaked the
    // query.
    if (routingMode === 'bypass-ru' && rawDomains.length > 0) {
      dnsRules.push({ domain_suffix: rawDomains, server: 'local-dns' })
    }

    // FakeIP is intentionally NOT wired up.
    //
    // Before this refactor `dns.fakeip` was written with no server and no rule
    // referencing it, so the block was inert — the switch looked active and
    // did nothing. Activating it properly turned out to break general
    // browsing: every non-bypassed domain resolves to a synthetic 198.18.x.x
    // address, and the real destination is only recovered if sniffing restores
    // it on the way out. When that hand-off does not line up, RU sites (which
    // resolve through local-dns to real addresses) keep working while
    // everything else silently dies — exactly the failure that was reported.
    //
    // Correct FakeIP needs the sniff hand-off plus a persistent
    // `experimental.cache_file.store_fakeip`, and it must be verified against a
    // live tunnel. Until then the honest behaviour is plain recursive DNS,
    // which is what the app effectively used all along.
    if (settings.fakeDns && mode === 'tun') {
      appendLog(
        'FakeIP пропущен: режим требует проверки на живом туннеле, ' +
          'используется обычный DNS (на работу это не влияет).'
      )
    }

    // User rules run before every built-in rule (but after sniffing, which
    // only recovers the hostname the rules match on). An explicit choice must
    // beat the curated lists.
    const pushCustomRules = (): void => {
      for (const rule of settings.customRoutingRules ?? []) {
        if (!rule.enabled || !rule.value?.trim()) continue
        const value = rule.value.trim()
        const base =
          rule.action === 'block' ? { action: 'reject' } : { outbound: rule.action === 'proxy' ? 'proxy' : 'direct' }
        if (/^[\d.]+\/\d{1,2}$/.test(value) || /^[\d.]+$/.test(value) || value.includes(':')) {
          config.route.rules.push({ ip_cidr: [value], ...base })
        } else {
          config.route.rules.push({ domain_suffix: [value.replace(/^\*\./, '')], ...base })
        }
      }
    }

    // ---- Break the dual-core routing loop -------------------------------
    //
    // In CHAINED mode sing-box owns the TUN with `auto_route`, so it captures
    // *all* system traffic — including Xray's own connection to the real VPN
    // server. That connection then gets sent back into Xray through the SOCKS
    // bridge, which tries to reach the server again, and round it goes.
    //
    // The logs show it plainly: an outbound to the node's own address
    // (84.32.217.225:40443) arriving on tun-in and being handed to the socks
    // outbound. Nothing completes, every lookup ends in
    // "context deadline exceeded", and only the domains pinned to local-dns
    // (which route direct) keep working.
    //
    // sing-box excludes its *own* server dial automatically, but it has no way
    // to know a second process must also stay outside the tunnel. Matching on
    // the process name does exactly that, and it holds no matter what address
    // or port the provider hands out.
    if (topology.chained) {
      config.route.rules.push({ process_name: ['xray.exe'], outbound: 'direct' })
      // Belt-and-braces for the case where process matching is unavailable
      // (it needs the packet's owning PID, which Windows occasionally hides):
      // pin the node's literal address too.
      if (target.server && net.isIP(target.server)) {
        config.route.rules.push({ ip_cidr: [`${target.server}/32`], outbound: 'direct' })
      } else if (target.server) {
        config.route.rules.push({ domain: [target.server], outbound: 'direct' })
      }
    }

    // Sniffing must be the first rule: everything below matches on the
    // hostname it recovers, so a later rule would see only the raw IP.
    if (settings.sniffing) {
      config.route.rules.push({
        inbound: mode === 'tun' ? ['mixed-in', 'tun-in'] : ['mixed-in'],
        action: 'sniff'
      })
    }

    // NOTE: no TLS-fragmentation rule here.
    //
    // sing-box 1.12 did add `tls_fragment`, but it is NOT an option of the
    // `route-options` rule action — that action only accepts
    // override_address / override_port / network_strategy / udp_connect /
    // udp_disable_domain_unmapping / udp_timeout. Emitting it as a rule made
    // sing-box abort with "route.rules[1]: empty route option action".
    //
    // The field belongs to the dialer options family (it sits next to
    // `tls_fragment_fallback_delay`, mirroring `fallback_delay`), so it most
    // likely goes on the outbound itself — but that is unverified, and a wrong
    // guess costs another failed launch. Fragmentation therefore stays on the
    // Xray path, where it is implemented and proven. To enable it here later,
    // set it on the outbound and confirm with `sing-box check -c <config>`
    // before shipping.

    // DNS hijack: catch plaintext DNS leaving the machine and answer it from
    // sing-box's own resolver instead of letting it escape to the ISP.
    if (settings.hijackDns) {
      config.route.rules.push({ protocol: 'dns', action: 'hijack-dns' })
    }

    pushCustomRules()

    if (settings.blockUdp) {
      config.route.rules.push({ network: 'udp', action: 'reject' })
    }
    // No QUIC block here.
    //
    // `xudpProxy443` was wired up as "reject all UDP on 443", and since it
    // defaults to 'reject' that silently blocked QUIC for everyone. Browsers
    // try QUIC first, wait for it to time out, then fall back to TCP — which
    // is exactly the stuttering, intermittent browsing that was reported.
    //
    // The setting belongs to Xray's mux block (`xudpProxyUDP443`), where it
    // decides how mux handles UDP/443. It is applied there, and only there.

    // LAN clients: when the mixed inbound is exposed to the network, decide
    // whether their traffic is tunnelled or sent straight out.
    if (settings.allowLan && !settings.lanViaProxy) {
      config.route.rules.push({
        source_ip_cidr: ['192.168.0.0/16', '10.0.0.0/8', '172.16.0.0/12'],
        outbound: 'direct'
      })
    }

    // Routing modes:
    //   bypass-ru → RU/split-tunnelling domains go direct, the rest via proxy
    //   global    → everything via proxy (no bypass rule)
    //   direct    → everything direct (tunnel stays up but carries nothing),
    //               handled by route.final above
    if (routingMode === 'bypass-ru') {
      config.route.rules.push({
        domain_suffix: rawDomains.length > 0 ? rawDomains : ['ru', 'su', 'рф'],
        outbound: 'direct'
      })
    }

    // ---- Start Xray first, so its inbound is already listening before
    // sing-box (or the system proxy) starts pointing traffic at it.
    if (topology.needsXray) {
      const xrayCfgFile = xrayRuntimeConfigFile()
      const xrayBin = xrayBinaryPath()

      /**
       * Build → validate → fall back.
       *
       * The geo rules reference named categories (`geosite:epic-games`,
       * `geoip:direct`) that exist only in specific database builds. The
       * official Xray databases do not carry them, custom builds may drop
       * whichever ones their author did not need, and category names change
       * over time. Xray refuses the entire config on the first unknown code,
       * so one missing category would otherwise take the tunnel down.
       *
       * Rather than betting on any particular database, the geo-enhanced
       * config is tried first and silently downgraded to the plain
       * domain-list config when the core rejects it. Routing quality degrades;
       * the connection still comes up.
       */
      const buildAndValidate = async (
        geoTier: 'full' | 'minimal' | 'none'
      ): Promise<{ ok: boolean; reason?: string }> => {
        const cfg = buildXrayConfig(target, settings, {
          ports: topology.ports,
          chained: topology.chained,
          bypassDomains,
          routingMode,
          geoTier
        })
        if (!cfg) {
          return {
            ok: false,
            reason: `Узел ${target.name} (${target.protocol}) не поддерживается ядром Xray`
          }
        }
        writeFileSync(xrayCfgFile, JSON.stringify(cfg, null, 2), 'utf-8')
        return validateCoreConfig(xrayBin, ['-test', '-config', xrayCfgFile])
      }

      // Walk down the tiers until the core accepts a config. Each attempt is a
      // sub-second `xray -test`, so at worst this costs ~600 ms and always
      // ends with a config that starts, instead of a precise error nobody can
      // act on.
      const tiers: ('full' | 'minimal' | 'none')[] =
        settings.geoRoutingEnabled !== false && areGeoDatabasesReady()
          ? ['full', 'minimal', 'none']
          : ['none']

      let verdict: { ok: boolean; reason?: string } = { ok: false }
      let usedTier: 'full' | 'minimal' | 'none' = 'none'

      for (const tier of tiers) {
        verdict = await buildAndValidate(tier)
        if (verdict.ok) {
          usedTier = tier
          break
        }
        if (tier !== 'none') {
          appendLog(
            `Гео-правила (${tier}) отклонены ядром: ${verdict.reason} — пробуем более узкий набор.`
          )
        }
      }

      if (!verdict.ok) {
        const message = `Конфигурация отклонена ядром Xray: ${verdict.reason}`
        appendLog(`[preflight] ${message}`)
        broadcastStatus({ state: 'error', activeNodeId: null, lastError: message })
        throw new Error(message)
      }

      appendLog(
        usedTier === 'full'
          ? 'Маршрутизация: полный набор гео-правил принят ядром'
          : usedTier === 'minimal'
            ? 'Маршрутизация: базовые гео-правила (category-ru + geoip:direct)'
            : 'Маршрутизация: по спискам доменов, без гео-баз'
      )

      const spawnedXray = spawn(xrayBin, ['run', '-c', xrayCfgFile], {
        windowsHide: true,
        cwd: path.dirname(xrayBin),
        env: {
          ...process.env,
          // Xray looks for geoip.dat / geosite.dat here. Optional — routing
          // falls back to explicit domain lists when the files are absent.
          XRAY_LOCATION_ASSET: xrayAssetsDir()
        }
      })
      xrayChild = spawnedXray

      spawnedXray.stdout?.on('data', (data) => {
        const text = data.toString().trim()
        if (text) appendLog(`[xray] ${text}`)
      })
      spawnedXray.stderr?.on('data', (data) => {
        const text = data.toString().trim()
        if (text) appendLog(`[xray:ERR] ${text}`)
      })
      spawnedXray.on('error', (err) => {
        if (generation !== childGeneration) return
        appendLog(`Ошибка процесса Xray: ${err.message}`)
        broadcastStatus({ state: 'error', activeNodeId: null, lastError: err.message })
        xrayChild = null
      })
      spawnedXray.on('exit', (code) => {
        if (generation !== childGeneration) return
        appendLog(`Xray остановлен (код ${code})`)
        xrayChild = null
        // Losing Xray kills the tunnel in every topology that uses it.
        endStatsSession()
        broadcastStatus({ state: 'stopped', activeNodeId: null })
        clearWindowsSystemProxy().catch(() => void 0)
      })

      // Give Xray a beat to bind, then verify it did not die on a bad config.
      await new Promise((r) => setTimeout(r, 600))
      if (generation !== childGeneration) return getIncyStatus()
      if (!xrayChild || spawnedXray.exitCode !== null) {
        const detail = ringLogs.slice(-3).join(' | ')
        const message =
          'Xray завершился сразу после запуска. Проверьте параметры узла и вкладку «Логи».' +
          (detail ? ` Последние строки: ${detail}` : '')
        broadcastStatus({ state: 'error', activeNodeId: null, lastError: message })
        throw new Error(message)
      }
      appendLog(
        topology.chained
          ? `Xray принимает трафик от sing-box на 127.0.0.1:${topology.ports.bridge}`
          : `Xray слушает HTTP :${topology.ports.front} и SOCKS5 :${topology.ports.socks}`
      )
    }

    // ---- XRAY_ONLY: sing-box is not needed at all. Apply the system proxy
    // (if that mode is selected) and finish here.
    if (!topology.needsSingBox) {
      if (mode === 'system_proxy') {
        await setWindowsSystemProxy(topology.ports.front, bypassDomains)
        appendLog(`Режим «Системный прокси»: порт 127.0.0.1:${topology.ports.front}`)
      } else {
        await clearWindowsSystemProxy()
        appendLog(`Режим «Только прокси»: порт 127.0.0.1:${topology.ports.front}`)
      }

      // XRAY_ONLY: Xray has no Clash API, so bytes cannot be counted here —
      // the session still records duration and the connection itself.
      beginStatsSession(0)
      const okStatus = broadcastStatus({
        state: 'running',
        activeNodeId: target.id,
        selectedNodeId: target.id,
        connectedAt: Date.now()
      })
      appendLog(`Успешно подключено к ${target.name} (ядро Xray)`)
      showSystemNotification(
        'INCY Proxy подключен',
        `Активен узел: ${target.name} (${target.protocol.toUpperCase()}, Xray)`
      )
      return okStatus
    }

    const cfgFile = incyRuntimeConfigFile()
    writeFileSync(cfgFile, JSON.stringify(config, null, 2), 'utf-8')

    // Pre-flight: ask sing-box to validate the config before we spawn it.
    //
    // sing-box reshapes its schema between minor versions and rejects the
    // whole file on the first unknown key, so a single stale field takes the
    // tunnel down. `check` parses the config and exits non-zero with the exact
    // offending path (e.g. "route.rules[1]: empty route option action") in
    // well under a second — far better than a dead tunnel and a guess.
    // Compact summary of what was actually generated. Symptoms alone ("only
    // some sites work") cannot distinguish a routing problem from a DNS one,
    // and the full config is too large for the log — these few facts are what
    // the diagnosis actually turns on.
    {
      const proxyOut = (config.outbounds as any[])[0] ?? {}
      appendLog(
        `Конфиг: outbound=${proxyOut.type ?? '?'}` +
          `${proxyOut.domain_strategy ? ` domain_strategy=${proxyOut.domain_strategy}` : ''}` +
          ` | режим=${mode} маршрутизация=${routingMode}` +
          ` | правил route=${(config.route.rules as any[]).length}` +
          ` dns=${dnsRules.length}` +
          ` | remote-dns=${dnsPair.remote} (через прокси), local-dns=${dnsPair.local}` +
          ` | ${cfgFile}`
      )
    }

    let preflight = await validateCoreConfig(bin, ['check', '-c', cfgFile])

    if (!preflight.ok) {
      /**
       * Схема конфига sing-box меняется между версиями, и одна незнакомая
       * секция роняет весь запуск. Вместо того чтобы гадать, подбираем
       * лекарство по тексту отказа.
       *
       * `matches` — признаки, по которым ошибка опознаётся. Если ни одно
       * средство не подошло по признаку, они всё равно перебираются подряд:
       * лучше применить лишнее и подняться, чем отказать пользователю.
       *
       * Раньше цепочка была жёсткой: любой отказ сначала выключал Clash API.
       * На ошибку про DNS это писало в лог «пробуем без Clash API» и без
       * нужды отключало статистику — при том что причина была совсем другая.
       */
      const remedies: {
        id: string
        matches: RegExp
        note: string
        apply: () => void
      }[] = [
        {
          id: 'dns-legacy',
          matches: /dns|domain_resolver/i,
          note: 'Используется устаревшая схема DNS: это ядро sing-box старее 1.12.',
          apply: () => {
            // Схема «до 1.12» — это пара: серверы одной строкой в `address`
            // И отсутствие `default_domain_resolver`, о котором старое ядро
            // не знает. Менять только одно бессмысленно: получится гибрид,
            // который не примет ни новое ядро, ни старое.
            config.dns.servers = dnsServersLegacy
            delete config.route.default_domain_resolver
          }
        },
        {
          id: 'no-clash-api',
          matches: /clash|experimental/i,
          note:
            'Статистика трафика недоступна: это ядро sing-box собрано без Clash API. ' +
            'Время сессии и число подключений считаются по-прежнему.',
          apply: () => {
            delete config.experimental
            statsClashPort = 0
          }
        }
      ]

      /**
       * Исходная причина отказа и исходный конфиг.
       *
       * И то, и другое обязательно сохранить до первой попытки. Лекарство
       * может не помочь и при этом ухудшить конфиг — например, откат на
       * старый формат DNS на ядре 1.14 добавляет свою фатальную ошибку.
       * Без отката изменений и без запоминания первой причины пользователь
       * увидел бы сообщение от последней, самой неудачной попытки, а
       * настоящая причина потерялась бы.
       */
      const originalReason = preflight.reason ?? ''
      const pristine = JSON.stringify(config)
      const pristineStatsPort = statsClashPort

      const restore = (): void => {
        // Восстанавливаем содержимое объекта, не подменяя ссылку: `config`
        // объявлен через const и используется ниже по коду.
        for (const key of Object.keys(config)) delete config[key]
        Object.assign(config, JSON.parse(pristine))
        statsClashPort = pristineStatsPort
      }

      // Сначала то, что подходит по тексту ошибки, затем всё остальное.
      const ordered = [
        ...remedies.filter((r) => r.matches.test(originalReason)),
        ...remedies.filter((r) => !r.matches.test(originalReason))
      ]

      // Пробуем сначала каждое лекарство по отдельности, затем — все сразу.
      // Так одно неподходящее средство не тянет за собой остальные и не
      // подменяет диагноз своей ошибкой.
      const attempts: { ids: string[]; apply: () => void }[] = [
        ...ordered.map((r) => ({ ids: [r.id], apply: r.apply })),
        ...(ordered.length > 1
          ? [{ ids: ordered.map((r) => r.id), apply: () => ordered.forEach((r) => r.apply()) }]
          : [])
      ]

      for (const attempt of attempts) {
        appendLog(`[preflight] Конфиг отклонён: ${originalReason} — пробуем «${attempt.ids.join(' + ')}».`)
        restore()
        attempt.apply()
        writeFileSync(cfgFile, JSON.stringify(config, null, 2), 'utf-8')
        preflight = await validateCoreConfig(bin, ['check', '-c', cfgFile])
        if (preflight.ok) {
          for (const id of attempt.ids) {
            const r = remedies.find((x) => x.id === id)
            if (r) appendLog(r.note)
          }
          break
        }
        appendLog(`[preflight] «${attempt.ids.join(' + ')}» не помогло: ${preflight.reason}`)
      }

      if (!preflight.ok) {
        // Ни одно средство не подошло — возвращаем исходный конфиг и
        // сообщаем первую, настоящую причину.
        restore()
        writeFileSync(cfgFile, JSON.stringify(config, null, 2), 'utf-8')
        preflight = { ok: false, reason: originalReason }
      }
    }

    if (!preflight.ok) {
      const message = `Конфигурация отклонена ядром sing-box: ${preflight.reason}`
      appendLog(`[preflight] ${message}`)
      broadcastStatus({ state: 'error', activeNodeId: null, lastError: message })
      throw new Error(message)
    }

    // 2. Spawn sing-box.exe (generation was claimed before Xray started)
    const spawned = spawn(bin, ['run', '-c', cfgFile], { windowsHide: true })
    child = spawned

    spawned.stdout?.on('data', (data) => {
      const text = data.toString().trim()
      if (text) appendLog(text)
    })

    spawned.stderr?.on('data', (data) => {
      const text = data.toString().trim()
      if (text) appendLog(`[ERR] ${text}`)
    })

    spawned.on('error', (err) => {
      if (generation !== childGeneration) return
      appendLog(`Ошибка процесса: ${err.message}`)
      broadcastStatus({ state: 'error', activeNodeId: null, lastError: err.message })
      clearWindowsSystemProxy().catch(() => void 0)
      child = null
    })

    spawned.on('exit', (code) => {
      // A replacement process has already taken over — this exit belongs to
      // the instance we deliberately killed, so it must not touch state.
      if (generation !== childGeneration) return
      appendLog(`Туннель остановлен (код ${code})`)
      endStatsSession()
      broadcastStatus({ state: 'stopped', activeNodeId: null })
      clearWindowsSystemProxy().catch(() => void 0)
      child = null
    })

    // 2b. Fail fast if sing-box died on startup (bad node config, TUN adapter
    // refused, port already taken). Without this the UI reported "подключено"
    // and showed a success toast for a tunnel that was already dead — and in
    // system_proxy mode it would additionally point Windows at a proxy port
    // that nothing is listening on, killing the user's internet.
    await new Promise((r) => setTimeout(r, 800))
    if (generation !== childGeneration) {
      // Another connect/disconnect superseded us while we were waiting.
      return getIncyStatus()
    }
    if (!child || spawned.exitCode !== null) {
      const detail = ringLogs.slice(-3).join(' | ')
      const message =
        'sing-box завершился сразу после запуска. Проверьте параметры узла и вкладку «Логи».' +
        (detail ? ` Последние строки: ${detail}` : '')
      broadcastStatus({ state: 'error', activeNodeId: null, lastError: message })
      await clearWindowsSystemProxy().catch(() => void 0)
      throw new Error(message)
    }

    // 3. Set Windows System Proxy ONLY if 'system_proxy' mode is active
    if (mode === 'system_proxy') {
      await setWindowsSystemProxy(settings.mixedPort || 20808, bypassDomains)
      appendLog(`Режим «Системный прокси»: порт 127.0.0.1:${settings.mixedPort || 20808}`)
    } else {
      await clearWindowsSystemProxy()
      if (mode === 'tun') {
        appendLog(`Режим «Туннелирование (TUN)»: включен виртуальный сетевой адаптер`)
      } else {
        appendLog(`Режим «Только прокси»: порт 127.0.0.1:${settings.mixedPort || 20808}`)
      }
    }

    beginStatsSession(statsClashPort)

    const status = broadcastStatus({
      state: 'running',
      activeNodeId: target.id,
      selectedNodeId: target.id,
      connectedAt: Date.now()
    })

    appendLog(`Успешно подключено к ${target.name}`)
    showSystemNotification('INCY Proxy подключен', `Активен узел: ${target.name} (${target.protocol.toUpperCase()})`)
    return status
  } finally {
    isConnecting = false
    // Never leave the UI stuck on "connecting". Every handled failure path
    // broadcasts its own error, but an unexpected throw would otherwise leave
    // a spinner running forever with no way back.
    if (currentStatus.state === 'connecting') {
      broadcastStatus({
        state: 'error',
        activeNodeId: null,
        lastError: currentStatus.lastError || 'Подключение прервалось на неизвестном шаге'
      })
    }
  }
}

export async function disconnectIncy(): Promise<IncyStatus> {
  await stopRunningChild()
  await clearWindowsSystemProxy()
  appendLog('Туннель отключен пользователем')

  const status = broadcastStatus({
    state: 'stopped',
    activeNodeId: null
  })
  showSystemNotification('INCY Proxy отключен', 'Соединение закрыто, системный прокси выключен')
  return status
}

/**
 * Re-apply the live tunnel with whatever routing settings are now on disk.
 *
 * Extracted because every routing change needs the same three things: save,
 * broadcast, and — only if a tunnel is actually up — rebuild the config. A
 * silent failure here reads as "the switch did nothing", so the reconnect
 * error is logged rather than swallowed.
 */
function reapplyRouting(mode: 'bypass-ru' | 'global' | 'direct'): IncyStatus {
  const status = broadcastStatus({ routingMode: mode })
  if (currentStatus.state === 'running' && currentStatus.activeNodeId) {
    connectIncyNode(currentStatus.activeNodeId).catch((e) => {
      appendLog(`Переключение маршрутизации не применилось: ${e instanceof Error ? e.message : String(e)}`)
    })
  }
  return status
}

export function listIncyRoutingProfiles(): IncyRoutingProfile[] {
  return loadIncySettings().routingProfileList
}

/**
 * Make a profile the active one: copy its mode, geo flag and rules into the
 * fields the config builder reads, then reconnect if a tunnel is up.
 */
export function applyIncyRoutingProfile(profileId: string): IncyStatus {
  const s = loadIncySettings()
  const profile = s.routingProfileList.find((p) => p.id === profileId)
  if (!profile) {
    appendLog(`Профиль маршрутизации не найден: ${profileId}`)
    return getIncyStatus()
  }
  s.routingMode = profile.mode
  s.geoRoutingEnabled = profile.geoRouting
  s.customRoutingRules = profile.rules.map((r) => ({ ...r }))
  s.activeRoutingProfileId = profile.id
  saveIncySettings(s)
  appendLog(`Профиль маршрутизации: ${profile.name}`)
  return reapplyRouting(profile.mode)
}

/**
 * Create or update a user profile.
 *
 * Built-ins are never modified in place — saving over one forks a copy, which
 * is what the user means when they tweak "Раздельно" and hit save.
 */
export function saveIncyRoutingProfile(profile: IncyRoutingProfile): IncyRoutingProfile[] {
  const s = loadIncySettings()
  const isBuiltinId = BUILTIN_ROUTING_PROFILES.some((p) => p.id === profile.id)
  const next: IncyRoutingProfile = {
    ...profile,
    builtin: false,
    id: isBuiltinId || !profile.id ? `rp_${randomBytes(5).toString('hex')}` : profile.id,
    name: profile.name?.trim() || 'Без названия',
    rules: Array.isArray(profile.rules) ? profile.rules : []
  }

  const custom = s.routingProfileList.filter((p) => !p.builtin)
  const idx = custom.findIndex((p) => p.id === next.id)
  if (idx >= 0) custom[idx] = next
  else custom.push(next)

  s.routingProfileList = [...BUILTIN_ROUTING_PROFILES, ...custom]
  saveIncySettings(s)
  return s.routingProfileList
}

export function deleteIncyRoutingProfile(profileId: string): IncyRoutingProfile[] {
  const s = loadIncySettings()
  if (BUILTIN_ROUTING_PROFILES.some((p) => p.id === profileId)) return s.routingProfileList
  s.routingProfileList = s.routingProfileList.filter((p) => p.id !== profileId)
  // Deleting the active profile does not change the live routing — the rules
  // are already copied into the top-level fields. It only clears the
  // highlight, so the UI stops claiming a deleted profile is in use.
  if (s.activeRoutingProfileId === profileId) s.activeRoutingProfileId = ''
  saveIncySettings(s)
  return s.routingProfileList
}

/** Snapshot the current mode / geo flag / rules as a new named profile. */
export function captureIncyRoutingProfile(name: string): IncyRoutingProfile[] {
  const s = loadIncySettings()
  const profile: IncyRoutingProfile = {
    id: `rp_${randomBytes(5).toString('hex')}`,
    name: name.trim() || 'Мой профиль',
    builtin: false,
    mode: s.routingMode,
    geoRouting: s.geoRoutingEnabled !== false,
    rules: (s.customRoutingRules ?? []).map((r) => ({ ...r }))
  }
  const list = saveIncyRoutingProfile(profile)
  // Saving a snapshot of the current state means the current state *is* that
  // profile — mark it active so the UI reflects reality straight away.
  const s2 = loadIncySettings()
  s2.activeRoutingProfileId = profile.id
  saveIncySettings(s2)
  return list
}

export function setIncyRoutingMode(mode: 'bypass-ru' | 'global' | 'direct'): IncyStatus {
  const s = loadIncySettings()
  s.routingMode = mode
  // Hand-changing the mode means the live settings no longer match whichever
  // profile was selected. Clearing the marker keeps the picker honest instead
  // of showing a profile that describes something else.
  const active = s.routingProfileList.find((p) => p.id === s.activeRoutingProfileId)
  if (active && active.mode !== mode) s.activeRoutingProfileId = ''
  saveIncySettings(s)
  return reapplyRouting(mode)
}
