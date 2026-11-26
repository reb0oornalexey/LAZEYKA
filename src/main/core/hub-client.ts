/**
 * LAZEYKA Hub — клиентская часть: объявления и ответы автора, отчёт в
 * поддержку, идеи и темы для галереи. В программе нет ключей: только публичный
 * адрес Worker. Отправка отчёта, идеи и темы — всегда явное действие человека
 * (кнопка); сама программа делает один лёгкий запрос /inbox: через ~10 секунд после
 * запуска, затем раз в 30 минут и при возврате окна из свёрнутого или трея (не чаще раза в
 * 3 минуты). Кнопка «Проверить» в окне спрашивает сразу.
 *
 * Если анонимный счётчик выключен («Показывать, сколько людей онлайн»),
 * /inbox опрашивается без идентификатора: объявление приходит, ответы — нет.
 * Исключение: 14 дней после того, как человек сам отправил отчёт, идею или тему
 * (и пока тема ждёт решения), идентификатор отправляется — иначе ответ не дойдёт.
 *
 * С 1.3.0 к /inbox добавляются ровно две строки: версия программы и система (win / mac) — по ним сервер
 * отбирает объявления (их бывает до 3 сразу, у каждого свои условия). Если счётчик выключен, добавляется
 * ns=1: сервер не учитывает такой запрос в статистике версий.
 *
 * Новое (ответ автора, решение по теме, объявление) попадает в центр уведомлений
 * (hub-notes.ts): главное окно (одно, не мини-окно) получает событие hub:notify (всплывающее сообщение
 * и звук), а если окно свёрнуто или в трее — ещё и системное уведомление. Одно событие (ключ
 * «источник:id») оповещает один раз; одновременно идёт не больше одного запроса /inbox.
 */
import { hubDisabled } from '../utils/test-env'
import { BrowserWindow, app, dialog, ipcMain } from 'electron'
import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { getAppConfig } from '../config'
import { dataDir } from '../utils/dirs'
import { writeFileAtomic } from '../utils/atomic-write'
import { notifyKindEnabled, showSystemNotification } from '../utils/notifications'
import { logToFile } from '../utils/file-logger'
import { getOnlineCount, getSavedInstallNum } from './online-counter'
import { buildReport, getIspNote, maskForReport, osLabel, type BuiltReport } from './support-report'
import { captureThemePreview, clearSharePreview, galleryInstall, galleryList, galleryPreview, prepareShare, type ShareInput } from './theme-gallery'
import { HUB_URL, POLL_FIRST_MS, POLL_MS, humanizeHubError, parsePending, pollDue, type HubKind, type PendingTheme } from './hub-pure'
import {
  addNotes,
  announceNotes,
  cleanIdList,
  cleanNote,
  markRead,
  noteFromReply,
  notifyTarget,
  parseAnnounces,
  pruneNotes,
  rememberIds,
  removeNote,
  singleFlight,
  unreadCount,
  unackedWarnings,
  ackNote,
  visibleAnnounces,
  type HubAnnounce,
  type HubNote
} from './hub-notes'
import { registerHubAdminIpc } from './hub-admin'
import { registerGallerySocialIpc } from './gallery-social'
import { applyClaimAnswers, claimErrorText, cleanLocalClaim, parseAmountText, pruneClaims, type LocalClaim } from './hub-donations-logic'

export { HUB_URL }

const INBOX_TIMEOUT_MS = 8000
const SEND_TIMEOUT_MS = 30_000
/** После своей отправки ID установки уходит с /inbox ещё столько, даже при выключенном счётчике. */
const ID_AFTER_SEND_MS = 14 * 24 * 60 * 60 * 1000

// ---- Типы (повторяются в renderer/utils/hub-api.ts) ----------------------------------------------

export type { HubNote, HubAnnounce }

export interface HubInbox {
  /** Самое новое из показываемых объявлений (для прежних мест, где ждут одно). */
  announce: HubAnnounce | null
  /** Все показываемые объявления: активные, не закрытые, новые сверху. */
  announces: HubAnnounce[]
  /** Центр уведомлений: новые сверху. */
  notes: HubNote[]
  unread: number
  /** Свои заявки «Я отправил пожертвование», новые сверху. */
  claims: LocalClaim[]
  /** Ник для заявок, запомненный с прошлого раза. */
  claimNick: string
}

