/**
 * LAZEYKA Hub: чистые функции без Electron — маскировка текста отчёта,
 * перевод ошибок сервера, проверка путей из index.json и сигнатур картинок.
 * Файл можно запускать отдельно (node-скрипты в /tmp проверяют его без приложения).
 */
import { isIPv6 } from 'node:net'

// ---- Маскировка ------------------------------------------------------------------

export interface MaskOptions {
  /** Строки, которые нужно убрать как есть (имя пользователя Windows, имя компьютера). */
  literals?: string[]
}

/** Схемы ссылок на узлы и прокси: от них не остаётся ничего, кроме схемы. */
const PROXY_SCHEMES = 'vless|vmess|trojan|ssr?|hysteria2?|hy2|tuic|wireguard|wg|awg|socks[45]?|anytls|naive\\+https|tg|mtproto'
const PROXY_LINK_RE = new RegExp(`\\b(${PROXY_SCHEMES})://[^\\s"'<>)\\]]+`, 'gi')
const URL_RE = /\b(https?):\/\/([^\s/?#"'<>]+)([^\s"'<>]*)/gi
const TOKEN_SEGMENT_RE = /^[A-Za-z0-9_=+%~-]{16,}$/
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi
const HEX_SECRET_RE = /(?<![0-9A-Za-z])(?:dd|ee)?[0-9a-f]{32,}(?![0-9A-Za-z])/gi
const WG_KEY_RE = /(?<![A-Za-z0-9+/=])[A-Za-z0-9+/]{43}=(?![A-Za-z0-9+/=])/g
const MAC_RE = /\b([0-9A-Fa-f]{2})([:-])([0-9A-Fa-f]{2})\2([0-9A-Fa-f]{2})\2[0-9A-Fa-f]{2}\2[0-9A-Fa-f]{2}\2[0-9A-Fa-f]{2}\b/g
const IPV4_RE = /(?<![0-9A-Za-z.])(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?![0-9A-Za-z]|\.\d)/g
const EMAIL_RE = /\b[A-Za-z0-9._%+-]{1,64}@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)\b/g
const WORKERS_RE = /\b(?:[A-Za-z0-9-]+\.)+workers\.dev\b/gi
const SECRET_KV_RE =
  /(["']?)\b(pass(?:word|wd)?|pwd|token|secret|api[_-]?key|private[_-]?key|preshared[_-]?key|psk|auth(?:orization)?|x-hwid|hwid|sub(?:scription)?[_-]?(?:url|token|id))\1(\s*[:=]\s*)(["']?)(?!\*\*\*)(?!Bearer\b)[^\s"',;&}]+/gi
const BEARER_RE = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/g

/** Адрес: оставляем первые два октета. */
function maskV4(a: string, b: string, c: string, d: string): string {
  const parts = [a, b, c, d].map((x) => Number(x))
  if (parts.some((n) => !Number.isInteger(n) || n > 255)) return `${a}.${b}.${c}.${d}`
  if (parts.join('.') === '127.0.0.1' || parts.join('.') === '0.0.0.0') return parts.join('.')
  return `${a}.${b}.x.x`
}

function maskV6(addr: string): string {
  const bare = addr.split('%')[0]
  if (bare === '::1' || bare === '::') return addr
  const lead: string[] = []
  for (const g of bare.split(':')) {
    if (!g || lead.length >= 2) break
    lead.push(g)
  }
  return `${lead.join(':')}::***`
}

/** Ссылка http(s): если в ней есть учётные данные, запрос, фрагмент или похожий на токен отрезок пути — остаётся только хост. */
function maskUrl(scheme: string, authority: string, rest: string): string {
  const at = authority.lastIndexOf('@')
  const host = at >= 0 ? authority.slice(at + 1) : authority
  const hasUserinfo = at >= 0
  const pathOnly = rest.split(/[?#]/)[0]
  const hasQuery = /[?#]/.test(rest)
  const tokenPath = pathOnly.split('/').some((seg) => TOKEN_SEGMENT_RE.test(seg))
  if (hasUserinfo || hasQuery || tokenPath) return `${scheme}://${host}/…`
  return `${scheme}://${host}${rest}`
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Прячет из текста всё, что нельзя показывать посторонним: адреса, ссылки с
 * токенами, ключи, секреты, имя пользователя. Идемпотентна.
 */
export function maskText(input: string, opts: MaskOptions = {}): string {
  let t = String(input ?? '')

  // 1. Ссылки на узлы и прокси (vless://…, tg://proxy?…) — целиком.
  t = t.replace(PROXY_LINK_RE, (_m, scheme: string) => `${scheme.toLowerCase()}://***`)

  // 2. Логин:пароль@ в любой ссылке, а также «user:pass@host» без схемы.
  t = t.replace(/\b([A-Za-z][A-Za-z0-9+.-]*:\/\/)[^\s/:@"'<>]+:[^\s/@"'<>]+@/g, '$1***:***@')
  t = t.replace(/(^|[\s"'=(,])[A-Za-z0-9._-]{1,40}:[^\s/@:"'<>]{1,80}@(?=[A-Za-z0-9[])/g, '$1***:***@')

  // 3. Ссылки http(s): токены и подписки — только хост.
  t = t.replace(URL_RE, (_m, scheme: string, authority: string, rest: string) => maskUrl(scheme, authority, rest))

  // 4. Адреса *.workers.dev (личные Worker пользователя).
  t = t.replace(WORKERS_RE, '***.workers.dev')

  // 5. password=…, token: …, Authorization: Bearer …
  t = t.replace(SECRET_KV_RE, (_m, q1: string, key: string, sep: string, q2: string) => `${q1}${key}${q1}${sep}${q2}***`)
  t = t.replace(BEARER_RE, '$1 ***')

  // 6. Ключи WireGuard (base64, 44 знака), UUID, hex-секреты (Telegram-прокси и т. п.).
  t = t.replace(WG_KEY_RE, '[ключ скрыт]')
  t = t.replace(UUID_RE, '[uuid скрыт]')
  t = t.replace(HEX_SECRET_RE, '[секрет скрыт]')

  // 7. Имя пользователя в путях: C:\Users\<имя>, /Users/<имя>, /home/<имя>.
  t = t.replace(/([A-Za-z]:[\\/]+Users[\\/]+)(?!\*\*\*[\\/]|\*\*\*$)[^\\/"'<>|:*?\r\n]+(?=[\\/])/gi, '$1***')
  t = t.replace(/([A-Za-z]:[\\/]+Users[\\/]+)(?!\*\*\*)[^\\/\s"'<>|:*?]+/gi, '$1***')
  t = t.replace(/(^|[\s"'=(])(\/Users\/|\/home\/)(?!\*\*\*)[^/\s"'<>|:*?]+/g, '$1$2***')

  // 8. MAC, e-mail.
  t = t.replace(MAC_RE, (_m, a: string, sep: string, b: string, c: string) => `${a}${sep}${b}${sep}${c}${sep}**${sep}**${sep}**`)
  t = t.replace(EMAIL_RE, '***@$1')

  // 9. IPv6 (проверка настоящим разбором, чтобы не трогать время 12:34:56), затем IPv4.
  t = t.replace(/(?<![0-9A-Za-z:.])[0-9A-Fa-f:.]{2,45}(?:%[0-9A-Za-z]+)?(?![0-9A-Za-z:])/g, (m) => {
    const bare = m.split('%')[0]
    return bare.includes(':') && isIPv6(bare) ? maskV6(m) : m
  })
  t = t.replace(IPV4_RE, (_m, a: string, b: string, c: string, d: string) => maskV4(a, b, c, d))

  // 10. Явно заданные строки (имя пользователя, имя компьютера).
  for (const lit of opts.literals ?? []) {
    const s = String(lit ?? '').trim()
    if (s.length < 3) continue
    t = t.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(s)}(?![\\p{L}\\p{N}])`, 'giu'), '***')
  }
  return t
}

/** Известные «безопасные» домены в строках ядер: остальные имена хостов считаем адресом сервера. */
const SAFE_HOST_RE =
  /(^|\.)(github\.com|githubusercontent\.com|google\.com|googleapis\.com|gstatic\.com|youtube\.com|ytimg\.com|googlevideo\.com|discord\.com|discord\.gg|discordapp\.com|discordapp\.net|telegram\.org|t\.me|cloudflare\.com|cloudflare-dns\.com|one\.one\.one\.one|dns\.google|yandex\.ru|ya\.ru|vk\.com|twitch\.tv|steampowered\.com|microsoft\.com|windows\.com|apple\.com|localhost)$/i
const HOST_RE = /(?<![A-Za-z0-9@-])(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,24}(?![A-Za-z0-9-])/g

/**
 * Строка лога: маскируем всё, как в maskText, а для строк INCY и ExitLag дополнительно
 * убираем названия узлов в «ёлочках» и имена хостов, которых нет в списке известных
 * (там встречается адрес сервера). Строка формата `HH:MM:SS [тип] [источник] текст`.
 */
export function maskLogLine(line: string, opts: MaskOptions = {}): string {
  let t = String(line ?? '')
  if (t.length > 600) t = t.slice(0, 600) + '…'
  const m = /^(\d{2}:\d{2}:\d{2} \[[a-z]+\] \[)([a-z]+)(\] )/.exec(t)
  const source = m?.[2] ?? ''
  t = t.replace(/«[^»\n]*»/g, '«***»')
  t = t.replace(/(Подключение к узлу:\s*).+?(\s+\([A-Za-z0-9-]+\))/g, '$1***$2')
  t = t.replace(/(Импортирован конфиг WireGuard:).*/g, '$1 ***')
  t = t.replace(/(Активный сервер сохранён после обновления:).*/g, '$1 ***')
  if (source === 'incy' || source === 'exitlag') {
    const head = m ? m[0] : ''
    const body = t.slice(head.length)
    t = head + body.replace(HOST_RE, (h) => (SAFE_HOST_RE.test(h) || /^\d+(\.\d+)+$/.test(h) || /\.(exe|dll|json|log|txt|dat|conf|yaml|yml|zip|bat)$/i.test(h) ? h : '***'))
  }
  return maskText(t, opts)
}

// ---- Ошибки сервера ----------------------------------------------------------------

export type HubKind = 'report' | 'idea' | 'theme'

export interface HubErrorInfo {
  message: string
  /** Можно предложить «Сохранить файлом» (для отчёта при недоступном сервере). */
  offerSave: boolean
}

/** Ждать столько-то: «5 мин», «3 ч». */
export function waitText(sec: number | undefined, unit: 'min' | 'auto' = 'auto'): string {
  const s = Number.isFinite(sec) && (sec as number) > 0 ? (sec as number) : 60
  if (unit === 'min' || s < 3600) return `${Math.max(1, Math.ceil(s / 60))} мин`
  return `${Math.max(1, Math.ceil(s / 3600))} ч`
}

const KIND_NOUN: Record<HubKind, { many: string; gen: string }> = {
  report: { many: 'отчётов', gen: 'отчёт' },
  idea: { many: 'идей', gen: 'идею' },
  theme: { many: 'тем', gen: 'тему' }
}

/** Код ошибки сервера (или 'network') → понятный текст для человека. */
export function humanizeHubError(kind: HubKind, error: string, retryAfterSec?: number): HubErrorInfo {
  const noun = KIND_NOUN[kind]
  switch (error) {
    case 'too_often':
      if (kind === 'report') return { message: `Отчёт можно отправлять раз в 15 минут, подождите ${waitText(retryAfterSec, 'min')}.`, offerSave: true }
      if (kind === 'idea') return { message: `Идеи можно отправлять не чаще раза в 5 минут, подождите ${waitText(retryAfterSec, 'min')}.`, offerSave: false }
      return { message: `Тему можно отправлять раз в сутки, подождите ${waitText(retryAfterSec)}.`, offerSave: false }
    case 'daily_limit':
      if (kind === 'theme') return { message: `Тему можно отправлять раз в сутки, попробуйте через ${waitText(retryAfterSec)}.`, offerSave: false }
      return {
        message:
          kind === 'idea'
            ? 'Сегодня вы уже отправили максимум идей. Попробуйте завтра.'
            : 'Сегодня уже отправлено максимум отчётов с этой установки. Попробуйте завтра или напишите в чат поддержки.',
        offerSave: kind === 'report'
      }
    case 'blocked':
      return { message: 'Отправка с этой установки отключена.', offerSave: kind === 'report' }
    case 'busy':
      return {
        message: `Сегодня уже пришло слишком много ${noun.many}, попробуйте завтра или напишите в чат поддержки.`,
        offerSave: kind === 'report'
      }
    case 'too_large':
      return {
        message: kind === 'theme' ? 'Тема или картинки слишком большие для отправки.' : kind === 'report' ? 'Отчёт слишком большой для отправки. Сохраните его файлом и отправьте в чат поддержки.' : 'Текст слишком длинный.',
        offerSave: kind === 'report'
      }
    case 'bad_name':
      return { message: 'Придумайте своё название темы: не короче 3 знаков и не как у встроенных тем.', offerSave: false }
    case 'images_only':
      return { message: 'Обои должны быть картинкой PNG, JPG или WebP.', offerSave: false }
    case 'delivery':
      return { message: `Сервер не смог передать ${noun.gen} автору. Попробуйте позже.`, offerSave: kind === 'report' }
    case 'bad_request':
      return { message: 'Сервер не принял данные. Проверьте введённый текст или обновите программу.', offerSave: kind === 'report' }
    case 'network':
      return {
        message:
          kind === 'report'
            ? 'Сервер недоступен. Проверьте подключение к интернету. Можно сохранить отчёт файлом и отправить его в чат поддержки.'
            : 'Сервер недоступен. Проверьте подключение к интернету и попробуйте позже.',
        offerSave: kind === 'report'
      }
    default:
      return { message: 'Не удалось отправить. Попробуйте позже.', offerSave: kind === 'report' }
  }
}

// ---- Проверка данных из index.json --------------------------------------------------

export const THEMES_RAW_BASE = 'https://raw.githubusercontent.com/reb0oornalexey/LAZEYKA-themes/main/'
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/
const THEME_FILE_RE = /^themes\/([A-Za-z0-9_-]{1,64})\/theme\.json$/
const PREVIEW_FILE_RE = /^themes\/([A-Za-z0-9_-]{1,64})\/preview\.(png|jpe?g|webp)$/
const WALLPAPER_PREFIX = '/reb0oornalexey/LAZEYKA-themes/releases/download/'

/** Путь вида themes/<id>/… без «..», обратных косых черт и лишних частей. */
export function isSafeThemePath(p: unknown, kind: 'theme' | 'preview'): p is string {
  if (typeof p !== 'string' || p.length > 160 || p.includes('..') || p.includes('\\') || p.includes('\0')) return false
  if (!p.startsWith('themes/')) return false
  return (kind === 'theme' ? THEME_FILE_RE : PREVIEW_FILE_RE).test(p)
}

/** Обои: только https://github.com/reb0oornalexey/LAZEYKA-themes/releases/download/<тег>/<файл>. */
export function isSafeWallpaperUrl(u: unknown): u is string {
  if (typeof u !== 'string' || u.length > 300) return false
  let url: URL
  try {
    url = new URL(u)
  } catch {
    return false
  }
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password) return false
  if (url.search || url.hash) return false
  const p = url.pathname
  if (!p.startsWith(WALLPAPER_PREFIX) || p.includes('..') || p.includes('//')) return false
  const rest = p.slice(WALLPAPER_PREFIX.length).split('/')
  return rest.length === 2 && rest.every((s) => /^[A-Za-z0-9._%-]{1,120}$/.test(s))
}

export interface GalleryEntry {
  id: string
  name: string
  author: string
  at: number
  theme: string
  preview: string
  wallpaper?: string
  /** Число лайков с Hub (с 2.0.0). Нет поля — счётчик неизвестен (старый Hub или запасной адрес GitHub). */
  likes?: number
}

const clean = (v: unknown, max: number): string =>
  String(v ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .trim()
    .slice(0, max)

/** Разбор index.json: неправильные записи молча пропускаются. */
export function parseGalleryIndex(raw: unknown): { updated: number | string | null; themes: GalleryEntry[] } {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const list = Array.isArray(r.themes) ? r.themes : []
  const out: GalleryEntry[] = []
  const seen = new Set<string>()
  for (const x of list.slice(0, 500)) {
    if (!x || typeof x !== 'object') continue
    const e = x as Record<string, unknown>
    const id = typeof e.id === 'string' ? e.id : ''
    if (!ID_RE.test(id) || seen.has(id)) continue
    if (!isSafeThemePath(e.theme, 'theme') || !isSafeThemePath(e.preview, 'preview')) continue
    // Путь должен вести в папку этой же темы.
    if (!(e.theme as string).startsWith(`themes/${id}/`) || !(e.preview as string).startsWith(`themes/${id}/`)) continue
    const name = clean(e.name, 40)
    if (name.length < 1) continue
    const entry: GalleryEntry = {
      id,
      name,
      author: clean(e.author, 32) || 'Аноним',
      at: typeof e.at === 'number' && Number.isFinite(e.at) ? e.at : Date.parse(String(e.at ?? '')) || 0,
      theme: e.theme as string,
      preview: e.preview as string
    }
    if (typeof e.likes === 'number' && Number.isFinite(e.likes)) entry.likes = Math.max(0, Math.min(1e9, Math.trunc(e.likes)))
    if (e.wallpaper !== undefined && e.wallpaper !== null && e.wallpaper !== '') {
      if (!isSafeWallpaperUrl(e.wallpaper)) continue
      entry.wallpaper = e.wallpaper as string
    }
    seen.add(id)
    out.push(entry)
  }
  const updated = typeof r.updated === 'number' || typeof r.updated === 'string' ? r.updated : null
  return { updated, themes: out }
}

// ---- Сигнатуры картинок --------------------------------------------------------------

export type ImageKind = 'png' | 'jpeg' | 'webp'

/** Настоящий тип по первым байтам (расширению и Content-Type верить нельзя). */
export function sniffImage(buf: Uint8Array): ImageKind | null {
  if (buf.length < 12) return null
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return 'png'
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg'
  const tag = (o: number, s: string): boolean => s.split('').every((c, i) => buf[o + i] === c.charCodeAt(0))
  if (tag(0, 'RIFF') && tag(8, 'WEBP')) return 'webp'
  return null
}

/** Анимированный WebP / APNG — по заголовку, как sniffAnimated в resolve/appearance.ts. */
export function isAnimatedImage(buf: Uint8Array, kind: ImageKind): boolean {
  const head = Buffer.from(buf.subarray(0, 65536))
  if (kind === 'webp') return head.toString('latin1', 12, 16) === 'VP8X' && (head[20] & 0x02) !== 0
  if (kind === 'png') {
    const ac = head.indexOf('acTL', 0, 'latin1')
    const idat = head.indexOf('IDAT', 0, 'latin1')
    return ac >= 0 && (idat < 0 || ac < idat)
  }
  return false
}

export const IMAGE_EXT: Record<ImageKind, string> = { png: 'png', jpeg: 'jpg', webp: 'webp' }
export const IMAGE_MIME: Record<ImageKind, string> = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' }

// ---- Прочее ------------------------------------------------------------------------------

/** Ссылки http/https в тексте объявления: части текста и ссылки по порядку. */
export function splitLinks(text: string): { text: string; url?: string }[] {
  const out: { text: string; url?: string }[] = []
  const re = /https?:\/\/[^\s<>"']+/gi
  let last = 0
  for (let m = re.exec(text); m; m = re.exec(text)) {
    let url = m[0]
    const trail = /[.,;:!?)\]»]+$/.exec(url)
    if (trail) url = url.slice(0, -trail[0].length)
    if (m.index > last) out.push({ text: text.slice(last, m.index) })
    out.push({ text: url, url })
    last = m.index + url.length
    re.lastIndex = last
  }
  if (last < text.length) out.push({ text: text.slice(last) })
  return out
}

/** Только последние `n` строк текста. */
export function lastLines(text: string, n: number): string[] {
  const lines = text.split(/\r?\n/)
  if (lines.length && lines[lines.length - 1] === '') lines.pop()
  return lines.slice(-n)
}

// ---- Адрес Hub, опрос и свежесть списка ------------------------------------------------------

/** Адрес развёрнутого Worker (hub/README.md). */
const HUB_PROD_URL = 'https://lazeyka-hub.reb0oorn-alexey.workers.dev'

/**
 * Локальный Hub для автоматических проверок (miniflare в песочнице): только адрес 127.0.0.1 с портом.
 * Переменную задаёт скрипт проверок; в собранной программе её не читают (см. test-env.ts) —
 * а даже если задать вручную, запросы уйдут только на свой же компьютер.
 */
export function devHubUrl(raw: string | undefined): string | null {
  return typeof raw === 'string' && /^http:\/\/127\.0\.0\.1:\d{2,5}$/.test(raw) ? raw : null
}

export const HUB_URL = (typeof process !== 'undefined' && devHubUrl(process.env?.LAZEYKA_DEV_HUB_URL)) || HUB_PROD_URL

/** Первый запрос /inbox после запуска. */
export const POLL_FIRST_MS = 10 * 1000
/** Обычный интервал опроса /inbox. */
export const POLL_MS = 30 * 60 * 1000
/** При возврате окна из свёрнутого или трея — не чаще раза в 3 минуты. */
export const POLL_MIN_GAP_MS = 3 * 60 * 1000

/** Пора ли опрашивать при возврате окна: с прошлого запроса прошло не меньше минимального промежутка. */
export function pollDue(now: number, lastPollAt: number, gapMs: number = POLL_MIN_GAP_MS): boolean {
  return !Number.isFinite(lastPollAt) || lastPollAt <= 0 || now - lastPollAt >= gapMs
}

/** Добавляет к адресу параметр, из-за которого CDN и кэш браузера считают его новым. */
export function antiCacheUrl(url: string, now: number = Date.now()): string {
  return `${url}${url.includes('?') ? '&' : '?'}t=${Math.trunc(now)}`
}

/** Тема автора, ожидающая решения. Идентификатор темы наружу не отдаётся: только название и время. */
export interface PendingTheme {
  name: string
  at: number
}

/** Разбор поля pending из ответа /inbox. */
export function parsePending(raw: unknown): PendingTheme[] {
  if (!Array.isArray(raw)) return []
  const out: PendingTheme[] = []
  for (const x of raw.slice(0, 5)) {
    if (!x || typeof x !== 'object') continue
    const o = x as Record<string, unknown>
    // eslint-disable-next-line no-control-regex
    const name = String(o.name ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 40)
    const at = Number(o.at)
    if (name) out.push({ name, at: Number.isFinite(at) && at > 0 ? at : Date.now() })
  }
  return out
}

// ---- Название темы для галереи ---------------------------------------------------------

/** Названия встроенных тем: так называть тему в галерее нельзя (то же правило на сервере). */
export const BUILTIN_THEME_NAMES = ['Тёмная', 'Светлая', 'Графит', 'Полночь', 'Изумруд', 'Закат', 'Пурпур', 'AMOLED чёрный', 'Небо']

const normName = (s: string): string => s.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim()

/** Почему название не подходит, или null. */
export function themeNameProblem(raw: string): string | null {
  const name = String(raw ?? '').trim()
  if (name.length < 3) return 'Название — от 3 знаков'
  if (name.length > 40) return 'Название — до 40 знаков'
  if (BUILTIN_THEME_NAMES.some((n) => normName(n) === normName(name))) return 'Так называется встроенная тема — придумайте своё название'
  return null
}

/** Ответ POST /themes/like: { ok, id, likes, liked }. null — ответ не такой. */
export function parseLikeAnswer(raw: unknown, id: string): { likes: number; liked: boolean } | null {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  if (r.ok !== true || r.id !== id || typeof r.likes !== 'number' || !Number.isFinite(r.likes) || typeof r.liked !== 'boolean') return null
  return { likes: Math.max(0, Math.min(1e9, Math.trunc(r.likes))), liked: r.liked }
}
