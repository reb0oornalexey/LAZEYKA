import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import os from 'node:os'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { zapretBundleDir } from '../utils/dirs'
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

/** Reads current mode straight from disk — source of truth, not config. */
export function getGameFilterMode(): GameFilterMode {
  const file = gameFilterFlagFile()
  if (!existsSync(file)) return 'off'
  try {
    const firstLine = readFileSync(file, 'utf-8').split(/\r?\n/)[0]?.trim().toLowerCase()
    if (firstLine === 'all' || firstLine === 'tcp' || firstLine === 'udp') return firstLine
    return 'off'
  } catch {
    return 'off'
  }
}

export async function setGameFilterMode(mode: GameFilterMode): Promise<GameFilterMode> {
  const file = gameFilterFlagFile()
  try {
    if (mode === 'off') {
      if (existsSync(file)) unlinkSync(file)
    } else {
      mkdirSync(path.dirname(file), { recursive: true })
      writeFileSync(file, `${mode}\r\n`, 'utf-8')
    }
  } catch (e) {
    throw new Error(`Не удалось изменить Game Filter: ${e instanceof Error ? e.message : String(e)}`)
  }
  const cfg = await getAppConfig()
  await patchAppConfig({ zapret: { ...(cfg.zapret as ZapretConfig), gameFilterMode: mode } })
  return mode
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
    // 1. First try direct execution (succeeds instantly if running as admin or UAC disabled)
    try {
      await execAsync(`cmd.exe /c "${tmpScript}"`, {
        windowsHide: true,
        timeout: 30_000
      })
    } catch (e) {
      console.warn('Direct cmd execution warning:', e)
    }

    await new Promise((r) => setTimeout(r, 600))

    // 2. Check if the service state was changed. If not, try UAC elevation.
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
  const gameMode = getGameFilterMode()
  const gameTcp = gameMode === 'all' || gameMode === 'tcp' ? '1024-65535' : '12'
  const gameUdp = gameMode === 'all' || gameMode === 'udp' ? '1024-65535' : '12'

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
    .replace(/%GameFilterTCP%/gi, gameTcp)
    .replace(/%GameFilterUDP%/gi, gameUdp)
    .replace(/%GameFilter%/gi, '1024-65535')

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
  category: 'system' | 'network' | 'conflicts' | 'discord'
  title: string
  status: 'ok' | 'warn' | 'error'
  message: string
  fixAction?: 'enable_tcp_timestamps' | 'remove_conflicts' | 'clear_discord_cache' | 'update_hosts' | 'disable_proxy' | 'start_bfe'
  fixLabel?: string
}

export interface DiagnosticReport {
  timestamp: number
  items: DiagnosticItem[]
  hasIssues: boolean
}

export async function runZapretDiagnostics(): Promise<DiagnosticReport> {
  const items: DiagnosticItem[] = []

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
