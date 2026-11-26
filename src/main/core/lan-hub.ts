/**
 * Раздел «Локальная сеть»: один главный выключатель, один QR.
 *  - пульт с телефона (http-сервер на адресе локальной сети, доступ по токену);
 *  - раздача на устройства (HTTP/SOCKS5-прокси на втором порту);
 *  - раздача Wi-Fi (мобильный хот-спот Windows, см. lan-hotspot.ts).
 *
 * По умолчанию всё выключено; при запуске программы включается само только при галочке
 * «включать при запуске». Таймеров в main нет: состояние читается по запросу страницы.
 *
 * Подключить: в main/index.ts вызвать registerLanIpc() при старте, startLanIfAutostart()
 * после готовности окна и stopLanOnQuit() в before-quit.
 */
import { BrowserWindow, ipcMain, net as electronNet, session, shell } from 'electron'
import { execFile, execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { dataDir } from '../utils/dirs'
import { writeFileAtomic } from '../utils/atomic-write'
import { appLog } from '../utils/app-logger'
import { physicalSourceIp } from './core-probe'
import { getLocalNetworkIps, getTgwsStatus, startTgws, stopTgws } from './tgws'
import { getZapretStatus, startZapret, stopZapret } from './zapret'
import {
  connectIncyNode,
  disconnectIncy,
  getIncyStatus,
  getLiveConnectionMode,
  loadIncyNodes,
  loadIncySettings,
  loadIncySubscriptions,
  patchIncySettings,
  selectIncyNode
} from './incy-engine'
import { applySystemDns, getDohProvidersWithPing, getSystemDnsState, providersInstant } from './dns-doh'
import { getAppConfigSync } from '../config'
import { applyScenario, listScenarios } from './scenarios'
import { LanProxy, isPrivateAddress, type LanProxyStats } from './lan-proxy'
import { incyOps, onIncyOpFinish } from './incy-ops-ipc'
import { parseRemoteOp, remoteOpStart } from './lan-remote-jobs'
import { LanServer, sanitizeRemoteMessage, type RemoteResult, type RemoteService } from './lan-server'
import { PHONE_VPN_HINT, PROXY_GUIDES, PROXY_HONEST_NOTE, QUIC_HINT, TELEGRAM_HINT, buildTelegramLinks, type ProxyGuide, type TelegramLinks } from './lan-remote-page'
import { LAN_FIREWALL_RULE, disableProgramBlockers, findProgramBlockers, firewallAddArgs, firewallDeleteArgs, runNetsh, type FirewallBlocker } from './lan-firewall'
import { WarnOnce, hotspotBindVerdict } from './lan-warn'
import { configureHotspot, findHotspotIp, readHotspot, startHotspot, stopHotspot, stopHotspotSync, validateHotspotConfig, type HotspotInfo } from './lan-hotspot'

// ---- Настройки ---------------------------------------------------------------------

export interface LanSettings {
  autostart: boolean
  hubPort: number
  proxyPort: number
  remote: boolean
  share: boolean
  proxyUser: string
  proxyPass: string
  token: string
  /** Правило брандмауэра добавлено нами и ещё не удалено. */
  firewallRule: boolean
  /** Пользователь разрешил брандмауэр кнопкой: правило ставится при каждом включении раздела и снимается при выключении. */
  firewallAuto: boolean
}

const DEFAULTS: LanSettings = {
  autostart: false,
  hubPort: 20900,
  proxyPort: 20901,
  remote: true,
  share: true,
  proxyUser: '',
  proxyPass: '',
  token: '',
  firewallRule: false,
  firewallAuto: false
}

const IS_WIN = process.platform === 'win32'

function settingsFile(): string {
  return path.join(dataDir(), 'lan.json')
}

let cache: LanSettings | null = null

export function loadLanSettings(): LanSettings {
  if (cache) return cache
  let s = { ...DEFAULTS }
  try {
    if (existsSync(settingsFile())) s = { ...s, ...(JSON.parse(readFileSync(settingsFile(), 'utf-8')) as Partial<LanSettings>) }
  } catch {
    /* повреждённый файл — берём значения по умолчанию */
  }
  cache = s
  return s
}

function saveLanSettings(next: LanSettings): void {
  cache = next
  mkdirSync(path.dirname(settingsFile()), { recursive: true })
  writeFileAtomic(settingsFile(), JSON.stringify(next, null, 2))
}

// ---- Публичные типы для страницы ------------------------------------------------------

export interface LanState {
  enabled: boolean
  busy: boolean
  error?: string
  platform: NodeJS.Platform
  settings: Omit<LanSettings, 'token' | 'firewallRule' | 'firewallAuto'>
  address: string | null
  remoteUrl: string | null
  setupUrl: string | null
  proxy: { host: string; port: number; active: boolean; authRequired: boolean } | null
  stats: LanProxyStats | null
  /** Сеть, в которой работает компьютер: «public» — «Общедоступная» (брандмауэр Windows может не пускать). */
  networkCategory: 'public' | 'private' | 'domain' | 'unknown'
  firewallRule: boolean
  /**
   * Запрещающие правила брандмауэра для самой программы (появляются, если в окне Windows «Разрешить доступ?»
   * отметить только частные сети). null — ещё не проверяли (проверка — при нажатии «Разрешить в брандмауэре»).
   */
  firewallBlockers: FirewallBlocker[] | null
  guides: ProxyGuide[]
  honestNote: string
  quicHint: string
  telegramHint: string
  /** Подсказка: VPN на телефоне может не пускать к адресам домашней сети. */
  phoneVpnHint: string
  /** Ссылки «добавить прокси в Telegram» для основной раздачи (с логином и паролем, если они заданы). */
  telegram: TelegramLinks | null
  /** Адрес компьютера в раздаваемой сети Wi-Fi и всё, что нужно устройствам хот-спота; null — хот-спот выключен или раздача на устройства выключена. */
  hotspot: {
    address: string
    setupUrl: string | null
    proxy: { host: string; port: number; authRequired: boolean } | null
    telegram: TelegramLinks | null
  } | null
  /** Для предупреждений на карточке хот-спота: Zapret и VPN включены ли сейчас и в каком режиме VPN. */
  zapretOn: boolean
  vpn: { on: boolean; mode: 'tun' | 'system_proxy' | 'only_proxy' }
}

// ---- Состояние в памяти ----------------------------------------------------------------

let server: LanServer | null = null
let proxy: LanProxy | null = null
let enabled = false
let busy = false
let lastError: string | undefined
let boundIp: string | null = null
let netCat: { at: number; ip: string; value: LanState['networkCategory'] } | null = null
let hotspotStartedByUs = false
/** Дополнительный адрес — компьютер в раздаваемой сети Wi-Fi; на нём тоже слушают пульт и прокси. */
let hotspotIp: string | null = null
let hotspotSync: Promise<void> | null = null
const serviceBusy = new Set<string>()

function broadcast(): void {
  void buildState().then((st) => {
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('lan:state', st)
  })
}

// ---- Адрес и сеть ---------------------------------------------------------------------

async function pickLanIp(): Promise<string> {
  const candidates: string[] = []
  const phys = await physicalSourceIp().catch(() => null)
  if (phys) candidates.push(phys)
  candidates.push(...getLocalNetworkIps())
  // Адрес раздаваемой сети Wi-Fi (192.168.137.1) — не «домашняя сеть»: его берём отдельно, см. syncHotspotListeners.
  const hs = findHotspotIp()
  const ip = candidates.find((c) => c !== hs && net.isIPv4(c) && isPrivateAddress(c) && !c.startsWith('127.') && !c.startsWith('169.254.'))
  if (!ip) throw new Error('Не найден адрес локальной сети. Подключитесь к Wi-Fi или кабелю и включите снова.')
  return ip
}

function readNetworkCategory(ip: string): Promise<LanState['networkCategory']> {
  if (!IS_WIN || !net.isIPv4(ip)) return Promise.resolve('unknown')
  if (netCat && netCat.ip === ip && Date.now() - netCat.at < 30_000) return Promise.resolve(netCat.value)
  const script =
    `$a=(Get-NetIPAddress -AddressFamily IPv4 -IPAddress '${ip}' -ErrorAction SilentlyContinue | Select-Object -First 1).InterfaceIndex;` +
    `$p=$null;if($a){$p=Get-NetConnectionProfile -InterfaceIndex $a -ErrorAction SilentlyContinue | Select-Object -First 1};` +
    `[pscustomobject]@{category=$(if($p){[int]$p.NetworkCategory}else{-1})} | ConvertTo-Json -Compress`
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 12_000 }, (_e, stdout) => {
      let value: LanState['networkCategory'] = 'unknown'
      try {
        const c = Number((JSON.parse(String(stdout).trim()) as { category: number }).category)
        value = c === 0 ? 'public' : c === 1 ? 'private' : c === 2 ? 'domain' : 'unknown'
      } catch {
        /* не разобрали */
      }
      netCat = { at: Date.now(), ip, value }
      resolve(value)
    })
  })
}