export type ClaimResult = { ok: true; claim: LocalClaim } | { ok: false; error: string; message: string }

export type HubSendResult =
  | { ok: true; code?: string; warnings?: string[] }
  | { ok: false; error: string; message: string; retryAfterSec?: number; offerSave: boolean }

// ---- Идентификатор установки (тот же, что у счётчика онлайна) -----------------------------------

function installId(): string {
  const file = path.join(dataDir(), 'online-id')
  try {
    const v = readFileSync(file, 'utf-8').trim()
    if (/^[0-9a-f]{32}$/.test(v)) return v
  } catch {
    /* создадим */
  }
  const id = randomBytes(16).toString('hex')
  try {
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, id, 'utf-8')
  } catch {
    /* не сохранили — пойдёт как новая установка */
  }
  return id
}

async function counterEnabled(): Promise<boolean> {
  try {
    return (await getAppConfig()).onlineStats !== false
  } catch {
    return true
  }
}

// ---- Состояние на диске ----------------------------------------------------------------------------------

interface HubState {
  /** id последнего полученного ответа: с него сервер отдаёт новые. */
  lastShownId: number
  /** id закрытых объявлений (последние 30). */
  dismissed: string[]
  /** id объявлений, о которых уже было уведомление (последние 30). */
  notified: string[]
  /** Объявления по последнему ответу сервера (уже отобранные под эту версию и систему). */
  announces: HubAnnounce[]
  notes: HubNote[]
  /** До какого времени ID установки отправляется с /inbox при выключенном счётчике (после своей отправки). */
  idUntil: number
  /** Мои темы, ожидающие решения автора (по данным сервера; до первого ответа — локальная отметка). */
  pending: PendingTheme[]
  /** Мои заявки о пожертвовании (только локально; статус — по ответам автора). */
  claims: LocalClaim[]
  claimNick: string
}

let state: HubState | null = null
const stateFile = (): string => path.join(dataDir(), 'hub-state.json')

function loadState(): HubState {
  if (state) return state
  const s: HubState = { lastShownId: 0, dismissed: [], notified: [], announces: [], notes: [], idUntil: 0, pending: [], claims: [], claimNick: '' }
  try {
    const raw = JSON.parse(readFileSync(stateFile(), 'utf-8')) as Partial<HubState> & {
      replies?: unknown
      notifiedId?: unknown
      announce?: unknown
      dismissedAnnounce?: unknown
      notifiedAnnounce?: unknown
    }
    s.lastShownId = Number.isSafeInteger(raw.lastShownId) ? (raw.lastShownId as number) : 0
    // Прежний файл: одно закрытое / одно показанное объявление строкой.
    const one = (v: unknown): string[] => (typeof v === 'string' && v ? cleanIdList([v.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 30)]) : [])
    s.dismissed = Array.isArray(raw.dismissed) ? cleanIdList(raw.dismissed) : one(raw.dismissedAnnounce)
    s.notified = Array.isArray(raw.notified) ? cleanIdList(raw.notified) : rememberIds(one(raw.notifiedAnnounce), s.dismissed)
    s.announces = Array.isArray(raw.announces) ? parseAnnounces({ announces: raw.announces }) : parseAnnounces({ announce: raw.announce })
    s.idUntil = Number.isFinite(raw.idUntil) ? Number(raw.idUntil) : 0
    s.pending = parsePending(raw.pending).filter((p) => Date.now() - p.at < 14 * 24 * 60 * 60 * 1000)
    s.notes = Array.isArray(raw.notes) ? raw.notes.map(cleanNote).filter((n): n is HubNote => n !== null) : []
    // Прежняя версия хранила только ответы: переносим их в уведомления (без повторного оповещения).
    if (!Array.isArray(raw.notes) && Array.isArray(raw.replies)) {
      for (const r of raw.replies) {
        const n = noteFromReply(r)
        if (n) {
          n.read = Boolean((r as { read?: unknown })?.read)
          s.notes.push(n)
          s.lastShownId = Math.max(s.lastShownId, Number(n.id.slice(1)))
        }
      }
      s.notified = rememberIds(s.notified, s.announces.map((a) => a.id))
    }
    s.notes = pruneNotes(s.notes)
    s.claims = pruneClaims(Array.isArray(raw.claims) ? raw.claims.map(cleanLocalClaim).filter((c): c is LocalClaim => c !== null) : [])
    s.claimNick = clip(raw.claimNick, 32).trim()
  } catch {
    /* первый запуск или повреждённый файл — начнём с чистого */
  }
  state = s
  return s
}

