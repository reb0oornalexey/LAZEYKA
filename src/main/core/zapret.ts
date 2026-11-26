import { spawn, spawnSync, execFile, ChildProcess } from 'child_process'
import { emitServiceStatusChanged } from '../utils/status-bus'
import { existsSync, readdirSync, readFileSync, mkdirSync, rmSync, writeFileSync, statSync, renameSync, cpSync, realpathSync } from 'fs'
import os from 'os'
import path from 'path'
import AdmZip from 'adm-zip'
import { app, BrowserWindow } from 'electron'
import { zapretBundleDir, zapretRuntimeDir } from '../utils/dirs'
import { getAppConfig } from '../config'
import { showSystemNotification } from '../utils/notifications'
import { logToFile } from '../utils/file-logger'
import { getGameFilterVars, getZapretWindowsServiceStatus } from './zapret-service-settings'
import { createConsoleDecoder, decodeConsole } from '../utils/console-decode'
import { mergeLazeykaIpset, addHostsToZapretUserList } from './zapret-iplist'
import { adoptRunningZapretMac, listMacStrategies, startZapretMac, stopZapretMac, type ZapretMacHost } from './zapret-mac'
import { isRunningAsAdmin } from '../utils/elevation'
import {
  ERROR_ACCESS_DENIED,
  ERROR_SERVICE_ALREADY_RUNNING,
  RETRY_DELAYS_MS,
  classifyWinws,
  decideDriverPrep,
  decideVerification,
  finalErrorText,
  hasUsableNetwork,
  isBootReady,
  needsFullReset,
  nextAutoStep,
  scDeleteOutcome,
  stillAlive,
  normalizeWinPath,
  parseScQc,
  parseScQuery,
  parseWinwsProcesses,
  reasonText,
  retryText,
  samePath,
  type ScQuery,
  type ScState,
  type StartFailReason,
  type WinwsProc
} from './zapret-logic'
import { listStrategyFiles, readStrategyDir, validateStrategyName, type StrategyDescriptor } from './zapret-strategy'
import { ensureCustomMaterialized } from './zapret-custom'
import { applyLinuxZapretStrategy, linuxZapretSystemState, listLinuxStrategies, resolveLinuxStrategy, stopLinuxZapret } from './zapret-linux'

export type { StrategyDescriptor }

let child: ChildProcess | null = null
let status: CoreStatus = { state: 'stopped' }

function broadcast(channel: string, ...args: unknown[]): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, ...args)
  }
}

function log(type: ControllerLog['type'], payload: string): void {
  const entry: ControllerLog = {
    time: Date.now(),
    type,
    source: 'zapret',
    payload
  }
  // Mirrored to disk: core stdout is exactly what post-mortem debugging needs,
  // and the renderer's ring buffer keeps only the last 500 lines of a session.
  logToFile(entry)
  broadcast('log', entry)
}

function setStatus(next: Partial<CoreStatus>): void {
  const prev = status.state
  status = { ...status, ...next }
  broadcast('zapret:status', status)
  emitServiceStatusChanged()

  if (prev !== 'running' && status.state === 'running') {
    showSystemNotification('Zapret запущен', 'Обход блокировок YouTube и Discord активен', undefined, 'actions')
  } else if (prev !== 'error' && status.state === 'error' && status.lastError) {
    showSystemNotification('Ошибка Zapret', status.lastError, undefined, 'errors')
  }
}

export function getZapretStatus(): CoreStatus {
  return status
}

/**
 * Стратегии из zapretBundleDir(): `general*.bat`, подпись — первый осмысленный
 * комментарий в файле (строка «:: 65001 - UTF-8» пропускается) или короткая
 * подпись по названию; порядок естественный (ALT2 перед ALT10).
 */
export function listStrategies(): StrategyDescriptor[] {
  if (process.platform === 'linux') return listLinuxStrategies()
  // macOS: стратегии из сборки Flowseal для Mac (file — идентификатор вида general-alt3).
  if (process.platform === 'darwin') return listMacStrategies()
  const dir = zapretBundleDir()
  if (!existsSync(dir)) return []
  // Свои стратегии из конструктора: пропавший после обновления сборки .bat пишется заново.
  ensureCustomMaterialized()
  return readStrategyDir(dir)
}

