/**
 * Значки игр и программ — для сценариев.
 *
 * Windows:
 *  - игры Steam: библиотеки из libraryfolders.vdf, appmanifest_*.acf, значок —
 *    из кэша Steam (appcache/librarycache) или из exe игры;
 *  - игры Epic Games: манифесты ProgramData\Epic\…\Manifests\*.item;
 *  - ярлыки меню «Пуск» и рабочего стола, ведущие на .exe (без деинсталляторов,
 *    ссылок на сайты и системных утилит Windows).
 * macOS: /Applications, /System/Applications, ~/Applications.
 *
 * Значки достаются строго по одному: app.getFileIcon при параллельных вызовах
 * в Windows возвращает «пустой» стандартный значок.
 */
import { app, nativeImage, shell } from 'electron'
import { execFile } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { extractIcons } from './win-icons'

interface Raw {
  name: string
  path: string
  iconFile: string
  iconIndex?: number
  kind: 'game' | 'app'
}

export interface AppIconEntry {
  name: string
  path: string
  icon: string
  kind: 'game' | 'app'
}

const JUNK =
  /uninst|unins\d|деинстал|удален|удалить|readme|read me|help|справк|manual|руковод|documentation|документац|license|лиценз|eula|website|web site|веб-?сайт|сайт|homepage|скачано|download|setup|install|repair|восстановл|release notes|changelog|what'?s new|feedback|отзыв|report|crash|debug|uninstaller|redistributable|runtime|sdk\b|\bmanual\b/i
const SKIP_STEAM_APP = new Set(['228980', '1070560', '1391110', '1628350', '1493710', '2180100', '961940', '1580130', '1887720'])

let cache: { at: number; list: AppIconEntry[] } | null = null

function readText(file: string): string {
  try {
    return readFileSync(file, 'utf-8')
  } catch {
    return ''
  }
}

function listDir(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

async function iconOf(file: string): Promise<string | null> {
  try {
    const ext = path.extname(file).toLowerCase()
    if (['.png', '.jpg', '.jpeg', '.ico', '.bmp'].includes(ext)) {
      const img = nativeImage.createFromPath(file)
      if (!img.isEmpty()) return img.resize({ width: 64, height: 64, quality: 'best' }).toDataURL()
    }
    const img = await app.getFileIcon(file, { size: 'large' })
    if (img.isEmpty()) return null
    return img.toDataURL()
  } catch {
    return null
  }
}

/* ---------------- Steam ---------------- */

function regQuery(key: string, value: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('reg', ['query', key, '/v', value], { windowsHide: true, timeout: 5000 }, (err, out) => {
      if (err) return resolve(null)
      const m = new RegExp(`${value}\\s+REG_\\w+\\s+(.+)`, 'i').exec(String(out))
      resolve(m ? m[1].trim() : null)
    })
  })
}

function vdfValue(text: string, key: string): string | null {
  const m = new RegExp(`"${key}"\\s+"([^"]*)"`, 'i').exec(text)
  return m ? m[1].replace(/\\\\/g, '\\') : null
}

/** Значок игры из кэша Steam: старый формат <appid>_icon.jpg или новый <appid>/<sha1>.jpg. */
function steamCachedIcon(steam: string, appid: string): string | null {
  const lc = path.join(steam, 'appcache', 'librarycache')
  const old = path.join(lc, `${appid}_icon.jpg`)
  if (isFile(old)) return old
  const dir = path.join(lc, appid)
  const hashed = listDir(dir).find((f) => /^[0-9a-f]{40}\.(jpg|png|ico)$/i.test(f))
  return hashed ? path.join(dir, hashed) : null
}

/** Самый «главный» exe в папке игры (имя похоже на название, иначе самый большой). */
function findGameExe(dir: string, name: string): string | null {
  const exes: { p: string; size: number }[] = []
  let visited = 0
  const walk = (d: string, depth: number): void => {
    if (depth > 4 || exes.length > 200 || ++visited > 1500) return
    for (const it of listDir(d)) {
      const p = path.join(d, it)
      let st
      try {
        st = statSync(p)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        if (!/^(redist|_commonredist|directx|vcredist|dotnet|support|tools|crashreport|easyanticheat|battleye)/i.test(it)) walk(p, depth + 1)
      } else if (/\.exe$/i.test(it) && !/unins|setup|crash|report|launcher_helper|vc_redist|dxsetup|ue4prereq|eac|battleye|helper/i.test(it)) {
        exes.push({ p, size: st.size })
      }
    }
  }
  walk(dir, 0)
  if (exes.length === 0) return null
  const key = name.toLowerCase().replace(/[^a-z0-9]/g, '')
  const byName = exes.find((e) => {
    const b = path.basename(e.p, '.exe').toLowerCase().replace(/[^a-z0-9]/g, '')
    return b.length > 2 && (key.includes(b) || b.includes(key))
  })
  return (byName ?? exes.sort((a, b) => b.size - a.size)[0]).p
}

