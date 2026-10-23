import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import os from 'node:os'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { zapretBundleDir, tgwsCliPaths } from '../utils/dirs'
import { isRunningAsAdmin } from '../utils/elevation'
import { mergeLazeykaIpset } from './zapret-iplist'
import { getAppConfig, patchAppConfig } from '../config'

const execAsync = promisify(exec)

/**
 * Settings & Tools mirroring Flowseal `service.bat`:
 * - Game Filter (off, all, tcp, udp)
 * - IPset Filter (loaded, none, any) + Update list
 * - Replace Active Fakes (Discord UDP / Game UDP)
 * - System Diagnostics & Conflict Resolver
 * - Windows Service Manager (Install Service, Remove Services, Status)
 * - Hosts file sync
 * - Auto-Update Check flag (utils/check_updates.enabled)
 * - Run Tests (utils/test zapret.ps1)
 */

export type GameFilterMode = 'off' | 'all' | 'tcp' | 'udp'
export type IpsetFilterMode = 'none' | 'loaded' | 'any'

// ---- Game Filter ----------------------------------------------------------

function gameFilterFlagFile(): string {
  return path.join(zapretBundleDir(), 'utils', 'game_filter.enabled')
}

export const DEFAULT_GAME_PORTS = '1024-65535'

export interface GameFilterSettings {
  mode: GameFilterMode
  /** Диапазоны портов в формате Flowseal: «N» или «N-M» через запятую. */
  tcp: string
  udp: string
  /** service.bat умеет свои диапазоны (Flowseal 1.10.3+). */
  rangesSupported: boolean
  bundleVersion?: string
}

/**
 * Проверка и нормализация списка портов — те же правила, что у Flowseal
 * (:validate_game_filter_range / :gf_validate_item): пробелы убираются,
 * элементы через запятую, каждый «N» или «N-M», без ведущих нулей,
 * N ≤ M ≤ 65535. Дополнительно сортируем и склеиваем пересечения, чтобы
 * несколько пресетов не давали дублей. Возвращает null, если что-то не так.
 */
export function normalizeGamePorts(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const cleaned = value.replace(/\s+/g, '')
  if (!cleaned) return null
  const ranges: [number, number][] = []
  for (const item of cleaned.split(',')) {
    if (!item) continue
    const m = /^([1-9][0-9]{0,4})(?:-([1-9][0-9]{0,4}))?$/.exec(item)
    if (!m) return null
    const from = Number(m[1])
    const to = m[2] ? Number(m[2]) : from
    if (from > 65535 || to > 65535 || from > to) return null
    ranges.push([from, to])
  }
  if (!ranges.length) return null
  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const merged: [number, number][] = []
  for (const r of ranges) {
    const last = merged[merged.length - 1]
    if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1])
    else merged.push([r[0], r[1]])
  }
  return merged.map(([a, b]) => (a === b ? String(a) : `${a}-${b}`)).join(',')
}

function readServiceBat(): string | null {
  try {
    const f = path.join(zapretBundleDir(), 'service.bat')
    return existsSync(f) ? readFileSync(f, 'utf-8') : null
  } catch {
    return null
  }
}

/** Свои диапазоны понимает только service.bat Flowseal 1.10.3+. */
function bundleSupportsGameRanges(service = readServiceBat()): boolean {
  return !!service && /validate_game_filter_range/i.test(service) && /GameFilterTCPRange/i.test(service)
}

/**
 * Читает utils/game_filter.enabled так же, как :game_switch_status в
 * service.bat: новый формат (mode=/tcp=/udp=) и старый (одно слово all/tcp/udp).
 */
export function getGameFilterSettings(): GameFilterSettings {
  const service = readServiceBat()
  const rangesSupported = bundleSupportsGameRanges(service)
  const bundleVersion = service?.match(/set\s+"?LOCAL_VERSION=([^"\r\n]+)"?/i)?.[1]?.trim()
  const res: GameFilterSettings = { mode: 'off', tcp: DEFAULT_GAME_PORTS, udp: DEFAULT_GAME_PORTS, rangesSupported, bundleVersion }
  const file = gameFilterFlagFile()
  if (!existsSync(file)) return res
  let text = ''
  try { text = readFileSync(file, 'utf-8') } catch { return res }
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (!rangesSupported) {
    // Старый service.bat берёт первую строку; всё, что не all/tcp — это UDP.
    const first = (lines[0] ?? '').toLowerCase()
    res.mode = first === 'all' || first === 'tcp' ? first : 'udp'
    return res
  }
  let mode = 'disabled'
  for (const line of lines) {
    const eq = line.indexOf('=')
    const key = (eq >= 0 ? line.slice(0, eq) : line).trim().toLowerCase()
    const val = eq >= 0 ? line.slice(eq + 1).trim() : ''
    if (key === 'mode') mode = val.toLowerCase()
    else if (key === 'all') mode = 'all'
    else if (key === 'tcp') { if (!val) mode = 'tcp'; else res.tcp = normalizeGamePorts(val) ?? res.tcp }
    else if (key === 'udp') { if (!val) mode = 'udp'; else res.udp = normalizeGamePorts(val) ?? res.udp }
  }
  res.mode = mode === 'all' || mode === 'tcp' || mode === 'udp' ? mode : 'off'
  return res
}

/** Reads current mode straight from disk — source of truth, not config. */
export function getGameFilterMode(): GameFilterMode {
  return getGameFilterSettings().mode
}

/**
 * Значения %GameFilter%, %GameFilterTCP%, %GameFilterUDP% — ровно как их
 * выставляет service.bat (выключенный протокол = порт 12, заглушка Flowseal).
 */
export function getGameFilterVars(): { GameFilter: string; GameFilterTCP: string; GameFilterUDP: string } {
  const s = getGameFilterSettings()
  const tcp = s.rangesSupported ? s.tcp : DEFAULT_GAME_PORTS
  const udp = s.rangesSupported ? s.udp : DEFAULT_GAME_PORTS
  switch (s.mode) {
    case 'all': return { GameFilter: tcp, GameFilterTCP: tcp, GameFilterUDP: udp }
    case 'tcp': return { GameFilter: tcp, GameFilterTCP: tcp, GameFilterUDP: '12' }
    case 'udp': return { GameFilter: udp, GameFilterTCP: '12', GameFilterUDP: udp }
    default: return { GameFilter: '12', GameFilterTCP: '12', GameFilterUDP: '12' }
  }
}

