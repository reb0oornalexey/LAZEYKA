import { app, BrowserWindow, dialog, nativeImage, net, nativeTheme, protocol, screen, systemPreferences } from 'electron'
import { copyFile, open, readFile, readdir, stat, unlink, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'
import { backgroundsDir } from '../utils/dirs'
import { patchAppConfig } from '../config/app'
import { setNativeTheme } from './theme'

export const BG_SCHEME = 'lazeyka-bg'
// «-a» перед расширением — анимированный файл (GIF / анимированный WebP или APNG).
const BG_NAME_RE = /^bg-[a-z0-9]{6,24}(-a)?\.(png|jpe?g|webp|gif|mp4|webm)$/
// Встроенные обои хранятся как `builtin:<имя>`; сами картинки вшиты в приложение.
const BUILTIN_BG_RE = /^builtin:[a-z0-9-]{1,24}$/
const MAX_STATIC_BYTES = 25 * 1024 * 1024
const MAX_ANIMATED_BYTES = 30 * 1024 * 1024
const MAX_VIDEO_BYTES = 50 * 1024 * 1024
const MAX_THEME_BYTES = 1024 * 1024

/** Схему нужно объявить до app.ready. */
export function registerBackgroundScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: BG_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
  ])
}

/** lazeyka-bg://img/<имя файла> → файл из папки backgrounds (и только оттуда). */
export function registerBackgroundProtocol(): void {
  protocol.handle(BG_SCHEME, async (req) => {
    try {
      const name = path.basename(decodeURIComponent(new URL(req.url).pathname))
      if (!BG_NAME_RE.test(name)) return new Response('bad request', { status: 400 })
      const full = path.join(backgroundsDir(), name)
      if (!existsSync(full)) return new Response('not found', { status: 404 })
      // Range нужен видео (перемотка / зацикливание); CORS — чтобы страница могла
      // снять кадр для палитры и «замороженного» фона.
      const res = await net.fetch(pathToFileURL(full).toString(), {
        headers: req.headers,
        bypassCustomProtocolHandlers: true
      })
      const headers = new Headers(res.headers)
      headers.set('Access-Control-Allow-Origin', '*')
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
    } catch {
      return new Response('error', { status: 500 })
    }
  })
}

// ---- Проверка данных из конфига / от интерфейса ----------------------------------

const DEFAULTS: AppearanceSettings = {
  fontScale: 1,
  fontFamily: 'onest',
  fontCustom: '',
  radius: 0.75,
  density: 'normal',
  animations: 'on',
  sidebarWidth: 212,
  bgImage: '',
  bgFit: 'cover',
  bgBlur: 0,
  bgDim: 0.3,
  bgBrightness: 1,
  bgSaturation: 1,
  bgGlass: false,
  bgDimColor: '#000000',
  panelOpacity: 1,
  bgGradient: false,
  bgGradientFrom: '#0b0d10',
  bgGradientTo: '#1b2a4a',
  bgGradientAngle: 135,
  bgAnimate: true,
  bgPauseOnBlur: true
}

const FONT_IDS = ['onest', 'system', 'segoe', 'arial', 'verdana', 'tahoma', 'trebuchet', 'georgia', 'consolas', 'custom']

const num = (v: unknown, min: number, max: number, def: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def
const oneOf = <T extends string>(v: unknown, list: readonly T[], def: T): T =>
  typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : def
const safeColor = (v: unknown, def: string): string =>
  typeof v === 'string' && v.length <= 160 && /^[#a-zA-Z0-9(),.%\s/+-]+$/.test(v) && !/url\(/i.test(v) ? v : def
const KEY_RE = /^[a-z0-9-]{1,48}$/

function sanitizeTokens(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!raw || typeof raw !== 'object') return out
  let n = 0
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (n >= 200) break
    if (KEY_RE.test(k) && typeof v === 'string') {
      const c = safeColor(v, '')
      if (c) {
        out[k] = c
        n++
      }
    }
  }
  return out
}

