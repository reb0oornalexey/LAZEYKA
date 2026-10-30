/**
 * macOS: запуск и остановка Zapret через службу (см. zapret-mac-service.ts).
 *
 * Приложение пишет в рабочую папку пользователя выбранную стратегию, режим IPset
 * и списки, а затем просит службу применить их: `sudo -n ctl.sh start|stop|status`
 * (без пароля). Стратегии берутся из strategies.tsv установленной (или встроенной)
 * сборки Flowseal, где идентификатор — имя файла без расширения (`general-alt3`);
 * он же служит значением `file` в интерфейсе вместо имени .bat-файла на Windows.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { zapretMacDataRoot } from '../utils/dirs'
import { getAppConfig, patchAppConfig } from '../config'
import { mergeLazeykaIpset } from './zapret-iplist'
import {
  ZAPRET_BASE,
  ZAPRET_CTL,
  ZAPRET_REQUIRED_TEXT,
  ZapretMacServiceRequiredError,
  bundledPayloadDir,
  ensureZapretMacDataRoot,
  installedPayloadVersion,
  isSudoDenied,
  notifyZapretMacService,
  zapretCtl,
  zapretCtlStatus,
  zapretMacServiceState,
  zapretServiceLogTail
} from './zapret-mac-service'

export interface MacStrategyDescriptor {
  file: string
  title: string
  description: string
}

/** Связь с zapret.ts (статус, журнал): передаётся вызывающим, чтобы не плодить циклические импорты. */
export interface ZapretMacHost {
  setStatus(next: Partial<CoreStatus>): void
  log(type: 'info' | 'warn' | 'error', payload: string): void
  /** Добавить в список пользователя домены, которые режет DPI (то же, что делает Windows-запуск). */
  ensureHosts(): void
}

const DEFAULT_STRATEGY = 'general-simple-fake'
const STRATEGY_ID = /^general(-[a-z0-9]+)*$/

// ---- Стратегии ---------------------------------------------------------------------------

/** Каталог с установленной сборкой, а пока службы нет — со встроенной. */
function payloadDirForReading(): string | null {
  if (existsSync(path.join(ZAPRET_BASE, 'strategies.tsv'))) return ZAPRET_BASE
  return bundledPayloadDir()
}

export function listMacStrategies(): MacStrategyDescriptor[] {
  const dir = payloadDirForReading()
  if (!dir) return []
  let text: string
  try {
    text = readFileSync(path.join(dir, 'strategies.tsv'), 'utf-8')
  } catch {
    return []
  }
  const out: MacStrategyDescriptor[] = []
  for (const line of text.split(/\r?\n/)) {
    const [id, ...rest] = line.split('\t')
    const title = rest.join('\t').trim()
    if (!id || !title || !STRATEGY_ID.test(id)) continue
    if (!existsSync(path.join(dir, 'strategies', `${id}.conf.in`))) continue
    out.push({ file: id, title, description: '' })
  }
  return out
}

/**
 * Имя стратегии из конфига → идентификатор Mac. Windows-имя вида `general (ALT3).bat`
 * превращается в `general-alt3`; неизвестное заменяется стратегией по умолчанию.
 */
export function resolveMacStrategy(active: string | undefined, list: MacStrategyDescriptor[]): string {
  const has = (id: string): boolean => list.some((s) => s.file === id)
  const raw = (active ?? '').trim()
  if (has(raw)) return raw
  const m = /^(general)(?:\s*\(([^)]*)\))?\s*\.bat$/i.exec(raw)
  if (m) {
    const id = [m[1], ...(m[2] ? m[2].trim().toLowerCase().split(/\s+/) : [])].join('-').toLowerCase()
    if (has(id)) return id
  }
  if (has(DEFAULT_STRATEGY)) return DEFAULT_STRATEGY
  return list[0]?.file ?? DEFAULT_STRATEGY
}

