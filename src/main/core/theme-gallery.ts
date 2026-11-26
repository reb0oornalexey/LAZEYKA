/**
 * Галерея тем: список из публичного репозитория на GitHub, кэш на диске,
 * установка чужой темы (с обоями) и подготовка своей темы к отправке.
 *
 * Чужое содержимое никогда не применяется как есть: тема проходит через
 * sanitizeAppearance (resolve/appearance.ts), обои проверяются по сигнатуре
 * файла, пути и ссылки из index.json — по строгим правилам (hub-pure.ts).
 */
import { BrowserWindow, net } from 'electron'
import { mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { backgroundsDir, dataDir } from '../utils/dirs'
import { sanitizeAppearance } from '../resolve/appearance'
import {
  HUB_URL,
  IMAGE_EXT,
  IMAGE_MIME,
  THEMES_RAW_BASE,
  antiCacheUrl,
  isAnimatedImage,
  parseGalleryIndex,
  sniffImage,
  themeNameProblem,
  type GalleryEntry,
  type ImageKind
} from './hub-pure'

/** Основной источник: Worker отдаёт свежий индекс (CDN GitHub кэширует raw-файлы минут на пять). */
export const GALLERY_HUB_URL = `${HUB_URL}/themes`
/** Запасной: прежний адрес; к нему добавляется параметр-антикэш. */
export const GALLERY_INDEX_URL = `${THEMES_RAW_BASE}index.json`

/** Без нажатия «Обновить» локальный список считается свежим 5 минут. «Обновить» кэш не использует. */
const REFRESH_MS = 60_000
const MAX_INDEX_BYTES = 1024 * 1024
export const MAX_THEME_JSON_BYTES = 200 * 1024
export const MAX_WALLPAPER_BYTES = 3 * 1024 * 1024
export const MAX_PREVIEW_BYTES = 400 * 1024
const MAX_PREVIEW_DOWNLOAD = 500 * 1024

export interface GalleryItem {
  id: string
  name: string
  author: string
  at: number
  hasWallpaper: boolean
  /** Лайков на сервере; null — счётчик неизвестен (список пришёл с запасного адреса или от старого Hub). */
  likes: number | null
}

export interface GalleryView {
  themes: GalleryItem[]
  /** Сколько тем в галерее всего (в themes может быть только начало списка). */
  total: number
  /** В themes весь список (иначе — только самые новые). */
  complete: boolean
  updated: number | string | null
  fetchedAt: number
  /** Показан сохранённый список: свежий скачать не удалось. */
  stale: boolean
  /** Репозиторий пуст или index.json ещё не создан. */
  empty: boolean
  error?: string
}

export interface InstallResult {
  /** Тема в формате файла «Экспорт темы», уже проверенная sanitizeAppearance. Подаётся в importTheme. */
  themeJson: string
  /** Что поставить в bgImage после импорта: имя скачанного файла обоев, `builtin:…` или пустая строка. */
  bgImage: string
  name: string
  author: string
  /** Предупреждение, если что-то (например, обои) поставить не удалось. */
  warning?: string
}

// ---- Диск ---------------------------------------------------------------------------------------

function cacheDir(): string {
  return path.join(dataDir(), 'hub', 'gallery')
}
const indexFile = (): string => path.join(cacheDir(), 'index.json')

interface CachedIndex {
  fetchedAt: number
  updated: number | string | null
  entries: GalleryEntry[]
  /** Всего тем на сервере. */
  total: number
  /** entries — весь список, а не только начало. */
  complete: boolean
}

/** Сколько самых новых тем нужно блоку в «Оформлении». */
export const GALLERY_HEAD = 4
/** Размер страницы при загрузке всего списка с Hub. */
const PAGE = 100
const MAX_THEMES = 500

let memory: CachedIndex | null = null
let loadedFromDisk = false

async function readCache(): Promise<CachedIndex | null> {
  if (memory) return memory
  if (loadedFromDisk) return null
  loadedFromDisk = true
  try {
    const raw = JSON.parse(await readFile(indexFile(), 'utf-8')) as { fetchedAt?: number; index?: unknown; total?: number; complete?: boolean }
    const parsed = parseGalleryIndex(raw.index)
    const complete = raw.complete !== false
    memory = {
      fetchedAt: typeof raw.fetchedAt === 'number' ? raw.fetchedAt : 0,
      updated: parsed.updated,
      entries: parsed.themes,
      total: complete ? parsed.themes.length : Math.max(parsed.themes.length, Number(raw.total) || 0),
      complete
    }
    return memory
  } catch {
    return null
  }
}

async function writeCache(fetchedAt: number, rawIndex: unknown, parsed: ReturnType<typeof parseGalleryIndex>, total: number, complete: boolean): Promise<void> {
  memory = { fetchedAt, updated: parsed.updated, entries: parsed.themes, total: complete ? parsed.themes.length : total, complete }
  try {
    await mkdir(cacheDir(), { recursive: true })
    await writeFile(indexFile(), JSON.stringify({ fetchedAt, index: rawIndex, total, complete }), 'utf-8')
    // Превью тем, которых в списке больше нет, не копим (только когда известен весь список).
    if (!complete) return
    const keep = new Set(parsed.themes.map((t) => t.id))
    for (const f of await readdir(cacheDir())) {
      const m = /^(?:preview|wall)-([A-Za-z0-9_-]+)\.(png|jpg|webp)$/.exec(f)
      if (m && !keep.has(m[1])) await unlink(path.join(cacheDir(), f)).catch(() => undefined)
    }
  } catch {
    /* кэш не критичен */
  }
}

// ---- Загрузка с ограничениями -----------------------------------------------------------------

class HttpError extends Error {
  constructor(public status: number) {
    super(`HTTP ${status}`)
  }
}

const hostAllowed = (host: string): boolean => host === 'github.com' || host === 'raw.githubusercontent.com' || host.endsWith('.githubusercontent.com')

async function readLimited(res: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(res.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error('Файл больше допустимого размера')
  if (!res.body) {
    const b = Buffer.from(await res.arrayBuffer())
    if (b.length > maxBytes) throw new Error('Файл больше допустимого размера')
    return b
  }
  const reader = res.body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined)
      throw new Error('Файл больше допустимого размера')
    }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks)
}

