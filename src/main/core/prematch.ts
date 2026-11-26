/**
 * «Перед каткой»: проверка сети перед матчем, игровая сессия с отчётом,
 * сигнал о лагах и проверка NAT.
 *
 * Принципы:
 *  - цель человек указывает сам; игровой сервер не определяется и соединения
 *    не отслеживаются;
 *  - вне сессии и вне проверки ничего не меряется, фоновых таймеров нет;
 *  - во время сессии — один пакет раз в SESSION_INTERVAL_MS;
 *  - все замеры идут напрямую, с адреса физического адаптера (мимо VPN).
 *
 * Чистая логика (статистика, разбор вывода, детектор лагов, вердикты) —
 * в prematch-stats.ts, STUN — в nat-check.ts.
 */
import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage } from 'electron'
import { execFile } from 'node:child_process'
import dgram from 'node:dgram'
import dns from 'node:dns'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { dataDir } from '../utils/dirs'
import { writeFileAtomic } from '../utils/atomic-write'
import { decodeConsole } from '../utils/console-decode'
import { showSystemNotification } from '../utils/notifications'
import { MAC_PING, macPingArgs, parseMacPingRtts } from '../utils/mac-net'
import { runBufferbloatTest } from './bufferbloat'
import { parseGameServerAddress } from './game-ping'
import { checkNat, type NatResult } from './nat-check'
import {
  CHECK_GATEWAY_SAMPLES,
  CHECK_TARGET_SAMPLES,
  DEFAULT_LAG_SETTINGS,
  HISTORY_LIMIT,
  REPORT_MIN_SAMPLES,
  REPORT_SERIES_POINTS,
  SESSION_GAP_MS,
  SESSION_INTERVAL_MS,
  SESSION_MAX_MS,
  bucketize,
  buildCheckVerdict,
  buildSessionStats,
  buildSessionVerdict,
  createLagDetector,
  decideLink,
  parseMacDefaultRoute,
  parseMacWifi,
  parseNetshWlan,
  parseWinDefaultRoute,
  parseWinPingRtts,
  summarizeReplies,
  summarizeSeries,
  type LagDetector,
  type LagEvent,
  type LagSettings,
  type LinkInfo,
  type SeriesStats,
  type SessionStats,
  type Verdict,
  type VerdictKind,
  type WifiParse
} from './prematch-stats'

// ---- типы для окна ------------------------------------------------------------------

export type PrematchMethod = 'icmp' | 'a2s'

export interface PrematchSettings {
  lastTarget: string
  /** Запоминается галочка «Проверить под нагрузкой». */
  checkLoad: boolean
  lag: LagSettings
}

export interface CheckResult {
  at: number
  target: {
    label: string
    ip: string
    port: number
    method: PrematchMethod | null
    stats: SeriesStats | null
    /** Подпись пути для интерфейса. */
    route: string
  }
  gateway: { ip: string | null; stats: SeriesStats | null }
  link: LinkInfo
  load: { grade: string; idleMs: number | null; loadedMs: number | null; increaseMs: number | null; lossPct: number; downloadMbps: number | null; verdict: string } | null
  /** Замеры шли с адреса физического адаптера (мимо VPN). */
  viaPhysical: boolean
  verdict: Verdict
}

export type CheckStep = 'link' | 'gateway' | 'target' | 'load'

export interface CheckProgress {
  step: CheckStep
  state: 'run' | 'done' | 'skip' | 'fail'
  detail?: string
}

export interface SessionState {
  id: string
  label: string
  ip: string
  port: number
  method: PrematchMethod
  startedAt: number
  gapMs: number
  intervalMs: number
  maxMs: number
  samples: (number | null)[]
  baselineMs: number | null
  lagAlerts: number
}

export interface MatchReport {
  id: string
  startedAt: number
  endedAt: number
  durationMs: number
  endedBy: 'user' | 'timeout' | 'quit'
  target: { label: string; ip: string; port: number }
  method: PrematchMethod
  stats: SessionStats
  baselineMs: number | null
  lagAlerts: number
  verdict: { kind: VerdictKind; text: string }
  /** График: среднее в корзине (null — все пакеты корзины потеряны), максимум и число потерь. */
  series: (number | null)[]
  seriesMax: (number | null)[]
  seriesLost: number[]
  /** Сколько замеров в одной точке графика. */
  perPoint: number
}

