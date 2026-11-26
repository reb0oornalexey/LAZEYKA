/**
 * Сбор пожертвований: разбор ответов Hub без Electron (публичный GET /donations и данные автора).
 * Ответ сервера проверяется по полям: в окно уходят только ожидаемые значения нужного типа,
 * ссылки — только https. Файл можно проверить node-скриптом отдельно от программы.
 */

export interface DonLevel {
  from: number
  name: string
  /** Ключ набора (gray, violet, gold…) или #rrggbb. */
  color: string
}

export interface DonWallItem {
  nick: string
  total: number
  /** Номер уровня; −1 — меньше самого низкого порога. */
  level: number
}

export interface DonRecentItem {
  nick: string
  amount: number
  at: number
  level: number
}

/** Значок способа оплаты: фирменный сервис или общий (карта, крипта, ссылка). */
export type DonMethodIcon = 'donationalerts' | 'cryptobot' | 'boosty' | 'tribute' | 'yoomoney' | 'patreon' | 'kofi' | 'card' | 'crypto' | 'link'

export const DON_METHOD_ICONS: readonly DonMethodIcon[] = ['donationalerts', 'cryptobot', 'boosty', 'tribute', 'yoomoney', 'patreon', 'kofi', 'card', 'crypto', 'link']

/** Способ оплаты в сборе (Б7): до 6 штук, ссылки только https. */
export interface DonMethod {
  name: string
  url: string
  icon: DonMethodIcon
}

/** Значок у ника на «стене» (Б11). */
export type DonBadge = 'crown' | 'star' | 'fire' | 'diamond' | 'heart' | 'bolt'
export const DON_BADGES: readonly DonBadge[] = ['crown', 'star', 'fire', 'diamond', 'heart', 'bolt']

/** Личный стиль ника поверх цвета уровня (Б11). */
export interface DonStyle {
  color?: string
  emoji?: string
  badge?: DonBadge
  glow?: true
}

export interface DonCampaignPublic {
  id: number
  title: string
  goal: number
  cur: string
  descr: string
  link: string
  /** Способы оплаты. У старого Hub — один, собранный из link. */
  methods: DonMethod[]
  /** Hub принимает заявки «Я отправил пожертвование» (новый Hub присылает methods). */
  claimable: boolean
  starts: number | null
  ends: number | null
  raised: number
  pct: number
  count: number
  donors: number
  byLevel: number[]
  below: number
  wall: DonWallItem[]
  recent: DonRecentItem[]
}

export interface DonationsPublic {
  levels: DonLevel[]
  campaigns: DonCampaignPublic[]
  /** Стили ников: ключ — ник в нижнем регистре. Старый Hub не присылает — пусто. */
  styles: Record<string, DonStyle>
  at: number
}

export interface DonCampaignAdmin {
  id: number
  title: string
  goal: number
  cur: string
  descr: string
  link: string
  methods: DonMethod[]
  active: boolean
  starts: number | null
  ends: number | null
  at: number
  raised: number
  pct: number
  count: number
  donors: number
  byLevel: number[]
  below: number
}

export interface DonItemAdmin {
  id: number
  camp: number
  nick: string
  amount: number
  at: number
  note: string
  level: number
}

export type DonClaimStatus = 'wait' | 'ok' | 'no'

/** Заявка «Я отправил пожертвование» глазами автора (Б8). */
export interface DonClaimAdmin {
  id: number
  camp: number
  nick: string
  amount: number
  method: string
  note: string
  at: number
  status: DonClaimStatus
  /** Первые 6 символов кода установки. */
  install: string
}

export interface DonStyleAdmin {
  nick: string
  color: string | null
  emoji: string | null
  badge: DonBadge | null
  glow: boolean
}