function saveState(): void {
  if (!state) return
  try {
    mkdirSync(path.dirname(stateFile()), { recursive: true })
    writeFileAtomic(stateFile(), JSON.stringify(state))
  } catch {
    /* не критично */
  }
}

// eslint-disable-next-line no-control-regex
const clip = (v: unknown, max: number): string => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, max)

function snapshot(): HubInbox {
  const s = loadState()
  const announces = visibleAnnounces(s.announces, s.dismissed)
  const notes = pruneNotes(s.notes)
  return { announce: announces[0] ?? null, announces, notes, unread: unreadCount(notes), claims: s.claims, claimNick: s.claimNick }
}

/** Окно на экране (не свёрнуто и не в трее)? */
function windowShown(): boolean {
  return BrowserWindow.getAllWindows().some((w) => !w.isDestroyed() && w.isVisible() && !w.isMinimized())
}

function showWindow(): void {
  const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed())
  if (!w) return
  if (w.isMinimized()) w.restore()
  w.show()
  w.focus()
}

/**
 * Новые уведомления: событие одному главному окну (всплывающее сообщение и звук) и системное — если окно
 * скрыто. Мини-окно и окно обновления событие не получают.
 */
function announceFresh(fresh: HubNote[]): void {
  if (!fresh.length) return
  const wins = BrowserWindow.getAllWindows()
  const i = notifyTarget(wins.map((w) => ({ destroyed: w.isDestroyed(), url: w.isDestroyed() ? '' : w.webContents.getURL() })))
  // «Настройки → Уведомления → Сообщения автора» выключено: без всплывашек и звука.
  // Колокольчик и плашка предупреждений (hub:inbox) обновляются как обычно.
  if (!notifyKindEnabled('author')) return
  if (i >= 0) wins[i].webContents.send('hub:notify', fresh)
  if (windowShown()) return
  const last = fresh[0]
  // В режиме стримера текст скрывает сама showSystemNotification.
  showSystemNotification(
    fresh.length === 1 ? `LAZEYKA: ${last.title}` : `LAZEYKA: новых уведомлений — ${fresh.length}`,
    last.text.slice(0, 140),
    showWindow, 'author'
  )
}

function broadcastInbox(): void {
  const payload = snapshot()
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('hub:inbox', payload)
  }
}

// ---- Сеть ------------------------------------------------------------------------------------------------------------

let zapretHintDone = false

/** Провайдер режет workers.dev — один раз за запуск добавляем его в список Zapret (как делает счётчик онлайна). */
async function hintZapret(): Promise<void> {
  if (zapretHintDone) return
  zapretHintDone = true
  try {
    const { addHostsToZapretUserList } = await import('./zapret-iplist')
    if (addHostsToZapretUserList(['workers.dev']) > 0) {
      const { getZapretStatus, restartZapret } = await import('./zapret')
      if (getZapretStatus().state === 'running') await restartZapret().catch(() => void 0)
    }
  } catch {
    /* noop */
  }
}

/** Запрос: сначала сетевой стек Chromium (как браузер), при сбое — fetch Node. */
async function hubFetch(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  // Тестовые запуски (песочница разработчика, LAZEYKA_NO_REMOTE=1) не должны попадать в статистику версий.
  if (hubDisabled() && url.includes('/inbox')) throw new Error('test environment: inbox disabled')
  const signal = AbortSignal.timeout(timeoutMs)
  const opts = { ...init, signal, headers: { 'User-Agent': 'LAZEYKA', ...(init.headers as Record<string, string> | undefined) } }
  try {
    const { net } = await import('electron')
    return await net.fetch(url, opts as Parameters<typeof net.fetch>[1])
  } catch (e) {
    if (signal.aborted) throw e
    return await fetch(url, opts)
  }
}

class NetworkError extends Error {}

interface ServerAnswer {
  ok?: boolean
  code?: string
  error?: string
  retryAfterSec?: number
}