export interface RegionEntry {
  id: string
  name: string
  ip: string
  preferred: boolean
}

export interface PrematchState {
  session: SessionState | null
  checking: boolean
  lastCheck: CheckResult | null
}

// ---- события ------------------------------------------------------------------------

function broadcast(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) {
      try {
        w.webContents.send(channel, payload)
      } catch { /* окно закрывается */ }
    }
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// ---- системные команды --------------------------------------------------------------

interface RunResult {
  out: string
  err: string
}

/** Запуск утилиты; вывод декодируется с учётом OEM-кодировки русской Windows. Ненулевой код — не ошибка. */
function run(file: string, args: string[], timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve) => {
    try {
      execFile(
        file,
        args,
        { windowsHide: true, timeout: timeoutMs, encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 },
        (_e, stdout, stderr) => resolve({ out: decodeConsole(stdout ?? Buffer.alloc(0)), err: decodeConsole(stderr ?? Buffer.alloc(0)) })
      )
    } catch {
      resolve({ out: '', err: '' })
    }
  })
}

// ---- физический адаптер -------------------------------------------------------------

interface PhysNet {
  /** Адрес физического адаптера (источник для замеров мимо VPN). */
  ip: string | null
  gateway: string | null
  /** Имя соединения (Windows) / интерфейс enN (macOS). */
  iface: string | null
}

let netCache: { at: number; v: PhysNet } | null = null

function ifaceNameByIp(ip: string): string | null {
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    if (list?.some((a) => a.family === 'IPv4' && a.address === ip)) return name
  }
  return null
}

function ipv4OfIface(name: string): string | null {
  const a = os.networkInterfaces()[name]?.find((x) => x.family === 'IPv4' && !x.internal)
  return a?.address ?? null
}

async function getPhysNet(force = false): Promise<PhysNet> {
  if (!force && netCache && Date.now() - netCache.at < 10_000) return netCache.v
  let v: PhysNet = { ip: null, gateway: null, iface: null }
  try {
    if (process.platform === 'win32') {
      const r = await run('route.exe', ['print', '-4', '0.0.0.0'], 5000)
      const d = parseWinDefaultRoute(r.out)
      if (d?.ip) v = { ip: d.ip, gateway: d.gateway, iface: ifaceNameByIp(d.ip) }
    } else if (process.platform === 'darwin') {
      const r = await run('/usr/sbin/netstat', ['-rn', '-f', 'inet'], 5000)
      const d = parseMacDefaultRoute(r.out)
      if (d?.iface) v = { ip: ipv4OfIface(d.iface), gateway: d.gateway, iface: d.iface }
    }
  } catch { /* остаётся пусто */ }
  // Не затираем рабочие данные пустым ответом (команда могла не успеть).
  if (!v.ip && netCache?.v.ip) v = netCache.v
  netCache = { at: Date.now(), v }
  return v
}

async function queryWifi(): Promise<WifiParse> {
  try {
    if (process.platform === 'win32') {
      const r = await run('netsh.exe', ['wlan', 'show', 'interfaces'], 8000)
      return parseNetshWlan(r.out)
    }
    if (process.platform === 'darwin') {
      const r = await run('/usr/sbin/system_profiler', ['SPAirPortDataType', '-json'], 25_000)
      return parseMacWifi(JSON.parse(r.out))
    }
  } catch { /* нет данных о Wi-Fi */ }
  return { ifaces: [], active: null }
}

// ---- ping ---------------------------------------------------------------------------

/** На некоторых системах ping не знает ключа -b; после первой неудачи не используем его. */
let macNoBoundIf = false

async function macPing(ip: string, count: number, physNet: PhysNet, waitMs: number): Promise<number[]> {
  const useB = !macNoBoundIf && !!physNet.iface
  const args = macPingArgs({ count, waitMs, src: physNet.ip ?? undefined }, ip)
  // -b принудительно привязывает сокет к интерфейсу: на macOS это единственный надёжный способ идти мимо VPN-туннеля.
  if (useB) args.splice(args.length - 1, 0, '-b', physNet.iface as string)
  const r = await run(MAC_PING, args, count * (waitMs + 700) + 4000)
  const rtts = parseMacPingRtts(r.out)
  if (!rtts.length && useB && /usage|illegal option|invalid|unknown/i.test(r.err)) {
    macNoBoundIf = true
    return macPing(ip, count, physNet, waitMs)
  }
  return rtts
}

