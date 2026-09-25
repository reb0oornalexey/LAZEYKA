/**
 * Поиск установленных игр для ExitLag: библиотеки Steam и Epic Games.
 *
 * Steam: путь берётся из реестра, список библиотек — из
 * steamapps/libraryfolders.vdf, игры — из appmanifest_*.acf. Какой .exe
 * запускает игру, Steam не хранит, поэтому в папке игры ищутся исполняемые
 * файлы (без установщиков, репортеров падений, античитов и т. п.), крупные —
 * первыми: у игр главный exe почти всегда самый большой.
 *
 * Epic: манифесты в C:\ProgramData\Epic\EpicGamesLauncher\Data\Manifests
 * содержат LaunchExecutable; дополнительно берутся *-Shipping.exe (у игр на
 * Unreal настоящий процесс игры — он, а не лаунчер).
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { decodeConsole } from '../utils/console-decode'

const execFileAsync = promisify(execFile)

export interface InstalledGame {
  name: string
  source: 'Steam' | 'Epic'
  dir: string
  /** Исполняемые файлы игры, главный — первым. */
  exes: string[]
}

/** Не игры: установщики, отчёты о падениях, античиты, служебные утилиты. */
const SKIP_EXE =
  /(unins|setup|install|redist|vcredist|vc_|dxsetup|directx|dotnet|crash|report|bugsplat|helper|updater|update|easyanticheat|eac_|battleye|be_service|unitycrashhandler|cefprocess|webhelper|7z|python|java|node\.exe|ffmpeg|benchmark|config|settings|touchup|cleanup|prereq|vr_|steamvr)/i

/** Папка Steam (installdir, нижний регистр) → процесс игры. */
const KNOWN_EXE: Record<string, string> = {
  'counter-strike global offensive': 'cs2.exe',
  'dota 2 beta': 'dota2.exe',
  pubg: 'TslGame.exe',
  'apex legends': 'r5apex.exe',
  rust: 'RustClient.exe',
  'team fortress 2': 'tf_win64.exe',
  'deadlock': 'deadlock.exe',
  'naraka': 'NarakaBladepoint.exe',
  'escape from tarkov': 'EscapeFromTarkov.exe',
  'call of duty hq': 'cod.exe',
  'marvel rivals': 'Marvel-Win64-Shipping.exe',
  'the finals': 'Discovery.exe'
}

/** Не игры среди приложений Steam. */
const SKIP_APP = /(redistributable|steamworks common|proton|steam linux runtime|steamvr|dedicated server|soundtrack|sdk\b)/i

async function regQuery(key: string, value: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('reg.exe', ['query', key, '/v', value], {
      windowsHide: true,
      timeout: 4000,
      encoding: 'buffer'
    })
    const out = decodeConsole(stdout as Buffer)
    const m = new RegExp(`${value}\\s+REG_\\w+\\s+(.+)$`, 'im').exec(out)
    return m ? m[1].trim() : null
  } catch {
    return null
  }
}

/** Значения `"ключ"  "значение"` из текстового формата Valve (VDF/ACF). */
function vdfValues(text: string, key: string): string[] {
  const re = new RegExp(`"${key}"\\s+"([^"]*)"`, 'gi')
  return [...text.matchAll(re)].map((m) => m[1].replace(/\\\\/g, '\\'))
}