export async function installZapretBundle(
  zipBytes: Uint8Array
): Promise<{ strategies: number; installedVersion?: string }> {
  if (process.platform === 'linux') throw new Error('Zapret обновляется вместе с пакетом LAZEYKA для Linux.')
  if (!zipBytes || zipBytes.length === 0) {
    throw new Error('Пустой архив')
  }

  // Stop a running winws.exe before touching the bundle directory; locked
  // files on Windows would otherwise make rmSync fail with EBUSY.
  const wasRunning = status.state === 'running' || status.state === 'starting'
  if (wasRunning) {
    try { await stopZapret() } catch { /* best-effort */ }
  }

  if (process.platform === 'win32') {
    for (const name of WINDIVERT_SERVICE_NAMES) {
      try { spawnSync('sc.exe', ['stop', name], { windowsHide: true, timeout: 3000 }) } catch { /* noop */ }
      try { spawnSync('sc.exe', ['delete', name], { windowsHide: true, timeout: 3000 }) } catch { /* noop */ }
    }
    detectedWinDivertSvc = null
    // Give the SCM a beat to actually release the .sys file handle.
    await new Promise((r) => setTimeout(r, 400))
  }

  let zip: AdmZip
  try {
    zip = new AdmZip(Buffer.from(zipBytes))
  } catch (e) {
    throw new Error(`Не удалось прочитать архив: ${e instanceof Error ? e.message : String(e)}`)
  }

  const entries = zip.getEntries()
  const normalize = (n: string): string => n.replace(/\\/g, '/')

  const generalEntry = entries.find(
    (e) => !e.isDirectory && /(^|\/)general\.bat$/i.test(normalize(e.entryName))
  )
  if (!generalEntry) {
    throw new Error('Архив не содержит general.bat — это не сборка Zapret')
  }

  const generalPath = normalize(generalEntry.entryName)
  const rootPrefix = generalPath.includes('/')
    ? generalPath.slice(0, generalPath.lastIndexOf('/') + 1)
    : ''

  const expectedBin = `${rootPrefix}bin/winws.exe`
  const hasBin = entries.some(
    (e) => !e.isDirectory && normalize(e.entryName).toLowerCase() === expectedBin.toLowerCase()
  )
  if (!hasBin) {
    throw new Error('Архив повреждён или неполный: не найден bin/winws.exe')
  }

  const dest = zapretRuntimeDir()

  // Раньше папка удалялась целиком ДО распаковки, а пользовательские списки
  // возвращались только после неё. Если антивирус не давал записать
  // winws.exe или WinDivert64.sys (у zapret это частая история), списки
  // пропадали навсегда. Теперь всё собирается во временной папке рядом и
  // подменяет рабочую только когда полностью готово.
  //
  // Что переносится из старой версии:
  //  - все lists/*-user.txt, *.backup и нестандартные списки;
  //  - ваши добавления в стандартные списки (слияние построчно);
  //  - utils/*.enabled (игровой фильтр, проверка обновлений и т. п.);
  //  - стратегии из конструктора «general (…).bat», которых нет в новой версии;
  //  - режим IPset (none/any): иначе обновление молча включало полный список.
  const currentBundleDir = zapretBundleDir()
  const currentListsDir = path.join(currentBundleDir, 'lists')
  const cachedExistingLists = new Map<string, Buffer>()

  if (existsSync(currentListsDir)) {
    for (const name of readdirSync(currentListsDir)) {
      try {
        const full = path.join(currentListsDir, name)
        if (statSync(full).isFile()) {
          cachedExistingLists.set(name, readFileSync(full))
        }
      } catch { /* best-effort */ }
    }
  }

  const staging = `${dest}.new`
  rmSync(staging, { recursive: true, force: true })
  mkdirSync(staging, { recursive: true })

  let written = 0
  try {
    for (const e of entries) {
      if (e.isDirectory) continue
      const name = normalize(e.entryName)
      if (rootPrefix && !name.startsWith(rootPrefix)) continue
      const rel = name.slice(rootPrefix.length)
      if (!rel) continue
      // Defensive: refuse path-traversal entries.
      if (rel.includes('..')) continue
      const out = path.join(staging, rel)
      mkdirSync(path.dirname(out), { recursive: true })
      writeFileSync(out, e.getData())
      written++
    }

    const listsDir = path.join(staging, 'lists')
    mkdirSync(listsDir, { recursive: true })

    // 1. Restore all user-owned files (*-user.txt), all backups (*.backup), and custom user files
    for (const [name, data] of cachedExistingLists) {
      const isStandardUpstream = /^(list-general|list-google|list-exclude|ipset-all|ipset-exclude)\.txt$/i.test(name)
      const isUserOrBackup = /-user\.txt(\.backup)?$/i.test(name) || /\.backup$/i.test(name) || !isStandardUpstream

      if (isUserOrBackup) {
        writeFileSync(path.join(listsDir, name), data)
      }
    }

    // 1b. Режим IPset «none»/«any»: старый ipset-all.txt был заглушкой.
    // Оставляем заглушку, а свежий полный список кладём в .backup — тогда
    // «Загрузить список» вернёт уже новую версию.
    const oldIpset = cachedExistingLists.get('ipset-all.txt')
    if (oldIpset) {
      const oldLines = oldIpset
        .toString('utf-8')
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)
      const wasPlaceholder = oldLines.length === 0 || oldLines.every((l) => l === '203.0.113.113/32')
      const freshIpset = path.join(listsDir, 'ipset-all.txt')
      if (wasPlaceholder && existsSync(freshIpset)) {
        writeFileSync(`${freshIpset}.backup`, readFileSync(freshIpset))
        writeFileSync(freshIpset, oldIpset)
      }
    }

    // 2. Intelligently merge user additions from standard upstream lists (list-general, list-google, list-exclude)
    for (const listName of ['list-general.txt', 'list-google.txt', 'list-exclude.txt']) {
      const prevBuf = cachedExistingLists.get(listName)
      if (!prevBuf) continue

      const destFile = path.join(listsDir, listName)
      if (!existsSync(destFile)) {
        writeFileSync(destFile, prevBuf)
        continue
      }

      try {
        const existingLines = prevBuf
          .toString('utf-8')
          .split(/\r?\n/)
          .map((s) => s.replace(/^\uFEFF/, '').trim())
          .filter((s) => s.length > 0 && !s.startsWith('#') && !s.startsWith(';'))

        if (!existingLines.length) continue

        const freshLines = readFileSync(destFile, 'utf-8')
          .split(/\r?\n/)
          .map((s) => s.replace(/^\uFEFF/, '').trim())
          .filter(Boolean)

        const seenLower = new Set(freshLines.map((s) => s.toLowerCase()))
        const merged = [...freshLines]
        let addedCustom = 0

        for (const line of existingLines) {
          const lower = line.toLowerCase()
          if (!seenLower.has(lower)) {
            seenLower.add(lower)
            merged.push(line)
            addedCustom++
          }
        }

        if (addedCustom > 0) {
          writeFileSync(destFile, merged.join('\r\n') + '\r\n', 'utf-8')
          log('info', `merged ${addedCustom} custom entry(ies) into updated ${listName}`)
        }
      } catch (e) {
        log('warn', `failed to merge list ${listName}: ${e}`)
      }
    }

    // 3. Флаги utils/*.enabled и стратегии из конструктора.
    try {
      const oldUtils = path.join(currentBundleDir, 'utils')
      if (existsSync(oldUtils)) {
        for (const f of readdirSync(oldUtils)) {
          if (!/\.enabled$/i.test(f)) continue
          mkdirSync(path.join(staging, 'utils'), { recursive: true })
          writeFileSync(path.join(staging, 'utils', f), readFileSync(path.join(oldUtils, f)))
        }
      }
      if (existsSync(currentBundleDir)) {
        for (const f of readdirSync(currentBundleDir)) {
          if (!/^general \(.+\)\.bat$/i.test(f)) continue
          const target = path.join(staging, f)
          if (!existsSync(target)) writeFileSync(target, readFileSync(path.join(currentBundleDir, f)))
        }
      }
    } catch (e) {
      log('warn', `failed to carry over utils/custom strategies: ${e}`)
    }

    const startWrapperRe = /start\s+"zapret:\s*%~n0"\s+\/min\s+/gi
    for (const f of readdirSync(staging)) {
      if (!/^general.*\.bat$/i.test(f)) continue
      const full = path.join(staging, f)
      try {
        const before = readFileSync(full, 'utf-8')
        const after = before.replace(startWrapperRe, '')
        if (after !== before) writeFileSync(full, after, 'utf-8')
      } catch { /* best-effort patch — bad encoding etc. */ }
    }

    const serviceBat = path.join(staging, 'service.bat')
    if (existsSync(serviceBat)) {
      try {
        let content = readFileSync(serviceBat, 'utf-8')
        content = content.replace(/(?<!if not defined NO_UPDATE_CHECK\s+)pause\b/gi, 'if not defined NO_UPDATE_CHECK pause')
        writeFileSync(serviceBat, content, 'utf-8')
      } catch { /* best-effort patch */ }
    }

    // Validate winws.exe can execute
    if (!existsSync(path.join(staging, 'bin', 'winws.exe'))) {
      throw new Error('Установка не удалась: файл bin/winws.exe не найден в распакованном бандле')
    }
  } catch (e) {
    rmSync(staging, { recursive: true, force: true })
    throw e
  }

  // Подмена: старая папка → .old, новая → на её место. Если старую не
  // сдвинуть (файл занят), копируем новую поверх неё.
  const old = `${dest}.old`
  rmSync(old, { recursive: true, force: true })
  if (existsSync(dest)) {
    try {
      renameSync(dest, old)
    } catch { /* занято — ниже копирование поверх */ }
  }
  if (!existsSync(dest)) {
    renameSync(staging, dest)
  } else {
    cpSync(staging, dest, { recursive: true, force: true })
    rmSync(staging, { recursive: true, force: true })
  }
  rmSync(old, { recursive: true, force: true })
  // Новый ipset-all.txt из бандла — возвращаем в него наши добавления.
  try { mergeLazeykaIpset() } catch { /* не критично */ }

  // Try to infer the upstream release version from the archive's top-level
  // folder, e.g. "zapret-discord-youtube-1.7.7/" → "1.7.7". Falls back to
  // undefined for archives unpacked at the zip root or with custom prefix.
  let installedVersion: string | undefined
  if (rootPrefix) {
    const m = rootPrefix.match(/zapret-discord-youtube-(.+?)\/?$/i)
    if (m) installedVersion = m[1]
  }

  const list = listStrategies()
  log(
    'info',
    `Zapret bundle installed: ${written} files, ${list.length} strategies` +
      (installedVersion ? `, version ${installedVersion}` : '')
  )
  // Работавший до обновления Zapret запускаем снова — раньше он оставался
  // выключенным, хотя уведомление говорило «Zapret обновлён».
  if (wasRunning) {
    const active = (await getAppConfig()).zapret?.activeStrategy
    if (active && list.some((s) => s.file === active)) {
      startZapret().catch((e) => log('warn', `restart after update failed: ${e}`))
    }
  }
  return { strategies: list.length, installedVersion }
}