export async function setGameFilterSettings(next: { mode?: GameFilterMode; tcp?: string; udp?: string }): Promise<GameFilterSettings> {
  const cur = getGameFilterSettings()
  const mode = next.mode ?? cur.mode
  let tcp = cur.tcp
  let udp = cur.udp
  if (next.tcp !== undefined) {
    const n = next.tcp.trim() ? normalizeGamePorts(next.tcp) : DEFAULT_GAME_PORTS
    if (!n) throw new Error(`Неверные TCP-порты: «${next.tcp}». Формат: 27015 или 27015-27050, через запятую, до 65535.`)
    tcp = n
  }
  if (next.udp !== undefined) {
    const n = next.udp.trim() ? normalizeGamePorts(next.udp) : DEFAULT_GAME_PORTS
    if (!n) throw new Error(`Неверные UDP-порты: «${next.udp}». Формат: 27015 или 27015-27050, через запятую, до 65535.`)
    udp = n
  }
  const custom = tcp !== DEFAULT_GAME_PORTS || udp !== DEFAULT_GAME_PORTS
  if (custom && !cur.rangesSupported) {
    throw new Error(`Свои порты поддерживает Zapret 1.10.3 и новее (сейчас ${cur.bundleVersion ?? 'старая версия'}). Обновите Zapret на вкладке Zapret.`)
  }
  const file = gameFilterFlagFile()
  try {
    mkdirSync(path.dirname(file), { recursive: true })
    if (cur.rangesSupported) {
      // Формат Flowseal :save_game_filter_settings — выключенный режим тоже
      // пишем, чтобы свои порты не терялись при выключении.
      const content = `mode=${mode === 'off' ? 'disabled' : mode}\r\ntcp=${tcp}\r\nudp=${udp}\r\n`
      if (mode === 'off' && !custom) { if (existsSync(file)) unlinkSync(file) }
      else writeFileSync(file, content, 'utf-8')
    } else if (mode === 'off') {
      if (existsSync(file)) unlinkSync(file)
    } else {
      writeFileSync(file, `${mode}\r\n`, 'utf-8')
    }
  } catch (e) {
    throw new Error(`Не удалось изменить Game Filter: ${e instanceof Error ? e.message : String(e)}`)
  }
  const cfg = await getAppConfig()
  await patchAppConfig({ zapret: { ...(cfg.zapret as ZapretConfig), gameFilterMode: mode } })
  return getGameFilterSettings()
}

export async function setGameFilterMode(mode: GameFilterMode): Promise<GameFilterMode> {
  return (await setGameFilterSettings({ mode })).mode
}

// ---- IPset Filter -----------------------------------------------------------

const DUMMY_IP = '203.0.113.113/32'

function ipsetListFile(): string {
  return path.join(zapretBundleDir(), 'lists', 'ipset-all.txt')
}
function ipsetBackupFile(): string {
  return `${ipsetListFile()}.backup`
}

function nonEmptyLines(content: string): string[] {
  return content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
}

export function getIpsetFilterMode(): IpsetFilterMode {
  const file = ipsetListFile()
  if (!existsSync(file)) return 'any'
  let content: string
  try {
    content = readFileSync(file, 'utf-8')
  } catch {
    return 'loaded'
  }
  const lines = nonEmptyLines(content)
  if (lines.length === 0) return 'any'
  return lines.every((l) => l === DUMMY_IP) ? 'none' : 'loaded'
}

export interface IpsetFilterSnapshot {
  mode: IpsetFilterMode
  lines: number
  hasBackup: boolean
}

export function getIpsetFilterSnapshot(): IpsetFilterSnapshot {
  const file = ipsetListFile()
  let lines = 0
  try {
    if (existsSync(file)) lines = nonEmptyLines(readFileSync(file, 'utf-8')).length
  } catch { /* ignore */ }
  return {
    mode: getIpsetFilterMode(),
    lines,
    hasBackup: existsSync(ipsetBackupFile())
  }
}

export async function setIpsetFilterMode(mode: IpsetFilterMode): Promise<IpsetFilterSnapshot> {
  const file = ipsetListFile()
  const backup = ipsetBackupFile()
  const current = getIpsetFilterMode()

  try {
    mkdirSync(path.dirname(file), { recursive: true })

    if (mode !== current) {
      if (mode === 'loaded') {
        if (!existsSync(backup)) {
          throw new Error(
            'Нет сохранённого списка для восстановления. Сначала загрузите ipset-список кнопкой «Обновить список».'
          )
        }
        if (existsSync(file)) unlinkSync(file)
        renameSync(backup, file)
        try { mergeLazeykaIpset() } catch { /* не критично */ }
      } else {
        if (current === 'loaded' && existsSync(file)) {
          if (existsSync(backup)) unlinkSync(backup)
          renameSync(file, backup)
        }
        writeFileSync(file, mode === 'none' ? `${DUMMY_IP}\r\n` : '', 'utf-8')
      }
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('Нет сохранённого списка')) throw e
    throw new Error(`Не удалось переключить IPset Filter: ${e instanceof Error ? e.message : String(e)}`)
  }

  const cfg = await getAppConfig()
  await patchAppConfig({ zapret: { ...(cfg.zapret as ZapretConfig), ipsetMode: mode } })
  return getIpsetFilterSnapshot()
}

const IPSET_URL =
  'https://raw.githubusercontent.com/Flowseal/zapret-discord-youtube/refs/heads/main/.service/ipset-service.txt'