// ---- Брандмауэр ------------------------------------------------------------------------
//
// Правило «LAZEYKA LAN» (см. lan-firewall.ts): порты пульта и прокси, все профили сети, только локальные адреса.
// Ставится по кнопке «Разрешить в брандмауэре»; после этого — при каждом включении раздела (firewallAuto),
// снимается при выключении. Перед добавлением старое правило с тем же именем удаляется — дубликатов нет,
// а правило прошлых версий (только для частной сети) заменяется новым.

const fwWarn = new WarnOnce((m) => appLog('warn', `[Локальная сеть] ${m}`))
let firewallBlockers: FirewallBlocker[] | null = null

async function firewallApply(): Promise<void> {
  const s = loadLanSettings()
  await runNetsh(firewallDeleteArgs()).catch(() => void 0)
  try {
    await runNetsh(firewallAddArgs([s.hubPort, s.proxyPort]))
  } catch (e) {
    throw new Error(`Не удалось добавить правило брандмауэра: ${e instanceof Error ? e.message : String(e)}`)
  }
  saveLanSettings({ ...loadLanSettings(), firewallRule: true })
}

/** Кнопка «Разрешить в брандмауэре»: правило + проверка запрещающих правил для программы. */
async function firewallAllow(): Promise<void> {
  if (!IS_WIN) throw new Error('Брандмауэр настраивается только в Windows.')
  await firewallApply()
  saveLanSettings({ ...loadLanSettings(), firewallAuto: true })
  fwWarn.clear('apply')
  firewallBlockers = await findProgramBlockers(process.execPath).catch((e) => {
    appLog('warn', `[Локальная сеть] брандмауэр: ${e instanceof Error ? e.message : String(e)}`)
    return null
  })
}

/** Кнопка «Отключить запрещающие правила»: только те, что найдены для файла этой программы. */
async function firewallUnblock(): Promise<number> {
  if (!IS_WIN) throw new Error('Брандмауэр настраивается только в Windows.')
  const list = firewallBlockers ?? (await findProgramBlockers(process.execPath))
  const n = await disableProgramBlockers(process.execPath, list.map((b) => b.id))
  firewallBlockers = await findProgramBlockers(process.execPath).catch(() => null)
  appLog('info', `[Локальная сеть] отключено запрещающих правил брандмауэра для программы: ${n}`)
  return n
}

/** При включении раздела: вернуть правило, если пользователь его раньше разрешил. Ошибка — одно предупреждение в журнал. */
async function firewallOnStart(): Promise<void> {
  if (!IS_WIN || !loadLanSettings().firewallAuto) return
  try {
    await firewallApply()
    fwWarn.clear('apply')
  } catch (e) {
    fwWarn.warn('apply', e instanceof Error ? e.message : String(e))
  }
}

async function firewallRemove(manual = false): Promise<void> {
  if (!IS_WIN) return
  await runNetsh(firewallDeleteArgs()).catch(() => void 0)
  const s = loadLanSettings()
  if (s.firewallRule || (manual && s.firewallAuto)) saveLanSettings({ ...s, firewallRule: false, firewallAuto: manual ? false : s.firewallAuto })
}

function firewallRemoveSync(): void {
  if (!IS_WIN) return
  try {
    execFileSync('netsh.exe', firewallDeleteArgs(LAN_FIREWALL_RULE), { windowsHide: true, timeout: 6000, stdio: 'ignore' })
  } catch {
    /* правила не было */
  }
  const s = loadLanSettings()
  if (s.firewallRule) saveLanSettings({ ...s, firewallRule: false })
}

