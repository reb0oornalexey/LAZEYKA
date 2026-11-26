/**
 * Центр уведомлений LAZEYKA Hub: чистая логика без Electron (проверяется node-скриптом).
 * Ответы автора, решения по темам и объявления хранятся списком: не больше 50 штук,
 * прочитанные старше 30 дней удаляются, у каждого — отметка «прочитано».
 */

export type HubNoteKind = 'reply' | 'theme_ok' | 'theme_no' | 'announce' | 'warn' | 'ban' | 'don_ok' | 'don_no'

export const NOTE_KINDS: readonly HubNoteKind[] = ['reply', 'theme_ok', 'theme_no', 'announce', 'warn', 'ban', 'don_ok', 'don_no']
const isKind = (v: unknown): v is HubNoteKind => typeof v === 'string' && (NOTE_KINDS as readonly string[]).includes(v)

/** Цвет акцента объявления: ключ набора сбора (как DON_PALETTE в Hub). */
export const ACCENT_KEYS = ['gray', 'violet', 'gold', 'blue', 'cyan', 'green', 'orange', 'red', 'pink'] as const
export type AccentKey = (typeof ACCENT_KEYS)[number]
const isAccent = (v: unknown): v is AccentKey => typeof v === 'string' && (ACCENT_KEYS as readonly string[]).includes(v)

export interface HubNote {
  /** r<id ответа сервера> или a<id объявления>. */
  id: string
  kind: HubNoteKind
  title: string
  text: string
  at: number
  read: boolean
  /** Предупреждение: жёлтое или красное (warn, ban). */
  lvl?: 'yellow' | 'red'
  /** Ссылка на заявку и т. п. (id заявки у don_ok / don_no). */
  ref?: string
  /** Человек нажал «Понятно» (warn, ban). */
  ack?: boolean
  /** «Понятно» нажато, но сервер об этом ещё не узнал (повтор при следующем удачном /inbox). */
  ackPending?: boolean
  /** Объявление: эмодзи перед заголовком и цвет акцента. */
  emoji?: string
  accent?: AccentKey
}

export const NOTES_MAX = 50
export const NOTES_READ_TTL_MS = 30 * 24 * 60 * 60 * 1000

// eslint-disable-next-line no-control-regex
const clip = (v: unknown, max: number): string => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, max)

/** Эмодзи объявления (как cleanEmoji в Hub): 1–8 символов, без латиницы, цифр и управляющих символов. */
export function noteEmoji(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  const n = Array.from(t).length
  // eslint-disable-next-line no-control-regex
  if (n < 1 || n > 8 || /[A-Za-z0-9\s\u0000-\u001f\u007f\u2028\u2029\u202a-\u202e\u2066-\u2069]/.test(t)) return undefined
  return t
}

/** Вид ответа: от сервера (kind) или, у старого сервера, по тексту. Неизвестный вид — обычный ответ. */
export function replyKind(kind: unknown, label: string, text: string): HubNoteKind {
  if (kind !== 'announce' && isKind(kind)) return kind
  if (/^Тема «/.test(label)) {
    if (/одобрена/i.test(text)) return 'theme_ok'
    if (/не прошла проверку/i.test(text)) return 'theme_no'
  }
  return 'reply'
}

/** Ответ сервера → уведомление. null — запись повреждена. */
export function noteFromReply(x: unknown): HubNote | null {
  if (!x || typeof x !== 'object') return null
  const r = x as Record<string, unknown>
  const id = Number(r.id)
  if (!Number.isSafeInteger(id) || id <= 0) return null
  const text = clip(r.text, 4000).trim()
  if (!text) return null
  const label = clip(r.label, 80).trim() || 'Ответ автора'
  const at = Number(r.at)
  const kind = replyKind(r.kind, label, text)
  const n: HubNote = { id: `r${id}`, kind, title: label, text, at: Number.isFinite(at) && at > 0 ? at : Date.now(), read: false }
  if (kind === 'warn' || kind === 'ban') n.lvl = r.lvl === 'yellow' && kind === 'warn' ? 'yellow' : 'red'
  const ref = cleanRef(r.ref)
  if (ref) n.ref = ref
  // Прочитано на другом устройстве с той же установкой (если сервер сообщит) — плашку не показываем.
  if ((kind === 'warn' || kind === 'ban') && Number(r.ack) > 0) n.ack = true
  return n
}

const cleanRef = (v: unknown): string => (typeof v === 'string' || typeof v === 'number' ? String(v).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 30) : '')