// Serialise start/stop/restart so concurrent IPC invocations cannot race.
let opLock: Promise<void> = Promise.resolve()
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = opLock.then(fn, fn)
  opLock = next.then(() => undefined, () => undefined)
  return next
}

export function withZapretLock<T>(fn: () => Promise<T>): Promise<T> {
  return withLock(fn)
}

/** macOS: что нужно zapret-mac.ts от этого модуля (статус, журнал, домены DPI). */
const macHost: ZapretMacHost = {
  setStatus,
  log,
  ensureHosts: () => ensureLazeykaHosts(zapretBundleDir())
}

async function syncLinuxZapretState(): Promise<boolean> {
  const live = await linuxZapretSystemState().catch(() => null)
  if (live?.state === 'active') {
    if (status.state !== 'running' || status.pid !== live.pid) {
      setStatus({ state: 'running', pid: live.pid, startedAt: Date.now(), lastError: undefined, phase: undefined, detail: undefined })
    }
    return true
  }
  if (live?.state === 'failed' && status.state === 'running') {
    setStatus({ state: 'error', pid: undefined, lastError: 'Служба Zapret прервана. Подробности в системном журнале.' })
  } else if (live?.state === 'inactive' && status.state === 'running') {
    setStatus({ state: 'stopped', pid: undefined, startedAt: undefined })
  }
  return false
}

async function changeLinuxZapret(running: boolean): Promise<void> {
  setStatus({ state: running ? 'starting' : 'stopping', lastError: undefined,
    detail: 'Ожидаю службу Zapret. При необходимости подтвердите действие в диалоге Linux.' })
  try {
    if (running) {
      const cfg = await getAppConfig()
      await applyLinuxZapretStrategy(resolveLinuxStrategy(cfg.zapret?.activeStrategy))
      await syncLinuxZapretState()
    } else {
      await stopLinuxZapret()
      setStatus({ state: 'stopped', pid: undefined, startedAt: undefined, detail: undefined })
    }
    log('info', running ? 'Служба Zapret запущена' : 'Служба Zapret остановлена')
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e)
    if (!(await syncLinuxZapretState())) setStatus({ state: 'error', pid: undefined, lastError: reason, detail: undefined })
    log('error', reason)
    throw e
  }
}

export function startZapret(): Promise<void> {
  if (process.platform === 'linux') return withLock(() => changeLinuxZapret(true))
  // macOS: движок utunws в root-службе, управление — zapret-mac.ts.
  if (process.platform === 'darwin') return withLock(() => startZapretMac(macHost))
  // Пользователь включает сам — ожидание и повторы автозапуска больше не нужны.
  startEpoch++
  return withLock(() => startZapretImpl())
}
/** macOS: подхватить службу Zapret, оставшуюся работать от прошлого запуска. */
export function adoptRunningZapret(): Promise<boolean> {
  if (process.platform === 'linux') {
    const poll = setInterval(() => {
      if (status.state !== 'starting' && status.state !== 'stopping') void syncLinuxZapretState()
    }, 4000)
    poll.unref()
    return syncLinuxZapretState()
  }
  return adoptRunningZapretMac(macHost)
}
export function stopZapret(): Promise<void> {
  if (process.platform === 'linux') return withLock(() => changeLinuxZapret(false))
  if (process.platform === 'darwin') return withLock(() => stopZapretMac(macHost))
  // Прерываем идущий запуск/самопроверку, не дожидаясь очереди: иначе «Выключить» ждало бы до 45 с.
  startEpoch++
  abortStart = true
  return withLock(() => stopZapretImpl())
}

/**
 * Kill ALL winws.exe by image name — включая чужие копии. Нужен, когда список процессов
 * получить не удалось; в обычном ходе используется killOwnWinws().
 */
export function killWinws(): Promise<void> {
  if (process.platform !== 'win32') return Promise.resolve()
  return runCmd('taskkill.exe', ['/F', '/IM', 'winws.exe'], 8_000).then(() => undefined)
}

/**
 * WinDivert service candidate names. Different zapret forks register
 * the driver under slightly different identifiers; we try them in order.
 * The first match is remembered in `detectedWinDivertSvc` to save on
 * repeated `sc query` calls during status checks.
 */
// Имена служб в Windows не различают регистр, поэтому 'windivert' отдельно не нужен.
const WINDIVERT_SERVICE_NAMES = ['WinDivert', 'WinDivert14', 'WinDivert64'] as const
let detectedWinDivertSvc: string | null = null

interface ScQueryResult {
  exists: boolean
  state: 'running' | 'stopped' | 'start_pending' | 'stop_pending' | 'unknown'
  binaryPath: string | null
}

/** Run `sc query` + `sc qc` for a single service name (синхронно, для проверки перед тестом стратегий). */
function scQueryOne(name: string): ScQueryResult {
  const q = spawnSync('sc.exe', ['query', name], { windowsHide: true, timeout: 3000 })
  const qOut = q.stdout ? decodeConsole(q.stdout) : ''
  // Разбор по структуре строк (русская Windows: заголовки переведены, код и имя состояния — нет).
  const parsed = parseScQuery(qOut, q.status)
  if (!parsed.found) return { exists: false, state: 'unknown', binaryPath: null }
  // sc.exe пишет в кодировке консоли (CP866), а не UTF-8: decodeConsole это учитывает —
  // путь C:\Users\Алексей\... иначе приходил испорченным и служба удалялась при каждом запуске.
  const qc = spawnSync('sc.exe', ['qc', name], { windowsHide: true, timeout: 3000 })
  const qcOut = qc.stdout ? decodeConsole(qc.stdout) : ''
  return {
    exists: true,
    state: parsed.state === 'running' || parsed.state === 'stopped' || parsed.state === 'start_pending' || parsed.state === 'stop_pending'
      ? parsed.state
      : 'unknown',
    binaryPath: parseScQc(qcOut).binaryPath
  }
}

/** Find a registered WinDivert service (if any) and cache the winning name. */
function findWinDivertService(): { name: string; info: ScQueryResult } | null {
  const ordered = detectedWinDivertSvc
    ? [detectedWinDivertSvc, ...WINDIVERT_SERVICE_NAMES.filter((n) => n !== detectedWinDivertSvc)]
    : [...WINDIVERT_SERVICE_NAMES]
  for (const name of ordered) {
    const info = scQueryOne(name)
    if (info.exists) {
      detectedWinDivertSvc = name
      return { name, info }
    }
  }
  return null
}

/**
 * Pre-flight for Zapret: make sure WinDivert is loaded and ready BEFORE we
 * spawn winws.exe. Two failure modes we actively guard against:
 *
 *  1. Service registered but pointing at a stale path (user reinstalled
 *     LAZEYKA to a different folder, or the resources/ layout changed).
 *     Detected by comparing `BINARY_PATH_NAME` to the current .sys location.
 *     Fix: `sc delete` so winws.exe re-registers on demand.
 *
 *  2. Service registered but stopped (previous LAZEYKA quit ran `sc stop`).
 *     Fix: `sc start` it ourselves — this is synchronous from our process,
 *     so we avoid the SCM-is-busy race that used to hit winws.exe at boot.
 *
 * Returns silently on success; throws with a user-facing message on hard
 * failure so the caller can surface it through the Zapret status card.
 */