/** Скачать файл с GitHub не больше maxBytes; после перенаправлений адрес всё ещё должен быть на GitHub. */
async function fetchBytes(url: string, maxBytes: number): Promise<Buffer> {
  const u = new URL(url)
  if (u.protocol !== 'https:' || !hostAllowed(u.hostname)) throw new Error('Недопустимый адрес')
  const signal = AbortSignal.timeout(25_000)
  const init = { headers: { 'User-Agent': 'LAZEYKA' }, signal, redirect: 'follow' as const }
  let res: Response
  try {
    res = await net.fetch(url, init)
  } catch {
    res = await fetch(url, init)
  }
  if (res.url) {
    const final = new URL(res.url)
    if (final.protocol !== 'https:' || !hostAllowed(final.hostname)) throw new Error('Недопустимый адрес после перенаправления')
  }
  if (!res.ok) throw new HttpError(res.status)
  return await readLimited(res, maxBytes)
}

/** Файл галереи по пути из индекса. Если GitHub ещё не отдаёт только что залитый файл (404) — повтор с параметром-антикэшем. */
async function fetchRepoFile(rel: string, maxBytes: number): Promise<Buffer> {
  const url = THEMES_RAW_BASE + rel
  try {
    return await fetchBytes(url, maxBytes)
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) return await fetchBytes(antiCacheUrl(url), maxBytes)
    throw e
  }
}

/** Индекс с Worker. Только адрес Hub, только https, ответ не больше 1 МБ, кэш браузера не используется. */
async function fetchHubIndex(query = ''): Promise<{ themes: unknown[]; updated?: unknown; total?: unknown }> {
  const url = antiCacheUrl(GALLERY_HUB_URL + query)
  const signal = AbortSignal.timeout(12_000)
  const init = { headers: { 'User-Agent': 'LAZEYKA', 'Cache-Control': 'no-cache' }, signal, cache: 'no-store' as const }
  let res: Response
  try {
    res = await net.fetch(url, init)
  } catch {
    res = await fetch(url, init)
  }
  if (!res.ok) throw new HttpError(res.status)
  const buf = await readLimited(res, MAX_INDEX_BYTES)
  const data: unknown = JSON.parse(buf.toString('utf-8'))
  if (!data || typeof data !== 'object' || !Array.isArray((data as { themes?: unknown }).themes)) throw new Error('Неверный ответ Hub')
  return data as { themes: unknown[]; updated?: unknown; total?: unknown }
}