/** Непрочитанные предупреждения и блокировки (плашка вверху окна), новые сверху. */
export const unackedWarnings = (list: HubNote[]): HubNote[] => list.filter((n) => (n.kind === 'warn' || n.kind === 'ban') && !n.ack)

/** Проверка записи из файла состояния. */
export function cleanNote(x: unknown): HubNote | null {
  if (!x || typeof x !== 'object') return null
  const n = x as Record<string, unknown>
  const id = typeof n.id === 'string' && /^[ra][A-Za-z0-9_-]{1,40}$/.test(n.id) ? n.id : ''
  const kind = isKind(n.kind) ? n.kind : null
  const text = clip(n.text, 4000).trim()
  const at = Number(n.at)
  if (!id || !kind || !text || !Number.isFinite(at) || at <= 0) return null
  const out: HubNote = { id, kind, title: clip(n.title, 80).trim() || 'LAZEYKA', text, at, read: n.read === true }
  if (kind === 'warn' || kind === 'ban') {
    out.lvl = n.lvl === 'yellow' && kind === 'warn' ? 'yellow' : 'red'
    if (n.ack === true) out.ack = true
    if (n.ackPending === true && out.ack) out.ackPending = true
  }
  const ref = cleanRef(n.ref)
  if (ref) out.ref = ref
  const emoji = noteEmoji(n.emoji)
  if (emoji) out.emoji = emoji
  if (isAccent(n.accent)) out.accent = n.accent
  return out
}

/** Убрать лишнее: прочитанные старше 30 дней, затем всё сверх 50 (сначала самые старые). */
export function pruneNotes(list: HubNote[], now: number = Date.now()): HubNote[] {
  // Непрочитанное предупреждение («Понятно» не нажато) не удаляется по сроку.
  const kept = list.filter((n) => !(n.read && now - n.at > NOTES_READ_TTL_MS && !((n.kind === 'warn' || n.kind === 'ban') && !n.ack)))
  kept.sort((a, b) => b.at - a.at || (b.id < a.id ? -1 : 1))
  return kept.slice(0, NOTES_MAX)
}

/**
 * Стабильный ключ события: источник + номер на сервере. «announce:<id>» — объявление, «reply:<id>» — ответ
 * автора или решение по теме (у них общий счётчик id на сервере). Вид ответа (reply / theme_ok / theme_no) в
 * ключ не входит: у старого сервера он угадывается по тексту и мог бы дать два ключа одному событию.
 */
export function noteKey(n: Pick<HubNote, 'id' | 'kind'>): string {
  const src = n.kind === 'announce' || n.id.startsWith('a') ? 'announce' : 'reply'
  return `${src}:${n.id.replace(/^[ra]/, '')}`
}

/**
 * Добавить новые уведомления. Уже известные (по ключу события) не дублируются — ни со списком,
 * ни внутри одной пачки. Возвращает итоговый список и то, что действительно новое (для всплывающего
 * сообщения и звука).
 */
export function addNotes(list: HubNote[], incoming: HubNote[], now: number = Date.now()): { list: HubNote[]; fresh: HubNote[] } {
  const keys = new Set(list.map(noteKey))
  const fresh: HubNote[] = []
  for (const n of incoming) {
    const k = noteKey(n)
    if (keys.has(k)) continue
    keys.add(k)
    fresh.push(n)
  }
  const next = pruneNotes([...list, ...fresh], now)
  const left = new Set(next.map((n) => n.id))
  return { list: next, fresh: fresh.filter((n) => left.has(n.id)) }
}

// ---- Объявления: несколько сразу -----------------------------------------------------------------

export interface HubAnnounce {
  id: string
  text: string
  at: number
  until: number
  /** Дополнение: id объявления, которое оно дополняет, и время того объявления. */
  re?: string
  reAt?: number
  /** Эмодзи перед текстом и цвет акцента (Б12). Старый Hub не присылает. */
  emoji?: string
  accent?: AccentKey
}

/** Сколько id закрытых / уже показанных объявлений помнить. */
export const ANNOUNCE_IDS_KEPT = 30
export const ANNOUNCES_MAX = 3

/** Объявление из ответа сервера или файла состояния. null — повреждено. */
export function cleanAnnounce(x: unknown): HubAnnounce | null {
  if (!x || typeof x !== 'object') return null
  const a = x as Record<string, unknown>
  const text = clip(a.text, 2000).trim()
  const id = a.id === undefined || a.id === null ? '' : String(a.id).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 30)
  if (!text || !id) return null
  const at = Number(a.at)
  const until = Number(a.until)
  const out: HubAnnounce = { id, text, at: Number.isFinite(at) ? at : 0, until: Number.isFinite(until) ? until : 0 }
  const re = a.re === undefined || a.re === null ? '' : String(a.re).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 30)
  if (re) {
    out.re = re
    const reAt = Number(a.reAt)
    if (Number.isFinite(reAt) && reAt > 0) out.reAt = reAt
  }
  const emoji = noteEmoji(a.emoji)
  if (emoji) out.emoji = emoji
  if (isAccent(a.accent)) out.accent = a.accent
  return out
}