// ---- Пульт: состояние, действия, серверы VPN и DNS ---------------------------------------
//
// Долгие действия (подключение VPN, запуск Zapret, сценарии) идут в фоне: телефон сразу получает ответ,
// а результат видит в состоянии (busy → on/err) и в списке событий. Таймеров нет — всё читается по запросу страницы.

interface RemoteEvent {
  seq: number
  at: number
  tone: 'ok' | 'err' | 'warn' | 'info'
  key: string
  text: string
}

let eventSeq = 0
const remoteEvents: RemoteEvent[] = []
/** Последняя ошибка действия с пульта по службе — показывается на плитке до следующего действия. */
const remoteErr = new Map<string, { text: string; code?: string }>()

function pushEvent(tone: RemoteEvent['tone'], key: string, text: string): void {
  remoteEvents.push({ seq: ++eventSeq, at: Date.now(), tone, key, text: sanitizeRemoteMessage(text) })
  if (remoteEvents.length > 20) remoteEvents.shift()
}

const errText = (e: unknown): string => sanitizeRemoteMessage(e instanceof Error ? e.message : String(e))

/** Запустить действие в фоне; занятость видна в состоянии, итог — событием. */
function runBg(key: string, fn: () => Promise<string | void>, okText: string, errPrefix: string): void {
  serviceBusy.add(key)
  remoteErr.delete(key)
  void fn()
    .then((t) => pushEvent('ok', key, t || okText))
    .catch((e) => {
      const text = `${errPrefix}${errText(e)}`
      remoteErr.set(key, { text })
      pushEvent('err', key, text)
    })
    .finally(() => serviceBusy.delete(key))
}

function nodeName(name: string): string {
  const n = String(name || '').trim()
  return (n.length > 80 ? `${n.slice(0, 79)}…` : n) || 'Без названия'
}

function groupTitles(): Map<string, string> {
  return new Map(loadIncySubscriptions().map((s) => [s.id, nodeName(s.title || 'Подписка')]))
}

/** Выбранный сервер VPN: только id, имя и группа. */
function selectedServer(): { id: string; name: string; group: string } | null {
  const id = getIncyStatus().selectedNodeId
  const n = id ? loadIncyNodes().find((x) => x.id === id) : undefined
  if (!n) return null
  return { id: n.id, name: nodeName(n.name), group: n.subscriptionId ? (groupTitles().get(n.subscriptionId) ?? 'Подписка') : 'Добавлены вручную' }
}

function strategyName(): string | undefined {
  try {
    const f = getAppConfigSync().zapret?.activeStrategy
    return f ? path.basename(f).replace(/\.bat$/i, '') : undefined
  } catch {
    return undefined
  }
}

function remoteState(): unknown {
  const z = getZapretStatus()
  const v = getIncyStatus()
  const t = getTgwsStatus()
  const errOf = (key: string, state: string, last?: string): { err?: string; errCode?: string } => {
    const e = remoteErr.get(key)
    if (e) return { err: e.text, errCode: e.code }
    return state === 'error' && last ? { err: sanitizeRemoteMessage(last, 160) } : {}
  }
  return {
    platform: process.platform,
    services: {
      zapret: {
        on: z.state === 'running',
        busy: serviceBusy.has('zapret') || z.state === 'starting' || z.state === 'stopping',
        detail: z.state === 'starting' && z.detail ? sanitizeRemoteMessage(z.detail, 80) : undefined,
        since: z.state === 'running' ? z.startedAt : undefined,
        strategy: strategyName(),
        ...errOf('zapret', z.state, z.lastError)
      },
      vpn: {
        on: v.state === 'running',
        busy: serviceBusy.has('vpn') || v.state === 'connecting',
        recovering: Boolean(v.recovering),
        since: v.state === 'running' ? v.connectedAt : undefined,
        mode: v.connectionMode,
        server: selectedServer(),
        // Номер идущего замера/обновления (с компьютера или телефона): лист серверов по нему начинает показывать ход.
        opSeq: incyOps.running() ? incyOps.view()?.seq : undefined,
        ...errOf('vpn', v.state, v.lastError)
      },
      tg: {
        on: t.state === 'running',
        busy: serviceBusy.has('tg') || t.state === 'starting' || t.state === 'stopping',
        since: t.state === 'running' ? t.startedAt : undefined,
        ...errOf('tg', t.state, t.lastError)
      },
      exitlag: { on: Boolean(loadIncySettings().perAppProxy), busy: serviceBusy.has('exitlag'), ...errOf('exitlag', '', '') }
    },
    scenarios: listScenarios().map((s) => ({
      id: s.id,
      name: s.name,
      emoji: s.emoji,
      // Свою картинку сценария передаём, только если это небольшая data:-картинка.
      icon: typeof s.icon === 'string' && /^data:image\/(png|jpeg|webp|gif);base64,/.test(s.icon) && s.icon.length < 40_000 ? s.icon : undefined
    })),
    proxy: { on: Boolean(proxy), busy },
    events: remoteEvents.slice(-10)
  }
}

/**
 * Проверка перед включением VPN с пульта. Раньше пульт вызывал connectIncyNode() без проверок, и при подключении,
 * которое уже шло, функция молча возвращала статус, а ошибка показывалась лишь короткой подсказкой.
 */
function vpnPrecheck(): RemoteResult | null {
  const nodes = loadIncyNodes()
  if (!nodes.length) {
    const r = { ok: false, code: 'no_nodes', message: 'Нет серверов. Добавьте подписку в программе на компьютере (раздел INCY).' }
    remoteErr.set('vpn', { text: 'Нет серверов', code: 'no_nodes' })
    return r
  }
  const id = getIncyStatus().selectedNodeId
  if (!id || !nodes.some((n) => n.id === id)) {
    remoteErr.set('vpn', { text: 'Сначала выберите сервер', code: 'need_server' })
    return { ok: false, code: 'need_server', message: 'Сначала выберите сервер' }
  }
  return null
}

/** VPN: подключение в фоне; итог проверяем по статусу, а не только по исключению. */
function startVpnBg(nodeId?: string): void {
  runBg(
    'vpn',
    async () => {
      await connectIncyNode(nodeId)
      const st = getIncyStatus()
      if (st.state !== 'running') throw new Error(st.lastError || 'подключение не завершилось')
      const srv = selectedServer()
      return srv ? `VPN подключён: ${srv.name}` : 'VPN подключён'
    },
    'VPN подключён',
    'Не удалось подключиться: '
  )
}