// ---- Файлы состояния в рабочей папке ----------------------------------------------------------

function writeState(name: 'selected-strategy' | 'ipset-mode', value: string): void {
  ensureZapretMacDataRoot()
  const file = path.join(zapretMacDataRoot(), name)
  writeFileSync(file, `${value}\n`)
}

function readState(name: 'selected-strategy' | 'ipset-mode'): string {
  try {
    return readFileSync(path.join(zapretMacDataRoot(), name), 'utf-8').trim()
  } catch {
    return ''
  }
}

// ---- IPset (режим хранится в файле ipset-mode, список — в lists/ipset-all.txt) -----------------

export type MacIpsetMode = 'none' | 'loaded' | 'any'

export function macGetIpsetMode(): MacIpsetMode {
  const v = readState('ipset-mode')
  return v === 'loaded' || v === 'any' ? v : 'none'
}

export function macIpsetSnapshot(): { mode: MacIpsetMode; lines: number; hasBackup: boolean } {
  let lines = 0
  try {
    const text = readFileSync(path.join(zapretMacDataRoot(), 'lists', 'ipset-all.txt'), 'utf-8')
    lines = text.split(/\r?\n/).filter((l) => l.trim()).length
  } catch {
    /* списка ещё нет */
  }
  return { mode: macGetIpsetMode(), lines, hasBackup: false }
}

export async function macSetIpsetMode(mode: MacIpsetMode): Promise<ReturnType<typeof macIpsetSnapshot>> {
  if (mode !== 'none' && mode !== 'loaded' && mode !== 'any') throw new Error('Неизвестный режим IPset')
  writeState('ipset-mode', mode)
  if (mode === 'loaded') {
    try { mergeLazeykaIpset() } catch { /* не критично */ }
  }
  const cfg = await getAppConfig()
  await patchAppConfig({ zapret: { ...(cfg.zapret as ZapretConfig), ipsetMode: mode } })
  return macIpsetSnapshot()
}

/** После скачивания нового ipset-all.txt: режим «загружен». */
export function macMarkIpsetLoaded(): void {
  writeState('ipset-mode', 'loaded')
}

/**
 * После обновления сборки: свежие списки по умолчанию объединяются с рабочими
 * (строки пользователя и наши добавления остаются, новые строки Flowseal добавляются).
 */
