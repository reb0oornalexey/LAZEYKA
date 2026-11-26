/**
 * INCY: окно «Соединения», быстрые правила для домена, память маршрутов и
 * цепочка узлов. Всё выключено, пока пользователь сам не включил:
 *
 *  - опрос /connections идёт ТОЛЬКО пока панель открыта (incyx:connStart …
 *    incyx:connStop) и закрывается вместе с окном;
 *  - цепочка узлов не действует, пока в настройках не задан chainEntryNodeId;
 *  - память маршрутов читается один раз при запуске, если в ней есть записи.
 *
 * Каналы (обёртка ответа `{ ok, value }` / `{ ok: false, message }`):
 *   incyx:connStart, incyx:connStop, incyx:connClose(id),
 *   incyx:ruleForDomain(domain, action), incyx:routeMemoryList,
 *   incyx:routeMemoryAdd(domain, fix, source?), incyx:routeMemoryRemove(domain),
 *   incyx:routeMemoryReapply, incyx:chainGet, incyx:chainSet(entryNodeId | null).
 * Событие в окно: `incyx:connections` (ConnectionsEvent).
 */
import net from 'node:net'
import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { isXrayAvailable } from '../utils/dirs'
import { probeChainPair } from './core-probe'
import { outerBundle } from '../utils/mac-apps'
import {
  appendLog,
  getIncyStatus,
  incyTunnelAlive,
  loadIncyNodes,
  loadIncySettings,
  patchIncySettings,
  type IncyRoutingRule
} from './incy-engine'
import { clashApiActive, clashRequest } from './incy-stats'
import {
  chainEligibility,
  chainExitEligible,
  getChainSession,
  planTopology
} from './incy-topology'
import {
  addRouteMemory,
  applyRouteMemoryOnStart,
  listRouteMemory,
  normalizeRouteDomain,
  reapplyRouteMemoryRules,
  removeRouteMemory,
  setDomainRule,
  type RouteFix
} from './route-memory'

export { applyRouteMemoryOnStart }

// ====================================================================================
//  Чистые функции (проверяются отдельно от Electron)
// ====================================================================================