async function remoteToggle(service: RemoteService, on: boolean): Promise<RemoteResult> {
  if (serviceBusy.has(service)) return { ok: false, message: 'Эта операция уже выполняется.' }
  remoteErr.delete(service)
  switch (service) {
    case 'zapret':
      runBg('zapret', () => (on ? startZapret() : stopZapret()), on ? 'Zapret включён' : 'Zapret выключен', on ? 'Zapret не запустился: ' : 'Zapret не остановился: ')
      return { ok: true }
    case 'tg':
      runBg('tg', () => (on ? startTgws() : stopTgws()), on ? 'Telegram-прокси включён' : 'Telegram-прокси выключен', on ? 'Telegram-прокси не запустился: ' : 'Telegram-прокси не остановился: ')
      return { ok: true }
    case 'vpn': {
      const st = getIncyStatus().state
      if (on) {
        if (st === 'running') return { ok: true }
        if (st === 'connecting') return { ok: true, message: 'VPN уже подключается' }
        const bad = vpnPrecheck()
        if (bad) return bad
        startVpnBg()
        return { ok: true }
      }
      runBg('vpn', async () => void (await disconnectIncy()), 'VPN отключён', 'VPN не отключился: ')
      return { ok: true }
    }
    case 'exitlag':
      try {
        patchIncySettings({ perAppProxy: on })
        pushEvent('ok', 'exitlag', on ? 'ExitLag включён' : 'ExitLag выключен')
        return { ok: true }
      } catch (e) {
        return { ok: false, message: errText(e) }
      }
  }
  return { ok: false, message: 'Неизвестная служба' }
}

/** «Включить всё» / «Выключить всё»: Zapret, Telegram-прокси и VPN по очереди. ExitLag не трогаем — это режим VPN. */
async function remoteAll(on: boolean): Promise<RemoteResult> {
  if (serviceBusy.has('all')) return { ok: false, message: 'Уже выполняется.' }
  let note: string | undefined
  let vpnOk = true
  if (on && getIncyStatus().state !== 'running') {
    const bad = vpnPrecheck()
    if (bad) {
      vpnOk = false
      note = `VPN не включится: ${bad.message?.toLowerCase()}`
    }
  }
  const z = getZapretStatus().state === 'running'
  const t = getTgwsStatus().state === 'running'
  const v = getIncyStatus().state === 'running'
  for (const k of ['zapret', 'tg', 'vpn']) remoteErr.delete(k)
  if (!vpnOk) remoteErr.set('vpn', { text: 'Сначала выберите сервер', code: 'need_server' })
  serviceBusy.add('all')
  const step = async (key: string, need: boolean, fn: () => Promise<unknown>, what: string): Promise<string | null> => {
    if (!need) return null
    serviceBusy.add(key)
    try {
      await fn()
      if (key === 'vpn' && on && getIncyStatus().state !== 'running') throw new Error(getIncyStatus().lastError || 'не подключился')
      return null
    } catch (e) {
      const text = `${what}: ${errText(e)}`
      remoteErr.set(key, { text })
      return text
    } finally {
      serviceBusy.delete(key)
    }
  }
  void (async () => {
    const bad: string[] = []
    if (on) {
      for (const r of [
        await step('zapret', !z, startZapret, 'Zapret'),
        await step('tg', !t, startTgws, 'Telegram-прокси'),
        await step('vpn', vpnOk && !v, () => connectIncyNode(), 'VPN')
      ]) if (r) bad.push(r)
    } else {
      for (const r of [
        await step('vpn', v, disconnectIncy, 'VPN'),
        await step('zapret', z, stopZapret, 'Zapret'),
        await step('tg', t, stopTgws, 'Telegram-прокси')
      ]) if (r) bad.push(r)
    }
    serviceBusy.delete('all')
    if (bad.length) pushEvent('err', 'all', `Не всё получилось. ${bad.join('. ')}`)
    else pushEvent('ok', 'all', on ? 'Всё включено' : 'Всё выключено')
  })()
  return { ok: true, message: note }
}

async function remoteScenario(id: string): Promise<RemoteResult> {
  const sc = listScenarios().find((s) => s.id === id)
  if (!sc) return { ok: false, message: 'Такого сценария нет.' }
  const key = `sc:${id}`
  if (serviceBusy.has(key)) return { ok: false, message: 'Этот сценарий уже выполняется.' }
  runBg(
    key,
    async () => {
      const steps = await applyScenario(id)
      const bad = steps.filter((x) => !x.ok)
      if (bad.length) throw new Error(bad.map((b) => b.what).join(', '))
      return `Сценарий «${sc.name}» выполнен`
    },
    'Сценарий выполнен',
    `Сценарий «${sc.name}»: не получилось — `
  )
  return { ok: true }
}

/**
 * «Обновить подписки» и «Проверить пинг» с телефона — через общий менеджер (incy-ops-ipc.ts), тот же, что у кнопок
 * на странице INCY. Если замер запущен в программе, телефон видит его прогресс и может остановить, и наоборот.
 * Повторный запуск во время идущего не дублирует, а возвращает текущее. Каждое действие с телефона — не чаще раза в 10 с.
 * Плашка с итогом уходит на телефон только для действий, запущенных с телефона.
 */
onIncyOpFinish((v) => {
  if (v.source !== 'remote') return
  pushEvent(v.ok ? 'ok' : 'err', `vpn-${v.kind}`, v.text ?? '')
  appLog(v.ok ? 'info' : 'warn', `[Локальная сеть] пульт: ${sanitizeRemoteMessage(v.text ?? '')}`)
})

function remoteVpnJob(kind: 'refresh' | 'ping' | 'stop', body?: Record<string, unknown>): RemoteResult {
  if (kind === 'stop') {
    const r = incyOps.stop()
    return r.ok ? { ok: true, message: 'Останавливаю' } : { ok: false, code: 'idle', message: 'Сейчас ничего не выполняется.' }
  }
  return remoteOpStart(incyOps, kind, parseRemoteOp(body))
}