export function mergeMacDefaultLists(): void {
  const defaults = path.join(ZAPRET_BASE, 'default-lists')
  const lists = path.join(zapretMacDataRoot(), 'lists')
  if (!existsSync(defaults) || !existsSync(lists)) return
  for (const name of ['list-general.txt', 'list-google.txt', 'list-exclude.txt', 'ipset-exclude.txt', 'ipset-all.txt']) {
    try {
      const fresh = readFileSync(path.join(defaults, name), 'utf-8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
      const target = path.join(lists, name)
      const have = existsSync(target) ? readFileSync(target, 'utf-8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : []
      const seen = new Set(have.map((l) => l.toLowerCase()))
      const add = fresh.filter((l) => !seen.has(l.toLowerCase()))
      if (add.length > 0 || !existsSync(target)) writeFileSync(target, [...have, ...add].join('\r\n') + '\r\n')
    } catch { /* список не критичен */ }
  }
}

/** После установки/обновления службы: свежие списки Flowseal вливаются в рабочие, версия — в конфиг. */
export async function afterZapretMacInstall(): Promise<void> {
  try { mergeMacDefaultLists() } catch { /* списки не критичны */ }
  const version = installedPayloadVersion()
  const cfg = await getAppConfig()
  if (version && cfg.zapret) {
    await patchAppConfig({ zapret: { ...cfg.zapret, installedVersion: version, dismissedUpdateTag: undefined } })
  }
}

// ---- Состояние службы и запуск ---------------------------------------------------------------------

let weStarted = false
let monitor: NodeJS.Timeout | null = null
let stopping = false

function stopMonitor(): void {
  if (monitor) clearInterval(monitor)
  monitor = null
}

function startMonitor(host: ZapretMacHost): void {
  stopMonitor()
  let failures = 0
  monitor = setInterval(() => {
    if (stopping) return
    void zapretCtlStatus().then((st) => {
      if (stopping || !monitor) return
      if (st === 'running') { failures = 0; return }
      // Служба перезапускается сама (KeepAlive при смене сети): даём ей несколько проверок.
      if (++failures < 3) return
      stopMonitor()
      weStarted = false
      const tail = zapretServiceLogTail()
      host.setStatus({ state: 'error', pid: undefined, lastError: `Служба Zapret остановилась${tail ? `: ${tail}` : ''}` })
      host.log('error', `служба Zapret остановилась (статус ${st})`)
    })
  }, 5000)
  monitor.unref?.()
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Ждём, пока служба поднимет движок и правила pf. */
async function waitRunning(timeoutMs: number): Promise<'running' | 'stopped' | 'timeout'> {
  const deadline = Date.now() + timeoutMs
  let stoppedSeen = 0
  while (Date.now() < deadline) {
    const st = await zapretCtlStatus()
    if (st === 'running') return 'running'
    // «stopped» сразу после kickstart бывает на долю секунды — считаем только повторы.
    if (st === 'stopped' || st === 'unavailable') {
      if (++stoppedSeen >= 4) return 'stopped'
    } else {
      stoppedSeen = 0
    }
    await sleep(500)
  }
  return 'timeout'
}

export function requireZapretMacInstalled(): void {
  const info = zapretMacServiceState()
  if (!info.installed) {
    notifyZapretMacService({ reason: 'required', message: ZAPRET_REQUIRED_TEXT })
    throw new ZapretMacServiceRequiredError()
  }
  if (info.state === 'needs_update') {
    notifyZapretMacService({
      reason: 'update',
      message: 'Служба Zapret устарела: в приложении более новая сборка. Обновите службу (спросят пароль).'
    })
  }
}

/** sudo не пустил — sudoers нет или сломан: просим поставить службу заново. */
function failSudo(host: ZapretMacHost, stderr: string): never {
  host.setStatus({ state: 'stopped', pid: undefined, lastError: undefined })
  host.log('warn', `sudo отказал: ${stderr}`)
  notifyZapretMacService({ reason: 'required', message: ZAPRET_REQUIRED_TEXT })
  throw new ZapretMacServiceRequiredError()
}

export async function startZapretMac(host: ZapretMacHost): Promise<void> {
  stopping = false
  const cfg = await getAppConfig()
  const list = listMacStrategies()
  if (list.length === 0) {
    const msg = 'Сборка Zapret для macOS не найдена'
    host.setStatus({ state: 'error', lastError: msg })
    throw new Error(msg)
  }
  const id = resolveMacStrategy(cfg.zapret?.activeStrategy, list)
  if (cfg.zapret && cfg.zapret.activeStrategy !== id) {
    await patchAppConfig({ zapret: { ...cfg.zapret, activeStrategy: id } })
  }
  try {
    requireZapretMacInstalled()
  } catch (e) {
    host.setStatus({ state: 'stopped', pid: undefined, lastError: undefined })
    throw e
  }

  host.setStatus({ state: 'starting', startedAt: Date.now(), lastError: undefined })
  host.log('info', `запуск Zapret (macOS): стратегия ${id}`)
  try {
    ensureZapretMacDataRoot()
    writeState('selected-strategy', id)
    host.ensureHosts()
  } catch (e) {
    const msg = `Не удалось подготовить рабочую папку Zapret: ${e instanceof Error ? e.message : String(e)}`
    host.setStatus({ state: 'error', lastError: msg })
    throw new Error(msg)
  }

  // `start` на уже работающей службе перезапускает движок (kickstart -k) — отдельный restart не нужен.
  const r = await zapretCtl('start')
  if (!r.ok) {
    if (isSudoDenied(r.stderr)) failSudo(host, r.stderr)
    const tail = zapretServiceLogTail()
    const msg = `Служба Zapret не запустилась${r.stderr ? `: ${r.stderr}` : ''}${tail ? ` (${tail})` : ''}`
    host.setStatus({ state: 'error', lastError: msg })
    host.log('error', msg)
    throw new Error(msg)
  }
  const st = await waitRunning(20_000)
  if (st !== 'running') {
    await zapretCtl('stop', 15_000).catch(() => null)
    const tail = zapretServiceLogTail()
    const msg =
      (st === 'stopped' ? 'Движок Zapret завершился сразу после запуска' : 'Движок Zapret не поднялся за 20 секунд') +
      (tail ? `: ${tail}` : '. Выключите другие VPN с туннелированием и проверьте сеть.')
    host.setStatus({ state: 'error', pid: undefined, lastError: msg })
    host.log('error', msg)
    throw new Error(msg)
  }
  weStarted = true
  host.setStatus({ state: 'running', lastError: undefined })
  host.log('info', 'Zapret работает')
  startMonitor(host)
}

export async function stopZapretMac(host: ZapretMacHost): Promise<void> {
  stopping = true
  stopMonitor()
  // Службы нет — останавливать нечего (и sudo зря не дёргаем, например при выходе из приложения).
  if (!zapretMacServiceState().installed) {
    weStarted = false
    host.setStatus({ state: 'stopped', pid: undefined, lastError: undefined })
    return
  }
  host.setStatus({ state: 'stopping', lastError: undefined })
  const r = await zapretCtl('stop', 20_000)
  if (!r.ok && !isSudoDenied(r.stderr)) host.log('warn', `ctl stop: ${r.stderr || r.code}`)
  weStarted = false
  host.setStatus({ state: 'stopped', pid: undefined, lastError: undefined })
  host.log('info', 'Zapret остановлен')
}

/** При выходе, когда async уже нельзя: остановить службу, если запускали мы. Ошибки глотаем. */
export function stopZapretMacSync(): void {
  if (process.platform !== 'darwin' || !weStarted) return
  try {
    spawnSync('/usr/bin/sudo', ['-n', ZAPRET_CTL, 'stop'], { timeout: 5000, stdio: 'ignore' })
    weStarted = false
  } catch { /* best effort */ }
}

/**
 * Служба могла остаться работать после краша приложения (KeepAlive). На старте
 * подхватываем её как «запущен», чтобы интерфейс не врал и её можно было остановить.
 */
export async function adoptRunningZapretMac(host: ZapretMacHost): Promise<boolean> {
  if (process.platform !== 'darwin' || !zapretMacServiceState().installed) return false
  const st = await zapretCtlStatus()
  if (st !== 'running') return false
  weStarted = true
  host.setStatus({ state: 'running', startedAt: Date.now(), lastError: undefined })
  host.log('info', 'Zapret уже работал (служба осталась от прошлого запуска)')
  startMonitor(host)
  return true
}

// ---- Для проверки стратегий (zapret-tester) ---------------------------------------------------------

/**
 * Применить стратегию без смены статуса приложения и без блокировки: записать выбор и
 * перезапустить движок. true — движок поднялся. Вызывать только изнутри withZapretLock.
 */
export async function macApplyStrategyForTest(id: string): Promise<boolean> {
  const list = listMacStrategies()
  if (!list.some((s) => s.file === id)) return false
  writeState('selected-strategy', id)
  const r = await zapretCtl('start')
  if (!r.ok) {
    if (isSudoDenied(r.stderr)) throw new ZapretMacServiceRequiredError()
    return false
  }
  return (await waitRunning(15_000)) === 'running'
}

export async function macStopForTest(): Promise<void> {
  await zapretCtl('stop', 20_000).catch(() => null)
}