export function ensureWinDivertReady(): void {
  const bundle = zapretBundleDir()
  // Possible .sys locations across forks — pick whichever one actually
  // exists on disk so `sc create` (if needed) points at a real file.
  const sysCandidates = [
    path.join(bundle, 'bin', 'WinDivert64.sys'),
    path.join(bundle, 'bin', 'WinDivert.sys'),
    path.join(bundle, 'WinDivert64.sys'),
    path.join(bundle, 'WinDivert.sys')
  ]
  const expectedSys = sysCandidates.find((p) => existsSync(p))

  const svc = findWinDivertService()
  if (!svc) {
    log('info', 'WinDivert service not registered — winws.exe will register it')
    return
  }

  // Stale-path detection: the service points at a .sys that no longer
  // exists (old install folder was wiped). Wipe the registration so
  // winws.exe can re-create it at the current path.
  if (expectedSys && svc.info.binaryPath) {
    const registered = svc.info.binaryPath.replace(/^\\\?\?\\/, '').toLowerCase()
    const expected = expectedSys.toLowerCase()
    if (!existsSync(svc.info.binaryPath.replace(/^\\\?\?\\/, '')) || registered !== expected) {
      // Драйвером может пользоваться живой winws.exe другой копии LAZEYKA (dev и установленная версия
      // делят имя службы) — тогда её регистрацию не трогаем.
      const live = spawnSync('tasklist.exe', ['/FI', 'IMAGENAME eq winws.exe', '/NH'], { windowsHide: true, timeout: 4000 })
      if (/winws\.exe/i.test(live.stdout ? decodeConsole(live.stdout) : '')) {
        log('warn', `WinDivert service points at ${svc.info.binaryPath}, но winws.exe уже работает — службу не трогаю`)
        return
      }
      log('warn', `WinDivert service points at stale path: ${svc.info.binaryPath}; re-registering`)
      spawnSync('sc.exe', ['stop', svc.name], { windowsHide: true, timeout: 2000 })
      spawnSync('sc.exe', ['delete', svc.name], { windowsHide: true, timeout: 2000 })
      detectedWinDivertSvc = null
      return
    }
  }

  // Service exists and path looks right. Start it synchronously so the
  // driver is live BEFORE winws.exe tries to use it.
  if (svc.info.state !== 'running') {
    log('info', `starting WinDivert service (${svc.name}, was ${svc.info.state})`)
    const r = spawnSync('sc.exe', ['start', svc.name], { windowsHide: true, timeout: 5000, encoding: 'utf8' })
    if (r.status !== 0) {
      // 1056 = service already running — benign race; anything else is a
      // hard failure worth surfacing.
      const alreadyRunning = /1056/.test(r.stdout ?? '') || /1056/.test(r.stderr ?? '')
      if (!alreadyRunning) {
        log('error', `sc start ${svc.name} failed: ${(r.stdout || r.stderr || '').trim()}`)
      }
    }
  }
}

/** Returns true if at least one winws.exe is running. */
export function isWinwsRunning(): Promise<boolean> {
  if (process.platform === 'darwin') return Promise.resolve(false)
  return runCmd('tasklist.exe', ['/FI', 'IMAGENAME eq winws.exe', '/NH'], 6_000).then((r) => /winws\.exe/i.test(r.stdout))
}

/**
 * Для проверок (автоподбор, проверка из конструктора): убрать свои остатки winws.exe и
 * убедиться, что чужого нет. Установленная версия и dev делят драйвер WinDivert —
 * чужой winws.exe не трогаем, а проверку не начинаем.
 * Возвращает текст причины, если проверять нельзя.
 */
export async function clearOwnWinwsForProbe(): Promise<string | null> {
  if (process.platform !== 'win32') return null
  if (isZapretServiceRunningSync()) {
    return 'Zapret работает как служба Windows — проверка остановила бы её. Удалите службу на вкладке «Настройки» или проверяйте позже'
  }
  if (!(await isWinwsRunning())) return null
  const k = await killOwnWinws()
  if (k.foreign.length > 0) {
    const f = k.foreign[0]
    log('warn', `проверка стратегии: работает winws.exe из другой папки (pid ${f.pid}, ${f.path ?? 'путь неизвестен'}) — не трогаю`)
    return `Уже работает другой winws.exe (${f.path ?? `pid ${f.pid}`}) — закройте другую копию LAZEYKA или Zapret и повторите`
  }
  if (k.unknown.length > 0) {
    const alive = stillAlive(k.unknown, await listWinwsProcesses())
    if (alive.length > 0) return `Уже работает другой winws.exe (pid ${alive.map((p) => p.pid).join(', ')}) — закройте его и повторите`
  }
  return null
}

/** Завершить свои winws.exe (чужие не трогает). Для проверок. */
export async function killOwnWinwsForProbe(): Promise<void> {
  if (process.platform !== 'win32') return
  await killOwnWinws().catch(() => void 0)
}

// ---- Системные вызовы Windows: execFile, windowsHide, таймаут на каждую команду ----

interface RunResult {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  spawnFailed: boolean
}

function runCmd(file: string, args: string[], timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve) => {
    try {
      execFile(
        file,
        args,
        { windowsHide: true, timeout: timeoutMs, encoding: 'buffer', maxBuffer: 4 * 1024 * 1024 },
        (err, stdout, stderr) => {
          const e = err as (NodeJS.ErrnoException & { killed?: boolean }) | null
          resolve({
            code: !e ? 0 : typeof e.code === 'number' ? e.code : null,
            stdout: stdout ? decodeConsole(stdout) : '',
            stderr: stderr ? decodeConsole(stderr) : '',
            timedOut: Boolean(e?.killed),
            spawnFailed: Boolean(e && typeof e.code === 'string')
          })
        }
      )
    } catch {
      resolve({ code: null, stdout: '', stderr: '', timedOut: false, spawnFailed: true })
    }
  })
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Пауза, которую можно прервать: false — прервано (отмена пользователем). Без частых опросов: шаг 500 мс. */
async function sleepUnless(ms: number, cancelled: () => boolean): Promise<boolean> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (cancelled()) return false
    await sleep(Math.min(500, end - Date.now()))
  }
  return !cancelled()
}

/** Идёт попытка запуска: выход cmd/winws разбирает она сама. */
let attemptActive = false
/** Пользователь нажал «Выключить» — идущая попытка запуска должна остановиться. */
let abortStart = false
/** Меняется при любом ручном включении/выключении: автозапуск понимает, что его отменили. */
let startEpoch = 0

const SIGNAL_GRACE_MS = 8_000
const STABLE_MS = 2_500
const LAUNCH_TIMEOUT_MANUAL_MS = 20_000
// При загрузке сценарий (netsh/sc внутри service.bat) бывает медленным — ждём winws заметно дольше.
const LAUNCH_TIMEOUT_AUTO_MS = 45_000
const BOOT_WAIT_MAX_MS = 60_000

async function scQueryAsync(name: string): Promise<ScQuery> {
  const r = await runCmd('sc.exe', ['query', name], 5_000)
  if (r.spawnFailed || r.timedOut) return { found: false, state: 'unknown', code: null }
  return parseScQuery(r.stdout, r.code)
}