/** count пакетов; возвращает времена полученных ответов, мс. */
async function pingSeries(ip: string, count: number, physNet: PhysNet, waitMs = 1000): Promise<number[]> {
  if (process.platform === 'darwin') return macPing(ip, count, physNet, waitMs)
  if (process.platform !== 'win32') return []
  const args = ['-n', String(count), '-w', String(waitMs), ...(physNet.ip ? ['-S', physNet.ip] : []), ip]
  const r = await run('ping.exe', args, count * (waitMs + 700) + 4000)
  return parseWinPingRtts(r.out)
}

const A2S_INFO = Buffer.concat([Buffer.from([0xff, 0xff, 0xff, 0xff, 0x54]), Buffer.from('Source Engine Query\0', 'ascii')])

function isA2sReply(msg: Buffer): boolean {
  // FF FF FF FF + 'I' (ответ) / 'A' (challenge) / 'm' (ответ по частям)
  return msg.length >= 5 && msg.readInt32LE(0) === -1 && [0x49, 0x41, 0x6d].includes(msg[4])
}

/** Один запрос A2S_INFO по UDP (как браузер серверов Steam). null — нет ответа. */
function a2sOnce(ip: string, port: number, src: string | null, timeoutMs = 900): Promise<number | null> {
  return new Promise((resolve) => {
    const sock = dgram.createSocket('udp4')
    let done = false
    let timer: NodeJS.Timeout | undefined
    const finish = (v: number | null): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      try { sock.close() } catch { /* noop */ }
      resolve(v)
    }
    sock.on('error', () => finish(null))
    sock.on('message', (msg, rinfo) => {
      if (rinfo.address === ip && isA2sReply(msg)) finish(Math.max(1, Math.round(performance.now() - start)))
    })
    let start = 0
    sock.bind(0, src ?? undefined, () => {
      timer = setTimeout(() => finish(null), timeoutMs)
      start = performance.now()
      try {
        sock.send(A2S_INFO, port, ip, (e) => {
          if (e) finish(null)
        })
      } catch {
        finish(null)
      }
    })
  })
}

/** Один замер сессии выбранным способом. */
async function pingOne(method: PrematchMethod, ip: string, port: number, physNet: PhysNet): Promise<number | null> {
  if (method === 'a2s') return a2sOnce(ip, port, physNet.ip)
  const r = await pingSeries(ip, 1, physNet, 1000)
  return r.length ? r[0] : null
}

// ---- цель ---------------------------------------------------------------------------

interface Target {
  label: string
  host: string
  ip: string
  port: number
}

async function resolveTarget(raw: string): Promise<Target> {
  const parsed = parseGameServerAddress(String(raw ?? ''))
  if (!parsed) throw new Error('Укажите IP сервера или строку «connect IP:порт», либо выберите датацентр.')
  const { host, port } = parsed
  if (net.isIPv6(host)) throw new Error('IPv6 пока не поддерживается. Укажите адрес IPv4.')
  let ip = host
  if (!net.isIPv4(host)) {
    try {
      let timer: NodeJS.Timeout | undefined
      const r = await Promise.race([
        dns.promises.lookup(host, { family: 4 }).then((x) => x.address),
        new Promise<null>((res) => {
          timer = setTimeout(() => res(null), 4000)
        })
      ])
      clearTimeout(timer)
      if (!r) throw new Error('timeout')
      ip = r
    } catch {
      throw new Error(`Не удалось узнать IP для «${host}». Проверьте адрес.`)
    }
  }
  return { label: host === ip ? `${ip}:${port}` : `${host} (${ip}):${port}`, host, ip, port }
}

// ---- хранилище ----------------------------------------------------------------------

const settingsFile = (): string => path.join(dataDir(), 'prematch-settings.json')
const historyFile = (): string => path.join(dataDir(), 'prematch-history.json')

const clamp = (v: unknown, lo: number, hi: number, def: number): number => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : def
}