export interface RawConn {
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

export type ConnRoute = 'vpn' | 'direct' | 'block' | 'other'

export interface ConnRow {
  id: string
  process: string
  /**
   * macOS: путь бандла/файла процесса — так записываются приложения в список ExitLag. Нужен фильтру
   * «только приложения из списка ExitLag» (на Windows список хранит имена .exe, хватает process).
   */
  appRule?: string
  /** Домен, а если имя неизвестно — IP-адрес. */
  host: string
  hostIsIp: boolean
  port: number
  network: string
  route: ConnRoute
  /** Какое правило сработало (человекочитаемо). */
  rule: string
  /** Сработало своё правило из «Свои правила». */
  customRule: boolean
  downSpeed: number
  upSpeed: number
  download: number
  upload: number
  /** Начало, мс с эпохи. */
  start: number
}

export interface ConnectionsEvent {
  at: number
  state: 'ok' | 'unavailable'
  /** Почему список пуст (для state = unavailable). */
  reason?: string
  rows: ConnRow[]
  /** Всего соединений у ядра. */
  total: number
  /** Сколько не поместилось в rows. */
  more: number
  downTotal: number
  upTotal: number
  /** Узел(ы), через которые идёт трафик: «вход → выход» при цепочке. */
  viaNode?: string
}

export const MAX_ROWS = 300

export interface CounterSnap {
  up: number
  down: number
  at: number
}

export function routeOfChains(chains: string[] | undefined, rule?: string): ConnRoute {
  const c = chains ?? []
  if (c.includes('proxy')) return 'vpn'
  if (c.includes('direct')) return 'direct'
  if (c.includes('block') || c.includes('reject') || /reject|block/i.test(rule ?? '')) return 'block'
  return 'other'
}

function ipv4ToInt(ip: string): number | null {
  const p = ip.split('.')
  if (p.length !== 4) return null
  let n = 0
  for (const part of p) {
    const v = Number(part)
    if (!Number.isInteger(v) || v < 0 || v > 255) return null
    n = n * 256 + v
  }
  return n
}

/** Попадает ли IP в значение правила (адрес или CIDR). */
export function ipMatchesRule(ip: string, value: string): boolean {
  const [base, prefix] = value.trim().split('/')
  if (!net.isIP(base) || !net.isIP(ip)) return false
  if (prefix === undefined) return base.toLowerCase() === ip.toLowerCase()
  if (net.isIPv4(base) && net.isIPv4(ip)) {
    const bits = Number(prefix)
    if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false
    const a = ipv4ToInt(base)
    const b = ipv4ToInt(ip)
    if (a === null || b === null) return false
    if (bits === 0) return true
    const size = 2 ** (32 - bits)
    return Math.floor(a / size) === Math.floor(b / size)
  }
  return false
}

const ACTION_ROUTE: Record<IncyRoutingRule['action'], ConnRoute> = {
  proxy: 'vpn',
  direct: 'direct',
  block: 'block'
}

/**
 * Какое из своих правил (в порядке списка) сработало для соединения.
 * Правило считается сработавшим, только если его действие совпадает с
 * фактическим маршрутом: после правки правил, пока туннель ещё не
 * переподключился, ядро работает по старому списку.
 */
export function matchCustomRule(
  host: string,
  ip: string,
  route: ConnRoute,
  rules: IncyRoutingRule[]
): IncyRoutingRule | null {
  const h = host.trim().toLowerCase().replace(/\.$/, '')
  for (const r of rules) {
    if (!r || !r.enabled || typeof r.value !== 'string') continue
    const v = r.value.trim().toLowerCase()
    if (!v || /^(geosite|geoip|ext):/.test(v)) continue
    let hit = false
    if (net.isIP(v.split('/')[0]) !== 0) {
      hit = ipMatchesRule(ip || h, v)
    } else if (h) {
      const domain = v.replace(/^\*\./, '')
      hit = h === domain || h.endsWith(`.${domain}`)
    }
    if (hit) return ACTION_ROUTE[r.action] === route ? r : null
  }
  return null
}

const RULE_WORDS: [RegExp, string][] = [
  [/domain_suffix|domain_keyword|domain_regex|domain/, 'домен'],
  [/ip_cidr|ip_is_private/, 'сеть'],
  [/process_path_regex|process_name|process_path/, 'приложение'],
  [/rule_set/, 'список'],
  [/geoip|geosite/, 'гео-список'],
  [/port/, 'порт']
]

/** Правило ядра sing-box («domain_suffix=[a.ru] => route(direct)») — коротко и по-русски. */
export function describeEngineRule(rule: string | undefined, payload?: string): string {
  const raw = String(rule ?? '').trim()
  if (!raw || /^(default|final|match)$/i.test(raw)) return 'по умолчанию'
  const head = raw.split('=>')[0].trim()
  const body = head.replace(/^\(|\)$/g, '')
  if (!body) return 'по умолчанию'
  const kind = RULE_WORDS.find(([re]) => re.test(body))?.[1]
  const value = String(payload ?? '').trim() || (/[=[]/.test(body) ? body.replace(/^[^=]*=\s*/, '').replace(/[[\]]/g, '') : '')
  const text = kind ? `${kind}${value ? `: ${value}` : ''}` : body
  return text.length > 70 ? `${text.slice(0, 67)}…` : text
}

/** Запись для списка ExitLag (только macOS: путь бандла). platform — для проверки без Electron. */
export function processAppRule(p: string | undefined, platform: string = process.platform): string | undefined {
  if (!p || platform !== 'darwin') return undefined
  return outerBundle(p) ?? p
}

export function processName(p: string | undefined): string {
  if (!p) return ''
  // Путь Windows или macOS: берём последнюю часть по любому разделителю.
  const base = p.split(/[\\/]/).filter(Boolean).pop() ?? ''
  return base.replace(/\.app$/i, '')
}

/**
 * Список соединений ядра → строки таблицы со скоростями.
 *
 * Скорость — по разнице накопительных счётчиков соединения между двумя
 * опросами, делённой на реальное время между ними. У нового соединения
 * скорость 0 (не с чем сравнивать); если счётчик уменьшился — тоже 0.
 */
export function computeRows(
  raw: RawConn[],
  prev: Map<string, CounterSnap>,
  now: number,
  rules: IncyRoutingRule[]
): { rows: ConnRow[]; next: Map<string, CounterSnap> } {
  const next = new Map<string, CounterSnap>()
  const rows: ConnRow[] = []
  for (const c of raw) {
    if (!c || typeof c.id !== 'string') continue
    const up = Number(c.upload) || 0
    const down = Number(c.download) || 0
    next.set(c.id, { up, down, at: now })
    const p = prev.get(c.id)
    let downSpeed = 0
    let upSpeed = 0
    if (p && now > p.at) {
      const dt = Math.max(0.2, (now - p.at) / 1000)
      downSpeed = Math.max(0, down - p.down) / dt
      upSpeed = Math.max(0, up - p.up) / dt
    }
    const m = c.metadata ?? {}
    const named = String(m.host ?? '').trim()
    const ip = String(m.destinationIP ?? '').trim()
    const host = named || ip || '—'
    const route = routeOfChains(c.chains, c.rule)
    const custom = matchCustomRule(named, ip, route, rules)
    const startMs = c.start ? Date.parse(c.start) : NaN
    rows.push({
      id: c.id,
      process: processName(m.processPath),
      ...(processAppRule(m.processPath) ? { appRule: processAppRule(m.processPath) } : {}),
      host,
      hostIsIp: !named,
      port: Number(m.destinationPort) || 0,
      network: String(m.network ?? '').toLowerCase(),
      route,
      rule: custom ? `своё правило: ${custom.value}` : describeEngineRule(c.rule, c.rulePayload),
      customRule: Boolean(custom),
      downSpeed,
      upSpeed,
      download: down,
      upload: up,
      start: Number.isFinite(startMs) ? startMs : now
    })
  }
  return { rows, next }
}

/** Самые активные строки, остальные — числом «и ещё N». */
export function limitRows(rows: ConnRow[], max = MAX_ROWS): { rows: ConnRow[]; more: number } {
  if (rows.length <= max) return { rows, more: 0 }
  const sorted = rows
    .slice()
    .sort((a, b) => b.downSpeed + b.upSpeed - (a.downSpeed + a.upSpeed) || b.start - a.start)
  return { rows: sorted.slice(0, max), more: rows.length - max }
}

// ====================================================================================
//  Опрос /connections — только пока панель открыта
// ====================================================================================

const POLL_MS = 1000
const subscribers = new Map<number, WebContents>()
let timer: NodeJS.Timeout | null = null
let busy = false
let prevSnap = new Map<string, CounterSnap>()

const UNAVAILABLE_NOT_RUNNING = 'VPN не подключён. Подключитесь на странице INCY — здесь появятся соединения.'
const UNAVAILABLE_NO_API =
  'Список соединений отдаёт ядро sing-box. Сейчас оно не запущено или собрано без статистики: ' +
  'узлы на Xray в режимах «Системный прокси» и «Только прокси» идут без sing-box.'

function nodeLabel(): string | undefined {
  try {
    const st = getIncyStatus()
    const nodes = loadIncyNodes()
    const name = (id?: string | null): string | undefined => nodes.find((n) => n.id === id)?.name
    const exit = name(st.activeNodeId)
    const chain = getChainSession()
    if (chain?.applied && chain.exitNodeId === st.activeNodeId) {
      const entry = name(chain.entryNodeId)
      if (entry && exit) return `${entry} → ${exit}`
    }
    return exit
  } catch {
    return undefined
  }
}

async function pollTick(): Promise<void> {
  if (busy || subscribers.size === 0) return
  busy = true
  try {
    const running = getIncyStatus().state === 'running'
    let event: ConnectionsEvent
    if (!running) {
      prevSnap = new Map()
      event = emptyEvent(UNAVAILABLE_NOT_RUNNING)
    } else if (!clashApiActive()) {
      prevSnap = new Map()
      event = emptyEvent(UNAVAILABLE_NO_API)
    } else {
      const data = (await clashRequest('/connections')) as {
        connections?: RawConn[]
        downloadTotal?: number
        uploadTotal?: number
      } | null
      if (!data || typeof data !== 'object') {
        event = emptyEvent(UNAVAILABLE_NO_API)
      } else {
        const now = Date.now()
        const { rows, next } = computeRows(data.connections ?? [], prevSnap, now, loadIncySettings().customRoutingRules ?? [])
        prevSnap = next
        const lim = limitRows(rows)
        event = {
          at: now,
          state: 'ok',
          rows: lim.rows,
          total: rows.length,
          more: lim.more,
          downTotal: Number(data.downloadTotal) || 0,
          upTotal: Number(data.uploadTotal) || 0,
          viaNode: nodeLabel()
        }
      }
    }
    broadcastToSubscribers(event)
  } catch {
    /* следующий опрос попробует снова */
  } finally {
    busy = false
  }
}

function emptyEvent(reason: string): ConnectionsEvent {
  return { at: Date.now(), state: 'unavailable', reason, rows: [], total: 0, more: 0, downTotal: 0, upTotal: 0 }
}

function broadcastToSubscribers(ev: ConnectionsEvent): void {
  for (const [id, wc] of subscribers) {
    if (wc.isDestroyed()) {
      subscribers.delete(id)
      continue
    }
    try {
      wc.send('incyx:connections', ev)
    } catch {
      subscribers.delete(id)
    }
  }
  if (subscribers.size === 0) stopTimer()
}

function stopTimer(): void {
  if (timer) clearInterval(timer)
  timer = null
  prevSnap = new Map()
}

function subscribe(wc: WebContents): void {
  if (!subscribers.has(wc.id)) {
    subscribers.set(wc.id, wc)
    // Окно закрыли, не успев отписаться, — опрос не должен остаться висеть.
    wc.once('destroyed', () => unsubscribe(wc.id))
  }
  if (!timer) {
    timer = setInterval(() => void pollTick(), POLL_MS)
    void pollTick()
  }
}

function unsubscribe(id: number): void {
  subscribers.delete(id)
  if (subscribers.size === 0) stopTimer()
}

async function closeConnection(id: string): Promise<boolean> {
  if (!/^[A-Za-z0-9-]{1,80}$/.test(id)) throw new Error('Неверный идентификатор соединения')
  if (!clashApiActive()) return false
  const r = await clashRequest(`/connections/${id}`, 'DELETE')
  return r !== null
}

// ====================================================================================
//  Правило для домена
// ====================================================================================

type RuleAction = IncyRoutingRule['action']

function parseAction(a: unknown): RuleAction {
  if (a === 'vpn' || a === 'proxy') return 'proxy'
  if (a === 'direct') return 'direct'
  if (a === 'block') return 'block'
  throw new Error('Неизвестное действие для правила')
}

function ruleForDomain(domain: string, action: RuleAction): { created: boolean; reapplied: boolean } {
  const value = normalizeRouteDomain(domain)
  if (!value) throw new Error('Не удалось разобрать адрес')
  const id = `cn-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
  const res = setDomainRule(value, action, id, 'Из окна «Соединения»')
  appendLog(`Правило из окна «Соединения»: ${value} → ${action === 'proxy' ? 'через VPN' : action === 'direct' ? 'напрямую' : 'блокировать'}.`)
  return { created: res.created, reapplied: res.reapplied }
}

// ====================================================================================
//  Цепочка узлов
// ====================================================================================

export interface ChainInfo {
  entryNodeId: string | null
  exitNodeId: string | null
  /** Цепочку можно применить с текущим выходом и входом. */
  applicable: boolean
  reason?: string
  /** Цепочка действует в поднятом туннеле прямо сейчас. */
  active: boolean
  /** Узлы, которые можно взять входом для текущего выхода. */
  eligibleEntryIds: string[]
  /** Узлы, которые вообще могут быть выходом цепочки (выбор выхода прямо в карточке). */
  eligibleExitIds: string[]
}

function currentExitId(): string | null {
  const st = getIncyStatus()
  return st.activeNodeId || st.selectedNodeId || loadIncySettings().selectedNodeId || null
}

function chainGet(): ChainInfo {
  const settings = loadIncySettings()
  const nodes = loadIncyNodes()
  const exitId = currentExitId()
  const exit = nodes.find((n) => n.id === exitId)
  const entryId = settings.chainEntryNodeId || null
  const topology = exit ? planTopology(exit, settings, isXrayAvailable()) : null
  const eligible = exit
    ? nodes.filter((n) => chainEligibility(exit, n, topology, settings).ok).map((n) => n.id)
    : []
  let applicable = false
  let reason: string | undefined
  if (entryId) {
    const v = chainEligibility(exit, nodes.find((n) => n.id === entryId), topology, settings)
    applicable = v.ok
    if (!v.ok) reason = v.reason
  } else if (exit && eligible.length === 0) {
    // Цепочка не включена, но для этого выхода подходящих входов нет — скажем почему.
    // Сначала — подходит ли сам выход (его причина понятнее), потом — почему не подошёл ни один вход.
    const ex = chainExitEligible(exit, settings)
    const other = nodes.find((n) => n.id !== exit.id && !(n.server && n.server === exit.server))
    const v = !ex.ok ? ex : other ? chainEligibility(exit, other, topology, settings) : { ok: false as const, reason: 'Для цепочки нужны хотя бы два разных сервера' }
    if (!v.ok) reason = v.reason
  } else if (!exit) {
    reason = 'Сначала выберите сервер — он станет выходом цепочки'
  }
  const eligibleExits = nodes.filter((n) => chainExitEligible(n, settings).ok).map((n) => n.id)
  const session = getChainSession()
  const st = getIncyStatus()
  const active = Boolean(
    entryId &&
      session?.applied &&
      session.entryNodeId === entryId &&
      st.state === 'running' &&
      st.activeNodeId === session.exitNodeId
  )
  // Сессия подняла узел без цепочки (например, failover на узел Xray).
  if (entryId && !active && st.state === 'running' && session && !session.applied && session.reason && !reason) {
    reason = session.reason
  }
  if (entryId && st.routingMode === 'direct') {
    reason = 'Выбран режим «Напрямую». Для цепочки нужен режим «Весь трафик» или раздельная маршрутизация.'
  }
  return { entryNodeId: entryId, exitNodeId: exit?.id ?? null, applicable, reason, active, eligibleEntryIds: eligible, eligibleExitIds: eligibleExits }
}

/** Verify traffic through the pair before replacing the current connection. */
async function checkChainCandidate(exitId: string, entryId: string): Promise<{ ok: boolean; reason?: string }> {
  const settings = loadIncySettings()
  const nodes = loadIncyNodes()
  const exit = nodes.find((n) => n.id === exitId)
  const entry = nodes.find((n) => n.id === entryId)
  if (!exit || !entry) return { ok: false, reason: 'Узел не найден в списке серверов' }
  const topology = planTopology(exit, settings, isXrayAvailable())
  const verdict = chainEligibility(exit, entry, topology, settings)
  if (!verdict.ok) return { ok: false, reason: verdict.reason }
  try {
    const result = await probeChainPair(exit, { entry, core: verdict.core ?? 'sing-box' })
    if (result.ok) return { ok: true }
    const label = {
      ok: 'HTTPS работает',
      core: 'ядро не запустилось',
      socks: 'SOCKS не открыл соединение',
      tls: 'TLS-рукопожатие не прошло',
      http: 'нет успешного ответа HTTP'
    }
    let reason = `Пара: ${label[result.pair]}. Вход отдельно: ${label[result.entry]}. Выход отдельно: ${label[result.exit]}.`
    if (result.entry === 'ok' && result.exit === 'ok') {
      reason += ' Оба узла отдельно отвечают. Проверьте другой вход или выход для этой цепочки.'
    }
    appendLog(`Проверка цепочки: ${reason}`)
    return { ok: false, reason: `${reason} Текущее подключение сохранено.` }
  } catch (error) {
    return { ok: false, reason: `Не удалось запустить проверку пары: ${error instanceof Error ? error.message : String(error)}` }
  }
}

async function chainSet(
  entryNodeId: unknown
): Promise<{ applied: boolean; reason?: string; reconnecting?: boolean }> {
  if (entryNodeId === null || entryNodeId === undefined || entryNodeId === '') {
    const r = patchIncySettings({ chainEntryNodeId: undefined })
    appendLog('Цепочка узлов выключена.')
    return { applied: true, reconnecting: r.reapplied }
  }
  const id = String(entryNodeId)
  const settings = loadIncySettings()
  const nodes = loadIncyNodes()
  const exitId = currentExitId()
  const exit = nodes.find((n) => n.id === exitId)
  const topology = exit ? planTopology(exit, settings, isXrayAvailable()) : null
  const verdict = chainEligibility(exit, nodes.find((n) => n.id === id), topology, settings)
  if (!verdict.ok) return { applied: false, reason: verdict.reason }
  const check = await checkChainCandidate(exit!.id, id)
  if (!check.ok) return { applied: false, reason: check.reason }
  const current = loadIncySettings()
  if (currentExitId() !== exitId || current.chainEntryNodeId !== settings.chainEntryNodeId) {
    return { applied: false, reason: 'Узлы изменились во время проверки. Выберите пару ещё раз.' }
  }
  const r = patchIncySettings({ chainEntryNodeId: id })
  appendLog('Цепочка узлов включена в настройках: применится при подключении.')
  return { applied: true, reconnecting: r.reapplied }
}

// ====================================================================================
//  IPC
// ====================================================================================

function hx<T>(fn: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<T> | T) {
  return async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    try {
      return { ok: true, value: await fn(event, ...args) }
    } catch (e: unknown) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) }
    }
  }
}

function parseFix(f: unknown): RouteFix {
  if (f === 'zapret' || f === 'vpn' || f === 'direct') return f
  throw new Error('Неизвестный тип решения')
}

export function registerIncyExtraIpc(): void {
  ipcMain.handle('incyx:connStart', hx((e) => { subscribe(e.sender) }))
  ipcMain.handle('incyx:connStop', hx((e) => { unsubscribe(e.sender.id) }))
  ipcMain.handle('incyx:connClose', hx((_e, id) => closeConnection(String(id))))
  ipcMain.handle('incyx:ruleForDomain', hx((_e, domain, action) => ruleForDomain(String(domain), parseAction(action))))
  ipcMain.handle('incyx:routeMemoryList', hx(() => listRouteMemory()))
  ipcMain.handle(
    'incyx:routeMemoryAdd',
    hx((_e, domain, fix, source) =>
      addRouteMemory(String(domain), parseFix(fix), typeof source === 'string' ? source : 'manual')
    )
  )
  ipcMain.handle('incyx:routeMemoryRemove', hx((_e, domain) => removeRouteMemory(String(domain))))
  ipcMain.handle('incyx:routeMemoryReapply', hx(() => reapplyRouteMemoryRules()))
  ipcMain.handle('incyx:chainProbe', hx(async () => {
    const before = getIncyStatus()
    if (!chainGet().active) return null
    const answer = await incyTunnelAlive()
    const after = getIncyStatus()
    return before.connectedAt === after.connectedAt && before.activeNodeId === after.activeNodeId && chainGet().active
      ? answer
      : null
  }))
  ipcMain.handle('incyx:chainExitCheck', hx((_e, id) => {
    const entry = loadIncySettings().chainEntryNodeId
    return entry ? checkChainCandidate(String(id), entry) : { ok: true }
  }))
  ipcMain.handle('incyx:chainGet', hx(() => chainGet()))
  ipcMain.handle('incyx:chainSet', hx((_e, id) => chainSet(id)))
}