interface DriverSvc {
  name: string
  query: ScQuery
  binaryPath: string | null
}

/** Служба драйвера WinDivert (под любым из известных имён) с её путём из `sc qc`. */
async function readDriverService(): Promise<DriverSvc | null> {
  const ordered = detectedWinDivertSvc
    ? [detectedWinDivertSvc, ...WINDIVERT_SERVICE_NAMES.filter((n) => n !== detectedWinDivertSvc)]
    : [...WINDIVERT_SERVICE_NAMES]
  for (const name of ordered) {
    const query = await scQueryAsync(name)
    if (!query.found) continue
    detectedWinDivertSvc = name
    const qc = await runCmd('sc.exe', ['qc', name], 5_000)
    return { name, query, binaryPath: qc.timedOut ? null : parseScQc(qc.stdout).binaryPath }
  }
  detectedWinDivertSvc = null
  return null
}

function findExpectedSys(): string | null {
  const bundle = zapretBundleDir()
  return (
    [
      path.join(bundle, 'bin', 'WinDivert64.sys'),
      path.join(bundle, 'bin', 'WinDivert.sys'),
      path.join(bundle, 'WinDivert64.sys'),
      path.join(bundle, 'WinDivert.sys')
    ].find((p) => existsSync(p)) ?? null
  )
}

function canonPath(p: string): string {
  const n = normalizeWinPath(p)
  try {
    return realpathSync.native(n)
  } catch {
    return n
  }
}

/** Пути совпадают: текстуально либо после раскрытия коротких имён (C:\USERS\ALEKSE~1). */
function pathsMatch(a: string, b: string): boolean {
  return samePath(a, b) || samePath(canonPath(a), canonPath(b))
}

/** Удаляет службу WinDivert: стоп, удаление, ожидание исчезновения (до ~7 с). true — службы больше нет. */
async function removeDriverService(name: string): Promise<boolean> {
  const st = await runCmd('sc.exe', ['stop', name], 8_000)
  // Код 5 — нет прав: ждать остановки бессмысленно, удаление ответит так же.
  if (st.code !== ERROR_ACCESS_DENIED) {
    for (let i = 0; i < 12; i++) {
      const q = await scQueryAsync(name)
      if (!q.found || q.state === 'stopped') break
      await sleep(250)
    }
  }
  const d = await runCmd('sc.exe', ['delete', name], 8_000)
  const outcome = scDeleteOutcome(d.code, d.timedOut)
  if (outcome.level === 'warn') log('warn', `WinDivert (${name}): ${outcome.text}`)
  detectedWinDivertSvc = null
  // Без прав служба точно осталась — не ждём её исчезновения 4 с.
  if (d.code === ERROR_ACCESS_DENIED) return false
  for (let i = 0; i < 16; i++) {
    const q = await scQueryAsync(name)
    if (!q.found) return true
    await sleep(250)
  }
  return false
}

// Path у Get-Process пуст для процессов с повышением, если LAZEYKA сама без прав администратора;
// тогда пробуем Win32_Process.ExecutablePath (может тоже быть пустым — это нормально, см. classifyWinws).
// В команде нет двойных кавычек: Node экранирует их при передаче аргументов, а PowerShell понимает по-своему.
const PS_LIST_WINWS =
  '[Console]::OutputEncoding=[Text.Encoding]::UTF8; ' +
  '$p=@(Get-Process -Name winws -ErrorAction SilentlyContinue | ForEach-Object { ' +
  '$id=$_.Id; $path=$_.Path; ' +
  "if (-not $path) { try { $path=(Get-CimInstance Win32_Process -Filter ('ProcessId=' + $id) -ErrorAction Stop).ExecutablePath } catch { $path=$null } }; " +
  '[pscustomobject]@{ ProcessId=$id; ExecutablePath=$path } }); ' +
  'ConvertTo-Json -InputObject $p -Compress'

/** Живые winws.exe с путями к файлам (путь может быть null); null — получить список не удалось. */
async function listWinwsProcesses(): Promise<WinwsProc[] | null> {
  const r = await runCmd('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', PS_LIST_WINWS], 12_000)
  if (r.spawnFailed || r.timedOut || r.code !== 0) return null
  return parseWinwsProcesses(r.stdout)
}

function ownWinwsExe(): string {
  return path.join(zapretBundleDir(), 'bin', 'winws.exe')
}

/**
 * Завершает winws.exe, которые принадлежат этой копии LAZEYKA (и остатки удалённых установок).
 * winws.exe из другой существующей папки (dev-сборка рядом с установленной, отдельный Zapret) не трогаем.
 * Процессы с неизвестным путём тоже не трогаем: это может быть чужая копия с повышенными правами.
 * Если список процессов получить нельзя — старое поведение: по имени образа.
 */
async function killOwnWinws(): Promise<{ foreign: WinwsProc[]; unknown: WinwsProc[] }> {
  const procs = await listWinwsProcesses()
  if (!procs) {
    await killWinws()
    return { foreign: [], unknown: [] }
  }
  const { own, foreign, unknown } = classifyWinws(procs, ownWinwsExe(), existsSync)
  for (const p of own) await runCmd('taskkill.exe', ['/F', '/T', '/PID', String(p.pid)], 8_000)
  return { foreign, unknown }
}

/** Ждёт службу BFE (фильтрация трафика, нужна WinDivert) и сетевой интерфейс с адресом: до maxMs, шаг 1 с. */
async function waitForBootReady(
  maxMs: number,
  cancelled: () => boolean
): Promise<{ ready: boolean; waitedMs: number; bfe: ScState; net: boolean }> {
  const t0 = Date.now()
  for (;;) {
    const bfe = (await scQueryAsync('BFE')).state
    const net = hasUsableNetwork(os.networkInterfaces())
    const waitedMs = Date.now() - t0
    if (isBootReady(bfe, net)) return { ready: true, waitedMs, bfe, net }
    if (waitedMs >= maxMs || cancelled()) return { ready: false, waitedMs, bfe, net }
    await sleep(1_000)
  }
}

let stopRequested = false

/**
 * Health signals derived from winws.exe's own stdout. winws is the
 * authoritative source of truth on whether WinDivert actually loaded —
 * `sc query` is unreliable (modern WinDivert versions register the service
 * under version-suffixed names, or use unique per-session names). We trust
 * winws's logs instead.
 */
let winwsHealth: 'unknown' | 'capturing' | 'failed' = 'unknown'
let winwsLastError: string | null = null

/** Чтение через функцию: TypeScript иначе «запоминает» значение внутри долгих async-циклов. */
function health(): 'unknown' | 'capturing' | 'failed' {
  return winwsHealth
}

function resetWinwsHealth(): void {
  winwsHealth = 'unknown'
  winwsLastError = null
}

function ingestWinwsLine(raw: string): void {
  // "windivert initialized. capture is started." — definitive success.
  // Variants from older Flowseal builds: "WinDivert: ok", "loaded".
  if (/windivert\s+initialized|capture\s+is\s+started|windivert.*\bok\b/i.test(raw)) {
    winwsHealth = 'capturing'
    return
  }
  // Hard failures we want to surface to the user instead of leaving
  // the UI sitting on "starting" until the 7-second timeout expires.
  if (
    /windivert.*failed|windivertopen.*failed|driver.*not.*loaded|access\s+is\s+denied|requires.*admin/i.test(raw)
  ) {
    winwsHealth = 'failed'
    winwsLastError = raw.trim()
  }
}