/** POST с одним повтором при сетевой ошибке (ответ сервера, даже с ошибкой, не повторяется). */
async function hubPost(route: string, body: FormData | string, json: boolean, tries = 2): Promise<ServerAnswer & Record<string, unknown>> {
  let lastErr: unknown
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const res = await hubFetch(
        `${HUB_URL}${route}`,
        { method: 'POST', body, headers: json ? { 'Content-Type': 'application/json' } : undefined },
        SEND_TIMEOUT_MS
      )
      const data = (await res.json().catch(() => null)) as (ServerAnswer & Record<string, unknown>) | null
      if (data && typeof data === 'object') return data
      return { ok: false, error: res.status >= 500 ? 'delivery' : res.status === 404 ? 'unsupported' : 'bad_request' }
    } catch (e) {
      lastErr = e
      if (attempt === 0 && tries > 1) {
        void hintZapret()
        await new Promise((r) => setTimeout(r, 2500))
      }
    }
  }
  logToFile({ time: Date.now(), type: 'warn', source: 'app', payload: `Hub: сервер недоступен (${lastErr instanceof Error ? lastErr.message : String(lastErr)})` })
  throw new NetworkError('network')
}

function toResult(kind: HubKind, ans: ServerAnswer, extra?: { warnings?: string[] }): HubSendResult {
  if (ans.ok === true) return { ok: true, code: typeof ans.code === 'string' ? ans.code.slice(0, 12) : undefined, warnings: extra?.warnings }
  const error = typeof ans.error === 'string' ? ans.error : 'delivery'
  const info = humanizeHubError(kind, error, ans.retryAfterSec)
  return { ok: false, error, message: info.message, retryAfterSec: ans.retryAfterSec, offerSave: info.offerSave }
}

function networkResult(kind: HubKind): HubSendResult {
  const info = humanizeHubError(kind, 'network')
  return { ok: false, error: 'network', message: info.message, offerSave: info.offerSave }
}

/** Человек сам отправил отчёт или идею: 14 дней ответы приходят и при выключенном счётчике. */
function rememberSent(r: HubSendResult): HubSendResult {
  if (r.ok) {
    loadState().idUntil = Date.now() + ID_AFTER_SEND_MS
    saveState()
  }
  return r
}

const sending = new Set<HubKind>()

async function guarded(kind: HubKind, run: () => Promise<HubSendResult>): Promise<HubSendResult> {
  if (sending.has(kind)) return { ok: false, error: 'busy_local', message: 'Отправка уже идёт, подождите.', offerSave: false }
  sending.add(kind)
  try {
    return await run()
  } catch (e) {
    if (e instanceof NetworkError) return networkResult(kind)
    throw e
  } finally {
    sending.delete(kind)
  }
}

// ---- Опрос /inbox -------------------------------------------------------------------------------------------------

let timer: ReturnType<typeof setTimeout> | null = null
let stopped = true
let lastPollAt = 0

/** Система для отбора объявлений. На других платформах параметр не отправляется. */
function osTag(): 'win' | 'mac' | 'linux' | null {
  switch (process.platform) {
    case 'win32': return 'win'
    case 'darwin': return 'mac'
    case 'linux': return 'linux'
    default: return null
  }
}

/**
 * Один запрос /inbox. true — сервер ответил (даже если новостей нет).
 * Одновременно идёт не больше одного: первый запрос после запуска, возврат окна и кнопка «Проверить»
 * получают один и тот же результат, а не делают второй запрос и второе уведомление.
 */