/** Исполняемые файлы в папке игры до глубины 4, крупные первыми. */
function findExes(dir: string, max = 3): string[] {
  const found: { name: string; size: number }[] = []
  const walk = (d: string, depth: number): void => {
    if (depth > 4 || found.length > 200) return
    let entries: import('node:fs').Dirent[]
    try {
      entries = readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const full = path.join(d, e.name)
      if (e.isDirectory()) {
        if (/^(_commonredist|redist|redistributables|directx|dotnetfx|support|tools|docs?|manual|__installer|installers?|prereq)/i.test(e.name)) continue
        walk(full, depth + 1)
      } else if (/\.exe$/i.test(e.name) && !SKIP_EXE.test(e.name)) {
        try {
          found.push({ name: e.name, size: statSync(full).size })
        } catch { /* нет доступа */ }
      }
    }
  }
  walk(dir, 0)
  const seen = new Set<string>()
  return found
    .sort((a, b) => b.size - a.size)
    .filter((f) => {
      const k = f.name.toLowerCase()
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
    .slice(0, max)
    .map((f) => f.name)
}

async function scanSteam(): Promise<InstalledGame[]> {
  const steamPath =
    (await regQuery('HKCU\\Software\\Valve\\Steam', 'SteamPath')) ??
    (await regQuery('HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath'))
  if (!steamPath) return []
  const root = path.normalize(steamPath.replace(/\//g, '\\'))
  // Ключ — путь в нижнем регистре: SteamPath из реестра пишется как
  // «c:/program files (x86)/steam», а в libraryfolders.vdf тот же путь с
  // заглавными буквами — без этого игры основной библиотеки шли дважды.
  const libMap = new Map<string, string>([[root.toLowerCase(), root]])
  try {
    const vdf = readFileSync(path.join(root, 'steamapps', 'libraryfolders.vdf'), 'utf-8')
    for (const p of vdfValues(vdf, 'path')) {
      const n = path.normalize(p)
      if (!libMap.has(n.toLowerCase())) libMap.set(n.toLowerCase(), n)
    }
  } catch { /* одна библиотека */ }
  const libs = [...libMap.values()]

  const games: InstalledGame[] = []
  for (const lib of libs) {
    const apps = path.join(lib, 'steamapps')
    let files: string[] = []
    try {
      files = readdirSync(apps).filter((f) => /^appmanifest_\d+\.acf$/i.test(f))
    } catch {
      continue
    }
    for (const f of files) {
      try {
        const acf = readFileSync(path.join(apps, f), 'utf-8')
        const name = vdfValues(acf, 'name')[0]
        const installdir = vdfValues(acf, 'installdir')[0]
        if (!name || !installdir || SKIP_APP.test(name)) continue
        const dir = path.join(apps, 'common', installdir)
        if (!existsSync(dir)) continue
        const all = findExes(dir, 200)
        let exes = all.slice(0, 3)
        // Для популярных игр главный процесс известен точно (у CS2 он не самый
        // большой файл в папке) — ставим его первым, если он там есть.
        const known = KNOWN_EXE[installdir.toLowerCase()]
        const hit = known ? all.find((e) => e.toLowerCase() === known.toLowerCase()) : undefined
        if (hit) exes = [hit, ...all.filter((e) => e !== hit)].slice(0, 3)
        if (exes.length > 0) games.push({ name, source: 'Steam', dir, exes })
      } catch { /* битый манифест */ }
    }
  }
  return games
}

function scanEpic(): InstalledGame[] {
  const dir = path.join(process.env.ProgramData || 'C:\\ProgramData', 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests')
  let files: string[] = []
  try {
    files = readdirSync(dir).filter((f) => /\.item$/i.test(f))
  } catch {
    return []
  }
  const games: InstalledGame[] = []
  for (const f of files) {
    try {
      const m = JSON.parse(readFileSync(path.join(dir, f), 'utf-8'))
      const name = String(m.DisplayName ?? '')
      const loc = String(m.InstallLocation ?? '')
      if (!name || !loc || !existsSync(loc)) continue
      const exes: string[] = []
      const shipping = findExes(loc, 6).filter((e) => /shipping/i.test(e))
      exes.push(...shipping)
      const launch = m.LaunchExecutable ? path.win32.basename(String(m.LaunchExecutable)) : ''
      if (launch && !exes.some((e) => e.toLowerCase() === launch.toLowerCase())) exes.push(launch)
      if (exes.length === 0) exes.push(...findExes(loc))
      if (exes.length > 0) games.push({ name, source: 'Epic', dir: loc, exes: exes.slice(0, 3) })
    } catch { /* битый манифест */ }
  }
  return games
}

export async function scanInstalledGames(): Promise<InstalledGame[]> {
  if (process.platform !== 'win32') return []
  const [steam, epic] = await Promise.all([scanSteam().catch(() => []), Promise.resolve().then(scanEpic).catch(() => [])])
  return [...steam, ...epic].sort((a, b) => a.name.localeCompare(b.name))
}