async function steamGames(): Promise<{ name: string; path: string; iconFile: string }[]> {
  const raw = (await regQuery('HKCU\\Software\\Valve\\Steam', 'SteamPath')) ?? (await regQuery('HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath'))
  if (!raw) return []
  const steam = path.normalize(raw.replace(/\//g, '\\'))
  const out: { name: string; path: string; iconFile: string }[] = []
  const steamExe = path.join(steam, 'steam.exe')
  if (isFile(steamExe)) out.push({ name: 'Steam', path: steamExe, iconFile: steamExe })
  const libs = new Set<string>([steam])
  const vdf = readText(path.join(steam, 'steamapps', 'libraryfolders.vdf'))
  for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/gi)) libs.add(path.normalize(m[1].replace(/\\\\/g, '\\')))
  for (const lib of libs) {
    const apps = path.join(lib, 'steamapps')
    for (const f of listDir(apps)) {
      if (!/^appmanifest_\d+\.acf$/i.test(f)) continue
      const acf = readText(path.join(apps, f))
      const appid = vdfValue(acf, 'appid')
      const name = vdfValue(acf, 'name')
      const dir = vdfValue(acf, 'installdir')
      if (!appid || !name || !dir || SKIP_STEAM_APP.has(appid) || /redistributable|proton|steam linux runtime|steamworks/i.test(name)) continue
      const gameDir = path.join(apps, 'common', dir)
      if (!existsSync(gameDir)) continue
      const cached = steamCachedIcon(steam, appid)
      const exe = cached ? null : findGameExe(gameDir, name)
      const iconFile = cached ?? exe
      if (!iconFile) continue
      out.push({ name, path: exe ?? gameDir, iconFile })
    }
  }
  return out
}

/* ---------------- Epic Games ---------------- */