interface Fetched {
  raw: { updated: unknown; themes: unknown[] }
  total: number
  complete: boolean
}

/**
 * Свежий индекс: сначала Hub (head — только самые новые темы, ?offset=0&limit=4; иначе весь список
 * страницами по 100), при любой ошибке — raw.githubusercontent.com с антикэшем. 404 запасного адреса =
 * пустая галерея. Старый Hub без параметров страниц отдаёт весь список — это тоже подходит.
 */
async function fetchIndexRaw(head: boolean): Promise<Fetched> {
  try {
    const first = await fetchHubIndex(`?offset=0&limit=${head ? GALLERY_HEAD : PAGE}`)
    const total = Number(first.total)
    if (!Number.isFinite(total)) return { raw: { updated: first.updated, themes: first.themes }, total: first.themes.length, complete: true }
    const themes = [...first.themes]
    if (!head) {
      while (themes.length < Math.min(total, MAX_THEMES)) {
        const next = await fetchHubIndex(`?offset=${themes.length}&limit=${PAGE}`)
        if (!next.themes.length) break
        themes.push(...next.themes)
      }
    }
    return { raw: { updated: first.updated, themes }, total, complete: themes.length >= Math.min(total, MAX_THEMES) }
  } catch {
    const buf = await fetchBytes(antiCacheUrl(GALLERY_INDEX_URL), MAX_INDEX_BYTES)
    const raw = JSON.parse(buf.toString('utf-8')) as { updated?: unknown; themes?: unknown }
    const themes = Array.isArray(raw?.themes) ? raw.themes : []
    return { raw: { updated: raw?.updated, themes }, total: themes.length, complete: true }
  }
}

// ---- Список -------------------------------------------------------------------------------------------

function view(c: CachedIndex, stale: boolean, error?: string): GalleryView {
  const themes = c.entries.map((e) => ({ id: e.id, name: e.name, author: e.author, at: e.at, hasWallpaper: Boolean(e.wallpaper), likes: typeof e.likes === 'number' ? e.likes : null }))
  themes.sort((a, b) => b.at - a.at)
  const total = c.complete ? themes.length : Math.max(c.total, themes.length)
  return { themes, total, complete: c.complete, updated: c.updated, fetchedAt: c.fetchedAt, stale, empty: total === 0 && !error, error }
}

const listing: Record<'head' | 'full', { p: Promise<GalleryView>; force: boolean } | null> = { head: null, full: null }

/**
 * Список тем. Свежий кэш (до минуты) отдаётся без запроса; force = кнопка «Обновить»: кэш не
 * используется, идём на сервер. mode 'head' — достаточно самых новых (блок в «Оформлении»),
 * 'full' — весь список (окно «Вся галерея»).
 */
export function galleryList(force: boolean, mode: 'head' | 'full' = 'full'): Promise<GalleryView> {
  const running = listing[mode]
  // Идущий запрос подходит, если он тоже мимо кэша или если нам кэш не мешает.
  if (running && (running.force || !force)) return running.p
  const p = (async () => {
    const cached = await readCache()
    const now = Date.now()
    if (cached && !force && now - cached.fetchedAt < REFRESH_MS && (cached.complete || mode === 'head')) return view(cached, false)
    try {
      const got = await fetchIndexRaw(mode === 'head')
      const parsed = parseGalleryIndex(got.raw)
      await writeCache(now, got.raw, parsed, got.total, got.complete)
      return view(memory as CachedIndex, false)
    } catch (e) {
      // 404: репозиторий ещё пуст — это не ошибка, а «тем пока нет».
      if (e instanceof HttpError && e.status === 404) {
        const empty = parseGalleryIndex({ themes: [] })
        await writeCache(now, { themes: [] }, empty, 0, true)
        return view(memory as CachedIndex, false)
      }
      if (cached) return view(cached, true)
      return {
        themes: [],
        total: 0,
        complete: false,
        updated: null,
        fetchedAt: 0,
        stale: false,
        empty: false,
        error: 'Не удалось загрузить список тем. Проверьте подключение к интернету и нажмите «Обновить».'
      }
    }
  })().finally(() => {
    if (listing[mode]?.p === p) listing[mode] = null
  })
  listing[mode] = { p, force }
  return p
}