export interface DonationsAdmin {
  levels: DonLevel[]
  campaigns: DonCampaignAdmin[]
  donations: DonItemAdmin[]
  maxActive: number
  defaultLink: string
  palette: Record<string, string>
  claims: DonClaimAdmin[]
  styles: DonStyleAdmin[]
  /** Hub знает о заявках и стилях (старый Hub этих полей не присылает). */
  hasClaims: boolean
  hasStyles: boolean
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => Boolean(v) && typeof v === 'object' && !Array.isArray(v)

const CTRL_RE = new RegExp('[' + String.fromCharCode(0) + '-' + String.fromCharCode(31) + String.fromCharCode(127) + String.fromCharCode(0x2028, 0x2029) + String.fromCharCode(0x202a) + '-' + String.fromCharCode(0x202e) + String.fromCharCode(0x2066) + '-' + String.fromCharCode(0x2069) + ']', 'g')

/** Строка без управляющих символов и переключателей направления, не длиннее n. */
export const str = (v: unknown, n: number): string => (typeof v === 'string' ? v.replace(CTRL_RE, ' ').slice(0, n) : '')
const num = (v: unknown, def = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : def)
const optTime = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null)
const arr = (v: unknown, max: number): unknown[] => (Array.isArray(v) ? v.slice(0, max) : [])

/** Ссылка сбора: только https://. Иначе — пустая строка (кнопку «Поддержать» не показываем). */
export function safeLink(v: unknown): string {
  if (typeof v !== 'string' || v.length > 300) return ''
  try {
    const u = new URL(v)
    return u.protocol === 'https:' && !u.username && !u.password ? u.toString() : ''
  } catch {
    return ''
  }
}

export const isColor = (c: string): boolean => /^[a-z]{3,10}$/.test(c) || /^#[0-9a-f]{6}$/.test(c)

/**
 * Эмодзи (как cleanEmoji в Hub): 1–8 символов, без латинских букв и цифр, пробелов и управляющих символов.
 * null — не подходит.
 */
export function cleanEmoji(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  const n = Array.from(t).length
  if (n < 1 || n > 8) return null
  if (/[A-Za-z0-9\s]/.test(t) || CTRL_TEST.test(t)) return null
  return t
}
const CTRL_TEST = new RegExp(CTRL_RE.source)

/** Значок способа по ссылке: как угадывает Hub. */
export function guessMethodIcon(url: string): DonMethodIcon {
  let host = ''
  let p = ''
  try {
    const u = new URL(url)
    host = u.hostname.toLowerCase().replace(/^www\./, '')
    p = u.pathname.toLowerCase()
  } catch {
    return 'link'
  }
  const is = (h: string): boolean => host === h || host.endsWith('.' + h)
  if (is('donationalerts.com')) return 'donationalerts'
  if (is('boosty.to')) return 'boosty'
  if (is('yoomoney.ru')) return 'yoomoney'
  if (is('patreon.com')) return 'patreon'
  if (is('ko-fi.com')) return 'kofi'
  if (host === 't.me' || host === 'telegram.me') {
    if (/^\/(cryptobot|send)\b/.test(p)) return 'cryptobot'
    if (p.includes('tribute')) return 'tribute'
  }
  return 'link'
}

export const DON_METHOD_NAMES: Record<DonMethodIcon, string> = {
  donationalerts: 'DonationAlerts',
  cryptobot: 'CryptoBot',
  boosty: 'Boosty',
  tribute: 'Tribute',
  yoomoney: 'ЮMoney',
  patreon: 'Patreon',
  kofi: 'Ko-fi',
  card: 'Банковская карта',
  crypto: 'Криптовалюта',
  link: 'Ссылка'
}

const isMethodIcon = (v: unknown): v is DonMethodIcon => typeof v === 'string' && (DON_METHOD_ICONS as readonly string[]).includes(v)

/** Список способов оплаты: до 6, без повторов ссылок; неподходящие пропускаются. */
export function parseMethods(v: unknown): DonMethod[] {
  const out: DonMethod[] = []
  for (const x of arr(v, 12)) {
    if (!isObj(x)) continue
    const url = safeLink(x.url)
    const name = str(x.name, 32).trim()
    if (!url || !name || out.some((m) => m.url === url)) continue
    out.push({ name, url, icon: isMethodIcon(x.icon) ? x.icon : guessMethodIcon(url) })
    if (out.length >= 6) break
  }
  return out
}

