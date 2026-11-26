/**
 * Сбор пожертвований: вызовы IPC (src/main/core/hub-donations.ts — публичный сбор,
 * src/main/core/hub-admin.ts — правки автора) и общие расчёты для окна.
 * Типы повторяют src/main/core/hub-donations-logic.ts.
 */

import type { HubInbox } from './hub-api'

interface IpcResult<T> {
  ok: boolean
  value?: T
  message?: string
}

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const res = (await window.electron.ipcRenderer.invoke(channel, ...args)) as IpcResult<T>
  if (!res || !res.ok) throw new Error(res?.message ?? `IPC ${channel} failed`)
  return res.value as T
}

export interface DonLevel {
  from: number
  name: string
  /** Ключ набора (gray, violet, gold…) или #rrggbb. */
  color: string
}

export interface DonWallItem {
  nick: string
  total: number
  level: number
}

export interface DonRecentItem {
  nick: string
  amount: number
  at: number
  level: number
}

export type DonMethodIcon = 'donationalerts' | 'cryptobot' | 'boosty' | 'tribute' | 'yoomoney' | 'patreon' | 'kofi' | 'card' | 'crypto' | 'link'

export const DON_METHOD_ICONS: DonMethodIcon[] = ['donationalerts', 'cryptobot', 'boosty', 'tribute', 'yoomoney', 'patreon', 'kofi', 'card', 'crypto', 'link']

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

/** Способ оплаты в сборе. */
export interface DonMethod {
  name: string
  url: string
  icon: DonMethodIcon
}

export type DonBadge = 'crown' | 'star' | 'fire' | 'diamond' | 'heart' | 'bolt'
export const DON_BADGES: DonBadge[] = ['crown', 'star', 'fire', 'diamond', 'heart', 'bolt']
export const DON_BADGE_RU: Record<DonBadge, string> = {
  crown: 'Корона',
  star: 'Звезда',
  fire: 'Огонь',
  diamond: 'Бриллиант',
  heart: 'Сердце',
  bolt: 'Молния'
}

/** Личный стиль ника поверх цвета уровня. */
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
  methods: DonMethod[]
  /** Hub принимает заявки «Я отправил пожертвование». */
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
  /** Ключ — ник в нижнем регистре. */
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

export interface DonClaimAdmin {
  id: number
  camp: number
  nick: string
  amount: number
  method: string
  note: string
  at: number
  status: DonClaimStatus
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
  hasClaims: boolean
  hasStyles: boolean
  /** id созданной записи или сбора (после добавления). */
  id?: number
}

export interface DonSave {
  id?: number
  camp?: number
  nick?: string
  amount?: number | string
  note?: string
  at?: number
}

export interface CampSave {
  id?: number
  title?: string
  goal?: number | string
  cur?: string
  descr?: string
  link?: string
  starts?: number | null
  ends?: number | null
  active?: boolean
  methods?: DonMethod[]
}

/** Своя заявка «Я отправил пожертвование» (хранится в программе). */
export interface LocalClaim {
  id: number
  camp: number
  title: string
  amount: number
  cur: string
  nick: string
  method: string
  at: number
  status: DonClaimStatus
  answer?: string
  decided?: number
}

export interface ClaimInput {
  camp: number
  title: string
  cur: string
  amount: string
  nick: string
  method?: string
  note?: string
}

export type ClaimResult = { ok: true; claim: LocalClaim } | { ok: false; error: string; message: string }

export interface StyleSave {
  nick: string
  color: string | null
  emoji: string | null
  badge: DonBadge | null
  glow: boolean
}

/** Публичный сбор (кэш 10 минут в главном процессе). null — нет связи или тестовая среда. */
export const donationsGet = (force = false): Promise<DonationsPublic | null> => invoke('hubDon:get', force)

export const adminDonations = (): Promise<DonationsAdmin> => invoke('hubAdmin:donations')
export const adminDonSave = (d: DonSave): Promise<DonationsAdmin> => invoke('hubAdmin:donSave', d)
export const adminDonDelete = (id: number): Promise<DonationsAdmin> => invoke('hubAdmin:donDelete', id)
export const adminCampSave = (c: CampSave): Promise<DonationsAdmin> => invoke('hubAdmin:campSave', c)
export const adminCampDelete = (id: number): Promise<DonationsAdmin> => invoke('hubAdmin:campDelete', id)
/** null — уровни по умолчанию. */
export const adminLevelsSave = (levels: DonLevel[] | null): Promise<DonationsAdmin> => invoke('hubAdmin:levelsSave', levels)
/** Решение по заявке: 'ok' (amount — другая сумма) или 'no' (reason — причина). */
export const adminClaimDecide = (id: number, action: 'ok' | 'no', extra?: { amount?: number; reason?: string }): Promise<DonationsAdmin> =>
  invoke('hubAdmin:claimDecide', id, action, extra ?? {})