/** Список серверов для телефона: только id, имя, группа и последний пинг. Ни адресов, ни ключей, ни ссылок подписок. */
function remoteVpnNodes(): unknown {
  const st = getIncyStatus()
  const titles = groupTitles()
  const job = incyOps.view()
  const snap = incyOps.snapshot()
  const targets = new Set(snap.targetIds)
  return {
    selectedId: st.selectedNodeId,
    activeId: st.state === 'running' ? st.activeNodeId : null,
    subs: titles.size,
    job: job
      ? {
          kind: job.kind,
          running: job.running,
          stopping: job.stopping || undefined,
          stopped: job.stopped || undefined,
          done: job.done,
          total: job.total,
          ok: job.ok,
          seq: job.seq,
          scope: job.scope,
          // С телефона или из программы: телефон подписывает «запущено на компьютере».
          fromApp: job.source === 'app' || undefined,
          label: sanitizeRemoteMessage(job.scopeLabel, 80),
          text: job.text ? sanitizeRemoteMessage(job.text, 200) : undefined
        }
      : null,
    nodes: loadIncyNodes().map((n) => {
      // Во время замера показываем уже полученные числа, не дожидаясь записи в файл.
      const part = incyOps.partialLatency(n.id)
      const lat = part !== undefined ? part : n.latencyMs
      return {
        id: n.id,
        name: nodeName(n.name),
        group: n.subscriptionId ? (titles.get(n.subscriptionId) ?? 'Подписка') : 'Добавлены вручную',
        // Для «Проверить эту группу»: id подписки ('' — добавленные вручную).
        gid: n.subscriptionId ?? '',
        ping: typeof lat === 'number' && lat > 0 ? Math.round(lat) : null,
        checked: part !== undefined || Boolean(n.latencyAt),
        pinging: targets.has(n.id) && part === undefined ? true : undefined
      }
    })
  }
}

async function remoteVpnSelect(id: string): Promise<RemoteResult> {
  const node = loadIncyNodes().find((n) => n.id === id)
  if (!node) return { ok: false, message: 'Такого сервера больше нет. Обновите список.' }
  if (serviceBusy.has('vpn') || getIncyStatus().state === 'connecting') return { ok: false, message: 'VPN сейчас подключается. Подождите.' }
  selectIncyNode(id)
  remoteErr.delete('vpn')
  // Как в программе: при работающем VPN выбор сервера сразу переподключает на него. Режим не меняется.
  if (getIncyStatus().state === 'running') {
    startVpnBg(id)
    return { ok: true, code: 'reconnect', message: `Переключаю на ${nodeName(node.name)}` }
  }
  return { ok: true, message: `Выбран сервер: ${nodeName(node.name)}` }
}

/** DNS для телефона: имя, описание, признаки; без адресов серверов. */
async function remoteDnsState(ping: boolean): Promise<unknown> {
  const list = ping ? await getDohProvidersWithPing() : providersInstant()
  const sys = await getSystemDnsState().catch(() => null)
  const cur = sys?.providerId ? list.find((p) => p.id === sys.providerId) : undefined
  return {
    current: cur ? { id: cur.id, name: cur.name, encrypted: Boolean(cur.url) } : null,
    list: list.map((p) => ({
      id: p.id,
      name: p.name,
      desc: sanitizeRemoteMessage(p.description || '', 90),
      encrypted: Boolean(p.url),
      custom: Boolean(p.custom),
      ping: typeof p.latencyMs === 'number' && p.latencyMs > 0 ? Math.round(p.latencyMs) : null
    }))
  }
}

async function remoteDnsApply(id: string): Promise<RemoteResult> {
  if (id !== 'dhcp' && !providersInstant().some((p) => p.id === id)) return { ok: false, message: 'Неизвестный DNS-сервер' }
  if (serviceBusy.has('dns')) return { ok: false, message: 'DNS уже меняется. Подождите.' }
  serviceBusy.add('dns')
  try {
    const r = await applySystemDns(id === 'dhcp' ? 'dhcp' : id)
    let message = sanitizeRemoteMessage(r.message)
    if (r.needsProfile) message += '. На компьютере открылся профиль DNS: подтвердите установку там.'
    return { ok: r.success, message }
  } finally {
    serviceBusy.delete('dns')
  }
}

// ---- Запуск и остановка ----------------------------------------------------------------

function validatePorts(hub: number, prx: number): void {
  for (const p of [hub, prx]) {
    if (!Number.isInteger(p) || p < 1024 || p > 65535) throw new Error('Порт должен быть числом от 1024 до 65535.')
  }
  if (hub === prx) throw new Error('Порты пульта и прокси должны различаться.')
}

async function startShareProxy(srv: LanServer, ip: string, settings: LanSettings): Promise<LanProxy> {
  const prx = new LanProxy({
    host: ip,
    port: settings.proxyPort,
    username: settings.proxyUser,
    password: settings.proxyPass,
    log: (message) => appLog('warn', `[Локальная сеть] ${message}`),
    isSelfService: (address, port) => port === loadLanSettings().hubPort && srv.hosts().includes(address)
  })
  try {
    await prx.start()
    for (const host of srv.hosts()) if (host !== ip) await prx.addHost(host)
    return prx
  } catch (error) {
    await prx.stop()
    throw error
  }
}

function remoteProxyShare(on: boolean, peer: { ip: string; port: number }): Promise<RemoteResult> {
  return enqueue(async () => {
    const ip = boundIp
    const srv = server
    if (!enabled || !ip || !srv) return { ok: false, message: 'Локальная сеть выключена' }
    const current = proxy
    if (Boolean(current) === on) return { ok: true }
    if (!on && current?.ownsUpstream(peer.ip, peer.port)) {
      return { ok: false, message: 'Этот пульт открыт через прокси. Сначала отключите прокси в настройках Wi-Fi телефона и откройте пульт по локальному адресу.' }
    }
    busy = true
    broadcast()
    try {
      const settings = loadLanSettings()
      if (on) {
        const next = await startShareProxy(srv, ip, settings)
        try {
          saveLanSettings({ ...settings, share: true })
        } catch (error) {
          await next.stop()
          throw error
        }
        proxy = next
      } else {
        saveLanSettings({ ...settings, share: false })
        proxy = null
        await current?.stop()
      }
      return { ok: true }
    } finally {
      busy = false
      broadcast()
    }
  })
}

