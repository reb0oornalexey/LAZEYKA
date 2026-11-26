/**
 * Блок «Стример»: режим стримера (размытие чувствительных данных), тест ingest-серверов и Discord Rich Presence.
 *
 * Правила:
 *  - в фоне ничего не работает, пока пользователь не включил: опрос процессов идёт только в режиме «Авто»
 *    (раз в 15 секунд); связь с Discord — только при включённой галочке «Показывать в Discord», без опроса:
 *    активность уходит при смене состояния, повтор подключения раз в 2 минуты, пока Discord не запущен;
 *  - в Discord уходят только готовые короткие фразы и пинг, названия серверов и адреса не передаются никогда;
 *  - настройки лежат в streamer.json в каталоге данных.
 */
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { BrowserWindow, ipcMain } from 'electron'
import { dataDir } from '../utils/dirs'
import { writeFileAtomic } from '../utils/atomic-write'
import { listRunningProcessNames } from '../utils/mac-apps'
import { appLog } from '../utils/app-logger'
import { onServiceStatusChanged } from '../utils/status-bus'
import { getZapretStatus } from './zapret'
import { getTgwsStatus } from './tgws'
import { getIncyStatus, loadIncyNodes, loadIncySettings, normalizePerAppList, patchIncySettings } from './incy-engine'
import { DiscordRpc } from './discord-rpc'
import { DiscordPresence, type DesiredActivity } from './discord-presence'
import { listIngests, runIngestTest } from './ingest-test'
import { registerStreamDeckIpc } from './streamdeck'
import { findStreamProgram, type IngestServer } from './streamer-logic'

// ---- Настройки ---------------------------------------------------------------------------

export type StreamerModeSetting = 'off' | 'on' | 'auto'
export type SensitiveCategory = 'ip' | 'node' | 'link' | 'qr' | 'id'

export interface StreamerSettings {
  mode: StreamerModeSetting
  categories: Record<SensitiveCategory, boolean>
  hideNotifications: boolean
  discordEnabled: boolean
  discordShowPing: boolean
  /**
   * Пользователь хотя бы раз сам менял настройки Discord. Пока нет — действуют значения по умолчанию
   * (показ и пинг включены), что бы ни лежало в файле; после первого выбора его выбор не трогаем.
   */
  discordTouched: boolean
}

const CATEGORIES: SensitiveCategory[] = ['ip', 'node', 'link', 'qr', 'id']

const DEFAULTS: StreamerSettings = {
  mode: 'off',
  categories: { ip: true, node: true, link: true, qr: true, id: true },
  hideNotifications: false,
  discordEnabled: true,
  discordShowPing: true,
  discordTouched: false
}

export interface DiscordPreview {
  details: string
  state: string | null
}

export interface DiscordStatusInfo {
  enabled: boolean
  /** off — выключено; waiting — Discord не запущен или не отвечает; connected — связь есть. */
  link: 'off' | 'waiting' | 'connected'
  /** Что сейчас видят друзья (или увидят после подключения). */
  preview: DiscordPreview | null
  /**
   * Итог отправки активности: none — ещё не отправляли; sending — ждём ответ Discord;
   * confirmed — Discord подтвердил приём; error — Discord отклонил или не ответил (текст в error).
   */
  activity: 'none' | 'sending' | 'confirmed' | 'error'
  /** Причина: ошибка Discord при отправке или причина, по которой нет связи. */
  error: string | null
  /** Имя профиля Discord, к которому подключились (видно только в окне программы). */
  user: string | null
  /** Когда Discord подтвердил последнюю отправку, мс. */
  confirmedAt: number | null
}

export interface StreamerState {
  active: boolean
  reason: 'manual' | 'program' | 'none'
  program: string | null
  reasonText: string
  settings: StreamerSettings
  discord: DiscordStatusInfo
  platform: NodeJS.Platform
}

function settingsFile(): string {
  return path.join(dataDir(), 'streamer.json')
}