const pollInbox = singleFlight(async (): Promise<boolean> => {
  if (hubDisabled()) return false
  lastPollAt = Date.now()
  try {
    const s = loadState()
    const counter = await counterEnabled()
    // Пока тема ждёт решения, идентификатор отправляется и при выключенном счётчике:
    // человек сам отправил тему с ним, а без него решение не придёт.
    const withId = counter || s.pending.length > 0 || s.claims.some((c) => c.status === 'wait') || Date.now() < s.idUntil
    const q = new URLSearchParams()
    if (withId) {
      q.set('install', installId())
      // Уже полученные ответы сервер повторно не присылает (даже если человек их удалил).
      q.set('after', String(s.lastShownId))
      // Счётчик выключен: ID нужен только для ответов, в статистику версий не попадаем.
      if (!counter) q.set('ns', '1')
    }
    // Версия и система — для отбора объявлений («только Windows», «версии ниже 1.3.0»). Больше ничего.
    q.set('v', app.getVersion().slice(0, 20))
    const os = osTag()
    if (os) q.set('os', os)
    const res = await hubFetch(`${HUB_URL}/inbox?${q.toString()}`, { method: 'GET' }, INBOX_TIMEOUT_MS)
    if (!res.ok) return false
    const data = (await res.json().catch(() => null)) as { announce?: unknown; announces?: unknown; replies?: unknown; pending?: unknown } | null
    if (!data || typeof data !== 'object') return false
    s.announces = parseAnnounces(data)
    if (withId) s.pending = parsePending(data.pending)
    const incoming: HubNote[] = []
    if (withId && Array.isArray(data.replies)) {
      for (const x of data.replies.slice(0, 20)) {
        const n = noteFromReply(x)
        if (!n) continue
        s.lastShownId = Math.max(s.lastShownId, Number(n.id.slice(1)))
        incoming.push(n)
      }
    }
    // Новое объявление — тоже уведомление (один раз на объявление; закрытое не повторяется).
    const ann = announceNotes(s.announces, s.notified, s.dismissed)
    s.notified = rememberIds(s.notified, ann.map((n) => n.id.slice(1)))
    incoming.push(...ann)
    const added = addNotes(s.notes, incoming)
    s.notes = added.list
    // Ответ автора по заявке (don_ok / don_no с ref = id заявки) меняет её статус.
    s.claims = applyClaimAnswers(s.claims, incoming)
    announceFresh(added.fresh)
    saveState()
    broadcastInbox()
    // «Понятно», которое раньше не дошло до сервера, — отправляем вместе с удачным запросом.
    void resendAcks()
    return true
  } catch {
    /* ошибки молча: следующая попытка по расписанию */
    return false
  }
})

const HUB_VISIBLE_POLL_MS = 60_000
const HUB_RETURN_GAP_MS = 30_000

function inboxPollDelay(): number {
  const visible = BrowserWindow.getAllWindows().some((window) => !window.isDestroyed() && window.isVisible() && !window.isMinimized())
  return visible ? HUB_VISIBLE_POLL_MS : POLL_MS
}

function schedule(delay: number): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    void pollInbox().finally(() => {
      if (!stopped) schedule(inboxPollDelay())
    })
  }, delay)
  timer.unref?.()
}

/** При возврате в окно обновляем расписание, сохраняя минимальный интервал запросов. */
function onWindowBack(): void {
  if (stopped) return
  if (pollDue(Date.now(), lastPollAt, HUB_RETURN_GAP_MS)) void pollInbox()
  schedule(inboxPollDelay())
}

const watchedWindows = new WeakSet<BrowserWindow>()

function watchWindow(w: BrowserWindow): void {
  if (watchedWindows.has(w) || w.isDestroyed()) return
  watchedWindows.add(w)
  w.on('show', onWindowBack)
  w.on('restore', onWindowBack)
  w.on('focus', onWindowBack)
}

function onWindowCreated(_e: unknown, w: BrowserWindow): void {
  watchWindow(w)
}

/** Запустить опрос: первый запрос после запуска, затем каждую минуту при видимом окне и реже в фоне. */
export function startHubPolling(): void {
  if (hubDisabled()) return
  if (!stopped) return
  stopped = false
  for (const w of BrowserWindow.getAllWindows()) watchWindow(w)
  app.on('browser-window-created', onWindowCreated)
  schedule(POLL_FIRST_MS)
}

/** Остановить таймеры и дописать состояние (вызывать при выходе). */
export function stopHubOnQuit(): void {
  stopped = true
  app.removeListener('browser-window-created', onWindowCreated)
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  saveState()
}

// ---- Отправка ------------------------------------------------------------------------------------------------------------

/** Отчёт, показанный человеку в окне предпросмотра: уходит ровно он. */
let shownReport: BuiltReport | null = null

function installNum(): number | undefined {
  return getOnlineCount()?.num ?? getSavedInstallNum() ?? undefined
}