export async function updateIpsetList(): Promise<IpsetFilterSnapshot> {
  let text: string
  try {
    const res = await fetch(IPSET_URL, { headers: { 'User-Agent': 'LAZEYKA-Updater' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    text = await res.text()
  } catch (e) {
    throw new Error(`Не удалось скачать ipset-список: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (!text.trim()) throw new Error('Скачанный ipset-список пуст')

  const file = ipsetListFile()
  const backup = ipsetBackupFile()
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, text, 'utf-8')
  if (existsSync(backup)) {
    try { unlinkSync(backup) } catch { /* best-effort */ }
  }
  // Свежий список не знает про наши добавления (серверы Valve и т. п.).
  try { mergeLazeykaIpset() } catch { /* не критично */ }

  const cfg = await getAppConfig()
  await patchAppConfig({ zapret: { ...(cfg.zapret as ZapretConfig), ipsetMode: 'loaded' } })
  return getIpsetFilterSnapshot()
}

// ---- Active Fakes -----------------------------------------------------------

export interface FakeFileInfo {
  name: string
  filename: string
  size: number
  hash: string
}

export interface ActiveFakesState {
  discordActive: string | null
  gameActive: string | null
  available: FakeFileInfo[]
}

function calculateFileHash(filePath: string): string | null {
  if (!existsSync(filePath)) return null
  try {
    const buf = readFileSync(filePath)
    return crypto.createHash('sha256').update(buf).digest('hex').toUpperCase()
  } catch {
    return null
  }
}

export function getActiveFakesState(): ActiveFakesState {
  const binDir = path.join(zapretBundleDir(), 'bin')
  if (!existsSync(binDir)) {
    return { discordActive: null, gameActive: null, available: [] }
  }

  const discordFile = path.join(binDir, 'ACTIVE_DISCORD_UDP.bin')
  const gameFile = path.join(binDir, 'ACTIVE_GAME_UDP.bin')

  const discordHash = calculateFileHash(discordFile)
  const gameHash = calculateFileHash(gameFile)

  const entries = readdirSync(binDir)
  const available: FakeFileInfo[] = []

  for (const filename of entries) {
    if (!filename.endsWith('.bin') || filename.startsWith('ACTIVE_')) continue
    const fullPath = path.join(binDir, filename)
    try {
      const st = statSync(fullPath)
      if (!st.isFile()) continue
      const hash = calculateFileHash(fullPath)
      if (hash) {
        available.push({
          name: path.basename(filename, '.bin'),
          filename,
          size: st.size,
          hash
        })
      }
    } catch { /* skip invalid */ }
  }

  available.sort((a, b) => a.name.localeCompare(b.name))

  const discordActive = available.find((f) => f.hash === discordHash)?.name || null
  const gameActive = available.find((f) => f.hash === gameHash)?.name || null

  return {
    discordActive,
    gameActive,
    available
  }
}

export function setActiveFake(target: 'discord' | 'game', fakeName: string): ActiveFakesState {
  const binDir = path.join(zapretBundleDir(), 'bin')
  if (!existsSync(binDir)) {
    throw new Error('Папка bin Zapret не найдена')
  }

  const sourceFile = path.join(binDir, `${fakeName}.bin`)
  if (!existsSync(sourceFile)) {
    throw new Error(`Файл фейка ${fakeName}.bin не найден`)
  }

  const destFile = path.join(binDir, target === 'discord' ? 'ACTIVE_DISCORD_UDP.bin' : 'ACTIVE_GAME_UDP.bin')
  try {
    copyFileSync(sourceFile, destFile)
  } catch (e) {
    throw new Error(`Не удалось скопировать фейк: ${e instanceof Error ? e.message : String(e)}`)
  }

  return getActiveFakesState()
}

// ---- Windows Service Manager ------------------------------------------------

export interface ZapretServiceStatus {
  installed: boolean
  running: boolean
  strategyName: string | null
  windivertRunning: boolean
}

async function safeExec(cmd: string): Promise<string> {
  try {
    const { stdout, stderr } = await execAsync(cmd, { windowsHide: true })
    return stdout + (stderr || '')
  } catch (e: any) {
    return e?.stdout || e?.message || ''
  }
}

async function executeScriptWithAdmin(scriptContent: string): Promise<void> {
  const tmpScript = path.join(
    os.tmpdir(),
    `lazeyka-svc-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.cmd`
  )
  const body = scriptContent.trimEnd().replace(/\r?\n/g, '\r\n')
  writeFileSync(tmpScript, body + '\r\nexit /b 0\r\n', 'utf-8')

  try {
    // Программа работает с правами администратора — тогда скрипт выполняется
    // один раз напрямую. Раньше после прямого запуска он ВСЕГДА повторялся
    // через UAC: второй проход установки тут же удалял только что созданную
    // службу, а при «помеченной на удаление» службе она пропадала совсем.
    if (await isRunningAsAdmin()) {
      await execAsync(`cmd.exe /c "${tmpScript}"`, { windowsHide: true, timeout: 30_000 })
      return
    }

    // Без прав администратора — только через запрос UAC.
    const escaped = tmpScript.replace(/'/g, "''")
    try {
      await execAsync(
        `powershell.exe -NoProfile -Command "Start-Process cmd.exe -ArgumentList '/c','\"\"${escaped}\"\"' -Verb RunAs -Wait"`,
        { windowsHide: true, timeout: 60_000 }
      )
    } catch {
      try {
        await execAsync(
          `mshta vbscript:CreateObject("Shell.Application").ShellExecute("cmd.exe","/c ""${tmpScript}""","","runas",0)(window.close)`,
          { windowsHide: true, timeout: 60_000 }
        )
      } catch { /* best effort */ }
    }
  } finally {
    setTimeout(() => { try { unlinkSync(tmpScript) } catch { /* ok */ } }, 3000)
  }
}

function parseStrategyArgsForService(batPath: string, bundleDir: string): string {
  const content = readFileSync(batPath, 'utf-8')
  const lines = content.split(/\r?\n/)
  const binDir = path.join(bundleDir, 'bin')
  const listsDir = path.join(bundleDir, 'lists')

  let capture = false
  let rawArgs = ''

  for (let line of lines) {
    line = line.trim()
    if (!capture) {
      if (line.includes('winws.exe')) {
        capture = true
        // Strip everything up to and including winws.exe" (with optional trailing quote)
        rawArgs += line.replace(/^.*winws\.exe["'\s]*/i, '') + ' '
      }
    } else {
      if (line.endsWith('^')) {
        // Continuation line — strip trailing ^
        rawArgs += line.replace(/\^+$/, '').trim() + ' '
      } else if (!line.startsWith('::') && !line.startsWith('REM') && line) {
        // Last argument line
        rawArgs += line.trim() + ' '
        break
      }
    }
  }

  // Expand GameFilter variables based on current settings
  const gameVars = getGameFilterVars()

  let args = rawArgs
    // Expand all known bat variables to absolute paths
    .replace(/%BIN%/gi, binDir + '\\')
    .replace(/%LISTS%/gi, listsDir + '\\')
    .replace(/%BIN_PATH%/gi, binDir + '\\')
    .replace(/%LISTS_PATH%/gi, listsDir + '\\')
    .replace(/%~dp0bin\\/gi, binDir + '\\')
    .replace(/%~dp0lists\\/gi, `${listsDir}\\`)
    .replace(/@%~dp0/gi, `@${bundleDir}\\`)
    .replace(/@lists\\/gi, `@${listsDir}\\`)
    .replace(/@bin\\/gi, `@${binDir}\\`)
    .replace(/%GameFilterTCP%/gi, gameVars.GameFilterTCP)
    .replace(/%GameFilterUDP%/gi, gameVars.GameFilterUDP)
    .replace(/%GameFilter%/gi, gameVars.GameFilter)

  // Normalize backslashes (no doubles) and remove stray carets
  args = args.replace(/\\{2,}/g, '\\')
  args = args.replace(/\^/g, '').replace(/\s{2,}/g, ' ').trim()
  // Remove stray leading quote left from "%BIN%winws.exe" pattern
  if (args.startsWith('"')) args = args.substring(1).trim()

  return args
}

export async function getZapretWindowsServiceStatus(): Promise<ZapretServiceStatus> {
  let installed = false
  let running = false
  let strategyName: string | null = null

  try {
    const { stdout } = await execAsync('sc.exe query zapret', { windowsHide: true })
    installed = true
    running = /\b(?:RUNNING|4\s+RUNNING)\b/i.test(stdout) || /:\s*4\b/.test(stdout)
  } catch (err: any) {
    const out = String(err?.stdout || '')
    if (out && !/1060|FAILED|сбой|does not exist|не существует|не установлена/i.test(out)) {
      if (/\b(?:RUNNING|STOPPED|PAUSED|START_PENDING|STOP_PENDING)\b/i.test(out)) {
        installed = true
        running = /\bRUNNING\b/i.test(out)
      }
    }
  }

  if (installed) {
    try {
      const { stdout: regOut } = await execAsync(
        'reg.exe query "HKLM\\System\\CurrentControlSet\\Services\\zapret" /v zapret-discord-youtube',
        { windowsHide: true }
      )
      const match = regOut.match(/zapret-discord-youtube\s+REG_SZ\s+(.+)/i)
      if (match) strategyName = match[1].trim()
    } catch {
      strategyName = null
    }
  }

  let windivertRunning = false
  try {
    const { stdout: wdOut } = await execAsync('sc.exe query WinDivert', { windowsHide: true })
    windivertRunning = /\bRUNNING\b/i.test(wdOut)
  } catch {
    windivertRunning = false
  }

  return { installed, running, strategyName, windivertRunning }
}

export async function installZapretWindowsService(strategyFile?: string): Promise<ZapretServiceStatus> {
  const bundle = zapretBundleDir()
  const cfg = await getAppConfig()
  const activeStrategy = strategyFile || cfg.zapret?.activeStrategy || 'general (ALT).bat'
  const batPath = path.join(bundle, activeStrategy)

  if (!existsSync(batPath)) {
    throw new Error(`Файл стратегии ${activeStrategy} не найден в бандле Zapret`)
  }

  const binPath = path.join(bundle, 'bin', 'winws.exe')
  const args = parseStrategyArgsForService(batPath, bundle)
  const stratName = activeStrategy.replace(/\.bat$/i, '')

  // Build the ImagePath — the full command line SCM will use to start the service
  const imagePath = `"${binPath}" ${args}`

  const installScript = [
    '@echo off',
    'chcp 65001 > nul',
    'netsh interface tcp set global timestamps=enabled > nul 2>&1',
    'net stop zapret > nul 2>&1',
    'sc delete zapret > nul 2>&1',
    'taskkill /IM winws.exe /F > nul 2>&1',
    'timeout /t 1 /nobreak > nul 2>&1',
    `sc create zapret binPath= "${binPath}" DisplayName= "zapret" start= auto > nul 2>&1`,
    'sc description zapret "Zapret DPI bypass software" > nul 2>&1',
    `reg add "HKLM\\System\\CurrentControlSet\\Services\\zapret" /v ImagePath /t REG_EXPAND_SZ /d "${imagePath.replace(/"/g, '\\"')}" /f > nul 2>&1`,
    `reg add "HKLM\\System\\CurrentControlSet\\Services\\zapret" /v zapret-discord-youtube /t REG_SZ /d "${stratName}" /f > nul 2>&1`,
    'net start zapret > nul 2>&1',
    'sc start zapret > nul 2>&1',
  ].join('\r\n')

  await executeScriptWithAdmin(installScript)
  await new Promise((r) => setTimeout(r, 1000))

  const status = await getZapretWindowsServiceStatus()
  if (!status.installed) {
    throw new Error('Не удалось установить службу Zapret. Проверьте права администратора.')
  }

  return status
}

export async function removeZapretWindowsService(): Promise<ZapretServiceStatus> {
  const uninstallScript = [
    '@echo off',
    'chcp 65001 > nul',
    'net stop zapret > nul 2>&1',
    'sc delete zapret > nul 2>&1',
    'reg delete "HKLM\\System\\CurrentControlSet\\Services\\zapret" /f > nul 2>&1',
    'taskkill /IM winws.exe /F > nul 2>&1',
    'net stop WinDivert > nul 2>&1',
    'sc delete WinDivert > nul 2>&1',
    'net stop WinDivert14 > nul 2>&1',
    'sc delete WinDivert14 > nul 2>&1',
    'timeout /t 1 /nobreak > nul 2>&1',
  ].join('\r\n')

  await executeScriptWithAdmin(uninstallScript)
  await new Promise((r) => setTimeout(r, 1000))

  return getZapretWindowsServiceStatus()
}

// ---- Hosts file check & update ----------------------------------------------

const HOSTS_URL =
  'https://raw.githubusercontent.com/Flowseal/zapret-discord-youtube/refs/heads/main/.service/hosts'

export interface HostsCheckResult {
  needsUpdate: boolean
  firstLineFound: boolean
  lastLineFound: boolean
  hasYoutubeEntries: boolean
  hostsPath: string
}

export async function checkZapretHostsFile(): Promise<HostsCheckResult> {
  const hostsPath = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts')
  let needsUpdate = false
  let firstLineFound = true
  let lastLineFound = true
  let hasYoutubeEntries = false

  if (existsSync(hostsPath)) {
    const localContent = readFileSync(hostsPath, 'utf-8')
    hasYoutubeEntries = /youtube\.com|youtu\.be/i.test(localContent)

    try {
      const res = await fetch(`${HOSTS_URL}?t=${Date.now()}`, { headers: { 'User-Agent': 'LAZEYKA-Updater' } })
      if (res.ok) {
        const remoteText = await res.text()
        const lines = remoteText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
        if (lines.length > 0) {
          const firstLine = lines[0]
          const lastLine = lines[lines.length - 1]
          firstLineFound = localContent.includes(firstLine)
          lastLineFound = localContent.includes(lastLine)
          if (!firstLineFound || !lastLineFound) {
            needsUpdate = true
          }
        }
      }
    } catch { /* offline */ }
  }

  return {
    needsUpdate,
    firstLineFound,
    lastLineFound,
    hasYoutubeEntries,
    hostsPath
  }
}

export async function runDiagnosticFix(action: DiagnosticItem['fixAction']): Promise<void> {
  if (action === 'enable_tcp_timestamps') {
    await executeScriptWithAdmin('netsh interface tcp set global timestamps=enabled')
  } else if (action === 'remove_conflicts') {
    await removeZapretWindowsService()
    await executeScriptWithAdmin(
      ['sc stop WinDivert', 'sc delete WinDivert', 'sc stop WinDivert14', 'sc delete WinDivert14'].join('\r\n')
    )
  } else if (action === 'update_hosts') {
    await updateZapretHostsFile()
  }
}

export async function updateZapretHostsFile(): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${HOSTS_URL}?t=${Date.now()}`, { headers: { 'User-Agent': 'LAZEYKA-Updater' } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const remoteText = await res.text()
  if (!remoteText.trim()) throw new Error('Скачанный файл hosts пуст')

  const hostsPath = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts')
  if (!existsSync(hostsPath)) throw new Error(`Файл ${hostsPath} не найден`)

  const currentContent = readFileSync(hostsPath, 'utf-8')
  const marker = '# --- Zapret Discord / YouTube hosts ---'
  const newContent = currentContent.includes(marker)
    ? currentContent.split(marker)[0].trimEnd() + `\n\n${marker}\n` + remoteText
    : currentContent.trimEnd() + `\n\n${marker}\n` + remoteText

  writeFileSync(hostsPath, newContent, 'utf-8')
  return { success: true, message: 'Файл hosts успешно синхронизирован с Flowseal' }
}

// ---- Auto Update check flag & Tests -----------------------------------------

export function getCheckUpdatesFlag(): boolean {
  const flagFile = path.join(zapretBundleDir(), 'utils', 'check_updates.enabled')
  return existsSync(flagFile)
}

export function setCheckUpdatesFlag(enabled: boolean): void {
  const flagFile = path.join(zapretBundleDir(), 'utils', 'check_updates.enabled')
  try {
    if (enabled) {
      mkdirSync(path.dirname(flagFile), { recursive: true })
      writeFileSync(flagFile, 'ENABLED\r\n', 'utf-8')
    } else {
      if (existsSync(flagFile)) unlinkSync(flagFile)
    }
  } catch { /* ignore */ }
}

export async function launchZapretTestsScript(): Promise<void> {
  const scriptPath = path.join(zapretBundleDir(), 'utils', 'test zapret.ps1')
  if (!existsSync(scriptPath)) {
    throw new Error(`Скрипт ${scriptPath} не найден`)
  }
  exec(`start "" powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`, { windowsHide: false })
}

// ---- Diagnostics & Quick Fixes ----------------------------------------------

export interface DiagnosticItem {
  id: string
  category: 'system' | 'network' | 'conflicts' | 'discord' | 'telegram'
  title: string
  status: 'ok' | 'warn' | 'error'
  message: string
  fixAction?: 'enable_tcp_timestamps' | 'remove_conflicts' | 'clear_discord_cache' | 'update_hosts' | 'disable_proxy' | 'start_bfe' | 'start_wmi'
  fixLabel?: string
}

export interface DiagnosticReport {
  timestamp: number
  items: DiagnosticItem[]
  hasIssues: boolean
}


// ---- Дополнительные проверки («Почему может не работать?») -------------------

/** Как safeExec, но с признаком успеха и ограничением по времени. */
async function tryExec(cmd: string, timeout = 15000): Promise<{ ok: boolean; out: string }> {
  try {
    const { stdout, stderr } = await execAsync(cmd, { windowsHide: true, timeout })
    return { ok: true, out: stdout + (stderr || '') }
  } catch (e: any) {
    return { ok: false, out: (e?.stdout || '') + (e?.stderr || '') || e?.message || '' }
  }
}

const AV_HINT = 'скорее всего их удалил антивирус. Добавьте папку LAZEYKA в исключения и переустановите TgWsProxy'

async function checkAdminRights(): Promise<DiagnosticItem> {
  const admin = await isRunningAsAdmin().catch(() => false)
  if (admin) {
    return {
      id: 'admin',
      category: 'system',
      title: 'Права администратора',
      status: 'ok',
      message: 'LAZEYKA запущена от имени администратора.'
    }
  }
  return {
    id: 'admin',
    category: 'system',
    title: 'Права администратора',
    status: 'warn',
    message:
      'LAZEYKA запущена без прав администратора. Zapret и драйвер WinDivert требуют их, а часть проверок ниже без админа может быть неточной. Перезапустите LAZEYKA от имени администратора.'
  }
}

async function checkWinDivert(): Promise<DiagnosticItem[]> {
  const items: DiagnosticItem[] = []
  const bin = path.join(zapretBundleDir(), 'bin')
  const hasDriver = existsSync(path.join(bin, 'WinDivert64.sys')) || existsSync(path.join(bin, 'WinDivert.sys'))
  const hasWinws = existsSync(path.join(bin, 'winws.exe'))
  if (!hasDriver || !hasWinws) {
    const missing = [!hasWinws && 'winws.exe', !hasDriver && 'драйвер WinDivert'].filter(Boolean).join(' и ')
    items.push({
      id: 'windivert_files',
      category: 'system',
      title: 'Файлы Zapret и драйвер WinDivert',
      status: 'error',
      message: `Не найдено: ${missing} — файл удалён, скорее всего антивирус. Добавьте папку LAZEYKA в исключения и переустановите Zapret.`
    })
  } else {
    items.push({
      id: 'windivert_files',
      category: 'system',
      title: 'Файлы Zapret и драйвер WinDivert',
      status: 'ok',
      message: 'Файлы winws.exe и драйвера WinDivert на месте.'
    })
  }
  try {
    const { getZapretStatus } = await import('./zapret')
    const st = getZapretStatus()
    if (st.state === 'error' && st.lastError && /windivert|access denied|отказано в доступе|доступ/i.test(st.lastError)) {
      items.push({
        id: 'windivert_error',
        category: 'system',
        title: 'Zapret не смог запустить драйвер',
        status: 'error',
        message: st.lastError
      })
    }
  } catch {
    /* статус недоступен — пропускаем */
  }
  return items
}

async function checkTgwsFiles(): Promise<DiagnosticItem[]> {
  const items: DiagnosticItem[] = []
  if (!tgwsCliPaths()) {
    items.push({
      id: 'tgws_files',
      category: 'telegram',
      title: 'Файлы TgWsProxy',
      status: 'error',
      message: `Не найдены Python или файлы TgWsProxy — ${AV_HINT}.`
    })
  } else {
    items.push({
      id: 'tgws_files',
      category: 'telegram',
      title: 'Файлы TgWsProxy',
      status: 'ok',
      message: 'Python и файлы TgWsProxy на месте.'
    })
  }
  try {
    const { getTgwsStatus } = await import('./tgws')
    const st = getTgwsStatus()
    if (st.state === 'error' && st.lastError) {
      items.push({
        id: 'tgws_error',
        category: 'telegram',
        title: 'TgWsProxy завершился с ошибкой',
        status: 'error',
        message: st.lastError
      })
    }
  } catch {
    /* noop */
  }
  return items
}

async function checkPowerShell(): Promise<DiagnosticItem> {
  const r = await tryExec(
    'powershell -NoProfile -Command "Get-ExecutionPolicy -Scope MachinePolicy; Get-ExecutionPolicy -Scope UserPolicy"'
  )
  if (!r.ok) {
    return {
      id: 'powershell',
      category: 'system',
      title: 'PowerShell',
      status: 'error',
      message:
        'PowerShell недоступен или заблокирован. Через него LAZEYKA настраивает DNS и часть сетевых параметров — без него эти функции не заработают.'
    }
  }
  const [machine = '', user = ''] = r.out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const bad = (v: string): boolean => /^(restricted|allsigned)$/i.test(v)
  if (bad(machine) || bad(user)) {
    return {
      id: 'powershell',
      category: 'system',
      title: 'PowerShell',
      status: 'warn',
      message: `Групповая политика (${bad(machine) ? 'компьютер' : 'пользователь'}: ${bad(machine) ? machine : user}) запрещает скрипты и перекрывает «-ExecutionPolicy Bypass»: часть функций, например настройка DNS, может не работать.`
    }
  }
  return {
    id: 'powershell',
    category: 'system',
    title: 'PowerShell',
    status: 'ok',
    message: 'PowerShell доступен, групповые политики скриптам не мешают.'
  }
}

async function checkWmi(): Promise<DiagnosticItem> {
  const q = await safeExec('sc query Winmgmt')
  const qc = await safeExec('sc qc Winmgmt')
  const running = /RUNNING/i.test(q)
  // Название поля локализовано («ТИП_ЗАПУСКА»), значение — нет: «4  DISABLED».
  const disabled = /:\s*4\s+DISABLED/i.test(qc)
  if (running && !disabled) {
    return {
      id: 'wmi',
      category: 'system',
      title: 'Служба WMI (Winmgmt)',
      status: 'ok',
      message: 'Служба WMI работает.'
    }
  }
  return {
    id: 'wmi',
    category: 'system',
    title: 'Служба WMI (Winmgmt)',
    status: 'error',
    message: disabled
      ? 'Служба WMI (Winmgmt) отключена. Без неё не работают часть системных проверок и определение сетевых адаптеров.'
      : 'Служба WMI (Winmgmt) не запущена. Без неё не работают часть системных проверок и определение сетевых адаптеров.',
    fixAction: 'start_wmi',
    fixLabel: 'Включить и запустить WMI'
  }
}

async function checkTelegramPort(): Promise<DiagnosticItem | null> {
  let port = 1443
  try {
    port = (await getAppConfig()).tgws?.port || 1443
  } catch {
    /* по умолчанию */
  }
  try {
    const { getTgwsStatus } = await import('./tgws')
    const st = getTgwsStatus().state
    if (st === 'running' || st === 'starting') return null
  } catch {
    /* продолжаем */
  }
  const out = await safeExec('netstat -ano -p TCP')
  let pid: number | null = null
  for (const line of out.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/)
    // TCP <локальный>:<порт> <внешний>:0 <состояние> <PID>. Слово состояния
    // локализовано («ПРОСЛУШИВАЕТСЯ»), поэтому слушающий сокет узнаём по внешнему адресу :0.
    if (parts.length < 5 || !/^TCP/i.test(parts[0])) continue
    if (!parts[1].endsWith(`:${port}`) || !/:0$/.test(parts[2])) continue
    const n = Number(parts[parts.length - 1])
    if (Number.isInteger(n)) {
      pid = n
      break
    }
  }
  if (pid === null) {
    return {
      id: 'tgws_port',
      category: 'telegram',
      title: `Порт Telegram-прокси (${port})`,
      status: 'ok',
      message: `Порт ${port} свободен.`
    }
  }
  if (pid === 4) {
    return {
      id: 'tgws_port',
      category: 'telegram',
      title: `Порт Telegram-прокси (${port})`,
      status: 'error',
      message: `Порт ${port} занят системой (HTTP.sys / служба Windows) — смените порт в настройках Telegram.`
    }
  }
  const t = await safeExec(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`)
  const name = /^"([^"]+)"/.exec(t.trim())?.[1]
  return {
    id: 'tgws_port',
    category: 'telegram',
    title: `Порт Telegram-прокси (${port})`,
    status: 'warn',
    message: `Порт ${port} уже занят ${name ? `программой ${name}` : 'другой программой'} (PID ${pid}). Закройте её или смените порт в настройках Telegram.`
  }
}

