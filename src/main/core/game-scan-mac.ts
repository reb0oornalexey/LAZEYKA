/**
 * Поиск установленных игр на macOS для ExitLag.
 *
 *  - Steam: ~/Library/Application Support/Steam/steamapps/libraryfolders.vdf и
 *    appmanifest_*.acf — как на Windows; игры без Mac-версии (в папке нет
 *    бандла `.app`) пропускаются.
 *  - Epic: манифесты ~/Library/Application Support/Epic/EpicGamesLauncher/Data/Manifests.
 *  - «Программы»: приложения в /Applications и ~/Applications с категорией «Игры»
 *    (LSApplicationCategoryType, например League of Legends).
 *
 * Записью списка ExitLag служит путь бандла `.app`: он совпадает и с самой
 * игрой, и с процессами-помощниками внутри.
 */
import { execFile } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { InstalledGame } from './game-scan'

const SKIP_APP = /(redistributable|steamworks common|proton|steam linux runtime|steamvr|dedicated server|soundtrack|sdk\b)/i
/** Не игры среди бандлов: установщики, отчёты о падениях, служебные утилиты. */
const SKIP_BUNDLE = /(unins|setup|install|redist|crash|report|helper|updater|launcher_?config|config|benchmark|prereq|steamvr)/i

/** Папка Steam (installdir, нижний регистр) → бандл игры (по имени, без пути). */
const KNOWN_APP: Record<string, string> = {
  'dota 2 beta': 'dota.app'
}

function vdfValues(text: string, key: string): string[] {
  const re = new RegExp(`"${key}"\\s+"([^"]*)"`, 'gi')
  return [...text.matchAll(re)].map((m) => m[1].replace(/\\\\/g, '\\'))
}

/** Бандлы `.app` в папке игры (глубина до 4, внутрь бандлов не заходим). */
export function findAppBundles(dir: string, max = 3): string[] {
  const found: string[] = []
  const walk = (d: string, depth: number): void => {
    if (depth > 4 || found.length >= 50) return
    let entries: import('node:fs').Dirent[]
    try {
      entries = readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue
      const full = path.join(d, e.name)
      if (/\.app$/i.test(e.name)) {
        if (!SKIP_BUNDLE.test(e.name)) found.push(full)
      } else {
        walk(full, depth + 1)
      }
    }
  }
  walk(dir, 0)
  return found.slice(0, max)
}

function scanSteamMac(): InstalledGame[] {
  const root = path.join(os.homedir(), 'Library', 'Application Support', 'Steam')
  if (!existsSync(root)) return []
  const libs = new Map<string, string>([[root.toLowerCase(), root]])
  try {
    const vdf = readFileSync(path.join(root, 'steamapps', 'libraryfolders.vdf'), 'utf-8')
    for (const p of vdfValues(vdf, 'path')) {
      const n = path.normalize(p)
      if (!libs.has(n.toLowerCase())) libs.set(n.toLowerCase(), n)
    }
  } catch { /* одна библиотека */ }

  const games: InstalledGame[] = []
  for (const lib of libs.values()) {
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
        let bundles = findAppBundles(dir, 10)
        const known = KNOWN_APP[installdir.toLowerCase()]
        const hit = known ? bundles.find((b) => path.basename(b).toLowerCase() === known) : undefined
        if (hit) bundles = [hit, ...bundles.filter((b) => b !== hit)]
        bundles = bundles.slice(0, 3)
        // Нет бандла — у игры нет версии для Mac (только Windows/Linux).
        if (bundles.length > 0) games.push({ name, source: 'Steam', dir, exes: bundles })
      } catch { /* битый манифест */ }
    }
  }
  return games
}

function scanEpicMac(): InstalledGame[] {
  const dir = path.join(os.homedir(), 'Library', 'Application Support', 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests')
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
      const bundles = findAppBundles(loc, 3)
      if (bundles.length > 0) games.push({ name, source: 'Epic', dir: loc, exes: bundles })
    } catch { /* битый манифест */ }
  }
  return games
}

function plistKey(plist: string, key: string): Promise<string> {
  return new Promise((resolve) => {
    execFile('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', plist], { timeout: 4000 }, (err, stdout) =>
      resolve(err ? '' : String(stdout).trim())
    )
  })
}

/** Приложения-игры из «Программ» по категории в Info.plist. */
async function scanApplicationsMac(): Promise<InstalledGame[]> {
  const roots = ['/Applications', path.join(os.homedir(), 'Applications')]
  const bundles: string[] = []
  for (const r of roots) {
    try {
      for (const e of readdirSync(r, { withFileTypes: true })) {
        if (e.isDirectory() && /\.app$/i.test(e.name)) bundles.push(path.join(r, e.name))
      }
    } catch { /* нет каталога */ }
  }
  const games: InstalledGame[] = []
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < bundles.length) {
      const b = bundles[next++]
      const cat = await plistKey(path.join(b, 'Contents', 'Info.plist'), 'LSApplicationCategoryType')
      if (/games/i.test(cat)) {
        games.push({ name: path.basename(b).replace(/\.app$/i, ''), source: 'Mac', dir: path.dirname(b), exes: [b] })
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(8, bundles.length) }, worker))
  return games
}

export async function scanInstalledGamesMac(): Promise<InstalledGame[]> {
  const [steam, epic, apps] = await Promise.all([
    Promise.resolve().then(scanSteamMac).catch(() => [] as InstalledGame[]),
    Promise.resolve().then(scanEpicMac).catch(() => [] as InstalledGame[]),
    scanApplicationsMac().catch(() => [] as InstalledGame[])
  ])
  // Игра из Steam/Epic уже в списке — второй раз из «Программ» не показываем.
  const have = new Set([...steam, ...epic].flatMap((g) => g.exes.map((e) => path.basename(e).toLowerCase())))
  const extra = apps.filter((g) => !have.has(path.basename(g.exes[0]).toLowerCase()))
  return [...steam, ...epic, ...extra].sort((a, b) => a.name.localeCompare(b.name))
}