/**
 * Объявления из ответа /inbox: новый сервер присылает список announces, старый — одно поле announce.
 * Новые сверху, без повторов, не больше ANNOUNCES_MAX.
 */
export function parseAnnounces(data: { announces?: unknown; announce?: unknown }): HubAnnounce[] {
  const raw = Array.isArray(data.announces) ? data.announces : data.announce ? [data.announce] : []
  const seen = new Set<string>()
  const out: HubAnnounce[] = []
  for (const x of raw.slice(0, 10)) {
    const a = cleanAnnounce(x)
    if (!a || seen.has(a.id)) continue
    seen.add(a.id)
    out.push(a)
  }
  return out.sort((a, b) => b.at - a.at).slice(0, ANNOUNCES_MAX)
}

/** Список id без повторов; новые в конце, хранится не больше max последних. */
export function rememberIds(list: string[], ids: string[], max: number = ANNOUNCE_IDS_KEPT): string[] {
  const add = ids.filter(Boolean)
  const next = [...list.filter((x) => !add.includes(x)), ...add]
  return next.slice(-max)
}

/** id из файла состояния: только строки нужного вида, не больше max. */
export function cleanIdList(raw: unknown, max: number = ANNOUNCE_IDS_KEPT): string[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((x): x is string => typeof x === 'string' && /^[A-Za-z0-9_-]{1,30}$/.test(x)).slice(-max)
}

/** Что показывать на главной: активные, не закрытые, новые сверху. */
export function visibleAnnounces(list: HubAnnounce[], dismissed: string[], now: number = Date.now()): HubAnnounce[] {
  const closed = new Set(dismissed)
  return list.filter((a) => !closed.has(a.id) && (!a.until || a.until > now))
}

/** Уведомления о новых объявлениях: по одному на объявление; уже показанные и закрытые — нет. */
export function announceNotes(list: HubAnnounce[], notified: string[], dismissed: string[], now: number = Date.now()): HubNote[] {
  const done = new Set(notified)
  return visibleAnnounces(list, dismissed, now)
    .filter((a) => !done.has(a.id))
    .map((a) => {
      const n: HubNote = { id: `a${a.id}`, kind: 'announce', title: a.re ? 'Дополнение к объявлению' : 'Объявление', text: a.text, at: a.at || now, read: false }
      if (a.emoji) n.emoji = a.emoji
      if (a.accent) n.accent = a.accent
      return n
    })
}

// ---- Доставка уведомления в окно ------------------------------------------------------------------

/**
 * Куда слать событие «пришло новое»: только в одно главное окно. Мини-окно (#/mini) и окно обновления
 * (#/update-window) открывают тот же index.html, но уведомления не показывают. Возвращает индекс окна или -1.
 */
export function notifyTarget(windows: { url: string; destroyed: boolean }[]): number {
  return windows.findIndex((w) => !w.destroyed && !/#\/(mini|update-window)\b/.test(w.url))
}

/** Один запуск в полёте: пока первый не закончился, повторные вызовы получают тот же результат. */
export function singleFlight<T>(fn: () => Promise<T>): () => Promise<T> {
  let running: Promise<T> | null = null
  return () => {
    if (running) return running
    running = (async () => {
      try {
        return await fn()
      } finally {
        running = null
      }
    })()
    return running
  }
}

export function markRead(list: HubNote[], ids?: string[]): HubNote[] {
  const only = ids ? new Set(ids) : null
  return list.map((n) => (!n.read && (!only || only.has(n.id)) ? { ...n, read: true } : n))
}

export function removeNote(list: HubNote[], id: string): HubNote[] {
  return list.filter((n) => n.id !== id)
}

/** «Понятно» у предупреждения: прочитано и подтверждено; pending — сервер ещё не знает. */
export function ackNote(list: HubNote[], id: string, pending: boolean): HubNote[] {
  return list.map((n) => (n.id === id && (n.kind === 'warn' || n.kind === 'ban') ? { ...n, read: true, ack: true, ackPending: pending || undefined } : n))
}

export const unreadCount = (list: HubNote[]): number => list.filter((n) => !n.read).length