function sendReport(note: unknown): Promise<HubSendResult> {
  return guarded('report', async () => {
    const rep = shownReport ?? (shownReport = await buildReport())
    const text = String(note ?? '').trim()
    const form = new FormData()
    form.set('install', installId())
    form.set('version', app.getVersion().slice(0, 20))
    form.set('os', osLabel().slice(0, 60))
    form.set('isp', getIspNote())
    const num = installNum()
    if (num) form.set('num', String(num))
    form.set('note', maskForReport(clip(text, 600)))
    form.set('file', new Blob([rep.text], { type: 'text/plain' }), 'lazeyka-report.txt')
    return rememberSent(toResult('report', await hubPost('/report', form, false)))
  })
}

function sendIdea(text: unknown): Promise<HubSendResult> {
  return guarded('idea', async () => {
    const t = clip(text, 1500).trim()
    if (t.length < 5) return { ok: false, error: 'bad_request', message: 'Напишите идею подробнее: хотя бы пару слов.', offerSave: false }
    const body = JSON.stringify({ install: installId(), text: maskForReport(t), version: app.getVersion().slice(0, 20) })
    return rememberSent(toResult('idea', await hubPost('/idea', body, true)))
  })
}

function shareTheme(input: unknown): Promise<HubSendResult> {
  return guarded('theme', async () => {
    const i = (input && typeof input === 'object' ? input : {}) as Partial<ShareInput>
    let parts
    try {
      parts = await prepareShare({ name: String(i.name ?? ''), author: String(i.author ?? ''), theme: String(i.theme ?? ''), bgImage: String(i.bgImage ?? '') })
    } catch (e) {
      return { ok: false, error: 'bad_request', message: e instanceof Error ? e.message : String(e), offerSave: false }
    }
    const form = new FormData()
    form.set('install', installId())
    form.set('name', parts.name)
    form.set('author', parts.author)
    form.set('theme', parts.themeJson)
    form.set('preview', new Blob([new Uint8Array(parts.preview)], { type: 'image/jpeg' }), 'preview.jpg')
    if (parts.wallpaper) {
      const ext = parts.wallpaper.mime === 'image/png' ? 'png' : parts.wallpaper.mime === 'image/webp' ? 'webp' : 'jpg'
      form.set('wallpaper', new Blob([new Uint8Array(parts.wallpaper.buf)], { type: parts.wallpaper.mime }), `wallpaper.${ext}`)
    }
    const res = toResult('theme', await hubPost('/theme', form, false), { warnings: parts.warnings })
    if (res.ok) {
      clearSharePreview()
      // Тема «на проверке» видна автору сразу; точный список потом приходит с /inbox.
      const st = loadState()
      st.pending = [{ name: parts.name, at: Date.now() }, ...st.pending].slice(0, 5)
      st.idUntil = Date.now() + ID_AFTER_SEND_MS
      saveState()
      void pollInbox()
    }
    return res
  })
}

// ---- Заявка «Я отправил пожертвование» (Б8) ---------------------------------------------------------

let claimBusy = false

/**
 * Одна заявка — один запрос POST /donations/claim, только по кнопке «Отправить». Без повтора при сетевой
 * ошибке: иначе автору могла бы прийти одна заявка дважды.
 */
