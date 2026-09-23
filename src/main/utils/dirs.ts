import { is } from '@electron-toolkit/utils'
import { existsSync, mkdirSync, readFileSync, statSync } from 'fs'
import { spawnSync } from 'child_process'
import { app } from 'electron'
import path from 'path'

export const homeDir = app.getPath('home')

export function isPortable(): boolean {
  return existsSync(path.join(exeDir(), 'PORTABLE'))
}

export function dataDir(): string {
  if (isPortable()) {
    return path.join(exeDir(), 'data')
  }
  return app.getPath('userData')
}

export function taskDir(): string {
  const dir = path.join(app.getPath('userData'), 'tasks')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

export function exeDir(): string {
  return path.dirname(exePath())
}

export function exePath(): string {
  return app.getPath('exe')
}

export function resourcesDir(): string {
  if (is.dev) {
    // In dev __dirname is <project>/out/main, so ../.. resolves to the
    // project root which contains the `resources/` folder with all
    // LAZEYKA runtime binaries (tgws/, zapret/, icon files).
    const root = path.join(__dirname, '../..')
    return path.join(root, 'resources')
  }
  if (app.getAppPath().endsWith('asar')) {
    return process.resourcesPath
  }
  return path.join(app.getAppPath(), 'resources')
}

export function resourcesFilesDir(): string {
  return path.join(resourcesDir(), 'files')
}

export function themesDir(): string {
  return path.join(dataDir(), 'themes')
}

export function appConfigPath(): string {
  return path.join(dataDir(), 'config.yaml')
}

export function logDir(): string {
  return path.join(dataDir(), 'logs')
}

export function logPath(): string {
  const date = new Date()
  const name = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
  return path.join(logDir(), `${name}.log`)
}

export function runtimeDir(): string {
  return path.join(dataDir(), 'runtime')
}

export function tgwsRuntimeDir(): string {
  return path.join(runtimeDir(), 'tgws')
}

export function tgwsBinaryPath(): string {
  // Check runtime dir first (downloaded auto-updates), fall back to bundled resources/.
  const rt = path.join(tgwsRuntimeDir(), 'TgWsProxy_windows.exe')
  if (existsSync(rt)) return rt
  return path.join(resourcesDir(), 'tgws', 'TgWsProxy_windows.exe')
}

/**
 * Консольный TgWsProxy: встроенный Python + пакет `proxy` из исходников Flowseal.
 *
 * Официальный `TgWsProxy_windows.exe` — это tray-приложение (`windows.py`):
 * аргументы командной строки оно игнорирует, читает `%APPDATA%\TgWsProxy\
 * config.json` и всегда рисует иконку в трее. Консольная точка входа
 * (`proxy/tg_ws_proxy.py`) понимает `--dc-ip`, `--no-cfproxy` и т.д. и не
 * создаёт никаких окон.
 *
 * Обновлённый пакет `proxy` (автообновление) лежит в runtime и имеет приоритет
 * над встроенным.
 */
export function tgwsCliPaths(): { python: string; bootstrap: string; appDir: string; version: string } | null {
  const pyDir = path.join(resourcesDir(), 'tgws', 'python')
  const python = path.join(pyDir, 'python.exe')
  const bootstrap = path.join(pyDir, 'lazeyka_tgws.py')
  if (!existsSync(python) || !existsSync(bootstrap)) return null
  const runtimeApp = path.join(tgwsRuntimeDir(), 'app')
  const bundledApp = path.join(resourcesDir(), 'tgws', 'app')
  const appDir = existsSync(path.join(runtimeApp, 'proxy', 'tg_ws_proxy.py')) ? runtimeApp : bundledApp
  if (!existsSync(path.join(appDir, 'proxy', 'tg_ws_proxy.py'))) return null
  let version = ''
  try {
    version = readFileSync(path.join(appDir, 'VERSION'), 'utf-8').trim()
  } catch {
    /* unknown */
  }
  return { python, bootstrap, appDir, version }
}

export function zapretRuntimeDir(): string {
  return path.join(runtimeDir(), 'zapret')
}

export function zapretBundleDir(): string {
  const rt = zapretRuntimeDir()
  if (existsSync(path.join(rt, 'general.bat')) && existsSync(path.join(rt, 'bin', 'winws.exe'))) return rt
  return path.join(resourcesDir(), 'zapret')
}

export function zapretBinaryPath(): string {
  return path.join(zapretBundleDir(), 'bin', 'winws.exe')
}

export function incyRuntimeDir(): string {
  return path.join(runtimeDir(), 'incy')
}

const coreVersionCache = new Map<string, { mtimeMs: number; version: number[] | null }>()

/** Версия ядра `x.y.z` (sing-box/xray печатают её в `version`). Кэш по mtime. */
function coreVersion(bin: string): number[] | null {
  try {
    const mtimeMs = statSync(bin).mtimeMs
    const cached = coreVersionCache.get(bin)
    if (cached && cached.mtimeMs === mtimeMs) return cached.version
    const r = spawnSync(bin, ['version'], { windowsHide: true, timeout: 5000, encoding: 'utf8' })
    const m = /(\d+)\.(\d+)\.(\d+)/.exec(String(r.stdout ?? ''))
    const version = m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
    coreVersionCache.set(bin, { mtimeMs, version })
    return version
  } catch {
    return null
  }
}

/**
 * Скачанное автообновлением ядро (runtime) или вшитое в сборку — берём НОВЕЕ.
 *
 * Раньше runtime выигрывал всегда. Автообновление ставит только патчи в
 * пределах своей минорной версии, поэтому однажды скачанный sing-box 1.11.x
 * навсегда перекрывал вшитый 1.13: конфиг в новом формате отклонялся, и
 * каждое подключение шло через откат «dns-legacy».
 */
function newerCore(runtimePath: string, bundledPath: string): string {
  const hasRt = existsSync(runtimePath)
  const hasBundled = existsSync(bundledPath)
  if (!hasRt) return bundledPath
  if (!hasBundled) return runtimePath
  const a = coreVersion(runtimePath)
  const b = coreVersion(bundledPath)
  if (!a) return bundledPath
  if (!b) return runtimePath
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i] ? runtimePath : bundledPath
  }
  return runtimePath
}

export function incyBinaryPath(): string {
  return newerCore(path.join(incyRuntimeDir(), 'sing-box.exe'), path.join(resourcesDir(), 'incy', 'sing-box.exe'))
}

/**
 * Path to xray.exe — the second INCY core.
 *
 * Xray carries VLESS / VMess / Trojan / Shadowsocks and is the only core of
 * the two that implements TCP fragmentation and noise packets. sing-box stays
 * responsible for Hysteria2 and for the TUN adapter.
 *
 * Same runtime-first lookup as every other binary: an auto-updated copy in
 * %APPDATA%\lazeyka\runtime\incy wins over the one shipped in the installer.
 */
export function xrayBinaryPath(): string {
  return newerCore(path.join(incyRuntimeDir(), 'xray.exe'), path.join(resourcesDir(), 'incy', 'xray.exe'))
}

/** True when an xray.exe is available in either location. */
export function isXrayAvailable(): boolean {
  try {
    return existsSync(xrayBinaryPath())
  } catch {
    return false
  }
}

/**
 * Directory Xray loads geoip.dat / geosite.dat from. Optional: routing here
 * uses explicit domain lists, so the app works without the asset files.
 */
export function xrayAssetsDir(): string {
  const rt = incyRuntimeDir()
  if (existsSync(path.join(rt, 'geosite.dat')) || existsSync(path.join(rt, 'geoip.dat'))) {
    return rt
  }
  return path.join(resourcesDir(), 'incy')
}