async function startAll(): Promise<void> {
  let s = loadLanSettings()
  validatePorts(s.hubPort, s.proxyPort)
  if (!s.token) {
    s = { ...s, token: randomBytes(16).toString('hex') }
    saveLanSettings(s)
  }
  const ip = await pickLanIp()
  const log = (m: string): void => appLog('warn', `[Локальная сеть] ${m}`)
  const srv = new LanServer({
    host: ip,
    port: s.hubPort,
    getToken: () => loadLanSettings().token,
    handlers: {
      getState: remoteState,
      toggle: remoteToggle,
      scenario: remoteScenario,
      all: remoteAll,
      vpnNodes: remoteVpnNodes,
      vpnSelect: remoteVpnSelect,
      vpnJob: remoteVpnJob,
      dnsState: remoteDnsState,
      dnsApply: remoteDnsApply,
      proxyShare: remoteProxyShare,
      youtubeCheck: checkYouTubeThroughProxy
    },
    isRemoteEnabled: () => loadLanSettings().remote,
    getSetupInfo: (reqHost) => {
      const cur = loadLanSettings()
      if (!cur.share) return null
      // Вкладка показывает тот адрес, по которому страницу открыли (домашняя сеть или раздаваемый Wi-Fi).
      const host = server && server.hosts().includes(reqHost) ? reqHost : ip
      return { host, port: cur.proxyPort, authRequired: Boolean(cur.proxyUser && cur.proxyPass) }
    },
    log
  })
  await srv.start()
  let prx: LanProxy | null = null
  try {
    if (s.share) prx = await startShareProxy(srv, ip, s)
  } catch (e) {
    await srv.stop()
    throw e
  }
  server = srv
  proxy = prx
  boundIp = ip
  enabled = true
  appLog('info', `[Локальная сеть] включена на ${ip}`)
  await firewallOnStart()
  await syncHotspotListeners()
}

/**
 * Если компьютер раздаёт Wi-Fi, у него есть второй адрес (обычно 192.168.137.1): слушаем пульт и прокси и на нём,
 * иначе устройства хот-спота не смогли бы подключиться. Без таймеров: вызывается при включении, при переключении
 * раздачи Wi-Fi и при чтении состояния страницей.
 *
 * Сразу после включения хот-спота Windows уже показывает адрес на адаптере, но открыть на нём порт ещё нельзя
 * (EADDRNOTAVAIL, «адрес недоступен»): система несколько секунд проверяет адрес. Раньше каждая такая попытка
 * писала в журнал «адрес компьютера в сети изменился» — до 8 раз подряд при каждом включении. Теперь в первые
 * 20 секунд после появления адреса эта ошибка — повод молча попробовать позже, а предупреждение пишется
 * один раз на событие (повтор того же текста не пишется, пока адрес не заработает или не исчезнет).
 */
const hsWarn = new WarnOnce((m) => appLog('warn', `[Локальная сеть] раздаваемая сеть Wi-Fi: ${m}`))
/** Когда адрес хот-спота впервые увидели (для отсрочки предупреждения); сбрасывается, когда адрес пропал. */
let hotspotSeen: { ip: string; at: number } | null = null

function syncHotspotListeners(): Promise<void> {
  if (hotspotSync) return hotspotSync
  hotspotSync = (async () => {
    const srv = server
    const prx = proxy
    if (!enabled || !srv) return
    const want = IS_WIN ? findHotspotIp() : null
    if (!want) {
      hotspotSeen = null
      hsWarn.reset()
    } else if (!hotspotSeen || hotspotSeen.ip !== want) {
      hotspotSeen = { ip: want, at: Date.now() }
      hsWarn.reset()
    }
    try {
      if (hotspotIp && hotspotIp !== want) {
        const old = hotspotIp
        hotspotIp = null
        await srv.removeHost(old)
        await prx?.removeHost(old)
      }
      if (want && want !== boundIp && want !== hotspotIp) {
        await srv.addHost(want)
        if (prx) await prx.addHost(want)
        hotspotIp = want
        hsWarn.reset()
        appLog('info', `[Локальная сеть] слушаю и в раздаваемой сети Wi-Fi: ${want}`)
      }
    } catch (e) {
      if (want) {
        await srv.removeHost(want).catch(() => void 0)
        await prx?.removeHost(want).catch(() => void 0)
      }
      hotspotIp = null
      const code = (e as NodeJS.ErrnoException)?.code
      const verdict = hotspotBindVerdict({ code, firstSeenAt: hotspotSeen?.at ?? Date.now(), now: Date.now() })
      if (verdict === 'warn') {
        hsWarn.warn(
          'bind',
          code === 'EADDRNOTAVAIL'
            ? `адрес ${want} не стал доступен для подключений. Устройства этой сети не смогут открыть пульт. Выключите и включите раздачу Wi-Fi.`
            : e instanceof Error
              ? e.message
              : String(e)
        )
      }
    }
  })().finally(() => {
    hotspotSync = null
  })
  return hotspotSync
}

/** После включения хот-спота адрес на адаптере становится рабочим не сразу: до 25 секунд проверяем раз в полсекунды (только в этот момент). */
async function waitHotspotAddress(): Promise<void> {
  for (let i = 0; i < 50 && enabled; i++) {
    await syncHotspotListeners()
    if (hotspotIp) return
    await new Promise((r) => setTimeout(r, 500))
  }
}

async function stopAll(): Promise<void> {
  const srv = server
  const prx = proxy
  server = null
  proxy = null
  boundIp = null
  hotspotIp = null
  hotspotSeen = null
  hsWarn.reset()
  enabled = false
  await Promise.all([srv?.stop(), prx?.stop()])
  await firewallRemove()
  appLog('info', '[Локальная сеть] выключена')
}

let queue: Promise<unknown> = Promise.resolve()
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn)
  queue = next.catch(() => void 0)
  return next
}

async function setEnabled(on: boolean): Promise<LanState> {
  return enqueue(async () => {
    busy = true
    lastError = undefined
    broadcast()
    try {
      if (on && !enabled) await startAll()
      else if (!on && enabled) await stopAll()
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e)
      enabled = false
      throw e
    } finally {
      busy = false
      broadcast()
    }
    return buildState()
  })
}