export function sanitizeSettings(raw: unknown): AppearanceSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const image = typeof r.bgImage === 'string' && (BG_NAME_RE.test(r.bgImage) || BUILTIN_BG_RE.test(r.bgImage)) ? r.bgImage : ''
  const custom = typeof r.fontCustom === 'string' ? r.fontCustom.replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 40) : ''
  return {
    fontScale: num(r.fontScale, 0.85, 1.3, DEFAULTS.fontScale),
    fontFamily: oneOf(r.fontFamily, FONT_IDS, 'onest'),
    fontCustom: custom,
    radius: num(r.radius, 0, 1.5, DEFAULTS.radius),
    density: oneOf(r.density, ['compact', 'normal', 'comfortable'] as const, 'normal'),
    animations: oneOf(r.animations, ['on', 'off', 'auto'] as const, 'on'),
    sidebarWidth: Math.round(num(r.sidebarWidth, 180, 300, DEFAULTS.sidebarWidth)),
    bgImage: image,
    // Прежний вариант «center» убран: такие настройки превращаются в «cover».
    bgFit: oneOf(r.bgFit, ['cover', 'contain', 'tile'] as const, 'cover'),
    bgBlur: num(r.bgBlur, 0, 40, 0),
    bgDim: num(r.bgDim, 0, 0.9, DEFAULTS.bgDim),
    bgBrightness: num(r.bgBrightness, 0.5, 1.5, 1),
    bgSaturation: num(r.bgSaturation, 0, 2, 1),
    bgGlass: r.bgGlass === true,
    bgDimColor: safeColor(r.bgDimColor, DEFAULTS.bgDimColor),
    panelOpacity: num(r.panelOpacity, 0, 1, 1),
    bgGradient: r.bgGradient === true,
    bgGradientFrom: safeColor(r.bgGradientFrom, DEFAULTS.bgGradientFrom),
    bgGradientTo: safeColor(r.bgGradientTo, DEFAULTS.bgGradientTo),
    bgGradientAngle: num(r.bgGradientAngle, 0, 360, DEFAULTS.bgGradientAngle),
    bgAnimate: r.bgAnimate !== false,
    bgPauseOnBlur: r.bgPauseOnBlur !== false
  }
}

const ID_RE = /^[a-z0-9-]{1,40}$/

function sanitizeSystem(raw: unknown): AppearanceSystemOptions {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const id = (v: unknown, def: string): string => (typeof v === 'string' && ID_RE.test(v) ? v : def)
  return {
    follow: r.follow === true,
    lightPreset: id(r.lightPreset, 'light'),
    darkPreset: id(r.darkPreset, 'dark'),
    accent: r.accent === true
  }
}

/**
 * Приводит оформление из конфига к корректному виду. Если поля ещё нет (старый
 * конфиг), строит его из прежнего `appTheme` — «dark» → пресет «Тёмная», «light» → «Светлая».
 */
export function sanitizeAppearance(raw: unknown, appTheme: AppTheme | undefined): AppearanceConfig {
  const r = (raw && typeof raw === 'object' ? raw : null) as Record<string, unknown> | null
  const legacy: AppearanceMode = appTheme === 'light' ? 'light' : 'dark'
  if (!r) {
    return { version: 1, presetId: legacy, mode: legacy, tokens: {}, settings: { ...DEFAULTS }, custom: [], recentColors: [], system: sanitizeSystem(null) }
  }
  const custom: CustomAppearanceTheme[] = []
  if (Array.isArray(r.custom)) {
    for (const c of r.custom.slice(0, 30)) {
      if (!c || typeof c !== 'object') continue
      const x = c as Record<string, unknown>
      if (typeof x.id !== 'string' || !ID_RE.test(x.id)) continue
      custom.push({
        id: x.id,
        name: typeof x.name === 'string' ? x.name.slice(0, 40) : 'Тема',
        mode: x.mode === 'light' ? 'light' : 'dark',
        tokens: sanitizeTokens(x.tokens),
        settings: sanitizeSettings(x.settings)
      })
    }
  }
  const mode: AppearanceMode = r.mode === 'light' ? 'light' : r.mode === 'dark' ? 'dark' : legacy
  const presetId = typeof r.presetId === 'string' && ID_RE.test(r.presetId) ? r.presetId : mode
  const recent = Array.isArray(r.recentColors)
    ? r.recentColors.filter((c): c is string => typeof c === 'string' && safeColor(c, '') !== '').slice(0, 10)
    : []
  return {
    version: 1,
    presetId,
    mode,
    tokens: sanitizeTokens(r.tokens),
    settings: sanitizeSettings(r.settings),
    custom,
    recentColors: recent,
    system: sanitizeSystem(r.system)
  }
}