/** Способ из одной ссылки (старый Hub): название по значку или по адресу. */
export function methodFromLink(link: string): DonMethod | null {
  if (!link) return null
  const icon = guessMethodIcon(link)
  let name = DON_METHOD_NAMES[icon]
  if (icon === 'link') {
    try {
      name = new URL(link).hostname.replace(/^www\./, '').slice(0, 32)
    } catch {
      /* оставим «Ссылка» */
    }
  }
  return { name, url: link, icon }
}

const isBadge = (v: unknown): v is DonBadge => typeof v === 'string' && (DON_BADGES as readonly string[]).includes(v)

/** Стиль одного ника; null — ни одного признака. */
export function parseStyle(x: unknown): DonStyle | null {
  if (!isObj(x)) return null
  const st: DonStyle = {}
  const color = str(x.color, 10).toLowerCase()
  if (color && isColor(color)) st.color = color
  const emoji = cleanEmoji(x.emoji)
  if (emoji) st.emoji = emoji
  if (isBadge(x.badge)) st.badge = x.badge
  if (x.glow === true || x.glow === 1) st.glow = true
  return Object.keys(st).length ? st : null
}

/** Стили из публичного ответа: { ник в нижнем регистре: стиль }, не больше 50. Объект без прототипа. */
export function parseStyles(v: unknown): Record<string, DonStyle> {
  const out: Record<string, DonStyle> = Object.create(null)
  if (!isObj(v)) return out
  let n = 0
  for (const [k, x] of Object.entries(v)) {
    const key = str(k, 32).trim().toLowerCase()
    const st = parseStyle(x)
    if (!key || !st) continue
    out[key] = st
    if (++n >= 50) break
  }
  return out
}

export function parseLevels(v: unknown): DonLevel[] {
  const out: DonLevel[] = []
  for (const x of arr(v, 8)) {
    if (!isObj(x)) continue
    const color = str(x.color, 10).toLowerCase()
    const from = num(x.from, -1)
    if (from <= 0 || !isColor(color)) continue
    out.push({ from, name: str(x.name, 24), color })
  }
  return out.sort((a, b) => a.from - b.from)
}

const level = (v: unknown, n: number): number => {
  const i = num(v, -1)
  return Number.isInteger(i) && i >= 0 && i < n ? i : -1
}

function parseCampaignPublic(x: unknown, nLevels: number): DonCampaignPublic | null {
  if (!isObj(x)) return null
  const goal = num(x.goal)
  const title = str(x.title, 60)
  if (!title || goal <= 0) return null
  return {
    id: num(x.id),
    title,
    goal,
    cur: str(x.cur, 4) || '₽',
    descr: str(x.descr, 300),
    link: safeLink(x.link),
    ...((): Pick<DonCampaignPublic, 'methods' | 'claimable'> => {
      // Новый Hub всегда присылает methods (хотя бы пустой список); старый — только link.
      const claimable = Array.isArray(x.methods)
      const methods = parseMethods(x.methods)
      const one = methods.length ? null : methodFromLink(safeLink(x.link))
      return { methods: one ? [one] : methods, claimable }
    })(),
    starts: optTime(x.starts),
    ends: optTime(x.ends),
    raised: Math.max(0, num(x.raised)),
    pct: Math.max(0, num(x.pct)),
    count: Math.max(0, num(x.count)),
    donors: Math.max(0, num(x.donors)),
    byLevel: arr(x.byLevel, nLevels).map((v) => Math.max(0, num(v))),
    below: Math.max(0, num(x.below)),
    wall: arr(x.wall, 60)
      .filter(isObj)
      .map((w) => ({ nick: str(w.nick, 32), total: num(w.total), level: level(w.level, nLevels) }))
      .filter((w) => w.nick && w.total > 0),
    recent: arr(x.recent, 8)
      .filter(isObj)
      .map((r) => ({ nick: str(r.nick, 32), amount: num(r.amount), at: num(r.at), level: level(r.level, nLevels) }))
      .filter((r) => r.nick && r.amount > 0)
  }
}