function validateSettingsPatch(patch: Partial<LanSettings>, cur: LanSettings): LanSettings {
  const next: LanSettings = { ...cur }
  if (typeof patch.autostart === 'boolean') next.autostart = patch.autostart
  if (typeof patch.remote === 'boolean') next.remote = patch.remote
  if (typeof patch.share === 'boolean') next.share = patch.share
  if (patch.hubPort !== undefined) next.hubPort = Number(patch.hubPort)
  if (patch.proxyPort !== undefined) next.proxyPort = Number(patch.proxyPort)
  if (typeof patch.proxyUser === 'string') next.proxyUser = patch.proxyUser.trim()
  if (typeof patch.proxyPass === 'string') next.proxyPass = patch.proxyPass
  validatePorts(next.hubPort, next.proxyPort)
  if (next.proxyUser.includes(':')) throw new Error('В логине нельзя использовать двоеточие.')
  if (next.proxyUser.length > 64 || next.proxyPass.length > 64) throw new Error('Логин и пароль — не длиннее 64 символов.')
  if (Boolean(next.proxyUser) !== Boolean(next.proxyPass)) throw new Error('Укажите и логин, и пароль, либо оставьте оба поля пустыми.')
  return next
}

async function setSettings(patch: Partial<LanSettings>): Promise<LanState> {
  const cur = loadLanSettings()
  const next = validateSettingsPatch(patch, cur)
  const needRestart =
    enabled && (next.hubPort !== cur.hubPort || next.proxyPort !== cur.proxyPort || next.remote !== cur.remote || next.share !== cur.share)
  saveLanSettings(next)
  if (enabled && !needRestart && (next.proxyUser !== cur.proxyUser || next.proxyPass !== cur.proxyPass)) {
    proxy?.setAuth(next.proxyUser, next.proxyPass)
  }
  if (needRestart) {
    await enqueue(async () => {
      busy = true
      broadcast()
      try {
        await stopAll()
        await startAll()
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e)
        throw e
      } finally {
        busy = false
      }
    })
  }
  broadcast()
  return buildState()
}

function rotateToken(): Promise<LanState> {
  const s = loadLanSettings()
  saveLanSettings({ ...s, token: randomBytes(16).toString('hex') })
  broadcast()
  return buildState()
}

async function buildState(): Promise<LanState> {
  const s = loadLanSettings()
  if (enabled) await syncHotspotListeners()
  const ip = boundIp
  const showProxy = enabled && s.share && ip
  const hip = enabled ? hotspotIp : null
  const authOn = Boolean(s.proxyUser && s.proxyPass)
  const vpnState = getIncyStatus().state
  const category = enabled && ip ? await readNetworkCategory(ip) : 'unknown'
  return {
    enabled,
    busy,
    error: lastError,
    platform: process.platform,
    settings: {
      autostart: s.autostart,
      hubPort: s.hubPort,
      proxyPort: s.proxyPort,
      remote: s.remote,
      share: s.share,
      proxyUser: s.proxyUser,
      proxyPass: s.proxyPass
    },
    address: enabled ? ip : null,
    remoteUrl: enabled && s.remote && ip ? `http://${ip}:${s.hubPort}/?k=${s.token}` : null,
    setupUrl: showProxy ? `http://${ip}:${s.hubPort}/setup` : null,
    proxy: showProxy ? { host: ip, port: s.proxyPort, active: Boolean(proxy), authRequired: Boolean(s.proxyUser && s.proxyPass) } : null,
    stats: proxy ? proxy.stats() : null,
    networkCategory: category,
    firewallRule: s.firewallRule,
    firewallBlockers,
    guides: PROXY_GUIDES,
    honestNote: PROXY_HONEST_NOTE,
    quicHint: QUIC_HINT,
    telegramHint: TELEGRAM_HINT,
    phoneVpnHint: PHONE_VPN_HINT,
    telegram: showProxy ? buildTelegramLinks({ host: ip, port: s.proxyPort, user: s.proxyUser, pass: s.proxyPass }) : null,
    hotspot: hip
      ? {
          address: hip,
          setupUrl: s.share ? `http://${hip}:${s.hubPort}/setup` : null,
          proxy: s.share && proxy ? { host: hip, port: s.proxyPort, authRequired: authOn } : null,
          telegram: s.share && proxy ? buildTelegramLinks({ host: hip, port: s.proxyPort, user: s.proxyUser, pass: s.proxyPass }) : null
        }
      : null,
    zapretOn: ['running', 'starting'].includes(getZapretStatus().state),
    vpn: { on: vpnState === 'running' || vpnState === 'connecting', mode: getLiveConnectionMode() ?? getIncyStatus().connectionMode }
  }
}

// ---- Публичный API ---------------------------------------------------------------------------

