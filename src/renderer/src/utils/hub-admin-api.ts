/**
 * Режим автора: вызовы IPC главного процесса (src/main/core/hub-admin.ts).
 * Окно знает только «привязка есть / нет»; ключ сюда не передаётся никогда.
 */

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

export interface AdminState {
  available: boolean
  paired: boolean
  until: number | null
}

export type PairResult = { ok: true; until: number } | { ok: false; message: string }

export type AnnounceOs = 'all' | 'win' | 'mac' | 'linux'

/** Условие объявления: система и версия ('' — все, '<1.3.0', '>=1.3.0'). */
export interface AnnounceCond {
  os: AnnounceOs
  ver: string
}

export interface AdminAnnounce {
  id: number | string
  text: string
  at: number
  until: number
  os: AnnounceOs
  ver: string
  /** «всем», «Windows, версии ниже 1.3.0». */
  label: string
  re: number | string | null
  /** Оформление (Б12); старый Hub не присылает. */
  emoji?: string | null
  accent?: string | null
}

export interface AdminWhoami {
  install: string
  until: number
  announce: { text: string; until: number } | null
  /** Все активные (до maxActive), новые сверху. */
  announces: AdminAnnounce[]
  maxActive: number
  /** Текущая версия программы по данным Hub (последний релиз). */
  latest: string | null
  dns: { version: number; updated: string } | null
}

/** Распределение по версиям и системам. */
export interface VersionSummary {
  total: number
  win: number
  mac: number
  linux?: number
  otherOs: number
  latest: string | null
  atLatest: number
  below: number
  unknownVer: number
  versions: { v: string; n: number }[]
}

export interface AdminStats {
  counter: { online: number | null; total: number | null; day: number | null; week: number | null; month: number | null; peak: number | null } | null
  report: number
  theme: number
  idea: number
  pendingThemes: number
  banned: number
  newSincePrev: number | null
  /** Старый Hub этого блока не присылает. */
  versions?: { latest: string | null; latestSource: string | null; now: VersionSummary; day: VersionSummary; week: VersionSummary } | null
  /** Расход бесплатных лимитов Cloudflare (Hub с поддержкой аналитики). Старый Hub не присылает. */
  cf?: CfUsage | null
}

export interface CfUsageRow {
  key: string
  label: string
  today: number
  yesterday: number
  limit: number
}

/** Ресурсы Cloudflare: сутки по UTC, сегодня — с 00:00 UTC до момента сводки. */
export interface CfUsage {
  ok: boolean
  /** no_token — в Hub не заданы CF_API_TOKEN / CF_ACCOUNT_ID; api — аналитика не ответила. */
  error?: 'no_token' | 'api'
  message?: string
  at?: number
  rows?: CfUsageRow[]
  errors?: { today: number; yesterday: number }
  cpuP99Ms?: number | null
  cpuLimitMs?: number
  rowsNote?: string
  maxPct?: number
}

export interface DnsAddrs {
  ipv4: string[]
  ipv6: string[]
  doh: string
  dohOnly: boolean
}

export interface DnsEdit {
  id: string
  name: string
  before: DnsAddrs
  after: DnsAddrs
}

/** Локально, без сети. */
export const adminState = (): Promise<AdminState> => invoke('hubAdmin:state')
/** Код из бота → запрос → «Да» в Telegram. Ждёт до ~2 минут. */
export const adminPair = (code: string): Promise<PairResult> => invoke('hubAdmin:pair', code)
export const adminPairCancel = (): Promise<void> => invoke('hubAdmin:pairCancel')
export const adminUnpair = (): Promise<{ serverOk: boolean }> => invoke('hubAdmin:unpair')
export const adminWhoami = (): Promise<AdminWhoami> => invoke('hubAdmin:whoami')
export const adminAnnounce = (
  text: string,
  days: 1 | 3 | 7,
  cond?: AnnounceCond & { re?: number | string | null; emoji?: string | null; accent?: string | null }
): Promise<AdminAnnounce> =>
  invoke('hubAdmin:announce', text, days, cond)