/** Ответ GET /donations → проверенные данные; null — ответ не похож на ожидаемый. */
export function parseDonationsPublic(v: unknown): DonationsPublic | null {
  if (!isObj(v) || v.ok !== true || !Array.isArray(v.campaigns)) return null
  const levels = parseLevels(v.levels)
  const campaigns = arr(v.campaigns, 3)
    .map((c) => parseCampaignPublic(c, levels.length))
    .filter((c): c is DonCampaignPublic => Boolean(c))
  return { levels, campaigns, styles: parseStyles(v.styles), at: num(v.at) }
}

/** Ответ /admin/donations* → данные для «Админки». */
export function parseDonationsAdmin(v: unknown): DonationsAdmin {
  const o = isObj(v) ? v : {}
  const levels = parseLevels(o.levels)
  const n = levels.length
  const campaigns = arr(o.campaigns, 40)
    .filter(isObj)
    .map((c) => ({
      id: num(c.id),
      title: str(c.title, 60),
      goal: num(c.goal),
      cur: str(c.cur, 4) || '₽',
      descr: str(c.descr, 300),
      link: safeLink(c.link),
      methods: ((): DonMethod[] => {
        const m = parseMethods(c.methods)
        const one = m.length ? null : methodFromLink(safeLink(c.link))
        return one ? [one] : m
      })(),
      active: c.active === true,
      starts: optTime(c.starts),
      ends: optTime(c.ends),
      at: num(c.at),
      raised: num(c.raised),
      pct: num(c.pct),
      count: num(c.count),
      donors: num(c.donors),
      byLevel: arr(c.byLevel, n).map((x) => num(x)),
      below: num(c.below)
    }))
  const donations = arr(o.donations, 5000)
    .filter(isObj)
    .map((d) => ({ id: num(d.id), camp: num(d.camp), nick: str(d.nick, 32), amount: num(d.amount), at: num(d.at), note: str(d.note, 200), level: level(d.level, n) }))
  const palette: Record<string, string> = {}
  if (isObj(o.palette)) for (const [k, c] of Object.entries(o.palette)) if (/^[a-z]{3,10}$/.test(k) && typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)) palette[k] = c.toLowerCase()
  const claims = arr(o.claims, 200)
    .filter(isObj)
    .map((c) => ({
      id: num(c.id),
      camp: num(c.camp),
      nick: str(c.nick, 32),
      amount: num(c.amount),
      method: str(c.method, 32),
      note: str(c.note, 200),
      at: num(c.at),
      status: (c.status === 'ok' || c.status === 'no' ? c.status : 'wait') as DonClaimStatus,
      install: str(c.install, 32).replace(/[^0-9a-f]/gi, '').slice(0, 6)
    }))
    .filter((c) => c.id > 0)
  const styles = arr(o.styles, 60)
    .filter(isObj)
    .map((x) => {
      const st = parseStyle(x)
      return { nick: str(x.nick, 32).trim(), color: st?.color ?? null, emoji: st?.emoji ?? null, badge: st?.badge ?? null, glow: st?.glow === true }
    })
    .filter((x) => x.nick)
  return {
    levels,
    campaigns,
    donations,
    maxActive: num(o.maxActive, 3),
    defaultLink: safeLink(o.defaultLink),
    palette,
    claims,
    styles,
    hasClaims: Array.isArray(o.claims),
    hasStyles: Array.isArray(o.styles)
  }
}

// ---- Заявки «Я отправил пожертвование»: локальная история (Б8) -------------------------------