async function entryById(id: string): Promise<GalleryEntry> {
  let c = await readCache()
  if (!c || (!c.complete && !c.entries.some((e) => e.id === String(id)))) {
    await galleryList(false, 'full')
    c = memory
  }
  const entry = c?.entries.find((e) => e.id === String(id))
  if (!entry) throw new Error('Такой темы нет в списке. Обновите галерею.')
  return entry
}

// ---- Превью ---------------------------------------------------------------------------------------------

let activePreviews = 0
const waiting: (() => void)[] = []
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (activePreviews >= 3) await new Promise<void>((r) => waiting.push(r))
  activePreviews++
  try {
    return await fn()
  } finally {
    activePreviews--
    waiting.shift()?.()
  }
}

const dataUrl = (buf: Buffer, kind: ImageKind): string => `data:${IMAGE_MIME[kind]};base64,${buf.toString('base64')}`

/** Превью темы как data-URL (скачивается лениво и сохраняется на диск). null — не удалось. */
export async function galleryPreview(id: string): Promise<string | null> {
  const entry = await entryById(id)
  const base = path.join(cacheDir(), `preview-${entry.id}`)
  for (const ext of ['png', 'jpg', 'webp']) {
    try {
      const buf = await readFile(`${base}.${ext}`)
      const kind = sniffImage(buf)
      if (kind) return dataUrl(buf, kind)
    } catch {
      /* нет в кэше */
    }
  }
  try {
    return await slot(async () => {
      const buf = await fetchRepoFile(entry.preview, MAX_PREVIEW_DOWNLOAD)
      const kind = sniffImage(buf)
      if (!kind) throw new Error('не картинка')
      await mkdir(cacheDir(), { recursive: true })
      await writeFile(`${base}.${IMAGE_EXT[kind]}`, buf)
      return dataUrl(buf, kind)
    })
  } catch {
    return null
  }
}

// ---- Обои темы для крупного просмотра (В16) ----------------------------------------------------------

/** Сколько файлов обоев держать в кэше просмотра (самые старые удаляются). */
const WALLS_KEPT = 12

async function cachedWallpaper(id: string): Promise<{ buf: Buffer; kind: ImageKind } | null> {
  for (const ext of ['png', 'jpg', 'webp']) {
    try {
      const buf = await readFile(path.join(cacheDir(), `wall-${id}.${ext}`))
      const kind = sniffImage(buf)
      if (kind) return { buf, kind }
    } catch {
      /* нет в кэше */
    }
  }
  return null
}

async function pruneWalls(): Promise<void> {
  try {
    const files = (await readdir(cacheDir())).filter((f) => /^wall-[A-Za-z0-9_-]+\.(png|jpg|webp)$/.test(f))
    if (files.length <= WALLS_KEPT) return
    const withTime = await Promise.all(files.map(async (f) => ({ f, t: (await stat(path.join(cacheDir(), f)).catch(() => null))?.mtimeMs ?? 0 })))
    withTime.sort((a, b) => b.t - a.t)
    for (const { f } of withTime.slice(WALLS_KEPT)) await unlink(path.join(cacheDir(), f)).catch(() => undefined)
  } catch {
    /* кэш не критичен */
  }
}

const wallLoading = new Map<string, Promise<string | null>>()

/**
 * Обои темы галереи как data-URL — для вкладки «Только обои» в окне темы. Скачиваются только по
 * нажатию на эту вкладку (не больше 3 МБ, проверка сигнатуры), хранятся на диске и потом
 * используются при установке темы. null — у темы нет обоев или скачать не вышло.
 */