const HOSTS_WATCH: [string, (h: string) => boolean][] = [
  ['discord', (h) => h.includes('discord')],
  ['youtube', (h) => h.includes('youtube') || h.includes('youtu.be')],
  ['googlevideo', (h) => h.includes('googlevideo')],
  ['telegram', (h) => h.includes('telegram')],
  ['t.me', (h) => h === 't.me' || h.endsWith('.t.me')],
  ['instagram', (h) => h.includes('instagram')],
  ['x.com', (h) => h === 'x.com' || h.endsWith('.x.com')],
  ['twitter', (h) => h.includes('twitter')],
  ['faceit', (h) => h.includes('faceit')],
  ['steam', (h) => h.includes('steam')]
]

/** Домены из hosts, которые перенаправлены на чужой IP (блок Flowseal и блокировки на 0.0.0.0/127.0.0.1 пропускаются). */
export function findHostsRedirects(content: string, known: Set<string> = new Set()): string[] {
  const marker = '# --- Zapret Discord / YouTube hosts ---'
  const own = content.indexOf(marker)
  const text = own >= 0 ? content.slice(0, own) : content
  const found = new Set<string>()
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim()
    if (!line) continue
    const [ip, ...names] = line.split(/\s+/)
    if (!ip || ['0.0.0.0', '127.0.0.1', '::1'].includes(ip)) continue
    // Официальные адреса Telegram (149.154.160.0/20, 91.108.0.0/16) — так
    // прописывает и Flowseal, это не подмена.
    if (/^149\.154\.(1[6-7][0-9])\./.test(ip) || /^91\.108\./.test(ip)) continue
    for (const n of names) {
      const host = n.toLowerCase()
      // Строка из актуального hosts Flowseal (добавлена через service.bat без нашей метки).
      if (known.has(`${ip} ${host}`)) continue
      if (HOSTS_WATCH.some(([, test]) => test(host))) found.add(host)
    }
  }
  return [...found]
}