export const adminStyleSave = (st: StyleSave): Promise<DonationsAdmin> => invoke('hubAdmin:styleSave', st)
export const adminStyleDelete = (nick: string): Promise<DonationsAdmin> => invoke('hubAdmin:styleDelete', nick)

/** «Я отправил пожертвование»: заявка автору (один запрос, только по кнопке). */
export const donClaim = (c: ClaimInput): Promise<ClaimResult> => invoke('hub:donClaim', c)
/** Убрать решённую заявку из своего списка. */
export const donClaimForget = (id: number): Promise<HubInbox> => invoke('hub:claimForget', id)

/** Стиль ника из ответа /donations (без унаследованных ключей вроде «constructor»). */
export function styleOf(styles: Record<string, DonStyle> | undefined, nick: string): DonStyle | undefined {
  if (!styles) return undefined
  const k = nick.trim().toLowerCase()
  return Object.prototype.hasOwnProperty.call(styles, k) ? styles[k] : undefined
}

/** Значок по ссылке (как в Hub): для подсказки в редакторе способов. */
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

/** Эмодзи (как cleanEmoji в Hub): 1–8 символов, без латиницы, цифр и пробелов. */
export function emojiOk(v: string): boolean {
  const t = v.trim()
  const n = Array.from(t).length
  return n >= 1 && n <= 8 && !/[A-Za-z0-9\s]/.test(t)
}

// ---- Цвета и уровни ----------------------------------------------------------------------------

/** Тот же набор, что в Hub (donations-logic.js). */
export const DON_PALETTE: Record<string, string> = {
  gray: '#9ca3af',
  violet: '#8b5cf6',
  gold: '#f5b301',
  blue: '#3b82f6',
  cyan: '#06b6d4',
  green: '#22c55e',
  orange: '#f97316',
  red: '#ef4444',
  pink: '#ec4899'
}

export const DON_PALETTE_RU: Record<string, string> = {
  gray: 'Серый',
  violet: 'Фиолетовый',
  gold: 'Золотой',
  blue: 'Синий',
  cyan: 'Бирюзовый',
  green: 'Зелёный',
  orange: 'Оранжевый',
  red: 'Красный',
  pink: 'Розовый'
}

export const DON_DEFAULT_LEVELS: DonLevel[] = [
  { from: 10, name: 'Обычный', color: 'gray' },
  { from: 100, name: 'Фиолетовый', color: 'violet' },
  { from: 500, name: 'Золотой', color: 'gold' }
]

/** Основной цвет уровня (#rrggbb). */
export function levelHex(color: string | undefined): string {
  if (!color) return DON_PALETTE.gray
  if (/^#[0-9a-f]{6}$/i.test(color)) return color.toLowerCase()
  return DON_PALETTE[color] ?? DON_PALETTE.gray
}

/** Номер уровня для суммы (самый высокий порог ≤ суммы) или −1. */
export function levelOf(levels: DonLevel[], amount: number): number {
  let idx = -1
  levels.forEach((l, i) => {
    if (amount >= l.from) idx = i
  })
  return idx
}

/** Самый высокий уровень «золотой»: ему достаётся лёгкое свечение. */
export const isTopLevel = (levels: DonLevel[], i: number): boolean => i >= 0 && i === levels.length - 1 && levels.length > 1

/** «1 500 ₽», «99,5 $». */
export function money(n: number, cur = '₽'): string {
  return `${n.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ${cur}`.trim()
}

/** «1–99», «от 500» — диапазон уровня. */
export function levelRange(levels: DonLevel[], i: number): string {
  const l = levels[i]
  const next = levels[i + 1]
  if (!l) return ''
  if (!next) return `от ${l.from.toLocaleString('ru-RU')}`
  const to = Math.round((next.from - (Number.isInteger(next.from) && Number.isInteger(l.from) ? 1 : 0.01)) * 100) / 100
  return `${l.from.toLocaleString('ru-RU')}–${to.toLocaleString('ru-RU')}`
}