function sanitizeLag(v: Partial<LagSettings> | undefined, base: LagSettings): LagSettings {
  return {
    enabled: typeof v?.enabled === 'boolean' ? v.enabled : base.enabled,
    spikeMs: clamp(v?.spikeMs ?? base.spikeMs, 10, 500, base.spikeMs),
    lossStreak: clamp(v?.lossStreak ?? base.lossStreak, 1, 10, base.lossStreak),
    cooldownSec: clamp(v?.cooldownSec ?? base.cooldownSec, 5, 600, base.cooldownSec),
    sound: typeof v?.sound === 'boolean' ? v.sound : base.sound,
    notify: typeof v?.notify === 'boolean' ? v.notify : base.notify
  }
}

let settingsCache: PrematchSettings | null = null

function loadSettings(): PrematchSettings {
  if (settingsCache) return settingsCache
  let raw: Partial<PrematchSettings> = {}
  try {
    if (existsSync(settingsFile())) raw = JSON.parse(readFileSync(settingsFile(), 'utf-8')) as Partial<PrematchSettings>
  } catch { /* битый файл — значения по умолчанию */ }
  settingsCache = {
    lastTarget: typeof raw.lastTarget === 'string' ? raw.lastTarget.slice(0, 200) : '',
    checkLoad: raw.checkLoad === true,
    lag: sanitizeLag(raw.lag, DEFAULT_LAG_SETTINGS)
  }
  return settingsCache
}

function saveSettings(): void {
  try {
    writeFileAtomic(settingsFile(), JSON.stringify(settingsCache ?? loadSettings(), null, 2))
  } catch { /* не критично */ }
}

function patchSettings(patch: Partial<PrematchSettings>): PrematchSettings {
  const cur = loadSettings()
  settingsCache = {
    lastTarget: typeof patch.lastTarget === 'string' ? patch.lastTarget.slice(0, 200) : cur.lastTarget,
    checkLoad: typeof patch.checkLoad === 'boolean' ? patch.checkLoad : cur.checkLoad,
    lag: sanitizeLag(patch.lag, cur.lag)
  }
  saveSettings()
  return settingsCache
}

let historyCache: MatchReport[] | null = null

function loadHistory(): MatchReport[] {
  if (historyCache) return historyCache
  let list: MatchReport[] = []
  try {
    if (existsSync(historyFile())) {
      const j = JSON.parse(readFileSync(historyFile(), 'utf-8')) as unknown
      if (Array.isArray(j)) list = (j as MatchReport[]).filter((r) => r && typeof r.id === 'string' && Array.isArray(r.series)).slice(0, HISTORY_LIMIT)
    }
  } catch { /* битый файл — пустая история */ }
  historyCache = list
  return list
}

function saveHistory(list: MatchReport[]): void {
  historyCache = list.slice(0, HISTORY_LIMIT)
  try {
    writeFileAtomic(historyFile(), JSON.stringify(historyCache))
  } catch { /* не критично */ }
}

// ---- проверка перед каткой ------------------------------------------------------------

let checking = false
let lastCheck: CheckResult | null = null

function sendProgress(p: CheckProgress): void {
  broadcast('prematch:progress', p)
}

function linkDetail(link: LinkInfo): string {
  if (link.type === 'wired') return 'по кабелю'
  if (link.type === 'wifi' && link.wifi) {
    const w = link.wifi
    return `Wi-Fi, ${w.rssiDbm != null ? `${String(w.rssiDbm).replace('-', '−')} дБм` : 'сигнал неизвестен'}${w.band ? `, ${w.band === '2.4' ? '2,4' : w.band} ГГц` : ''}`
  }
  if (link.type === 'wifi-unknown') return 'Wi-Fi, сигнал не определён'
  return 'тип подключения не определён'
}

async function measureTarget(t: Target, physNet: PhysNet): Promise<{ method: PrematchMethod | null; stats: SeriesStats | null }> {
  const icmp = await pingSeries(t.ip, CHECK_TARGET_SAMPLES, physNet)
  if (icmp.length) return { method: 'icmp', stats: summarizeReplies(icmp, CHECK_TARGET_SAMPLES) }
  // Сервер не отвечает на ICMP — пробуем A2S (как оптимизатор маршрута).
  const res: (number | null)[] = []
  for (let i = 0; i < 15; i++) {
    const rtt = await a2sOnce(t.ip, t.port, physNet.ip)
    res.push(rtt)
    if (i === 2 && res.every((r) => r === null)) break
    await sleep(rtt === null ? 300 : 150)
  }
  if (res.some((r) => r !== null)) return { method: 'a2s', stats: summarizeSeries(res) }
  return { method: null, stats: null }
}