/** Своя заявка, как её помнит программа. Статус меняется по ответу автора (don_ok / don_no). */
export interface LocalClaim {
  id: number
  camp: number
  /** Название сбора на момент отправки. */
  title: string
  amount: number
  cur: string
  nick: string
  method: string
  at: number
  status: DonClaimStatus
  /** Текст ответа автора (причина отказа или благодарность). */
  answer?: string
  decided?: number
}

export const CLAIMS_KEPT = 10
const CLAIM_DONE_TTL_MS = 60 * 24 * 60 * 60 * 1000

/** Запись из файла состояния или ответа сервера. null — повреждена. */
export function cleanLocalClaim(x: unknown): LocalClaim | null {
  if (!isObj(x)) return null
  const id = num(x.id)
  const amount = num(x.amount)
  const at = num(x.at)
  if (!Number.isSafeInteger(id) || id <= 0 || amount <= 0 || at <= 0) return null
  const c: LocalClaim = {
    id,
    camp: num(x.camp),
    title: str(x.title, 60),
    amount,
    cur: str(x.cur, 4) || '₽',
    nick: str(x.nick, 32),
    method: str(x.method, 32),
    at,
    status: x.status === 'ok' || x.status === 'no' ? x.status : 'wait'
  }
  const answer = str(x.answer, 600).trim()
  if (answer) c.answer = answer
  if (num(x.decided) > 0) c.decided = num(x.decided)
  return c
}

/** Новые сверху; решённые старше 60 дней удаляются; всего не больше CLAIMS_KEPT. */
export function pruneClaims(list: LocalClaim[], now: number = Date.now()): LocalClaim[] {
  return [...list]
    .filter((c) => c.status === 'wait' || now - (c.decided ?? c.at) < CLAIM_DONE_TTL_MS)
    .sort((a, b) => b.at - a.at)
    .slice(0, CLAIMS_KEPT)
}

/**
 * Ответы автора по заявкам: уведомление вида don_ok / don_no с ref = id заявки меняет её статус.
 * Возвращает новый список (или тот же, если ничего не поменялось).
 */
export function applyClaimAnswers(list: LocalClaim[], notes: { kind: string; ref?: string; text: string; at: number }[]): LocalClaim[] {
  let changed = false
  const next = list.map((c) => {
    const n = notes.find((x) => (x.kind === 'don_ok' || x.kind === 'don_no') && x.ref === String(c.id))
    if (!n) return c
    const status: DonClaimStatus = n.kind === 'don_ok' ? 'ok' : 'no'
    if (c.status === status && c.answer === n.text) return c
    changed = true
    return { ...c, status, answer: n.text, decided: n.at }
  })
  return changed ? next : list
}

/** Сумма из поля: «1 500», «99,5», «500 ₽». null — не число или вне пределов. */
export function parseAmountText(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 && v <= 100_000_000 ? Math.round(v * 100) / 100 : null
  if (typeof v !== 'string') return null
  const t = v.replace(/[\s\u00a0₽$€₸]/g, '').replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null
  const n = Number(t)
  return n > 0 && n <= 100_000_000 ? n : null
}

/** Код ошибки сервера по заявке → понятный текст. */
export function claimErrorText(error: string): string {
  switch (error) {
    case 'limit':
      return 'Уже есть заявки на проверке — дождитесь ответа.'
    case 'blocked':
      return 'Отправка заявок с этой установки отключена.'
    case 'camp':
      return 'Этот сбор уже завершён. Обновите страницу «Поддержка».'
    case 'bad':
      return 'Сервер не принял данные: проверьте сумму и ник.'
    case 'too_often':
    case 'rate':
    case 'busy':
      return 'Сейчас слишком много заявок. Попробуйте позже.'
    case 'network':
      return 'Сервер недоступен. Проверьте подключение к интернету и попробуйте позже.'
    case 'unsupported':
      return 'Сервер пока не принимает заявки. Напишите автору через «Отчёт в поддержку» или в Telegram.'
    default:
      return 'Не удалось отправить заявку. Попробуйте позже.'
  }
}