function normalize(raw: unknown): StreamerSettings {
  const r = (raw ?? {}) as Partial<StreamerSettings>
  const cats = { ...DEFAULTS.categories }
  for (const c of CATEGORIES) if (typeof r.categories?.[c] === 'boolean') cats[c] = r.categories[c]
  const touched = r.discordTouched === true
  return {
    mode: r.mode === 'on' || r.mode === 'auto' ? r.mode : 'off',
    categories: cats,
    hideNotifications: r.hideNotifications === true,
    // До первого выбора пользователя — включено и показ, и пинг.
    discordEnabled: touched ? r.discordEnabled === true : DEFAULTS.discordEnabled,
    discordShowPing: touched ? r.discordShowPing === true : DEFAULTS.discordShowPing,
    discordTouched: touched
  }
}

let settings: StreamerSettings = normalize(null)

function loadSettings(): void {
  try {
    const f = settingsFile()
    if (existsSync(f)) settings = normalize(JSON.parse(readFileSync(f, 'utf-8')))
  } catch {
    settings = normalize(null)
  }
}

function saveSettings(): void {
  try {
    mkdirSync(dataDir(), { recursive: true })
    writeFileAtomic(settingsFile(), JSON.stringify(settings, null, 2))
  } catch (e) {
    appLog('warn', `Режим стримера: настройки не сохранены: ${e instanceof Error ? e.message : String(e)}`)
  }
}

// ---- Состояние режима -----------------------------------------------------------------------

let detectedProgram: string | null = null
let watchTimer: NodeJS.Timeout | null = null
let watchBusy = false

function isActive(): boolean {
  return settings.mode === 'on' || (settings.mode === 'auto' && detectedProgram !== null)
}

/** Скрывать ли текст системных уведомлений прямо сейчас. */
export function streamerHidesNotifications(): boolean {
  return isActive() && settings.hideNotifications
}

function broadcast(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload)
  }
}

function currentState(): StreamerState {
  const active = isActive()
  const manual = settings.mode === 'on'
  const reason: StreamerState['reason'] = !active ? 'none' : manual ? 'manual' : 'program'
  return {
    active,
    reason,
    program: manual ? null : detectedProgram,
    reasonText: !active ? '' : manual ? 'включён вручную' : `запущен ${detectedProgram}`,
    settings,
    discord: discordInfo(),
    platform: process.platform
  }
}

function pushState(): void {
  broadcast('streamer:state', currentState())
}

function listWinProcessNames(): Promise<string[]> {
  return new Promise((resolve) => {
    execFile('tasklist.exe', ['/FO', 'CSV', '/NH'], { windowsHide: true, maxBuffer: 8 * 1024 * 1024, timeout: 10_000 }, (err, stdout) => {
      if (err) return resolve([])
      const names: string[] = []
      for (const line of String(stdout).split(/\r?\n/)) {
        const m = /^"([^"]+)"/.exec(line)
        if (m) names.push(m[1].toLowerCase())
      }
      resolve(names)
    })
  })
}

async function watchOnce(): Promise<void> {
  if (watchBusy || settings.mode !== 'auto') return
  watchBusy = true
  try {
    const names = process.platform === 'darwin' ? await listRunningProcessNames() : await listWinProcessNames()
    const program = findStreamProgram(names, process.platform)
    if (settings.mode !== 'auto') return
    if (program !== detectedProgram) {
      detectedProgram = program
      pushState()
    }
  } catch {
    /* список процессов недоступен — оставляем прежнее состояние */
  } finally {
    watchBusy = false
  }
}

function syncWatcher(): void {
  if (settings.mode === 'auto') {
    if (!watchTimer) {
      watchTimer = setInterval(() => void watchOnce(), 15_000)
      void watchOnce()
    }
  } else {
    if (watchTimer) clearInterval(watchTimer)
    watchTimer = null
    detectedProgram = null
  }
}

// ---- Discord -------------------------------------------------------------------------------------

/**
 * Связь с Discord — локальный канал (named pipe на Windows, сокет на macOS), в интернет ничего не уходит.
 * Логика без постоянного опроса — в discord-presence.ts: пока связь есть, таймеров нет, активность
 * отправляется при изменении состояния программы; пока Discord не запущен — повтор раз в 2 минуты.
 */
const rpc = new DiscordRpc()
const startedAtSec = Math.floor(Date.now() / 1000 - process.uptime())
let lastSig = ''