async function runCheck(rawTarget: string, opts: { load?: boolean }): Promise<CheckResult> {
  if (checking) throw new Error('Проверка уже идёт.')
  if (session) throw new Error('Сначала завершите игровую сессию.')
  const target = await resolveTarget(rawTarget)
  checking = true
  try {
    patchSettings({ lastTarget: String(rawTarget).trim(), checkLoad: Boolean(opts.load) })

    // 1. Подключение: адаптер, шлюз, Wi-Fi.
    sendProgress({ step: 'link', state: 'run' })
    const [physNet, wifi] = await Promise.all([getPhysNet(true), queryWifi()])
    const link = decideLink(wifi, physNet.iface, process.platform)
    sendProgress({ step: 'link', state: 'done', detail: linkDetail(link) })

    // 2 и 3. Роутер и сервер одновременно.
    sendProgress({ step: 'gateway', state: physNet.gateway ? 'run' : 'skip', detail: physNet.gateway ? undefined : 'роутер не найден' })
    sendProgress({ step: 'target', state: 'run' })
    const gatewayTask = physNet.gateway
      ? pingSeries(physNet.gateway, CHECK_GATEWAY_SAMPLES, physNet).then((r) => {
          const st = summarizeReplies(r, CHECK_GATEWAY_SAMPLES)
          sendProgress({ step: 'gateway', state: 'done', detail: st.received ? `${st.avgMs} мс` : 'не отвечает на пинг' })
          return st
        })
      : Promise.resolve(null)
    const targetTask = measureTarget(target, physNet).then((r) => {
      sendProgress({
        step: 'target',
        state: r.stats ? 'done' : 'fail',
        detail: r.stats ? `${r.stats.avgMs} мс${r.method === 'a2s' ? ' (запрос игрового сервера)' : ''}` : 'не отвечает'
      })
      return r
    })
    const [gwStats, tgt] = await Promise.all([gatewayTask, targetTask])

    // 4. Под нагрузкой (по желанию).
    let load: CheckResult['load'] = null
    if (opts.load) {
      sendProgress({ step: 'load', state: 'run' })
      try {
        const b = await runBufferbloatTest()
        load = {
          grade: b.grade,
          idleMs: b.idle.avgMs,
          loadedMs: b.loaded.avgMs,
          increaseMs: b.increaseMs,
          lossPct: b.loaded.lossPct,
          downloadMbps: b.downloadMbps,
          verdict: b.verdict
        }
        sendProgress({ step: 'load', state: b.grade === 'unknown' ? 'fail' : 'done', detail: b.grade === 'unknown' ? 'не удалось нагрузить канал' : `оценка ${b.grade}` })
      } catch (e) {
        sendProgress({ step: 'load', state: 'fail', detail: e instanceof Error ? e.message : 'ошибка' })
      }
    } else {
      sendProgress({ step: 'load', state: 'skip', detail: 'не выбрано' })
    }

    const verdict = buildCheckVerdict({
      target: { replied: !!tgt.stats, stats: tgt.stats },
      gateway: { found: !!physNet.gateway, replied: !!gwStats && gwStats.received > 0, stats: gwStats },
      link,
      load: load ? { grade: load.grade as 'A' | 'B' | 'C' | 'D' | 'unknown', increaseMs: load.increaseMs, lossPct: load.lossPct } : null
    })
    const result: CheckResult = {
      at: Date.now(),
      target: {
        label: target.label,
        ip: target.ip,
        port: target.port,
        method: tgt.method,
        stats: tgt.stats,
        route: 'напрямую, без VPN'
      },
      gateway: { ip: physNet.gateway, stats: gwStats },
      link,
      load,
      viaPhysical: Boolean(physNet.ip),
      verdict
    }
    lastCheck = result
    return result
  } finally {
    checking = false
  }
}

// ---- игровая сессия -------------------------------------------------------------------

interface LiveSession {
  id: string
  target: Target
  method: PrematchMethod
  startedAt: number
  gapMs: number
  lastTickAt: number
  samples: (number | null)[]
  detector: LagDetector
  lagAlerts: number
  physNet: PhysNet
  timer: NodeJS.Timeout | null
}

let session: LiveSession | null = null