/**
 * Служба Windows «zapret» запущена? Тогда её winws.exe и драйвер WinDivert
 * трогать нельзя: служба обещает обход и при закрытой программе.
 */
export function isZapretServiceRunningSync(): boolean {
  if (process.platform !== 'win32') return false
  try {
    const r = spawnSync('sc.exe', ['query', 'zapret'], { windowsHide: true, timeout: 2000 })
    if (r.status !== 0 || !r.stdout) return false
    return /:\s*4\s+RUNNING|\bRUNNING\b/i.test(decodeConsole(r.stdout))
  } catch {
    return false
  }
}

async function killOwnTree(): Promise<void> {
  if (!child?.pid) return
  const pid = child.pid
  await new Promise<void>((resolve) => {
    const p = spawn('taskkill.exe', ['/F', '/T', '/PID', String(pid)], { windowsHide: true })
    p.on('exit', () => resolve())
    p.on('error', () => resolve())
  })
}

/**
 * Домены, которые провайдеры режут по DPI, но которых нет в списке Flowseal,
 * а из-за них «висят» популярные сайты. Пример: cdn.cookielaw.org (баннер
 * cookie OneTrust) — HLTV ждёт этот скрипт перед отрисовкой, и страница
 * открывалась 30–40 секунд вместо одной.
 *
 * Добавляются в list-general-user.txt один раз на версию набора (метка
 * рядом со списками), чтобы пользователь мог убрать домен руками и он не
 * возвращался при каждом запуске.
 */
const LAZEYKA_EXTRA_HOSTS = { version: 1, hosts: ['cookielaw.org', 'onetrust.com'] }

function ensureLazeykaHosts(bundleDir: string): void {
  try {
    const marker = path.join(bundleDir, 'lists', `.lazeyka-extra-hosts-v${LAZEYKA_EXTRA_HOSTS.version}`)
    if (existsSync(marker)) return
    const added = addHostsToZapretUserList(LAZEYKA_EXTRA_HOSTS.hosts)
    writeFileSync(marker, new Date().toISOString(), 'utf-8')
    if (added > 0) log('info', `в список Zapret добавлены домены, которые режет DPI (${LAZEYKA_EXTRA_HOSTS.hosts.join(', ')})`)
  } catch {
    /* не критично */
  }
}

// ---------------------------------------------------------------------------
// Запуск Zapret (Windows)
//
// Порядок одной попытки:
//   1. подготовка: чужой winws.exe не трогаем; свой остаток убираем; драйвер WinDivert
//      приводим в порядок (перерегистрация, только если им никто не пользуется);
//   2. запуск .bat и ожидание winws.exe (на загрузке сценарий может «думать» десятки секунд);
//   3. самопроверка: winws жив, драйвер RUNNING, есть признак захвата, всё это держится ещё
//      пару секунд. До этого статус — «запущен, проверяю» (жёлтый). Драйвер из папки другой копии
//      LAZEYKA — не провал (тот же драйвер), только запись в журнал.
// Без прав администратора запуск не начинается (см. attemptStart).
// Ошибка показывается, только когда не помогла и полная очистка («Перезагрузить службы»).
// ---------------------------------------------------------------------------

interface AttemptOpts {
  /** Полная очистка перед запуском: убрать свой winws и заново зарегистрировать драйвер. */
  force: boolean
  /** Автозапуск при входе в Windows: winws может появиться заметно позже. */
  auto: boolean
}

type AttemptResult =
  | { ok: true; weak: boolean }
  | { ok: false; reason: StartFailReason; detail?: string; foreignPath?: string }

async function resolveStrategy(): Promise<{ dir: string; batPath: string }> {
  const cfg = await getAppConfig()
  const z = cfg.zapret
  if (!z || !z.activeStrategy) {
    throw new Error('no active zapret strategy configured')
  }
  const dir = zapretBundleDir()
  ensureCustomMaterialized()
  // Только имя файла из списка стратегий этой папки: значение могло прийти
  // из импортированного профиля или старого конфига (путь с «..» и т. п.).
  let name: string
  try {
    name = validateStrategyName(z.activeStrategy, listStrategyFiles(dir))
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    setStatus({ state: 'error', phase: undefined, detail: undefined, lastError: msg })
    log('error', `${msg} (значение в настройках: ${JSON.stringify(String(z.activeStrategy).slice(0, 120))})`)
    throw new Error(msg)
  }
  const batPath = path.join(dir, name)
  if (path.dirname(batPath) !== path.join(dir) || !existsSync(batPath)) {
    setStatus({ state: 'error', phase: undefined, detail: undefined, lastError: `strategy not found: ${batPath}` })
    log('error', `strategy not found: ${batPath}`)
    throw new Error(`zapret strategy not found: ${batPath}`)
  }
  return { dir, batPath }
}

/** Приводит драйвер WinDivert в состояние, с которым winws.exe запустится надёжно. */
async function prepareDriver(force: boolean, admin: boolean): Promise<void> {
  const expectedSys = findExpectedSys()
  const svc = await readDriverService()
  const svcPath = svc?.binaryPath ?? null
  const decision = decideDriverPrep({
    svc: svc ? { state: svc.query.state } : null,
    svcPath: svcPath && expectedSys && pathsMatch(svcPath, expectedSys) ? expectedSys : svcPath,
    expectedSys,
    svcPathExists: svcPath ? existsSync(normalizeWinPath(svcPath)) : false,
    foreignWinws: false, // чужой winws.exe отсеян раньше — сюда с ним не доходим
    admin,
    force
  })
  switch (decision.action) {
    case 'register-by-winws':
      log('info', 'WinDivert service not registered — winws.exe will register it')
      return
    case 'reuse':
      return
    case 'start-service': {
      log('info', `starting WinDivert service (${svc?.name}, was ${svc?.query.state})`)
      const r = await runCmd('sc.exe', ['start', svc!.name], 8_000)
      if (r.code !== 0 && r.code !== ERROR_SERVICE_ALREADY_RUNNING) {
        log('warn', `sc start ${svc!.name} failed (код ${r.code ?? '?'}${r.timedOut ? ', таймаут' : ''})`)
      }
      return
    }
    case 'reregister': {
      const why =
        decision.reason === 'forced'
          ? 'полная очистка'
          : decision.reason === 'stuck-stopping'
            ? 'драйвер завис в остановке'
            : `служба указывает на ${svcPath ?? '?'}`
      log('warn', `WinDivert: перерегистрирую службу ${svc!.name} (${why})`)
      const removed = await removeDriverService(svc!.name)
      if (!removed) {
        // Не ошибка: если драйвер RUNNING и winws подтвердит захват — всё работает с драйвером из другой папки.
        log('warn', 'WinDivert: служба осталась прежней — продолжаю, самопроверка решит')
      }
      return
    }
    case 'keep':
      if (svcPath && expectedSys && !pathsMatch(svcPath, expectedSys)) {
        log('warn', `WinDivert: служба указывает на ${svcPath}; перерегистрировать нельзя (${decision.reason === 'no-admin' ? 'нет прав администратора' : 'драйвером пользуется другой winws'}) — использую как есть`)
      }
      return
  }
}