/** Фразы для друзей. Здесь нет ни названий узлов, ни адресов: только состояние служб и число пинга. */
function desiredActivity(): DesiredActivity {
  let zapret = false
  let incy = false
  let tgws = false
  let ping: number | null = null
  try {
    zapret = getZapretStatus().state === 'running'
    tgws = getTgwsStatus().state === 'running'
    const st = getIncyStatus()
    incy = st.state === 'running'
    if (incy && st.activeNodeId && settings.discordShowPing) {
      const v = loadIncyNodes().find((n) => n.id === st.activeNodeId)?.latencyMs
      if (typeof v === 'number' && v > 0) ping = Math.round(v)
    }
  } catch {
    /* состояние служб недоступно — покажем «выключена» */
  }
  const details = incy ? 'VPN подключён' : zapret ? 'Защита включена' : tgws ? 'Прокси для Telegram включён' : 'Защита выключена'
  const others = [zapret && incy ? 'Обход блокировок' : '', tgws && (incy || zapret) ? 'Прокси для Telegram' : ''].filter(Boolean)
  return { details, extra: others.length ? others.join(', ') : undefined, ping, startTimestamp: startedAtSec }
}

const presence = new DiscordPresence({
  rpc,
  desired: desiredActivity,
  now: () => Date.now(),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (t) => clearTimeout(t as NodeJS.Timeout),
  changed: () => pushIfChanged(),
  log: (m) => appLog('warn', m)
})

rpc.onLinkChange = () => presence.linkChanged()

function discordInfo(): DiscordStatusInfo {
  if (!settings.discordEnabled) {
    return { enabled: false, link: 'off', preview: null, activity: 'none', error: null, user: null, confirmedAt: null }
  }
  const p = presence.preview()
  const connected = rpc.link === 'connected'
  return {
    enabled: true,
    link: connected ? 'connected' : 'waiting',
    preview: { details: p.details, state: p.state ?? null },
    activity: connected ? presence.activity : 'none',
    error: connected ? presence.error : rpc.lastError,
    user: connected ? rpc.user : null,
    confirmedAt: connected ? presence.confirmedAt : null
  }
}

function discordSignature(): string {
  const i = discordInfo()
  return `${i.enabled}|${i.link}|${i.activity}|${i.error ?? ''}|${i.confirmedAt ?? ''}|${i.preview?.details ?? ''}|${i.preview?.state ?? ''}`
}

function pushIfChanged(): void {
  const sig = discordSignature()
  if (sig !== lastSig) {
    lastSig = sig
    pushState()
  }
}

/**
 * Состояние программы изменилось (Zapret, VPN, прокси Telegram, пинг узла). Соседние модули могут
 * вызывать это напрямую; пока такого вызова нет, его подают наблюдатели ниже.
 */
export function streamerStatusChanged(): void {
  if (!settings.discordEnabled) return
  presence.statusChanged()
  pushIfChanged()
}

// ---- откуда узнаём об изменениях (без опроса) ----

let statusQueued = false

function queueStatusChanged(): void {
  if (statusQueued) return
  statusQueued = true
  // Одна и та же смена рассылается во все окна — склеиваем в один вызов.
  setImmediate(() => {
    statusQueued = false
    streamerStatusChanged()
  })
}

/**
 * Zapret, INCY и Telegram-прокси сами сообщают о смене состояния (utils/status-bus),
 * пинг узла — при сохранении замеров. Ни опроса, ни слежки за файлами.
 */
function installStatusListener(): void {
  onServiceStatusChanged(queueStatusChanged)
}

function syncDiscord(): void {
  if (settings.discordEnabled) {
    if (!presence.enabled) presence.start()
  } else if (presence.enabled) {
    presence.stop()
    lastSig = ''
  }
}

/** Закрытие программы: убрать активность из Discord и остановить таймеры. */
export function stopStreamerOnQuit(): void {
  if (watchTimer) clearInterval(watchTimer)
  watchTimer = null
  presence.stop()
}

// ---- «Пускать OBS напрямую» -----------------------------------------------------------------------

const OBS_EXE = ['obs64.exe', 'obs32.exe']

/**
 * Добавляет OBS в список приложений INCY, которые идут мимо VPN (режим «bypass_only» из ExitLag),
 * через существующую patchIncySettings. Только Windows.
 */