function sessionState(s: LiveSession): SessionState {
  return {
    id: s.id,
    label: s.target.label,
    ip: s.target.ip,
    port: s.target.port,
    method: s.method,
    startedAt: s.startedAt,
    gapMs: s.gapMs,
    intervalMs: SESSION_INTERVAL_MS,
    maxMs: SESSION_MAX_MS,
    samples: s.samples,
    baselineMs: s.detector.baseline(),
    lagAlerts: s.lagAlerts
  }
}

/** Способ замера для сессии: ICMP, а если сервер молчит — A2S. До трёх попыток каждым. */
async function detectMethod(t: Target, physNet: PhysNet): Promise<PrematchMethod | null> {
  for (let i = 0; i < 3; i++) if ((await pingOne('icmp', t.ip, t.port, physNet)) != null) return 'icmp'
  for (let i = 0; i < 3; i++) if ((await pingOne('a2s', t.ip, t.port, physNet)) != null) return 'a2s'
  return null
}

async function startSession(rawTarget: string): Promise<SessionState> {
  if (session) throw new Error('Сессия уже идёт.')
  if (checking) throw new Error('Дождитесь окончания проверки.')
  const target = await resolveTarget(rawTarget)
  checking = true // не даём запустить проверку/вторую сессию, пока определяется способ замера
  let physNet: PhysNet
  let method: PrematchMethod | null
  try {
    physNet = await getPhysNet(true)
    method = await detectMethod(target, physNet)
  } finally {
    checking = false
  }
  if (!method) throw new Error('Сервер не отвечает на пинг. Выберите датацентр из списка или проверьте IP.')
  patchSettings({ lastTarget: String(rawTarget).trim() })
  const now = Date.now()
  const s: LiveSession = {
    id: randomBytes(6).toString('hex'),
    target,
    method,
    startedAt: now,
    gapMs: 0,
    lastTickAt: 0,
    samples: [],
    detector: createLagDetector(),
    lagAlerts: 0,
    physNet,
    timer: null
  }
  session = s
  void tick(s)
  return sessionState(s)
}

async function tick(s: LiveSession): Promise<void> {
  if (session !== s) return
  const t0 = Date.now()
  if (s.lastTickAt && t0 - s.lastTickAt > SESSION_GAP_MS) {
    // Компьютер спал или завис: пропуск не считаем ни потерями, ни временем игры.
    s.gapMs += t0 - s.lastTickAt - SESSION_INTERVAL_MS
  }
  s.lastTickAt = t0
  if (t0 - s.startedAt - s.gapMs >= SESSION_MAX_MS) {
    const report = finishSession('timeout')
    if (report) showSystemNotification('LAZEYKA', 'Игровая сессия завершена по времени (6 часов). Отчёт сохранён.', undefined, 'actions')
    return
  }
  // Раз в минуту обновляем адаптер: Wi-Fi мог переподключиться и сменить адрес.
  if (s.samples.length > 0 && s.samples.length % 20 === 0) {
    try {
      s.physNet = await getPhysNet(true)
    } catch { /* остаёмся на прежнем */ }
  }
  let rtt: number | null = null
  try {
    rtt = await pingOne(s.method, s.target.ip, s.target.port, s.physNet)
  } catch {
    rtt = null
  }
  if (session !== s) return
  s.samples.push(rtt)
  broadcast('prematch:sample', { sessionId: s.id, seq: s.samples.length - 1, rtt })

  const lag = loadSettings().lag
  const ev: LagEvent | null = s.detector.push(rtt, Date.now(), lag)
  if (ev) {
    s.lagAlerts++
    broadcast('prematch:lag', { ...ev, sessionId: s.id, sound: lag.sound, notify: lag.notify })
    if (lag.notify) showSystemNotification('LAZEYKA: лаги', ev.message)
  }
  s.timer = setTimeout(() => void tick(s), Math.max(0, SESSION_INTERVAL_MS - (Date.now() - t0)))
}

function buildReport(s: LiveSession, reason: MatchReport['endedBy']): MatchReport | null {
  if (s.samples.length < REPORT_MIN_SAMPLES) return null
  const endedAt = Date.now()
  const durationMs = Math.max(0, endedAt - s.startedAt - s.gapMs)
  const stats = buildSessionStats(s.samples)
  const b = bucketize(s.samples, REPORT_SERIES_POINTS)
  return {
    id: s.id,
    startedAt: s.startedAt,
    endedAt,
    durationMs,
    endedBy: reason,
    target: { label: s.target.label, ip: s.target.ip, port: s.target.port },
    method: s.method,
    stats,
    baselineMs: s.detector.baseline(),
    lagAlerts: s.lagAlerts,
    verdict: buildSessionVerdict(stats, durationMs),
    series: b.avg,
    seriesMax: b.max,
    seriesLost: b.lost,
    perPoint: Math.max(1, Math.ceil(s.samples.length / REPORT_SERIES_POINTS))
  }
}

