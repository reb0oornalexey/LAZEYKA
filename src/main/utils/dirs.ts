import { is } from '@electron-toolkit/utils'
import { existsSync, mkdirSync, statSync } from 'fs'
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
  // Check runtime dir first (downloaded updates), fall back to bundled resources/.
  const rt = path.join(tgwsRuntimeDir(), 'TgWsProxy_windows.exe')
  try {
    if (existsSync(rt) && statSync(rt).size > 1024 * 1024) return rt
  } catch { /* fallback */ }
  return path.join(resourcesDir(), 'tgws', 'TgWsProxy_windows.exe')
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

export function incyBinaryPath(): string {
  const rt = path.join(incyRuntimeDir(), 'sing-box.exe')
  if (existsSync(rt)) return rt
  return path.join(resourcesDir(), 'incy', 'sing-box.exe')
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
  const rt = path.join(incyRuntimeDir(), 'xray.exe')
  if (existsSync(rt)) return rt
  return path.join(resourcesDir(), 'incy', 'xray.exe')
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