export function galleryWallpaper(id: string): Promise<string | null> {
  const running = wallLoading.get(id)
  if (running) return running
  const p = (async () => {
    const entry = await entryById(id)
    if (!entry.wallpaper) return null
    const cached = await cachedWallpaper(entry.id)
    if (cached) return dataUrl(cached.buf, cached.kind)
    try {
      const buf = await fetchBytes(entry.wallpaper, MAX_WALLPAPER_BYTES)
      const kind = sniffImage(buf)
      if (!kind) return null
      await mkdir(cacheDir(), { recursive: true })
      await writeFile(path.join(cacheDir(), `wall-${entry.id}.${IMAGE_EXT[kind]}`), buf)
      void pruneWalls()
      return dataUrl(buf, kind)
    } catch {
      return null
    }
  })().finally(() => wallLoading.delete(id))
  wallLoading.set(id, p)
  return p
}

/** Новое число лайков после ответа сервера — в список в памяти (до следующей загрузки галереи). */
export function galleryPatchLikes(id: string, likes: number): void {
  const e = memory?.entries.find((x) => x.id === id)
  if (e) e.likes = likes
}

// ---- Проверка темы --------------------------------------------------------------------------------------

export interface NormalizedTheme {
  name: string
  mode: 'light' | 'dark'
  tokens: Record<string, string>
  settings: AppearanceSettings
}

/** Файл темы → проверенные поля. Всё сомнительное отбрасывается или заменяется значениями по умолчанию. */
export function normalizeThemeFile(raw: unknown, fallbackName = 'Тема'): NormalizedTheme {
  const d = (raw && typeof raw === 'object' ? raw : null) as Record<string, unknown> | null
  if (!d || d.app !== 'lazeyka-theme' || !d.tokens || typeof d.tokens !== 'object') throw new Error('Это не файл темы LAZEYKA')
  const a = sanitizeAppearance(
    {
      custom: [
        {
          id: 'gallery-tmp',
          name: typeof d.name === 'string' && d.name.trim() ? d.name : fallbackName,
          mode: d.mode === 'light' ? 'light' : 'dark',
          tokens: d.tokens,
          settings: d.settings
        }
      ]
    },
    undefined
  )
  const t = a.custom[0]
  if (!t) throw new Error('Тема повреждена')
  return { name: t.name, mode: t.mode, tokens: t.tokens, settings: t.settings }
}

const themeFileJson = (t: NormalizedTheme, bgImage: string): string =>
  JSON.stringify({ app: 'lazeyka-theme', version: 1, name: t.name, mode: t.mode, tokens: t.tokens, settings: { ...t.settings, bgImage } })

const BUILTIN_RE = /^builtin:[a-z0-9-]{1,24}$/

// ---- Установка -------------------------------------------------------------------------------------------

/**
 * Скачивает тему и обои, проверяет и возвращает всё для штатного импорта.
 * Применяет и добавляет в «Мои темы» окно (useAppearanceStore.importTheme) — здесь только данные.
 */
export async function galleryInstall(id: string): Promise<InstallResult> {
  const entry = await entryById(id)
  let theme: NormalizedTheme
  try {
    const buf = await fetchRepoFile(entry.theme, MAX_THEME_JSON_BYTES)
    theme = normalizeThemeFile(JSON.parse(buf.toString('utf-8')), entry.name)
  } catch (e) {
    if (e instanceof SyntaxError) throw new Error('Файл темы повреждён')
    if (e instanceof HttpError) throw new Error('Не удалось скачать тему. Попробуйте позже.')
    throw e instanceof Error ? e : new Error(String(e))
  }
  theme.name = entry.name || theme.name

  let bgImage = BUILTIN_RE.test(theme.settings.bgImage) ? theme.settings.bgImage : ''
  let warning: string | undefined
  if (entry.wallpaper) {
    try {
      // Обои уже смотрели в окне темы — берём с диска, второй раз не скачиваем.
      const buf = (await cachedWallpaper(entry.id))?.buf ?? (await fetchBytes(entry.wallpaper, MAX_WALLPAPER_BYTES))
      const kind = sniffImage(buf)
      if (!kind) throw new Error('not an image')
      const animated = isAnimatedImage(buf, kind)
      const name = `bg-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}${animated ? '-a' : ''}.${IMAGE_EXT[kind]}`
      await writeFile(path.join(backgroundsDir(), name), buf)
      bgImage = name
    } catch {
      warning = 'Обои не скачались, тема установлена без них.'
    }
  }
  return { themeJson: themeFileJson(theme, ''), bgImage, name: theme.name, author: entry.author, warning }
}