/** Синхронно завершает сессию и сохраняет отчёт (нужно и при выходе из программы). */
function finishSession(reason: MatchReport['endedBy']): MatchReport | null {
  const s = session
  if (!s) return null
  session = null
  if (s.timer) clearTimeout(s.timer)
  let report: MatchReport | null = null
  try {
    report = buildReport(s, reason)
    if (report) saveHistory([report, ...loadHistory().filter((r) => r.id !== report!.id)])
  } catch { /* отчёт не критичен */ }
  if (reason !== 'quit') broadcast('prematch:ended', { sessionId: s.id, reason, report })
  return report
}

/** Вызвать при выходе из программы: сессия завершается и сохраняется. */
export function stopPrematchOnQuit(): void {
  try {
    finishSession('quit')
  } catch { /* выходим */ }
}

// ---- регионы Valve --------------------------------------------------------------------

const REGION_NAMES: Record<string, string> = {
  sto: 'Стокгольм', hel: 'Хельсинки', waw: 'Варшава', vie: 'Вена', fra: 'Франкфурт', ams: 'Амстердам',
  lhr: 'Лондон', par: 'Париж', mad: 'Мадрид', lux: 'Люксембург', dxb: 'Дубай', ist: 'Стамбул',
  iad: 'Вашингтон', atl: 'Атланта', ord: 'Чикаго', dfw: 'Даллас', lax: 'Лос-Анджелес', sea: 'Сиэтл',
  gru: 'Сан-Паулу', scl: 'Сантьяго', lim: 'Лима', eze: 'Буэнос-Айрес', bom: 'Мумбаи', maa: 'Ченнаи',
  sgp: 'Сингапур', hkg: 'Гонконг', tyo: 'Токио', seo: 'Сеул', syd: 'Сидней', jnb: 'Йоханнесбург'
}
/** Регионы, которые показываются первыми (ближайшие к игрокам из СНГ). */
const PREFERRED_REGIONS = ['sto', 'hel', 'waw', 'vie', 'fra', 'ams', 'lhr']

let regionsCache: { at: number; list: RegionEntry[] } | null = null
const regionsFile = (): string => path.join(dataDir(), 'prematch-regions.json')

function popsToRegions(raw: unknown): RegionEntry[] {
  const pops = (raw as { pops?: Record<string, { desc?: string; relays?: { ipv4?: string }[] }> } | null)?.pops
  if (!pops || typeof pops !== 'object') return []
  const out: RegionEntry[] = []
  for (const [code, v] of Object.entries(pops)) {
    const relay = Array.isArray(v?.relays) ? v.relays.find((r) => typeof r?.ipv4 === 'string' && net.isIPv4(r.ipv4)) : null
    if (!relay?.ipv4) continue
    // Дубли вида sto2 — тот же город, оставляем основной.
    if (/\d$/.test(code) && pops[code.replace(/\d+$/, '')]) continue
    out.push({ id: code, name: REGION_NAMES[code] ?? String(v?.desc ?? code), ip: relay.ipv4, preferred: PREFERRED_REGIONS.includes(code) })
  }
  out.sort((a, b) => {
    const pa = PREFERRED_REGIONS.indexOf(a.id)
    const pb = PREFERRED_REGIONS.indexOf(b.id)
    if (pa >= 0 || pb >= 0) return (pa < 0 ? 99 : pa) - (pb < 0 ? 99 : pb)
    return a.name.localeCompare(b.name, 'ru')
  })
  return out
}