async function checkHostsRedirects(): Promise<DiagnosticItem> {
  const hostsPath = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts')
  let list: string[] = []
  // Строки из hosts Flowseal не считаем подменой (без сети — только встроенные исключения).
  const known = new Set<string>()
  try {
    const res = await fetch(HOSTS_URL, { headers: { 'User-Agent': 'LAZEYKA-Updater' }, signal: AbortSignal.timeout(5000) })
    if (res.ok) {
      for (const l of (await res.text()).split(/\r?\n/)) {
        const [ip, ...names] = l.replace(/#.*/, '').trim().split(/\s+/)
        if (ip) for (const n of names) known.add(`${ip} ${n.toLowerCase()}`)
      }
    }
  } catch {
    /* офлайн */
  }
  try {
    if (existsSync(hostsPath)) list = findHostsRedirects(readFileSync(hostsPath, 'utf-8'), known)
  } catch {
    /* нет доступа к hosts — не считаем проблемой */
  }
  if (list.length === 0) {
    return {
      id: 'hosts_redirects',
      category: 'network',
      title: 'Перенаправления в hosts',
      status: 'ok',
      message: 'Популярные сайты (Discord, YouTube, Telegram и др.) в hosts на чужие адреса не перенаправлены.'
    }
  }
  const shown = list.slice(0, 5).join(', ')
  return {
    id: 'hosts_redirects',
    category: 'network',
    title: 'Перенаправления в hosts',
    status: 'warn',
    message: `Файл hosts перенаправляет на другой IP: ${shown}${list.length > 5 ? ` и ещё ${list.length - 5}` : ''}. Такие записи могут ломать сайты и обход блокировок — удалите их, если не добавляли сами.`
  }
}

/**
 * Сторонние VPN-службы (как в диагностике Flowseal 1.10.4: «VPN» и Happ) —
 * их TUN/WFP-драйверы перехватывают трафик раньше Zapret.
 */
async function checkOtherVpn(): Promise<DiagnosticItem> {
  const out = await safeExec('sc query')
  const names = new Set<string>()
  for (const line of out.split(/\r?\n/)) {
    const m = /^\s*(?:SERVICE_NAME|ИМЯ_СЛУЖБЫ)\s*:\s*(.+?)\s*$/i.exec(line)
    if (m && /vpn|happservice/i.test(m[1])) names.add(m[1])
  }
  if (names.size === 0) {
    return { id: 'other_vpn', category: 'conflicts', title: 'Другие VPN', status: 'ok', message: 'Запущенных сторонних VPN-служб не найдено.' }
  }
  return {
    id: 'other_vpn',
    category: 'conflicts',
    title: 'Другие VPN',
    status: 'warn',
    message: `Запущены VPN-службы: ${[...names].slice(0, 5).join(', ')}. Они могут перехватывать трафик раньше Zapret — если что-то не работает, выключите их.`
  }
}

export async function runZapretDiagnostics(): Promise<DiagnosticReport> {
  const items: DiagnosticItem[] = []

  // 0. Права администратора — без них остальные проверки могут быть неточными
  items.push(await checkAdminRights())

  // 1. Base Filtering Engine (BFE)
  const bfeOut = await safeExec('sc query BFE')
  if (/RUNNING/i.test(bfeOut)) {
    items.push({
      id: 'bfe',
      category: 'system',
      title: 'Служба Base Filtering Engine (BFE)',
      status: 'ok',
      message: 'Служба BFE активна — перехват сетевых пакетов работает штатно.'
    })
  } else {
    items.push({
      id: 'bfe',
      category: 'system',
      title: 'Служба Base Filtering Engine (BFE)',
      status: 'error',
      message: 'Служба BFE не запущена. Без неё драйвер WinDivert не сможет фильтровать трафик.',
      fixAction: 'start_bfe',
      fixLabel: 'Запустить службу BFE'
    })
  }

  // 2. TCP Timestamps
  const tcpOut = await safeExec('netsh interface tcp show global')
  // Match either English ("RFC 1323 Timestamps : enabled") or Russian ("Метки времени RFC 1323 : enabled" / "включен")
  const lineMatch = tcpOut.match(/(?:RFC\s*1323|1323|timestamps|метки\s*времени)[\s\S]*?:\s*([^\r\n]+)/i)
  const val = (lineMatch?.[1] ?? '').trim().toLowerCase()
  const timestampsEnabled = /enabled|allowed|включен|on|true|1/i.test(val)

  if (timestampsEnabled) {
    items.push({
      id: 'tcp_timestamps',
      category: 'network',
      title: 'Временные метки TCP (Timestamps)',
      status: 'ok',
      message: 'TCP Timestamps включены — отправка фальшивых пакетов работает корректно.'
    })
  } else {
    items.push({
      id: 'tcp_timestamps',
      category: 'network',
      title: 'Временные метки TCP (Timestamps)',
      status: 'warn',
      message: 'TCP Timestamps выключены в системе. Рекомендуется включить для стабильной работы обхода.',
      fixAction: 'enable_tcp_timestamps',
      fixLabel: 'Включить TCP Timestamps'
    })
  }

  // 3. System Proxy
  const proxyOut = await safeExec('reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable')
  const isProxyOn = /0x1\b/i.test(proxyOut)
  if (isProxyOn) {
    const serverOut = await safeExec('reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyServer')
    const match = serverOut.match(/ProxyServer\s+REG_SZ\s+(\S+)/i)
    const server = match ? match[1] : 'неизвестный'
    items.push({
      id: 'proxy',
      category: 'network',
      title: 'Системный прокси Windows',
      status: 'warn',
      message: `В системе активен прокси (${server}). Если это сторонний прокси, он может конфликтовать с Zapret.`,
      fixAction: 'disable_proxy',
      fixLabel: 'Отключить прокси'
    })
  } else {
    items.push({
      id: 'proxy',
      category: 'network',
      title: 'Системный прокси Windows',
      status: 'ok',
      message: 'Системный прокси отключен.'
    })
  }

  // 4. Conflicting Services (GoodbyeDPI, old WinDivert, etc)
  const conflictServices = ['GoodbyeDPI', 'discordfix_zapret', 'winws1', 'winws2']
  const foundServices: string[] = []

  for (const srv of conflictServices) {
    const out = await safeExec(`sc query "${srv}"`)
    if (!/FAILED 1060/i.test(out) && !/не существует/i.test(out) && /SERVICE_NAME/i.test(out)) {
      foundServices.push(srv)
    }
  }

  // Check orphan WinDivert when winws is not running
  const winwsTask = await safeExec('tasklist /FI "IMAGENAME eq winws.exe"')
  const isWinwsRunning = /winws\.exe/i.test(winwsTask)
  if (!isWinwsRunning) {
    const wdOut = await safeExec('sc query WinDivert')
    if (/RUNNING|STOP_PENDING/i.test(wdOut)) {
      foundServices.push('WinDivert (зависший драйвер)')
    }
  }

  if (foundServices.length > 0) {
    items.push({
      id: 'conflicts',
      category: 'conflicts',
      title: 'Конфликтующие bypass-службы',
      status: 'error',
      message: `Обнаружены конкурирующие службы/драйверы: ${foundServices.join(', ')}. Они блокируют сетевой стек.`,
      fixAction: 'remove_conflicts',
      fixLabel: 'Очистить службы и драйверы'
    })
  } else {
    items.push({
      id: 'conflicts',
      category: 'conflicts',
      title: 'Конфликтующие bypass-службы',
      status: 'ok',
      message: 'Сторонних или зависших служб обхода блокировок не обнаружено.'
    })
  }

  // 5. Conflicting Applications (Adguard, Killer, SmartByte)
  const taskOut = await safeExec('tasklist')
  const adguardFound = /AdguardSvc\.exe/i.test(taskOut)
  if (adguardFound) {
    items.push({
      id: 'adguard',
      category: 'conflicts',
      title: 'Приложение AdGuard',
      status: 'warn',
      message: 'Обнаружен запущенный AdGuard. Сетевой драйвер WFP в AdGuard может мешать работе голоса в Discord.'
    })
  }

  // 6. Hosts file check
  const hostsCheck = await checkZapretHostsFile()
  if (hostsCheck.hasYoutubeEntries) {
    items.push({
      id: 'hosts',
      category: 'network',
      title: 'Файл hosts (C:\\Windows\\...\\hosts)',
      status: 'warn',
      message: 'В файле hosts найдены перенаправления для YouTube. Это может ломать воспроизведение видео.',
      fixAction: 'update_hosts',
      fixLabel: 'Синхронизировать hosts'
    })
  } else if (hostsCheck.needsUpdate) {
    items.push({
      id: 'hosts',
      category: 'network',
      title: 'Файл hosts (C:\\Windows\\...\\hosts)',
      status: 'warn',
      message: 'Файл hosts отличается от актуальной версии Flowseal (отсутствуют рекомендуемые DNS-записи).',
      fixAction: 'update_hosts',
      fixLabel: 'Обновить файл hosts'
    })
  } else {
    items.push({
      id: 'hosts',
      category: 'network',
      title: 'Файл hosts (C:\\Windows\\...\\hosts)',
      status: 'ok',
      message: 'Файл hosts в порядке и актуален.'
    })
  }

  // 7. Discord Installations
  const appData = process.env.APPDATA || ''
  const discordVariants = [
    { name: 'Discord', path: path.join(appData, 'discord') },
    { name: 'Discord PTB', path: path.join(appData, 'discordptb') },
    { name: 'Discord Canary', path: path.join(appData, 'discordcanary') },
    { name: 'Discord Dev', path: path.join(appData, 'discorddevelopment') }
  ]
  const installedDiscord = discordVariants.filter((d) => existsSync(d.path)).map((d) => d.name)

  if (installedDiscord.length > 0) {
    items.push({
      id: 'discord_cache',
      category: 'discord',
      title: 'Кэш Discord',
      status: 'ok',
      message: `Обнаружены клиенты: ${installedDiscord.join(', ')}. При проблемах с голосовыми каналами очистите кэш.`,
      fixAction: 'clear_discord_cache',
      fixLabel: 'Очистить кэш Discord'
    })
  }

  // 8. Дополнительные проверки: драйвер, TgWsProxy, PowerShell, WMI, порт, hosts
  items.push(...(await checkWinDivert()))
  items.push(...(await checkTgwsFiles()))
  items.push(await checkPowerShell())
  items.push(await checkWmi())
  const portItem = await checkTelegramPort()
  if (portItem) items.push(portItem)
  items.push(await checkHostsRedirects())
  items.push(await checkOtherVpn())

  const hasIssues = items.some((i) => i.status !== 'ok')

  return {
    timestamp: Date.now(),
    items,
    hasIssues
  }
}

export async function fixDiagnosticIssue(action: string): Promise<{ success: boolean; message: string }> {
  if (action === 'enable_tcp_timestamps') {
    try {
      await execAsync('netsh interface tcp set global timestamps=enabled', { windowsHide: true })
      try {
        await execAsync('powershell -NoProfile -Command "Set-NetTCPSetting -SettingName Internet -Timestamps Enabled -ErrorAction SilentlyContinue; Set-NetTCPSetting -SettingName InternetCustom -Timestamps Enabled -ErrorAction SilentlyContinue"', { windowsHide: true })
      } catch { /* best effort */ }
      return { success: true, message: 'TCP Timestamps успешно включены' }
    } catch (e: any) {
      throw new Error(`Ошибка при включении TCP Timestamps: ${e?.message || String(e)}`)
    }
  }

  if (action === 'start_bfe') {
    try {
      await execAsync('net start BFE', { windowsHide: true })
      return { success: true, message: 'Служба BFE успешно запущена' }
    } catch (e: any) {
      throw new Error(`Ошибка запуска службы BFE: ${e?.message || String(e)}`)
    }
  }

  if (action === 'start_wmi') {
    try {
      await execAsync('sc config Winmgmt start= auto', { windowsHide: true })
      try {
        await execAsync('net start Winmgmt', { windowsHide: true })
      } catch (e: any) {
        // 2182 — «служба уже запущена»
        if (!/2182|already been started|уже запущена/i.test(`${e?.stdout ?? ''}${e?.stderr ?? ''}${e?.message ?? ''}`)) throw e
      }
      return { success: true, message: 'Служба WMI включена и запущена' }
    } catch (e: any) {
      throw new Error(`Ошибка запуска службы WMI (нужны права администратора): ${e?.message || String(e)}`)
    }
  }

  if (action === 'disable_proxy') {
    try {
      await execAsync('reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable /t REG_DWORD /d 0 /f', { windowsHide: true })
      return { success: true, message: 'Системный прокси успешно отключен' }
    } catch (e: any) {
      throw new Error(`Ошибка при отключении прокси: ${e?.message || String(e)}`)
    }
  }

  if (action === 'remove_conflicts') {
    const services = ['GoodbyeDPI', 'discordfix_zapret', 'winws1', 'winws2', 'WinDivert', 'WinDivert14']
    for (const srv of services) {
      try { await execAsync(`net stop "${srv}"`, { windowsHide: true }) } catch { /* ignore */ }
      try { await execAsync(`sc delete "${srv}"`, { windowsHide: true }) } catch { /* ignore */ }
    }
    return { success: true, message: 'Службы и драйверы успешно остановлены и удалены' }
  }

  if (action === 'update_hosts') {
    return updateZapretHostsFile()
  }

  if (action === 'clear_discord_cache') {
    const appData = process.env.APPDATA || ''
    const processes = ['Discord.exe', 'DiscordPTB.exe', 'DiscordCanary.exe', 'DiscordDevelopment.exe']
    for (const p of processes) {
      try { await execAsync(`taskkill /F /IM "${p}" /T`, { windowsHide: true }) } catch { /* ignore */ }
    }

    const cacheDirs = [
      path.join(appData, 'discord'),
      path.join(appData, 'discordptb'),
      path.join(appData, 'discordcanary'),
      path.join(appData, 'discorddevelopment')
    ]

    let cleared = 0
    for (const base of cacheDirs) {
      for (const sub of ['Cache', 'Code Cache', 'GPUCache']) {
        const p = path.join(base, sub)
        if (existsSync(p)) {
          try {
            rmSync(p, { recursive: true, force: true })
            cleared++
          } catch { /* ignore */ }
        }
      }
    }

    return { success: true, message: `Кэш Discord очищен (${cleared} папок)` }
  }

  throw new Error(`Неизвестное действие: ${action}`)
}