/** Состояние драйвера для самопроверки: служба и совпадение пути с нашим .sys. */
async function driverSnapshot(): Promise<{ state: ScState; pathOk: boolean | null } | null> {
  const svc = await readDriverService()
  if (!svc) return null
  const expected = findExpectedSys()
  const pathOk = expected && svc.binaryPath ? pathsMatch(svc.binaryPath, expected) : null
  return { state: svc.query.state, pathOk }
}

async function dropLaunch(me: ChildProcess | null): Promise<void> {
  if (me && child === me) {
    await killOwnTree()
    child = null
  }
  await killOwnWinws().catch(() => void 0)
}

async function attemptStart(dir: string, batPath: string, opts: AttemptOpts): Promise<AttemptResult> {
  setStatus({ state: 'starting', startedAt: Date.now(), lastError: undefined, phase: undefined, detail: undefined })
  log('info', `launching: ${batPath}${opts.force ? ' (после полной очистки)' : ''}`)

  // Если Zapret уже работает как служба Windows — его winws.exe и драйвер трогать нельзя.
  const svc = await getZapretWindowsServiceStatus()
  if (svc.installed && svc.running) {
    setStatus({ state: 'running', startedAt: Date.now(), lastError: undefined, phase: undefined, detail: undefined })
    log('info', 'Zapret is running as a Windows service')
    return { ok: true, weak: false }
  }

  // Без прав администратора winws.exe (в его манифесте requireAdministrator) из нашего cmd не
  // запустить как дочерний: cmd поднимает его отдельно через UAC, его вывод до нас не доходит,
  // остановить его LAZEYKA потом не может, службу WinDivert тоже не трогает (код 5).
  // Поэтому запуск без прав не начинаем и честно говорим, что нужно.
  const admin = await isRunningAsAdmin().catch(() => true)
  if (!admin) {
    log('warn', 'LAZEYKA работает без прав администратора — Zapret не запускаю')
    return { ok: false, reason: 'no-admin' }
  }

  // winws.exe, оставшийся от прошлого запуска, — убираем; чужой (другая копия LAZEYKA,
  // отдельный Zapret) — не трогаем: он продолжит работать.
  if (await isWinwsRunning()) {
    const k = await killOwnWinws()
    if (k.foreign.length > 0) {
      const f = k.foreign[0]
      log('warn', `winws.exe из другой папки уже работает (pid ${f.pid}, ${f.path ?? 'путь неизвестен'}) — не трогаю`)
      return { ok: false, reason: 'foreign', foreignPath: f.path ?? undefined }
    }
    if (k.unknown.length > 0) {
      // Путь не прочитался. Мешает, только если процесс действительно жив.
      const alive = stillAlive(k.unknown, await listWinwsProcesses())
      if (alive.length > 0) {
        log('warn', `уже работает winws.exe с неизвестным путём (pid ${alive.map((p) => p.pid).join(', ')}) — не трогаю`)
        return { ok: false, reason: 'foreign' }
      }
    }
    log('info', 'stale winws.exe detected — cleaned up')
  }
  if (opts.force) await sleep(500)
  if (abortStart) return { ok: false, reason: 'cancelled' }

  await prepareDriver(opts.force, admin)
  if (abortStart) return { ok: false, reason: 'cancelled' }

  resetWinwsHealth()
  const gameVars = getGameFilterVars()

  // .bat patched at install time to drop `start /min`: winws.exe is a direct child of cmd,
  // so the whole tree can be killed via taskkill /F /T /PID.
  const me = spawn('cmd.exe', [ '/c', batPath ], {
    cwd: dir,
    windowsHide: true,
    detached: false,
    env: {
      ...process.env,
      // Skip the .bat's network update check — it can hang for several seconds on cold boot.
      NO_UPDATE_CHECK: '1',
      ...gameVars
    }
  })
  child = me
  let exitCode: number | null | undefined
  attemptActive = true
  const decodeOut = createConsoleDecoder()
  const decodeErr = createConsoleDecoder()
  me.stdout?.on('data', (buf) => {
    const s = decodeOut(buf)
    log('info', s.trimEnd())
    for (const line of s.split(/\r?\n/)) ingestWinwsLine(line)
  })
  me.stderr?.on('data', (buf) => {
    const s = decodeErr(buf)
    log('warn', s.trimEnd())
    for (const line of s.split(/\r?\n/)) ingestWinwsLine(line)
  })
  me.on('error', (err) => {
    log('error', `child error: ${err.message}`)
    if (child !== me) return
    child = null
    exitCode = null
    if (!attemptActive) setStatus({ state: 'error', phase: undefined, detail: undefined, lastError: err.message })
  })
  me.on('exit', (code, signal) => {
    log('info', `zapret exited code=${code} signal=${signal ?? 'none'}`)
    // Процесс уже заменён или остановлен нами (stop/сброс) — состоянием занимается тот, кто его убил.
    if (child !== me) return
    child = null
    exitCode = code
    // Идёт попытка запуска: итог решит она сама (повтор, очистка, затем ошибка).
    if (attemptActive) return
    // Уже «работает» и вдруг упал — это и есть наблюдение за процессом, дополнительных опросов нет.
    if (status.state === 'error') return
    if (stopRequested) {
      setStatus({ state: 'stopped', pid: undefined, lastError: undefined, phase: undefined, detail: undefined })
    } else {
      setStatus({
        state: code === 0 || signal === 'SIGTERM' ? 'stopped' : 'error',
        pid: undefined,
        phase: undefined,
        detail: undefined,
        lastError: code && code !== 0 ? `winws.exe exited with code ${code}` : undefined
      })
    }
  })

  try {
    // ---- 1. ждём появления winws.exe ----
    const t0 = Date.now()
    const launchDeadline = t0 + (opts.auto ? LAUNCH_TIMEOUT_AUTO_MS : LAUNCH_TIMEOUT_MANUAL_MS)
    for (;;) {
      if (abortStart) {
        await dropLaunch(me)
        return { ok: false, reason: 'cancelled' }
      }
      if (health() === 'failed') {
        log('error', `winws.exe reported a fatal error: ${winwsLastError ?? '(no detail)'}`)
        await dropLaunch(me)
        return { ok: false, reason: 'winws-error', detail: winwsLastError ?? undefined }
      }
      if (health() === 'capturing') break
      if (child !== me) {
        await killOwnWinws().catch(() => void 0)
        return { ok: false, reason: 'bat-exited', detail: exitCode != null ? `код ${exitCode}` : undefined }
      }
      if (await isWinwsRunning()) break
      if (Date.now() > launchDeadline) {
        log('warn', `winws.exe не появился за ${Math.round((Date.now() - t0) / 1000)} с`)
        await dropLaunch(me)
        return { ok: false, reason: 'launch-timeout' }
      }
      await sleep(400)
    }

    // ---- 2. самопроверка ----
    setStatus({ state: 'starting', phase: 'verifying', detail: 'Запущен, проверяю…' })
    const v0 = Date.now()
    let weak = false
    let foreignDriver = false
    for (;;) {
      if (abortStart) {
        await dropLaunch(me)
        return { ok: false, reason: 'cancelled' }
      }
      const alive = child === me && (await isWinwsRunning())
      const v = decideVerification({
        winwsAlive: alive,
        capture: health() === 'capturing',
        fatalLine: health() === 'failed',
        driver: await driverSnapshot(),
        waitedForSignalMs: Date.now() - v0,
        signalGraceMs: SIGNAL_GRACE_MS
      })
      if (v.verdict === 'wait') {
        await sleep(500)
        continue
      }
      if (v.verdict === 'fail') {
        log('warn', `самопроверка Zapret не пройдена: ${reasonText(v.reason)}`)
        await dropLaunch(me)
        return { ok: false, reason: v.reason, detail: v.reason === 'winws-error' ? winwsLastError ?? undefined : undefined }
      }
      weak = v.weak
      foreignDriver = v.foreignDriver
      break
    }

    // ---- 3. держится ли это пару секунд ----
    await sleep(STABLE_MS)
    const alive2 = child === me && (await isWinwsRunning())
    const v2 = decideVerification({
      winwsAlive: alive2,
      capture: health() === 'capturing',
      fatalLine: health() === 'failed',
      driver: await driverSnapshot(),
      waitedForSignalMs: 0,
      signalGraceMs: SIGNAL_GRACE_MS
    })
    if (v2.verdict !== 'ok') {
      const reason: StartFailReason = v2.verdict === 'fail' ? v2.reason : 'no-capture-signal'
      log('warn', `Zapret не удержался после запуска: ${reasonText(reason)}`)
      await dropLaunch(me)
      return { ok: false, reason }
    }

    if (weak) log('warn', 'служба WinDivert не найдена под известными именами, но winws.exe подтвердил перехват — принимаю')
    if (foreignDriver) {
      log('warn', 'драйвер WinDivert загружен из папки другой копии LAZEYKA — это тот же драйвер, winws подтвердил перехват, работаю с ним')
    }
    setStatus({ state: 'running', pid: me.pid, phase: undefined, detail: undefined, lastError: undefined })
    log('info', `winws.exe is capturing (${Date.now() - (status.startedAt ?? Date.now())}ms), самопроверка пройдена`)
    return { ok: true, weak }
  } finally {
    attemptActive = false
  }
}