function obsDirect(): { message: string } {
  if (process.platform !== 'win32') throw new Error('Эта кнопка есть только в версии для Windows')
  const s = loadIncySettings()
  const list = normalizePerAppList(s.perAppProcesses)
  const isObs = (n: string): boolean => OBS_EXE.includes(n.toLowerCase())
  if (s.perAppProxy && s.perAppMode !== 'bypass_only') {
    // Режим ExitLag: через VPN идёт только список, всё остальное и так напрямую. Убираем OBS из списка, если он там.
    if (list.some(isObs)) {
      patchIncySettings({ perAppProcesses: list.filter((n) => !isObs(n)) })
      return { message: 'OBS убран из списка ExitLag и теперь идёт напрямую' }
    }
    return { message: 'Включён режим ExitLag: OBS не в списке, поэтому и так идёт напрямую' }
  }
  if (!s.perAppProxy && (s.connectionMode || 'tun') !== 'tun') {
    throw new Error('Исключения по приложениям работают только в режиме «TUN». Переключите режим подключения на странице INCY')
  }
  const missing = OBS_EXE.filter((n) => !list.some((x) => x.toLowerCase() === n))
  if (s.perAppProxy && missing.length === 0) return { message: 'OBS уже идёт напрямую' }
  patchIncySettings({ perAppProxy: true, perAppMode: 'bypass_only', perAppProcesses: [...list, ...missing] })
  return { message: 'Готово: OBS теперь идёт мимо VPN. Список исключений виден на странице ExitLag' }
}

// ---- IPC -------------------------------------------------------------------------------------------

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

function applyPatch(raw: unknown): StreamerState {
  const p = (raw ?? {}) as Partial<StreamerSettings>
  const next: StreamerSettings = {
    ...settings,
    categories: { ...settings.categories }
  }
  if (p.mode === 'off' || p.mode === 'on' || p.mode === 'auto') next.mode = p.mode
  if (p.categories) for (const c of CATEGORIES) if (typeof p.categories[c] === 'boolean') next.categories[c] = p.categories[c]
  if (typeof p.hideNotifications === 'boolean') next.hideNotifications = p.hideNotifications
  // Любой выбор пользователя по Discord закрепляет оба значения: дальше умолчания их не перезапишут.
  if (typeof p.discordEnabled === 'boolean' || typeof p.discordShowPing === 'boolean') next.discordTouched = true
  if (typeof p.discordEnabled === 'boolean') next.discordEnabled = p.discordEnabled
  if (typeof p.discordShowPing === 'boolean') next.discordShowPing = p.discordShowPing
  settings = next
  saveSettings()
  syncWatcher()
  syncDiscord()
  // Подпись пинга зависит от галочки: изменение уйдёт в Discord по общим правилам (не чаще раза в 15 с).
  if (settings.discordEnabled) presence.statusChanged()
  pushState()
  return currentState()
}

/** Сценарии: режим стримера off / on / auto. */
export function applyStreamerModeFromScenario(mode: StreamerModeSetting): void {
  applyPatch({ mode })
}

/** Сценарии: включить или выключить статус в Discord (это выбор пользователя, значения по умолчанию больше не действуют). */
export function setDiscordFromScenario(on: boolean): void {
  applyPatch({ discordEnabled: on })
}

export function registerStreamerIpc(): void {
  registerStreamDeckIpc()
  loadSettings()
  syncWatcher()
  installStatusListener()
  syncDiscord()

  handle('streamer:getState', () => currentState())
  handle('streamer:setSettings', (patch) => applyPatch(patch))
  handle('streamer:ingestList', () => listIngests())
  handle('streamer:ingestTest', (servers) =>
    runIngestTest(Array.isArray(servers) ? (servers as IngestServer[]) : [], (p) => broadcast('streamer:ingestProgress', p))
  )
  handle('streamer:discordStatus', () => discordInfo())
  handle('streamer:discordRetry', async () => {
    // Кнопка «Проверить снова»: подключиться сейчас и отправить заново.
    await presence.retryNow()
    pushIfChanged()
    return discordInfo()
  })
  handle('streamer:obsDirect', () => obsDirect())
}