function epicGames(): { name: string; path: string; iconFile: string }[] {
  const dir = path.join(process.env.ProgramData ?? 'C:\\ProgramData', 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests')
  const out: { name: string; path: string; iconFile: string }[] = []
  for (const f of listDir(dir)) {
    if (!/\.item$/i.test(f)) continue
    try {
      const j = JSON.parse(readText(path.join(dir, f))) as { DisplayName?: string; InstallLocation?: string; LaunchExecutable?: string; bIsApplication?: boolean }
      if (!j.DisplayName || !j.InstallLocation || j.bIsApplication === false) continue
      const exe = j.LaunchExecutable ? path.join(j.InstallLocation, j.LaunchExecutable) : findGameExe(j.InstallLocation, j.DisplayName)
      if (exe && isFile(exe)) out.push({ name: j.DisplayName, path: exe, iconFile: exe })
    } catch {
      /* битый манифест */
    }
  }
  return out
}

/* ---------------- Ярлыки ---------------- */

function shortcutRoots(): string[] {
  const env = process.env
  return [
    env.ProgramData && path.join(env.ProgramData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    env.APPDATA && path.join(env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    path.join(os.homedir(), 'Desktop'),
    env.PUBLIC && path.join(env.PUBLIC, 'Desktop'),
    path.join(os.homedir(), 'OneDrive', 'Desktop'),
    path.join(os.homedir(), 'OneDrive', 'Рабочий стол')
  ].filter((p): p is string => !!p && existsSync(p))
}

function walkShortcuts(dir: string, out: string[], depth = 0): void {
  if (depth > 4 || out.length > 2000) return
  for (const it of listDir(dir)) {
    const p = path.join(dir, it)
    let st
    try {
      st = statSync(p)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      // Служебные папки Windows в меню «Пуск» — не нужны.
      if (!/^(windows (powershell|tools|accessories|administrative|system)|administrative tools|startup|автозагрузка|служебные|стандартные|средства администрирования|accessibility|специальные возможности|maintenance|обслуживание)/i.test(it)) walkShortcuts(p, out, depth + 1)
    } else if (/\.(lnk|url)$/i.test(it)) out.push(p)
  }
}

function shortcutApps(): Raw[] {
  const files: string[] = []
  for (const r of shortcutRoots()) walkShortcuts(r, files)
  const win = (process.env.WINDIR ?? 'C:\\Windows').toLowerCase()
  const out: Raw[] = []
  for (const f of files) {
    const name = path.basename(f, path.extname(f)).trim()
    if (!name || JUNK.test(name)) continue
    if (/\.url$/i.test(f)) {
      // Только игры из лаунчеров (steam://, Epic), а не ссылки на сайты.
      const t = readText(f)
      const url = /^URL=(.+)$/m.exec(t)?.[1]?.trim() ?? ''
      const iconFile = /^IconFile=(.+)$/m.exec(t)?.[1]?.trim()
      if (!/^(steam|com\.epicgames\.launcher|uplay|origin2?|battlenet|eadm|link2ea):/i.test(url) || !iconFile || !isFile(iconFile)) continue
      out.push({ name, path: f, iconFile, kind: 'game' })
      continue
    }
    try {
      const l = shell.readShortcutLink(f)
      const target = l.target ?? ''
      if (!/\.exe$/i.test(target) || !isFile(target)) continue
      if (JUNK.test(path.basename(target)) || target.toLowerCase().startsWith(win)) continue
      // Свой значок ярлыка (в т.ч. из .dll по номеру) или значок самой программы.
      const own = !!l.icon && isFile(l.icon)
      out.push({ name, path: target, iconFile: own ? (l.icon as string) : target, iconIndex: own ? l.iconIndex ?? 0 : 0, kind: 'app' })
    } catch {
      /* битый ярлык */
    }
  }
  return out
}

/* ---------------- macOS ---------------- */

function macApps(): { name: string; path: string; iconFile: string; kind: 'app' }[] {
  const out: { name: string; path: string; iconFile: string; kind: 'app' }[] = []
  for (const r of ['/Applications', '/Applications/Utilities', '/System/Applications', path.join(os.homedir(), 'Applications')]) {
    for (const it of listDir(r)) if (it.endsWith('.app')) out.push({ name: it.replace(/\.app$/, ''), path: path.join(r, it), iconFile: path.join(r, it), kind: 'app' })
  }
  return out
}

/** Игры (Steam, Epic, лаунчеры) и программы со значками; кэш на 10 минут. */
export async function listAppIcons(): Promise<AppIconEntry[]> {
  if (cache && Date.now() - cache.at < 10 * 60_000) return cache.list
  const raw: Raw[] = []
  if (process.platform === 'darwin') raw.push(...macApps())
  else {
    raw.push(...(await steamGames().catch(() => [])).map((g) => ({ ...g, kind: (g.name === 'Steam' ? 'app' : 'game') as 'game' | 'app' })))
    raw.push(...epicGames().map((g) => ({ ...g, kind: 'game' as const })))
    raw.push(...shortcutApps())
  }
  const seenName = new Set<string>()
  const seenPath = new Set<string>()
  const picked = raw.filter((r) => {
    const n = r.name.toLowerCase().replace(/\s+/g, ' ')
    const p = r.path.toLowerCase()
    if (seenName.has(n) || seenPath.has(p)) return false
    seenName.add(n)
    seenPath.add(p)
    return true
  })
  const list: AppIconEntry[] = []
  const isImage = (f: string): boolean => /\.(png|jpe?g|bmp)$/i.test(f)
  // Windows: значки достаём из ресурсов файлов одним вызовом (PrivateExtractIcons) —
  // getFileIcon у части exe (в т.ч. у LAZEYKA) даёт пустой стандартный значок.
  const fromRes =
    process.platform === 'win32'
      ? await extractIcons(picked.map((r) => ({ file: isImage(r.iconFile) ? '' : r.iconFile, index: r.iconIndex ?? 0 })))
      : picked.map(() => null)
  for (let k = 0; k < picked.length; k++) {
    const r = picked[k]
    // Запасной путь — строго по одному (см. комментарий в начале файла).
    const icon = fromRes[k] ?? (await iconOf(r.iconFile))
    if (icon) list.push({ name: r.name, path: r.path, icon, kind: r.kind })
  }
  list.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, 'ru') : a.kind === 'game' ? -1 : 1))
  cache = { at: Date.now(), list }
  return list
}

/** Значок произвольного файла (exe, ярлык, .app, картинка). */
export async function iconForFile(file: string): Promise<string | null> {
  if (!file || !existsSync(file)) return null
  let src = file
  if (/\.lnk$/i.test(file)) {
    try {
      const l = shell.readShortcutLink(file)
      if (l.icon && isFile(l.icon) && !/\.dll$/i.test(l.icon)) src = l.icon
      else if (l.target && isFile(l.target)) src = l.target
    } catch {
      /* как есть */
    }
  } else if (/\.url$/i.test(file)) {
    const f = /^IconFile=(.+)$/m.exec(readText(file))?.[1]?.trim()
    if (f && isFile(f)) src = f
  }
  if (process.platform === 'win32' && !/\.(png|jpe?g|bmp)$/i.test(src)) {
    const [png] = await extractIcons([{ file: src, index: 0 }])
    if (png) return png
  }
  return iconOf(src)
}