// ---- Сохранение и файлы ---------------------------------------------------------

export async function saveAppearance(raw: unknown): Promise<void> {
  const a = sanitizeAppearance(raw, undefined)
  // Ключ с «!» заменяет объект целиком (иначе deepMerge не смог бы удалить правки токенов).
  await patchAppConfig({ appTheme: a.mode, ['appearance!' as 'appearance']: a } as Partial<AppConfig>)
  setNativeTheme(a.system.follow ? 'system' : a.mode)
}

function parentWindow(): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
}

type BgKind = 'static' | 'animated' | 'video'

/** Анимированный ли WebP / APNG — по заголовку файла, без декодирования. */
async function sniffAnimated(file: string, ext: string): Promise<boolean> {
  if (ext === 'gif') return true
  const fh = await open(file, 'r')
  try {
    const buf = Buffer.alloc(65536)
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0)
    const head = buf.subarray(0, bytesRead)
    if (ext === 'webp') {
      return head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 12, 16) === 'VP8X' && (head[20] & 0x02) !== 0
    }
    if (ext === 'png') {
      const ac = head.indexOf('acTL', 0, 'latin1')
      const idat = head.indexOf('IDAT', 0, 'latin1')
      return ac >= 0 && (idat < 0 || ac < idat)
    }
    return false
  } finally {
    await fh.close()
  }
}

const mb = (n: number): string => `${Math.round(n / 1024 / 1024)} МБ`

/** Самый большой экран в физических пикселях. */
function maxScreenPixels(): { w: number; h: number } {
  let w = 0
  let h = 0
  for (const d of screen.getAllDisplays()) {
    w = Math.max(w, Math.round(d.size.width * d.scaleFactor))
    h = Math.max(h, Math.round(d.size.height * d.scaleFactor))
  }
  return { w: w || 1920, h: h || 1080 }
}

/**
 * Диалог выбора фона. Файл копируется в папку данных, возвращается только имя.
 * Лимиты: статичная картинка 25 МБ, GIF / анимированный WebP / APNG 30 МБ, видео
 * 50 МБ. Статичные картинки крупнее экрана уменьшаются (nativeImage); анимированные
 * файлы и видео не перекодируются, чтобы не потерять анимацию.
 */