async function loadRegions(): Promise<RegionEntry[]> {
  if (regionsCache && Date.now() - regionsCache.at < 3_600_000) return regionsCache.list
  let list: RegionEntry[] = []
  try {
    const res = await fetch('https://api.steampowered.com/ISteamApps/GetSDRConfig/v1/?appid=730', { signal: AbortSignal.timeout(8000) })
    if (res.ok) {
      const raw = await res.json()
      list = popsToRegions(raw)
      if (list.length) {
        try { writeFileAtomic(regionsFile(), JSON.stringify(raw)) } catch { /* кэш не главное */ }
      }
    }
  } catch { /* ниже — кэш */ }
  if (!list.length) {
    try {
      if (existsSync(regionsFile())) list = popsToRegions(JSON.parse(readFileSync(regionsFile(), 'utf-8')))
    } catch { /* нет кэша */ }
  }
  if (list.length) regionsCache = { at: Date.now(), list }
  return list
}

// ---- картинка отчёта ------------------------------------------------------------------

function pngFromDataUrl(dataUrl: unknown): Buffer {
  const prefix = 'data:image/png;base64,'
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith(prefix) || dataUrl.length > 16_000_000) throw new Error('Некорректное изображение.')
  const buf = Buffer.from(dataUrl.slice(prefix.length), 'base64')
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error('Некорректное изображение.')
  return buf
}

async function saveImage(dataUrl: unknown, suggested: unknown): Promise<{ saved: boolean; path?: string }> {
  const buf = pngFromDataUrl(dataUrl)
  let name = String(suggested ?? 'lazeyka-match').replace(/[^\w.-]+/g, '_').slice(0, 80) || 'lazeyka-match'
  if (!/\.png$/i.test(name)) name += '.png'
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const opts = {
    title: 'Сохранить отчёт о матче',
    defaultPath: path.join(app.getPath('pictures'), name),
    filters: [{ name: 'PNG', extensions: ['png'] }]
  }
  const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
  if (r.canceled || !r.filePath) return { saved: false }
  await writeFile(r.filePath, buf)
  return { saved: true, path: r.filePath }
}

// ---- IPC ----------------------------------------------------------------------------

/** Как h() из utils/ipc.ts: ошибка обработчика уходит в окно как { ok: false, message }. */
function h<T>(fn: (...args: unknown[]) => Promise<T> | T) {
  return async (_event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => {
    try {
      const value = await fn(...args)
      return { ok: true, value }
    } catch (e: unknown) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) }
    }
  }
}

function handle<T>(channel: string, fn: (...args: unknown[]) => Promise<T> | T): void {
  ipcMain.removeHandler(channel)
  ipcMain.handle(channel, h(fn))
}

export function registerPrematchIpc(): void {
  handle('prematch:check', (target, opts) => runCheck(String(target ?? ''), (opts ?? {}) as { load?: boolean }))
  handle('prematch:start', (target) => startSession(String(target ?? '')))
  handle('prematch:stop', () => finishSession('user'))
  handle('prematch:state', (): PrematchState => ({ session: session ? sessionState(session) : null, checking, lastCheck }))
  handle('prematch:getSettings', () => loadSettings())
  handle('prematch:setSettings', (patch) => patchSettings((patch ?? {}) as Partial<PrematchSettings>))
  handle('prematch:history', () => loadHistory())
  handle('prematch:deleteReport', (id) => {
    const next = loadHistory().filter((r) => r.id !== String(id))
    saveHistory(next)
    return next
  })
  handle('prematch:saveImage', (dataUrl, name) => saveImage(dataUrl, name))
  handle('prematch:copyImage', (dataUrl) => {
    clipboard.writeImage(nativeImage.createFromBuffer(pngFromDataUrl(dataUrl)))
  })
  handle('prematch:nat', async (): Promise<NatResult> => {
    const physNet = await getPhysNet(true)
    return checkNat(physNet.ip)
  })
  handle('prematch:regions', () => loadRegions())
}

/** Горячая клавиша: начать сессию с последней целью или завершить идущую. */
export async function toggleSessionFromHotkey(): Promise<'started' | 'stopped'> {
  if (session) {
    finishSession('user')
    return 'stopped'
  }
  const target = loadSettings().lastTarget
  if (!target) throw new Error('Сначала выберите цель на вкладке «Перед каткой»')
  await startSession(target)
  return 'started'
}

/** Для сценариев: идёт ли сессия и какая цель сохранена. */
export function prematchScenarioInfo(): { active: boolean; target: string } {
  return { active: Boolean(session), target: String(loadSettings().lastTarget ?? '') }
}
export async function startSessionFromScenario(target: string): Promise<void> {
  await startSession(target)
}
export function stopSessionFromScenario(): void {
  finishSession('user')
}