/** id — снять одно; без id — все. */
export const adminAnnounceOff = (id?: number | string): Promise<boolean> => invoke('hubAdmin:announceOff', id)
/** Сколько программ подходит условию: сейчас (~35 минут) и за сутки. */
export const adminAudience = (cond: AnnounceCond): Promise<{ now: number; day: number; label: string }> => invoke('hubAdmin:audience', cond)
export const adminStats = (): Promise<AdminStats> => invoke('hubAdmin:stats')
/** Локально: встроенные DNS, изменённые на этом устройстве. */
export const adminDnsDiff = (): Promise<DnsEdit[]> => invoke('hubAdmin:dnsDiff')
export const adminDnsPublish = (ids: string[]): Promise<{ version: number }> => invoke('hubAdmin:dnsPublish', ids)

/** Убранная автором запись каталога. */
export interface DnsRemovedInfo {
  id: string
  name: string
  reason: string
  at?: string
  builtin: boolean
}

export interface DnsPlan {
  add: DnsAddition[]
  available: { id: string; name: string }[]
  edits: DnsEdit[]
  /** Отмечены «убрать у всех», ещё не опубликованы. */
  remove: { id: string; name: string; reason: string }[]
  /** Отмечены «вернуть», ещё не опубликованы. */
  restore: { id: string; name: string }[]
  /** Уже убраны в каталоге. */
  removed: DnsRemovedInfo[]
}

export interface DnsAddition extends DnsAddrs {
  id: string
  name: string
  description: string
  tags: string[]
  site?: string
}

/** Локально: правки, отметки «убрать / вернуть» и уже убранные. */
export const adminDnsPlan = (): Promise<DnsPlan> => invoke('hubAdmin:dnsPlan')
export const adminDnsStageAddition = (preset: DnsAddition): Promise<DnsPlan> => invoke('hubAdmin:dnsStageAddition', preset)
/** Отметить «убрать у всех» (публикуется кнопкой в «Панели автора»). */
export const adminDnsMarkRemove = (id: string, reason: string): Promise<DnsPlan> => invoke('hubAdmin:dnsMarkRemove', id, reason)
export const adminDnsMarkRestore = (id: string): Promise<DnsPlan> => invoke('hubAdmin:dnsMarkRestore', id)
export const adminDnsUnmark = (id: string): Promise<DnsPlan> => invoke('hubAdmin:dnsUnmark', id)
/** Правки, «убрать» и «вернуть» одним запросом (списки id). */
export const adminDnsPublishPlan = (pick: { add?: string[]; edits: string[]; remove: string[]; restore: string[] }): Promise<{ version: number }> =>
  invoke('hubAdmin:dnsPublish', pick)

export function onAdminChanged(cb: (s: AdminState) => void): () => void {
  const listener = (_e: unknown, s: AdminState): void => cb(s)
  // Отписка — функцией, которую вернул on(): removeListener через contextBridge получает другую обёртку
  // функции и слушателя не находит.
  return window.electron.ipcRenderer.on('hubAdmin:changed', listener)
}

// ---- Предупреждения и шаблоны (Б13) -------------------------------------------------------------

export type TplUse = 'warn' | 'ban' | 'reply' | 'don_no' | 'any'

export const TPL_USE_RU: Record<TplUse, string> = {
  warn: 'Предупреждение',
  ban: 'Блокировка',
  reply: 'Ответ',
  don_no: 'Отказ по заявке',
  any: 'Любой'
}

export interface AdminTemplate {
  id: string
  name: string
  text: string
  use: TplUse
}

export interface AdminWarn {
  id: number
  install: string
  lvl: 'yellow' | 'red'
  kind: 'warn' | 'ban'
  text: string
  at: number
  /** Когда человек нажал «Понятно»; null — ещё не прочитано. */
  ack: number | null
}

export const adminTemplates = (): Promise<{ templates: AdminTemplate[]; sign: string }> => invoke('hubAdmin:templates')
export const adminTemplatesSave = (templates: AdminTemplate[], sign: string): Promise<{ templates: AdminTemplate[]; sign: string }> =>
  invoke('hubAdmin:templatesSave', templates, sign)
export const adminWarns = (): Promise<AdminWarn[]> => invoke('hubAdmin:warns')
/** install — код установки (6–32 знака из сообщения бота). */
export const adminWarn = (install: string, lvl: 'yellow' | 'red', text: string): Promise<{ id: number }> => invoke('hubAdmin:warn', install, lvl, text)