export async function pickBackground(): Promise<string | null> {
  const win = parentWindow()
  const opts: Electron.OpenDialogOptions = {
    title: 'Выберите картинку или видео для фона',
    properties: ['openFile'],
    filters: [
      { name: 'Картинки и видео', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'mp4', 'webm'] }
    ]
  }
  const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  if (res.canceled || !res.filePaths[0]) return null
  const src = res.filePaths[0]
  const ext = path.extname(src).slice(1).toLowerCase().replace('jpeg', 'jpg')
  if (!['png', 'jpg', 'webp', 'gif', 'mp4', 'webm'].includes(ext)) {
    throw new Error('Поддерживаются png, jpg, webp, gif, mp4 и webm')
  }
  const size = (await stat(src)).size
  const kind: BgKind = ext === 'mp4' || ext === 'webm' ? 'video' : (await sniffAnimated(src, ext)) ? 'animated' : 'static'
  const limit = kind === 'video' ? MAX_VIDEO_BYTES : kind === 'animated' ? MAX_ANIMATED_BYTES : MAX_STATIC_BYTES
  if (size > limit) {
    throw new Error(
      `Файл слишком большой: ${mb(size)}. Максимум для ${
        kind === 'video' ? 'видео' : kind === 'animated' ? 'анимации (GIF / WebP / APNG)' : 'картинки'
      } — ${mb(limit)}.`
    )
  }
  const id = `bg-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const dir = backgroundsDir()
  if (kind !== 'static') {
    const name = `${id}${kind === 'animated' ? '-a' : ''}.${ext}`
    await copyFile(src, path.join(dir, name))
    return name
  }
  // Статичная картинка: уменьшаем, если она больше самого большого экрана.
  try {
    const img = nativeImage.createFromPath(src)
    if (!img.isEmpty()) {
      const { width, height } = img.getSize()
      const m = maxScreenPixels()
      if (width > m.w || height > m.h) {
        const f = Math.min(m.w / width, m.h / height)
        const small = img.resize({ width: Math.max(1, Math.round(width * f)), height: Math.max(1, Math.round(height * f)), quality: 'best' })
        const asJpeg = ext === 'jpg'
        const name = `${id}.${asJpeg ? 'jpg' : 'png'}`
        await writeFile(path.join(dir, name), asJpeg ? small.toJPEG(92) : small.toPNG())
        return name
      }
    }
  } catch {
    /* не получилось уменьшить — копируем как есть */
  }
  const name = `${id}.${ext}`
  await copyFile(src, path.join(dir, name))
  return name
}

// ---- Системная тема и акцент Windows (только по событиям, без опроса) ------------

export interface SystemAppearanceInfo {
  dark: boolean
  /** #rrggbb или null, если система не отдаёт акцентный цвет. */
  accent: string | null
}

export function getSystemAppearance(): SystemAppearanceInfo {
  let accent: string | null = null
  try {
    if (process.platform === 'win32' || process.platform === 'darwin') {
      const c = systemPreferences.getAccentColor()
      if (/^[0-9a-f]{6,8}$/i.test(c)) accent = `#${c.slice(0, 6).toLowerCase()}`
    }
  } catch {
    /* noop */
  }
  return { dark: nativeTheme.shouldUseDarkColors, accent }
}

function broadcastSystem(): void {
  const info = getSystemAppearance()
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('appearance:systemChanged', info)
  }
}

export function initSystemAppearanceEvents(): void {
  nativeTheme.on('updated', broadcastSystem)
  try {
    systemPreferences.on('accent-color-changed', broadcastSystem)
  } catch {
    /* событие есть не на всех платформах */
  }
}

export async function exportThemeFile(json: string, suggested: string): Promise<boolean> {
  const win = parentWindow()
  const safe = suggested.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40) || 'theme'
  const opts: Electron.SaveDialogOptions = {
    title: 'Экспорт темы',
    defaultPath: path.join(app.getPath('documents'), `${safe}.lazeyka-theme.json`),
    filters: [{ name: 'Тема LAZEYKA', extensions: ['json'] }]
  }
  const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
  if (res.canceled || !res.filePath) return false
  await writeFile(res.filePath, json, 'utf-8')
  return true
}

export async function importThemeFile(): Promise<string | null> {
  const win = parentWindow()
  const opts: Electron.OpenDialogOptions = {
    title: 'Импорт темы',
    properties: ['openFile'],
    filters: [{ name: 'Тема LAZEYKA', extensions: ['json'] }]
  }
  const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  if (res.canceled || !res.filePaths[0]) return null
  const info = await stat(res.filePaths[0])
  if (info.size > MAX_THEME_BYTES) throw new Error('Файл темы слишком большой')
  return await readFile(res.filePaths[0], 'utf-8')
}

// ---- Загруженные пользователем обои ---------------------------------------------

/** Имена загруженных файлов фона (новые первыми: имя начинается с времени в base36). */
export async function listBackgrounds(): Promise<string[]> {
  try {
    const files = (await readdir(backgroundsDir())).filter((f) => BG_NAME_RE.test(f))
    return files.sort().reverse()
  } catch {
    return []
  }
}

/** Удаляет один загруженный файл фона (только из своей папки, только по строгому имени). */
export async function removeBackground(name: string): Promise<void> {
  if (!BG_NAME_RE.test(name)) throw new Error('Недопустимое имя файла')
  await unlink(path.join(backgroundsDir(), name)).catch(() => undefined)
}