// ---- Своя тема: снимок и подготовка к отправке ---------------------------------------------

let lastPreview: Buffer | null = null

/** Снимок окна: ширина до 640, JPEG не больше 400 КБ. Возвращает data-URL для показа в диалоге. */
export async function captureThemePreview(): Promise<string> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.isVisible())
  if (!win) throw new Error('Нет открытого окна для снимка')
  let img = await win.webContents.capturePage()
  if (img.isEmpty()) throw new Error('Не удалось сделать снимок окна')
  for (const width of [640, 520, 420]) {
    const size = img.getSize()
    const small = size.width > width ? img.resize({ width, quality: 'good' }) : img
    for (const q of [82, 70, 58, 46, 36]) {
      const buf = small.toJPEG(q)
      if (buf.length <= MAX_PREVIEW_BYTES - 16 * 1024) {
        lastPreview = buf
        return dataUrl(buf, 'jpeg')
      }
    }
    img = small
  }
  throw new Error('Снимок получился слишком большим')
}

export interface ShareInput {
  name: string
  author: string
  /** Результат exportTheme() из окна. */
  theme: string
  /** Текущее значение settings.bgImage в окне. */
  bgImage: string
}

export interface ShareParts {
  name: string
  author: string
  themeJson: string
  preview: Buffer
  wallpaper: { buf: Buffer; mime: string } | null
  warnings: string[]
}

const BG_FILE_RE = /^bg-[a-z0-9]{6,24}(-a)?\.(png|jpe?g|webp|gif|mp4|webm)$/

// eslint-disable-next-line no-control-regex
const cleanText = (v: unknown, max: number): string => String(v ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, max)

/** Проверить ввод, собрать тему, обои и снимок для отправки. */
export async function prepareShare(input: ShareInput): Promise<ShareParts> {
  const name = cleanText(input.name, 40)
  const author = cleanText(input.author, 32)
  const bad = themeNameProblem(name)
  if (bad) throw new Error(bad)
  if (typeof input.theme !== 'string' || input.theme.length > MAX_THEME_JSON_BYTES) throw new Error('Тема слишком большая')
  let theme: NormalizedTheme
  try {
    theme = normalizeThemeFile(JSON.parse(input.theme), name)
  } catch (e) {
    throw new Error(e instanceof SyntaxError ? 'Не удалось прочитать тему' : e instanceof Error ? e.message : String(e))
  }
  theme.name = name

  const warnings: string[] = []
  let wallpaper: ShareParts['wallpaper'] = null
  const bg = String(input.bgImage ?? '')
  let themeBg = ''
  if (BUILTIN_RE.test(bg)) {
    // Встроенные обои есть у каждого — файл не нужен.
    themeBg = bg
  } else if (bg && BG_FILE_RE.test(bg)) {
    const animatedName = /-a\.[a-z0-9]+$/.test(bg) || /\.(gif|mp4|webm)$/.test(bg)
    if (animatedName) {
      warnings.push('GIF, анимированные и видеообои не отправляются: тема уйдёт без обоев.')
    } else {
      try {
        const file = path.join(backgroundsDir(), bg)
        const size = (await stat(file)).size
        if (size > MAX_WALLPAPER_BYTES) {
          warnings.push('Обои больше 3 МБ и не отправляются: тема уйдёт без обоев.')
        } else {
          const buf = await readFile(file)
          const kind = sniffImage(buf)
          if (!kind) warnings.push('Файл обоев не удалось распознать как картинку: тема уйдёт без обоев.')
          else if (isAnimatedImage(buf, kind)) warnings.push('Анимированные обои не отправляются: тема уйдёт без обоев.')
          else wallpaper = { buf, mime: IMAGE_MIME[kind] }
        }
      } catch {
        warnings.push('Файл обоев не найден: тема уйдёт без обоев.')
      }
    }
  }

  if (!lastPreview) await captureThemePreview()
  if (!lastPreview) throw new Error('Не удалось сделать снимок для превью')
  return { name, author, themeJson: themeFileJson(theme, themeBg), preview: lastPreview, wallpaper, warnings }
}

export function clearSharePreview(): void {
  lastPreview = null
}