/** Итог неудачи: честное сообщение (про права — только если прав действительно нет). */
async function finishFailed(res: Extract<AttemptResult, { ok: false }>, attempts: number, earlyBoot: boolean): Promise<void> {
  const adminOk = await isRunningAsAdmin().catch(() => true)
  const ctx = {
    reason: res.reason,
    adminOk,
    earlyBoot,
    detail: res.detail,
    foreignPath: res.foreignPath,
    dev: !app.isPackaged
  }
  const text = finalErrorText(ctx, attempts)
  log('error', `Zapret не запустился: ${reasonText(res.reason)}`)
  child = null
  setStatus({ state: 'error', pid: undefined, phase: undefined, detail: undefined, lastError: text })
}

async function startZapretImpl(): Promise<void> {
  // Процесс остался от запуска, который не дождался winws (таймаут), —
  // гасим его, иначе повторный «Старт» молча ничего не делал.
  if (child && status.state === 'error') {
    await killOwnTree()
    child = null
  }
  if (child) return
  abortStart = false
  stopRequested = false
  const { dir, batPath } = await resolveStrategy()
  ensureLazeykaHosts(dir)

  let attempts = 1
  let res = await attemptStart(dir, batPath, { force: false, auto: false })
  // Самопроверка не прошла — один раз делаем то же, что кнопка «Перезагрузить службы».
  if (!res.ok && needsFullReset(res.reason) && !abortStart) {
    attempts = 2
    log('warn', `первая попытка не удалась (${reasonText(res.reason)}) — полная очистка и повторный запуск`)
    setStatus({ state: 'starting', phase: 'retrying', detail: 'Проверка не прошла — перезапускаю драйвер…' })
    res = await attemptStart(dir, batPath, { force: true, auto: false })
  }
  if (!res.ok && res.reason !== 'cancelled') {
    // Ручное включение: готовность сети не проверялась, поэтому «Windows ещё загружала сеть» не утверждаем.
    await finishFailed(res, attempts, false)
  }
}

/**
 * Автозапуск при входе в Windows (Windows). Ждёт готовности системы (служба BFE, сеть),
 * затем запускает; при неудаче — до трёх повторов с паузами 5/15/30 с, перед повтором — полная очистка.
 * Пользователь может отменить это переключателем (stop/start сбрасывают ожидание).
 */
export async function autoStartZapret(): Promise<void> {
  if (process.platform === 'linux') return
  if (process.platform === 'darwin') return startZapret()
  const epoch = ++startEpoch
  abortStart = false
  const cancelled = (): boolean => startEpoch !== epoch || abortStart
  if (child) return

  // Стратегия обязательна — те же ошибки, что и раньше (их показывает index.ts).
  await resolveStrategy()

  setStatus({
    state: 'starting',
    startedAt: Date.now(),
    lastError: undefined,
    phase: 'waiting',
    detail: 'Жду, пока Windows подготовит сеть…'
  })
  const ready = await waitForBootReady(BOOT_WAIT_MAX_MS, cancelled)
  log(
    ready.ready ? 'info' : 'warn',
    ready.ready
      ? `Windows готова к запуску Zapret (служба BFE и сеть; ожидание ${Math.round(ready.waitedMs / 1000)} с)`
      : `Windows не подтвердила готовность за ${Math.round(ready.waitedMs / 1000)} с (BFE: ${ready.bfe}, сеть: ${ready.net ? 'есть' : 'нет'}) — запускаю как есть`
  )
  if (cancelled()) return
  const earlyBoot = !ready.ready || ready.waitedMs > 2_000 || os.uptime() < 300

  let attempt = 1
  let force = false
  for (;;) {
    const res = await withLock<AttemptResult>(async () => {
      if (cancelled()) return { ok: false, reason: 'cancelled' }
      if (child) return { ok: true, weak: false } // пользователь уже включил сам
      stopRequested = false
      const { dir, batPath } = await resolveStrategy()
      ensureLazeykaHosts(dir)
      return attemptStart(dir, batPath, { force, auto: true })
    })
    const step = nextAutoStep(attempt, res.ok ? { ok: true } : { ok: false, reason: res.reason })
    if (step.kind === 'done' || step.kind === 'cancelled') return
    if (step.kind === 'giveup') {
      if (!res.ok) await finishFailed(res, step.attempts, earlyBoot)
      return
    }
    // retry
    if (!res.ok) {
      const adminOk = await isRunningAsAdmin().catch(() => true)
      const text = retryText({ reason: res.reason, adminOk, earlyBoot })
      log('warn', `${text} (попытка ${attempt} из ${RETRY_DELAYS_MS.length + 1}, пауза ${step.delayMs / 1000} с)`)
      setStatus({ state: 'starting', phase: 'retrying', detail: text })
    }
    if (!(await sleepUnless(step.delayMs, cancelled))) return
    attempt = step.nextAttempt
    force = step.cleanup
  }
}

async function stopZapretImpl(): Promise<void> {
  stopRequested = true
  setStatus({ state: 'stopping', lastError: undefined, phase: undefined, detail: undefined })

  // Сначала своё дерево (cmd → winws): быстро и точно. Остаток ищем по имени, но чужие копии не трогаем.
  if (child?.pid) await killOwnTree()
  child = null
  if (await isWinwsRunning()) await killOwnWinws()
  await sleep(150)
  setStatus({ state: 'stopped', pid: undefined, lastError: undefined, phase: undefined, detail: undefined })
  log('info', 'zapret stopped')
}

export async function restartZapret(): Promise<void> {
  if (process.platform === 'linux') return startZapret()
  // macOS: запуск уже перезапускает движок службы целиком (без цикла остановки).
  if (process.platform === 'darwin') return startZapret()
  await stopZapret()
  await sleep(500)
  await startZapret()
}