/** Включить раздел при запуске программы, только если стоит галочка. */
export async function startLanIfAutostart(): Promise<void> {
  if (!loadLanSettings().autostart || enabled) return
  try {
    await setEnabled(true)
  } catch (e) {
    appLog('warn', `[Локальная сеть] не включилась при запуске: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/** Остановить сокеты и дождаться отмены сетевой проверки при выходе. */
export async function stopLanOnQuit(): Promise<void> {
  const pendingCheck = youtubeProxyCheck
  youtubeProxyAbort?.abort()
  const srv = server
  const prx = proxy
  server = null
  proxy = null
  hotspotIp = null
  enabled = false
  const stops = [srv?.stop(), prx?.stop(), pendingCheck]
  firewallRemoveSync()
  if (hotspotStartedByUs) {
    hotspotStartedByUs = false
    stopHotspotSync()
  }
  await Promise.allSettled(stops)
}

type Envelope<T> = { ok: true; value: T } | { ok: false; message: string }

function h<T>(fn: (...args: unknown[]) => Promise<T> | T) {
  return async (_event: Electron.IpcMainInvokeEvent, ...args: unknown[]): Promise<Envelope<T>> => {
    try {
      return { ok: true, value: await fn(...args) }
    } catch (e: unknown) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) }
    }
  }
}

const YOUTUBE_PROXY_CHECKS = [
  { label: 'Сайт YouTube', url: 'https://www.youtube.com/', minBytes: 0 },
  { label: 'Сервер видео', url: 'https://redirector.googlevideo.com/report_mapping', minBytes: 16 * 1024 }
]

let youtubeProxyCheck: Promise<{ label: string; ok: boolean; detail: string }[]> | null = null
let youtubeProxyAbort: AbortController | null = null

function checkYouTubeThroughProxy(): Promise<{ label: string; ok: boolean; detail: string }[]> {
  if (youtubeProxyCheck) return youtubeProxyCheck
  const ip = boundIp
  if (!enabled || !proxy || !ip) throw new Error('Сначала включите прокси для устройств')
  const settings = loadLanSettings()
  const controller = new AbortController()
  youtubeProxyAbort = controller
  youtubeProxyCheck = (async () => {
    const checkSession = session.fromPartition('lan-proxy-check', { cache: false })
    try {
      await checkSession.closeAllConnections()
      controller.signal.throwIfAborted()
      const host = net.isIPv6(ip) ? `[${ip}]` : ip
      await checkSession.setProxy({ mode: 'fixed_servers', proxyRules: `http://${host}:${settings.proxyPort}`, proxyBypassRules: '<-loopback>' })
      controller.signal.throwIfAborted()
      return await Promise.all(YOUTUBE_PROXY_CHECKS.map(({ label, url, minBytes }) =>
        new Promise<{ label: string; ok: boolean; detail: string }>((resolve) => {
          const req = electronNet.request({ url, session: checkSession, redirect: 'manual' })
          let sentAuth = false
          let finished = false
          const finish = (ok: boolean, detail: string): void => {
            if (finished) return
            finished = true
            clearTimeout(timer)
            controller.signal.removeEventListener('abort', abort)
            resolve({ label, ok, detail })
            req.abort()
          }
          let received = 0
          const timer = setTimeout(() => finish(false, received ? `Загрузка остановилась (получено ${received} из ${minBytes} байт)` : 'Нет ответа через прокси за 12 с'), 12_000)
          const abort = (): void => finish(false, 'Проверка остановлена')
          controller.signal.addEventListener('abort', abort, { once: true })
          req.on('login', (info, cb) => {
            if (info.isProxy && !sentAuth && settings.proxyUser) {
              sentAuth = true
              cb(settings.proxyUser, settings.proxyPass)
            } else cb()
          })
          req.on('redirect', (status, _method, target) => {
            const destination = new URL(target)
            const trusted = destination.protocol === 'https:' &&
              ['youtube.com', 'google.com', 'googlevideo.com'].some((domain) =>
                destination.hostname === domain || destination.hostname.endsWith('.' + domain))
            if (trusted && minBytes) req.followRedirect()
            else finish(trusted, trusted ? `Ответил через прокси (перенаправление ${status})` : `Неожиданное перенаправление: ${destination.hostname}`)
          })
          req.on('response', (res) => {
            const ok = res.statusCode >= 200 && res.statusCode < 300
            if (!ok || !minBytes) {
              finish(ok, ok ? `Ответил через прокси (HTTP ${res.statusCode})` : `Через прокси получен HTTP ${res.statusCode}`)
              return
            }
            res.on('data', (chunk: Buffer) => {
              received += chunk.length
              if (received >= minBytes) finish(true, `Загружено ${minBytes / 1024} КБ через прокси`)
            })
            res.on('end', () => finish(false, `Сервер ответил, но прислал меньше ${minBytes / 1024} КБ (${received} байт)`))
            res.on('error', (error) => finish(false, error.message))
          })
          req.on('error', (error) => finish(false, error.message))
          req.end()
        })
      ))
    } finally {
      await checkSession.closeAllConnections().catch(() => void 0)
    }
  })().finally(() => {
    youtubeProxyAbort = null
    youtubeProxyCheck = null
  })
  return youtubeProxyCheck
}

export function registerLanIpc(): void {
  ipcMain.handle('lan:checkYouTubeProxy', h(() => checkYouTubeThroughProxy()))
  ipcMain.handle('lan:getState', h(() => buildState()))
  ipcMain.handle('lan:setEnabled', h((on) => setEnabled(Boolean(on))))
  ipcMain.handle('lan:setSettings', h((patch) => setSettings((patch ?? {}) as Partial<LanSettings>)))
  ipcMain.handle('lan:rotateToken', h(() => rotateToken()))
  ipcMain.handle(
    'lan:firewall',
    h(async (mode) => {
      if (mode === 'allow') await firewallAllow()
      else if (mode === 'remove') await firewallRemove(true)
      else if (mode === 'unblock') await firewallUnblock()
      else throw new Error('Неизвестное действие.')
      broadcast()
      return buildState()
    })
  )
  ipcMain.handle(
    'lan:openRemote',
    h(async () => {
      const st = await buildState()
      if (!st.remoteUrl) throw new Error('Пульт выключен: включите раздел и пульт.')
      await shell.openExternal(st.remoteUrl)
    })
  )
  ipcMain.handle('lan:hotspotState', h(() => readHotspot()))
  ipcMain.handle(
    'lan:hotspotSet',
    h(async (arg) => {
      const a = (arg ?? {}) as { on?: boolean; ssid?: string; password?: string }
      let info: HotspotInfo | null = null
      if (a.ssid !== undefined || a.password !== undefined) {
        const cur = await readHotspot()
        if (!cur.supported) return cur
        const ssid = a.ssid ?? cur.ssid
        const password = a.password ?? cur.password
        const bad = validateHotspotConfig(ssid, password)
        if (bad) throw new Error(bad)
        // Windows применяет новое имя и пароль только при выключенной раздаче.
        if (cur.on) await stopHotspot()
        info = await configureHotspot(ssid, password)
        if (cur.on) {
          info = await startHotspot()
          await waitHotspotAddress()
          broadcast()
        }
      }
      if (typeof a.on === 'boolean') {
        info = a.on ? await startHotspot() : await stopHotspot()
        hotspotStartedByUs = a.on
        if (a.on) await waitHotspotAddress()
        else await syncHotspotListeners()
        broadcast()
      }
      return info ?? (await readHotspot())
    })
  )
}

/** Для сценариев: включить или выключить раздел. Возвращает true, если состояние изменилось. */
export async function setLanEnabledFromScenario(on: boolean): Promise<boolean> {
  const st = await buildState()
  if (st.enabled === on) return false
  await setEnabled(on)
  return true
}