async function sendClaim(input: unknown): Promise<ClaimResult> {
  const i = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const amount = parseAmountText(i.amount)
  const nick = clip(i.nick, 32).replace(/\s+/g, ' ').trim()
  const camp = Number(i.camp)
  if (amount === null) return { ok: false, error: 'bad', message: 'Укажите сумму числом, например 500.' }
  if (!nick) return { ok: false, error: 'bad', message: 'Укажите ник, под которым вас добавить.' }
  if (!Number.isSafeInteger(camp) || camp <= 0) return { ok: false, error: 'camp', message: claimErrorText('camp') }
  if (claimBusy) return { ok: false, error: 'busy_local', message: 'Отправка уже идёт, подождите.' }
  claimBusy = true
  try {
    const method = clip(i.method, 32).trim()
    const note = clip(i.note, 200).replace(/\s+/g, ' ').trim()
    const body = JSON.stringify({ install: installId(), camp, amount, nick, ...(method ? { method } : {}), ...(note ? { note: maskForReport(note) } : {}) })
    let ans: ServerAnswer & Record<string, unknown>
    try {
      ans = await hubPost('/donations/claim', body, true, 1)
    } catch {
      return { ok: false, error: 'network', message: claimErrorText('network') }
    }
    const raw = ans.claim && typeof ans.claim === 'object' ? (ans.claim as Record<string, unknown>) : null
    if (ans.ok !== true || !raw) {
      const code = typeof ans.error === 'string' ? ans.error.slice(0, 20) : 'delivery'
      // Старый Hub не знает этого адреса.
      const error = code === 'not_found' ? 'unsupported' : code
      return { ok: false, error, message: claimErrorText(error) }
    }
    const claim = cleanLocalClaim({
      id: raw.id,
      camp,
      title: clip(i.title, 60),
      amount: Number(raw.amount) || amount,
      cur: clip(i.cur, 4),
      nick: typeof raw.nick === 'string' ? raw.nick : nick,
      method,
      at: Number(raw.at) || Date.now(),
      status: 'wait'
    })
    if (!claim) return { ok: false, error: 'delivery', message: claimErrorText('delivery') }
    const s = loadState()
    s.claims = pruneClaims([claim, ...s.claims.filter((c) => c.id !== claim.id)])
    s.claimNick = nick
    // Ответ автора придёт через /inbox: 14 дней ID установки отправляется и при выключенном счётчике.
    s.idUntil = Date.now() + ID_AFTER_SEND_MS
    saveState()
    broadcastInbox()
    return { ok: true, claim }
  } finally {
    claimBusy = false
  }
}

// ---- «Понятно» у предупреждения (Б13) -----------------------------------------------------------------

async function postAck(serverId: number): Promise<boolean> {
  try {
    const ans = await hubPost('/ack', JSON.stringify({ install: installId(), id: serverId }), true, 1)
    // Старый Hub не знает /ack — повторять бессмысленно, считаем доставленным.
    return ans.ok === true || ans.error === 'unsupported' || ans.error === 'not_found'
  } catch {
    return false
  }
}

/** Отметить предупреждение прочитанным здесь и сообщить серверу (один запрос). */
async function ackWarning(idRaw: unknown): Promise<HubInbox> {
  const id = String(idRaw ?? '')
  const s = loadState()
  const note = s.notes.find((n) => n.id === id)
  if (!note || (note.kind !== 'warn' && note.kind !== 'ban')) return snapshot()
  // Плашка уходит сразу, не дожидаясь сервера.
  s.notes = ackNote(s.notes, id, true)
  saveState()
  broadcastInbox()
  const delivered = await postAck(Number(id.slice(1)))
  if (delivered) {
    const st = loadState()
    st.notes = ackNote(st.notes, id, false)
    saveState()
    broadcastInbox()
  }
  return snapshot()
}

let ackResending = false

async function resendAcks(): Promise<void> {
  if (ackResending) return
  const pending = loadState().notes.filter((n) => n.ackPending)
  if (!pending.length) return
  ackResending = true
  try {
    for (const n of pending.slice(0, 5)) {
      if (await postAck(Number(n.id.slice(1)))) {
        const st = loadState()
        st.notes = ackNote(st.notes, n.id, false)
        saveState()
      }
    }
  } finally {
    ackResending = false
  }
}

/** Удаление предупреждения без «Понятно» — тоже подтверждение прочтения. */
function ackBeforeRemove(ids: string[]): void {
  const s = loadState()
  for (const n of unackedWarnings(s.notes).filter((x) => ids.includes(x.id))) void ackWarning(n.id)
}

async function saveReport(note: unknown): Promise<{ saved: boolean; path?: string }> {
  const rep = shownReport ?? (shownReport = await buildReport())
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const opts: Electron.SaveDialogOptions = {
    title: 'Сохранить отчёт',
    defaultPath: path.join(app.getPath('documents'), `lazeyka-report-${stamp}.txt`),
    filters: [{ name: 'Текстовый файл', extensions: ['txt'] }]
  }
  const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
  if (res.canceled || !res.filePath) return { saved: false }
  const text = String(note ?? '').trim()
  const body = (text ? `Описание проблемы: ${maskForReport(clip(text, 600))}\n\n` : '') + rep.text
  await writeFile(res.filePath, body, 'utf-8')
  return { saved: true, path: res.filePath }
}

// ---- IPC -------------------------------------------------------------------------------------------------------------------------

/** Как h() из utils/ipc.ts: ошибка обработчика уходит в окно как { ok: false, message }. */
function h<T>(fn: (...args: unknown[]) => Promise<T> | T) {
  return async (_event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => {
    try {
      const value = await fn(...args)
      return { ok: true, value }
    } catch (e: unknown) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) }
    }
  }
}

function handle<T>(channel: string, fn: (...args: unknown[]) => Promise<T> | T): void {
  ipcMain.removeHandler(channel)
  ipcMain.handle(channel, h(fn))
}

export function registerHubIpc(): void {
  handle('hub:inbox', async (refresh) => {
    if (refresh === true) await pollInbox()
    return snapshot()
  })
  /** Кнопка «Проверить»: спросить сервер прямо сейчас. reached = false — сервер не ответил. */
  handle('hub:checkNow', async () => {
    const reached = await pollInbox()
    return { reached, inbox: snapshot() }
  })
  /** Мои темы на проверке. */
  handle('hub:pending', () => loadState().pending)
  /** Закрыть объявление: id — это одно, без id — все показанные сейчас (как прежняя кнопка). */
  handle('hub:dismissAnnounce', (id) => {
    const s = loadState()
    const ids = typeof id === 'string' && id ? [id] : visibleAnnounces(s.announces, s.dismissed).map((a) => a.id)
    s.dismissed = rememberIds(s.dismissed, ids)
    // Закрытое уведомление тоже больше не всплывает.
    s.notified = rememberIds(s.notified, ids)
    saveState()
    broadcastInbox()
  })
  const changeNotes = (fn: (list: HubNote[]) => HubNote[]): HubInbox => {
    const s = loadState()
    s.notes = fn(s.notes)
    saveState()
    broadcastInbox()
    return snapshot()
  }
  /** Отметить прочитанными: ids — только эти, без аргумента — все. */
  handle('hub:notesRead', (ids) => changeNotes((l) => markRead(l, Array.isArray(ids) ? ids.map(String) : undefined)))
  handle('hub:markRepliesRead', () => changeNotes((l) => markRead(l)))
  handle('hub:noteRemove', (id) => {
    ackBeforeRemove([String(id ?? '')])
    return changeNotes((l) => removeNote(l, String(id ?? '')))
  })
  handle('hub:notesClear', () => {
    ackBeforeRemove(loadState().notes.map((n) => n.id))
    return changeNotes(() => [])
  })
  /** «Понятно» у предупреждения или сообщения о блокировке: POST /ack, плашка уходит. */
  handle('hub:ack', (id) => ackWarning(id))
  /** «Я отправил пожертвование»: заявка автору (только по кнопке). */
  handle('hub:donClaim', (input) => sendClaim(input))
  /** Убрать решённую заявку из своего списка (только локально). */
  handle('hub:claimForget', (id) => {
    const s = loadState()
    s.claims = s.claims.filter((c) => !(c.id === Number(id) && c.status !== 'wait'))
    saveState()
    broadcastInbox()
    return snapshot()
  })
  handle('hub:buildReport', async (full) => {
    // Без аргумента (старое окно) — полный отчёт, как раньше.
    shownReport = await buildReport({ full: full !== false })
    return { text: shownReport.text, bytes: shownReport.bytes }
  })
  handle('hub:sendReport', (note) => sendReport(note))
  handle('hub:saveReport', (note) => saveReport(note))
  handle('hub:sendIdea', (text) => sendIdea(text))
  handle('hub:galleryList', (force, mode) => galleryList(force === true, mode === 'head' ? 'head' : 'full'))
  handle('hub:galleryPreview', (id) => galleryPreview(String(id ?? '')))
  handle('hub:galleryInstall', (id) => galleryInstall(String(id ?? '')))
  handle('hub:capturePreview', () => captureThemePreview())
  handle('hub:shareTheme', (input) => shareTheme(input))
  // Режим автора: свой модуль, регистрируется вместе с Hub (src/main/utils/ipc.ts не трогаем).
  registerHubAdminIpc()
  // В15–В16: лайки, избранное и обои для просмотра в галерее тем.
  registerGallerySocialIpc(installId)
}

/** ID установки для режима автора (тот же, что у отчётов и /inbox). */
export function hubInstallId(): string {
  return installId()
}
