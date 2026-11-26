/**
 * Режим автора в программе: привязка к LAZEYKA Hub и запросы автора
 * (объявление для всех, статистика, каталог встроенных DNS).
 *
 * Как устроена защита (подробно — hub/README.md, «Режим автора»):
 *  - ключ автора выдаёт только Hub и только после двух шагов: одноразовый код из личного
 *    Telegram-бота владельца и кнопка «Да» там же; в программе и в репозитории ключей нет;
 *  - ключ хранится только здесь, в главном процессе, зашифрованным через safeStorage
 *    (DPAPI в Windows, Связка ключей в macOS); без safeStorage привязка не выполняется;
 *  - окно (renderer) ключ не видит: оно знает только «привязка есть / нет», запросы делает
 *    этот модуль; ключ не пишется в логи, отчёт, экспорт настроек и буфер обмена;
 *  - без привязки модуль в сеть не ходит.
 *
 * IPC: hubAdmin:state, hubAdmin:pair, hubAdmin:pairCancel, hubAdmin:unpair, hubAdmin:whoami,
 * hubAdmin:announce, hubAdmin:announceOff, hubAdmin:audience, hubAdmin:stats, hubAdmin:dnsDiff, hubAdmin:dnsPublish,
 * hubAdmin:dnsPlan, hubAdmin:dnsMarkRemove, hubAdmin:dnsMarkRestore, hubAdmin:dnsUnmark,
 * hubAdmin:donations, hubAdmin:donSave, hubAdmin:donDelete, hubAdmin:campSave, hubAdmin:campDelete, hubAdmin:levelsSave,
 * hubAdmin:claimDecide, hubAdmin:styleSave, hubAdmin:styleDelete (сбор пожертвований), hubAdmin:templates,
 * hubAdmin:templatesSave, hubAdmin:warns, hubAdmin:warn (предупреждения и шаблоны), а также публичный hubDon:get (hub-donations.ts).
 * Событие окнам: hubAdmin:changed (привязка появилась или пропала).
 */
import { app, BrowserWindow, ipcMain, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { dataDir } from '../utils/dirs'
import { writeFileAtomic } from '../utils/atomic-write'
import { devHubUrl, HUB_URL } from './hub-pure'
import { loadCatalogCache, loadOverrides, removeOverride } from './dns-catalog-store'
import { validateCatalog, type Catalog, type CatalogPreset } from './dns-catalog-logic'
import { builtinsWithoutOverrides, type DohProvider } from './dns-doh'
import { broadcastChanged, refreshCatalog, removedList, type CatalogStatus, type RemovedInfo } from './dns-catalog'
import { invalidateDonations, registerHubDonationsIpc } from './hub-donations'
import { cleanEmoji, DON_BADGES, DON_METHOD_ICONS, parseDonationsAdmin, safeLink, type DonationsAdmin } from './hub-donations-logic'
import { ACCENT_KEYS } from './hub-notes'

const TIMEOUT_MS = 12_000
const PAIR_POLL_MS = 3000
const PAIR_WAIT_MS = 2 * 60 * 1000 + 10_000

const keyFile = (): string => path.join(dataDir(), 'hub-author.bin')

interface Stored {
  k: string
  until: number
  at: number
}

// ---- хранение ключа ------------------------------------------------------------------

let cached: Stored | null | undefined

/**
 * Проверки с локальным Hub (несобранная программа + LAZEYKA_DEV_HUB_URL=http://127.0.0.1:порт): в песочнице
 * нет хранилища ключей ОС, поэтому ключ живёт только в памяти до закрытия программы и на диск не пишется.
 */
const devKeyInMemory = !app.isPackaged && devHubUrl(process.env.LAZEYKA_DEV_HUB_URL) !== null
const canStore = (): boolean => devKeyInMemory || safeStorage.isEncryptionAvailable()

function readStored(): Stored | null {
  if (cached !== undefined) return cached
  if (devKeyInMemory) return (cached = null)
  cached = null
  try {
    if (!existsSync(keyFile()) || !safeStorage.isEncryptionAvailable()) return null
    const v = JSON.parse(safeStorage.decryptString(readFileSync(keyFile()))) as Partial<Stored>
    if (typeof v.k === 'string' && /^[A-Za-z0-9_-]{43}$/.test(v.k) && Number(v.until) > Date.now()) {
      cached = { k: v.k, until: Number(v.until), at: Number(v.at) || 0 }
    }
  } catch {
    cached = null
  }
  return cached
}

function writeStored(v: Stored): void {
  if (devKeyInMemory) {
    cached = v
    broadcast()
    return
  }
  mkdirSync(path.dirname(keyFile()), { recursive: true })
  writeFileAtomic(keyFile(), safeStorage.encryptString(JSON.stringify(v)))
  cached = v
  broadcast()
}

function wipe(): void {
  cached = null
  try {
    if (existsSync(keyFile())) unlinkSync(keyFile())
  } catch {
    /* файл занят — при следующем запуске ключ всё равно не пройдёт проверку срока/сервера */
  }
  broadcast()
}

function broadcast(): void {
  const st = state()
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('hubAdmin:changed', st)
}

export interface AdminState {
  /** Защищённое хранилище ОС доступно (без него привязка невозможна). */
  available: boolean
  paired: boolean
  /** До какого времени действует привязка. */
  until: number | null
}

/** Только локально: без сети. */
function state(): AdminState {
  const s = readStored()
  let available = false
  try {
    available = canStore()
  } catch {
    available = false
  }
  return { available, paired: Boolean(s), until: s?.until ?? null }
}

// ---- сеть --------------------------------------------------------------------------------

async function installId(): Promise<string> {
  const { hubInstallId } = await import('./hub-client')
  return hubInstallId()
}

class AdminError extends Error {}

async function rawFetch(url: string, init: RequestInit): Promise<Response> {
  const signal = AbortSignal.timeout(TIMEOUT_MS)
  const opts = { ...init, signal, cache: 'no-store' as const, redirect: 'error' as const }
  try {
    const { net } = await import('electron')
    return await net.fetch(url, opts as Parameters<typeof net.fetch>[1])
  } catch (e) {
    if (signal.aborted) throw e
    return await fetch(url, opts)
  }
}

async function postJson(route: string, method: 'POST' | 'PUT' | 'DELETE', body: Record<string, unknown>, key?: string): Promise<{ status: number; data: Record<string, unknown> }> {
  let res: Response
  try {
    res = await rawFetch(`${HUB_URL}${route}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'LAZEYKA', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({ ...body, install: await installId() })
    })
  } catch {
    throw new AdminError('Сервер недоступен. Проверьте подключение к интернету.')
  }
  const data = ((await res.json().catch(() => null)) ?? {}) as Record<string, unknown>
  return { status: res.status, data }
}

/** Запрос автора. 401 — привязка отозвана или истекла: ключ стирается. */
async function adminCall(route: string, method: 'POST' | 'PUT' | 'DELETE', body: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const s = readStored()
  if (!s) throw new AdminError('Режим автора не включён на этом устройстве.')
  const r = await postJson(route, method, body, s.k)
  if (r.status === 401) {
    wipe()
    throw new AdminError('Привязка больше не действует (её отозвали или истёк срок). Привяжите программу заново.')
  }
  if (r.status === 429) throw new AdminError('Слишком много запросов. Подождите минуту.')
  if (r.data.ok !== true) {
    const reason = typeof r.data.reason === 'string' ? `: ${r.data.reason.slice(0, 200)}` : ''
    throw new AdminError(`Сервер не принял запрос (${String(r.data.error ?? r.status).slice(0, 40)})${reason}`)
  }
  return r.data
}

// ---- привязка ------------------------------------------------------------------------------

let pairing: { cancelled: boolean } | null = null

export type PairResult = { ok: true; until: number } | { ok: false; message: string }

async function pair(codeRaw: unknown): Promise<PairResult> {
  if (!canStore()) {
    return { ok: false, message: 'Защищённое хранилище системы недоступно, поэтому ключ негде безопасно сохранить. Привязка не выполнена.' }
  }
  const code = String(codeRaw ?? '').replace(/\D/g, '')
  if (code.length !== 8) return { ok: false, message: 'Код — 8 цифр из сообщения бота.' }
  if (pairing) return { ok: false, message: 'Привязка уже идёт.' }
  const run = { cancelled: false }
  pairing = run
  try {
    const first = await postJson('/admin/pair', 'POST', { code })
    if (first.status !== 200 || typeof first.data.request !== 'string') {
      const err = String(first.data.error ?? '')
      const message =
        err === 'blocked'
          ? 'Слишком много неверных попыток. Привязка с этого адреса закрыта на час.'
          : err === 'full'
            ? 'Уже привязано 3 устройства. Отзовите одно в боте и получите новый код.'
            : err === 'expired'
              ? 'Срок кода истёк. Получите новый код в боте.'
              : 'Код не подошёл. Получите новый код в боте.'
      return { ok: false, message }
    }
    const request = first.data.request
    const deadline = Date.now() + PAIR_WAIT_MS
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, PAIR_POLL_MS))
      if (run.cancelled) return { ok: false, message: 'Привязка отменена.' }
      let st: { status: number; data: Record<string, unknown> }
      try {
        st = await postJson('/admin/pair/status', 'POST', { request })
      } catch {
        continue // сеть мигнула — спросим ещё раз
      }
      const status = st.data.status
      if (status === 'wait') continue
      if (status === 'ok' && typeof st.data.key === 'string' && /^[A-Za-z0-9_-]{43}$/.test(st.data.key)) {
        const until = Number(st.data.until) || Date.now() + 90 * 24 * 60 * 60 * 1000
        writeStored({ k: st.data.key, until, at: Date.now() })
        return { ok: true, until }
      }
      if (status === 'denied') return { ok: false, message: 'Запрос отклонён в Telegram.' }
      if (status === 'full') return { ok: false, message: 'Уже привязано 3 устройства. Отзовите одно в боте.' }
      return { ok: false, message: 'Запрос не подтвердили вовремя. Получите новый код и попробуйте снова.' }
    }
    return { ok: false, message: 'Запрос не подтвердили за 2 минуты. Получите новый код и попробуйте снова.' }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  } finally {
    pairing = null
  }
}

async function unpair(): Promise<{ serverOk: boolean }> {
  const s = readStored()
  if (!s) return { serverOk: true }
  let serverOk = false
  try {
    const r = await postJson('/admin/pair', 'DELETE', {}, s.k)
    serverOk = r.status === 200 || r.status === 401
  } catch {
    serverOk = false
  }
  wipe()
  return { serverOk }
}

// ---- DNS: правки автора → каталог для всех -------------------------------------------------

export interface DnsEdit {
  id: string
  name: string
  before: { ipv4: string[]; ipv6: string[]; doh: string; dohOnly: boolean }
  after: { ipv4: string[]; ipv6: string[]; doh: string; dohOnly: boolean }
}

const addrsOf = (p: DohProvider): DnsEdit['before'] => ({
  ipv4: [p.ip, p.secondaryIp].filter((a): a is string => Boolean(a)),
  ipv6: p.ipv6 ?? [],
  doh: p.url || '',
  dohOnly: Boolean(p.strict)
})

/** Встроенные записи, которые автор изменил у себя (правки поверх каталога). */
function dnsEdits(): DnsEdit[] {
  const ov = loadOverrides()
  const out: DnsEdit[] = []
  for (const b of builtinsWithoutOverrides()) {
    const o = ov[b.id]
    if (!o) continue
    out.push({ id: b.id, name: b.name, before: addrsOf(b), after: { ipv4: o.ipv4, ipv6: o.ipv6, doh: o.doh, dohOnly: o.dohOnly && Boolean(o.doh) } })
  }
  return out
}

/** Полный каталог программы — основа для Hub, если там каталога ещё нет. null — собрать не вышло. */
function localCatalog(): Catalog | null {
  const cache = loadCatalogCache()
  if (cache) return cache.catalog
  const presets: CatalogPreset[] = builtinsWithoutOverrides().map((b) => ({
    id: b.id,
    name: b.name,
    description: (b.description || '').slice(0, 240),
    ...((): Pick<CatalogPreset, 'ipv4' | 'ipv6' | 'doh' | 'dohOnly'> => {
      const a = addrsOf(b)
      return { ipv4: a.ipv4, ipv6: a.ipv6, doh: a.doh, dohOnly: a.dohOnly }
    })(),
    tags: b.tags ?? [],
    ...(b.site ? { site: b.site } : {})
  }))
  const check = validateCatalog(JSON.stringify({ version: 1, updated: new Date().toISOString().slice(0, 10), presets }))
  return check.ok ? check.catalog : null
}

// ---- DNS: «убрать у всех» и «вернуть» — отметки автора до публикации ----------------------

/** Отметки хранятся локально, пока автор не нажмёт «Опубликовать» (или не снимет их). */
interface DnsPending {
  remove: Record<string, string>
  restore: string[]
}

const pendingFile = (): string => path.join(dataDir(), 'hub-author-dns-pending.json')
const ID_OK = /^[a-z0-9][a-z0-9-]{1,31}$/

function loadPending(): DnsPending {
  try {
    if (!existsSync(pendingFile())) return { remove: {}, restore: [] }
    const j = JSON.parse(readFileSync(pendingFile(), 'utf-8')) as Partial<DnsPending>
    const remove: Record<string, string> = {}
    for (const [id, why] of Object.entries(j.remove ?? {})) if (ID_OK.test(id)) remove[id] = String(why ?? '').slice(0, 200)
    const restore = Array.isArray(j.restore) ? j.restore.map(String).filter((id) => ID_OK.test(id)) : []
    return { remove, restore: [...new Set(restore)] }
  } catch {
    return { remove: {}, restore: [] }
  }
}

function savePending(p: DnsPending): void {
  mkdirSync(path.dirname(pendingFile()), { recursive: true })
  writeFileAtomic(pendingFile(), JSON.stringify(p))
  broadcastChanged()
}

/** Причина: одна строка без управляющих символов, до 200 знаков. */
const cleanReason = (v: unknown): string =>
  String(v ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ')
    .trim()
    .slice(0, 200)

export interface DnsPlan {
  edits: DnsEdit[]
  /** Отмечены «убрать у всех», ещё не опубликованы. */
  remove: { id: string; name: string; reason: string }[]
  /** Отмечены «вернуть», ещё не опубликованы. */
  restore: { id: string; name: string }[]
  /** Уже убраны в каталоге. */
  removed: RemovedInfo[]
}

/** Только локально: что автор собирается опубликовать. Отметки, ставшие неактуальными, не показываются. */
function dnsPlan(): DnsPlan {
  if (!readStored()) return { edits: [], remove: [], restore: [], removed: [] }
  const pend = loadPending()
  const removed = removedList()
  const goneIds = new Set(removed.map((r) => r.id))
  const all = builtinsWithoutOverrides()
  const nameOf = (id: string): string => all.find((b) => b.id === id)?.name ?? removed.find((r) => r.id === id)?.name ?? id
  return {
    edits: dnsEdits(),
    remove: Object.entries(pend.remove)
      .filter(([id]) => !goneIds.has(id) && all.some((b) => b.id === id))
      .map(([id, reason]) => ({ id, name: nameOf(id), reason })),
    restore: pend.restore.filter((id) => goneIds.has(id)).map((id) => ({ id, name: nameOf(id) })),
    removed
  }
}

function markRemove(idRaw: unknown, reasonRaw: unknown): DnsPlan {
  if (!readStored()) throw new AdminError('Режим автора не включён на этом устройстве.')
  const id = String(idRaw ?? '')
  if (!builtinsWithoutOverrides().some((b) => b.id === id)) throw new AdminError('Это не встроенный DNS.')
  const p = loadPending()
  p.remove[id] = cleanReason(reasonRaw)
  p.restore = p.restore.filter((x) => x !== id)
  savePending(p)
  return dnsPlan()
}

function markRestore(idRaw: unknown): DnsPlan {
  if (!readStored()) throw new AdminError('Режим автора не включён на этом устройстве.')
  const id = String(idRaw ?? '')
  if (!removedList().some((r) => r.id === id)) throw new AdminError('Эта запись не убрана.')
  const p = loadPending()
  delete p.remove[id]
  p.restore = [...new Set([...p.restore, id])]
  savePending(p)
  return dnsPlan()
}

function unmark(idRaw: unknown): DnsPlan {
  const id = String(idRaw ?? '')
  const p = loadPending()
  delete p.remove[id]
  p.restore = p.restore.filter((x) => x !== id)
  savePending(p)
  return dnsPlan()
}

/**
 * Публикация: правки адресов, «убрать у всех» и «вернуть» — одним запросом.
 * Аргумент — список id правок (как раньше) или { edits, remove, restore } (списки id).
 */
async function dnsPublish(arg: unknown): Promise<{ version: number; status: CatalogStatus }> {
  const pick = (v: unknown): Set<string> => new Set(Array.isArray(v) ? v.map(String) : [])
  const o = (Array.isArray(arg) ? { edits: arg } : arg && typeof arg === 'object' ? arg : {}) as Record<string, unknown>
  const ids = pick(o.edits)
  const plan = dnsPlan()
  const edits = plan.edits.filter((e) => ids.has(e.id))
  const rmIds = pick(o.remove)
  const backIds = pick(o.restore)
  const remove = plan.remove.filter((x) => rmIds.has(x.id))
  const restore = plan.restore.filter((x) => backIds.has(x.id))
  if (!edits.length && !remove.length && !restore.length) throw new AdminError('Нечего публиковать.')
  const changes = edits.map((e) => ({ id: e.id, ...e.after }))
  const body: Record<string, unknown> = { base: localCatalog(), changes }
  if (remove.length) body.remove = remove.map((x) => ({ id: x.id, reason: x.reason }))
  if (restore.length) body.restore = restore.map((x) => x.id)
  const r = await adminCall('/admin/dns', 'PUT', body)
  // Правки теперь в общем каталоге: локальные снимаем и забираем каталог заново.
  for (const e of edits) removeOverride(e.id)
  if (remove.length || restore.length) {
    const p = loadPending()
    for (const x of remove) delete p.remove[x.id]
    p.restore = p.restore.filter((id) => !restore.some((x) => x.id === id))
    savePending(p)
  }
  const res = await refreshCatalog(true)
  // Список на странице DNS перечитывается: правки сняты, даже если каталог совпал.
  broadcastChanged()
  return { version: Number(r.version) || 0, status: res.status }
}

// ---- Сбор пожертвований (только с ключом автора) -------------------------------------------

/** Понятные сообщения для ошибок сбора. */
function donError(e: unknown): never {
  if (e instanceof AdminError) {
    if (/\(full_active\)/.test(e.message)) throw new AdminError('Уже 3 активных сбора. Завершите один, чтобы включить этот.')
    if (/\(too_many\)/.test(e.message)) throw new AdminError('Слишком много записей. Удалите старые сборы.')
    if (/\(not_found\)/.test(e.message)) throw new AdminError('Запись или сбор уже удалены. Обновите страницу.')
    const inv = /\(invalid\): (.+)$/.exec(e.message)
    if (inv) throw new AdminError(`Не сохранено: ${inv[1]}.`)
  }
  throw e
}

async function donCall(route: string, method: 'POST' | 'PUT' | 'DELETE', body: Record<string, unknown> = {}): Promise<DonationsAdmin & { id?: number }> {
  try {
    const d = await adminCall(route, method, body)
    if (method !== 'POST') invalidateDonations()
    const out: DonationsAdmin & { id?: number } = parseDonationsAdmin(d)
    if (typeof d.id === 'number') out.id = d.id
    return out
  } catch (e) {
    return donError(e)
  }
}

const optNum = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** Поля пожертвования из окна: только известные, нужного типа. */
function donBody(v: unknown): Record<string, unknown> {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  const b: Record<string, unknown> = {}
  if (optNum(o.id) !== null) b.id = o.id
  if (optNum(o.camp) !== null) b.camp = o.camp
  if (typeof o.nick === 'string') b.nick = o.nick.slice(0, 64)
  if (typeof o.amount === 'number' || typeof o.amount === 'string') b.amount = typeof o.amount === 'string' ? o.amount.slice(0, 20) : o.amount
  if (typeof o.note === 'string') b.note = o.note.slice(0, 200)
  if (optNum(o.at) !== null) b.at = o.at
  return b
}

function campBody(v: unknown): Record<string, unknown> {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  const b: Record<string, unknown> = {}
  if (optNum(o.id) !== null) b.id = o.id
  for (const k of ['title', 'cur', 'descr', 'link'] as const) if (typeof o[k] === 'string') b[k] = (o[k] as string).slice(0, 400)
  if (typeof o.goal === 'number' || typeof o.goal === 'string') b.goal = o.goal
  for (const k of ['starts', 'ends'] as const) if (o[k] === null || optNum(o[k]) !== null) b[k] = o[k]
  if (typeof o.active === 'boolean') b.active = o.active
  // Способы оплаты (Б7): только известные значки и https-ссылки; старый link = первый способ.
  if (Array.isArray(o.methods)) {
    const methods = o.methods
      .slice(0, 6)
      .map((m) => {
        const x = (m && typeof m === 'object' ? m : {}) as Record<string, unknown>
        const url = safeLink(x.url)
        const name = typeof x.name === 'string' ? x.name.replace(/\s+/g, ' ').trim().slice(0, 32) : ''
        const icon = typeof x.icon === 'string' && (DON_METHOD_ICONS as readonly string[]).includes(x.icon) ? x.icon : 'link'
        return url && name ? { name, url, icon } : null
      })
      .filter(Boolean)
    b.methods = methods
    if (o.link === undefined) b.link = (methods[0] as { url: string } | undefined)?.url ?? ''
  }
  return b
}

/** Изменение в сборе: если ответ без полного списка (новые маршруты Hub), список запрашивается заново. */
async function donMutate(route: string, method: 'PUT' | 'DELETE', body: Record<string, unknown>, what?: string): Promise<DonationsAdmin> {
  try {
    const d = await adminCall(route, method, body)
    invalidateDonations()
    if (Array.isArray(d.campaigns)) return parseDonationsAdmin(d)
  } catch (e) {
    if (what && e instanceof AdminError && /\(not_found\)/.test(e.message)) newRoute(e, what)
    donError(e)
  }
  return donCall('/admin/donations', 'POST')
}

/** Ошибка «нет такого адреса» у старого Hub → понятный текст. */
function newRoute(e: unknown, what: string): never {
  if (e instanceof AdminError && /\(not_found\)/.test(e.message)) throw new AdminError(`${what}: на сервере этой функции ещё нет — обновите LAZEYKA Hub.`)
  throw e
}

const oneLine = (v: unknown, n: number): string =>
  String(v ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ')
    .trim()
    .slice(0, n)
const multiLine = (v: unknown, n: number): string =>
  String(v ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, ' ')
    .trim()
    .slice(0, n)

const TPL_USES = ['warn', 'ban', 'reply', 'don_no', 'any'] as const
export type TplUse = (typeof TPL_USES)[number]
export interface AdminTemplate {
  id: string
  name: string
  text: string
  use: TplUse
}

function cleanTemplates(v: unknown): AdminTemplate[] {
  if (!Array.isArray(v)) return []
  const out: AdminTemplate[] = []
  for (const x of v.slice(0, 30)) {
    const t = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>
    const id = String(t.id ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 12)
    const name = oneLine(t.name, 32)
    const text = multiLine(t.text, 500)
    const use = (TPL_USES as readonly string[]).includes(String(t.use)) ? (t.use as TplUse) : 'any'
    if (id && name && text && !out.some((o) => o.id === id)) out.push({ id, name, text, use })
  }
  return out
}

export interface AdminWarn {
  id: number
  install: string
  lvl: 'yellow' | 'red'
  kind: string
  text: string
  at: number
  ack: number | null
}

function cleanWarns(v: unknown): AdminWarn[] {
  if (!Array.isArray(v)) return []
  return v
    .slice(0, 50)
    .map((x) => {
      const w = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>
      return {
        id: Number(w.id) || 0,
        install: String(w.install ?? '').replace(/[^0-9a-f]/gi, '').slice(0, 6),
        lvl: (w.lvl === 'yellow' ? 'yellow' : 'red') as 'yellow' | 'red',
        kind: w.kind === 'ban' ? 'ban' : 'warn',
        text: multiLine(w.text, 2000),
        at: Number(w.at) || 0,
        ack: Number(w.ack) > 0 ? Number(w.ack) : null
      }
    })
    .filter((w) => w.id > 0)
}

// ---- IPC -----------------------------------------------------------------------------------

function h<T>(fn: (...args: unknown[]) => Promise<T> | T) {
  return async (_event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => {
    try {
      return { ok: true, value: await fn(...args) }
    } catch (e: unknown) {
      // Сообщения ошибок здесь свои и ключа не содержат.
      return { ok: false, message: e instanceof AdminError ? e.message : 'Не удалось выполнить запрос.' }
    }
  }
}

function handle<T>(channel: string, fn: (...args: unknown[]) => Promise<T> | T): void {
  ipcMain.removeHandler(channel)
  ipcMain.handle(channel, h(fn))
}

export function registerHubAdminIpc(): void {
  handle('hubAdmin:state', () => state())
  handle('hubAdmin:pair', (code) => pair(code))
  handle('hubAdmin:pairCancel', () => {
    if (pairing) pairing.cancelled = true
  })
  handle('hubAdmin:unpair', () => unpair())
  handle('hubAdmin:whoami', async () => {
    const d = await adminCall('/admin/whoami', 'POST')
    return {
      install: d.install,
      until: d.until,
      announce: d.announce ?? null,
      // Старый Hub этих полей не присылает: тогда одно объявление без условий.
      announces: Array.isArray(d.announces) ? d.announces : [],
      maxActive: Number(d.maxActive) || 1,
      latest: typeof d.latest === 'string' ? d.latest : null,
      dns: d.dns ?? null
    }
  })
  /** cond: { os: 'all'|'win'|'mac', ver: ''|'<X'|'>=X', re?: id объявления, которое дополняем }. */
  handle('hubAdmin:announce', async (text, days, cond) => {
    const c = (cond && typeof cond === 'object' ? cond : {}) as { os?: unknown; ver?: unknown; re?: unknown; emoji?: unknown; accent?: unknown }
    const body: Record<string, unknown> = { text: String(text ?? '').slice(0, 300), days: Number(days) }
    // Оформление (Б12): старый Hub лишние поля пропускает.
    const emoji = cleanEmoji(c.emoji)
    if (emoji) body.emoji = emoji
    if (typeof c.accent === 'string' && (ACCENT_KEYS as readonly string[]).includes(c.accent)) body.accent = c.accent
    if (c.os === 'win' || c.os === 'mac') body.os = c.os
    if (typeof c.ver === 'string' && c.ver) body.ver = c.ver.slice(0, 24)
    if (c.re !== undefined && c.re !== null && c.re !== '') body.re = String(c.re).slice(0, 20)
    try {
      return (await adminCall('/admin/announce', 'POST', body)).announce
    } catch (e) {
      if (e instanceof AdminError && /\(full\)/.test(e.message)) throw new AdminError('Уже 3 активных объявления. Снимите одно и опубликуйте снова.')
      throw e
    }
  })
  /** id — снять одно; без id — все. */
  handle('hubAdmin:announceOff', async (id) => {
    const body = id !== undefined && id !== null && id !== '' ? { id: String(id).slice(0, 20) } : {}
    return (await adminCall('/admin/announce', 'DELETE', body)).removed === true
  })
  /** Сколько программ подходит условию (сейчас и за сутки) — для предпросмотра, без публикации. */
  handle('hubAdmin:audience', async (cond) => {
    const c = (cond && typeof cond === 'object' ? cond : {}) as { os?: unknown; ver?: unknown }
    const d = await adminCall('/admin/audience', 'POST', { os: c.os === 'win' || c.os === 'mac' ? c.os : 'all', ver: typeof c.ver === 'string' ? c.ver.slice(0, 24) : '' })
    return { now: Number(d.now) || 0, day: Number(d.day) || 0, label: typeof d.label === 'string' ? d.label : '' }
  })
  handle('hubAdmin:stats', async () => (await adminCall('/admin/stats', 'POST')).stats)
  /** Только локально: какие встроенные DNS автор изменил у себя. */
  handle('hubAdmin:dnsDiff', () => (readStored() ? dnsEdits() : []))
  handle('hubAdmin:dnsPublish', (arg) => dnsPublish(arg))
  /** Только локально: правки, отметки «убрать / вернуть» и уже убранные. */
  handle('hubAdmin:dnsPlan', () => dnsPlan())
  handle('hubAdmin:dnsMarkRemove', (id, reason) => markRemove(id, reason))
  handle('hubAdmin:dnsMarkRestore', (id) => markRestore(id))
  handle('hubAdmin:dnsUnmark', (id) => unmark(id))
  // Сбор пожертвований: всё, правка/добавление записи, удаление, сборы и уровни цвета.
  handle('hubAdmin:donations', () => donCall('/admin/donations', 'POST'))
  handle('hubAdmin:donSave', (d) => donCall('/admin/donations/donation', 'PUT', donBody(d)))
  handle('hubAdmin:donDelete', (id) => donCall('/admin/donations/donation', 'DELETE', { id: Number(id) || 0 }))
  handle('hubAdmin:campSave', (c) => donCall('/admin/donations/campaign', 'PUT', campBody(c)))
  handle('hubAdmin:campDelete', (id) => donCall('/admin/donations/campaign', 'DELETE', { id: Number(id) || 0 }))
  handle('hubAdmin:levelsSave', (levels) =>
    donCall('/admin/donations/levels', 'PUT', {
      levels: Array.isArray(levels)
        ? levels.slice(0, 8).map((l) => {
            const x = (l && typeof l === 'object' ? l : {}) as Record<string, unknown>
            return { from: x.from, name: typeof x.name === 'string' ? x.name.slice(0, 24) : '', color: typeof x.color === 'string' ? x.color.slice(0, 10) : '' }
          })
        : null
    })
  )
  // Заявки «Я отправил пожертвование» (Б8): подтвердить (можно с другой суммой) или отклонить с причиной.
  handle('hubAdmin:claimDecide', async (id, action, extra) => {
    const x = (extra && typeof extra === 'object' ? extra : {}) as Record<string, unknown>
    const body: Record<string, unknown> = { id: Number(id) || 0, action: action === 'ok' ? 'ok' : 'no' }
    if (action === 'ok' && (typeof x.amount === 'number' || typeof x.amount === 'string')) body.amount = typeof x.amount === 'string' ? x.amount.slice(0, 20) : x.amount
    if (action !== 'ok' && typeof x.reason === 'string' && x.reason.trim()) body.reason = multiLine(x.reason, 500)
    try {
      return await donMutate('/admin/donations/claim', 'PUT', body)
    } catch (e) {
      if (e instanceof AdminError && /Запись или сбор уже удалены/.test(e.message)) throw new AdminError('Заявка не найдена: её уже решили в боте или удалили. Обновите список.')
      if (e instanceof AdminError && /\(done\)/.test(e.message)) throw new AdminError('Эта заявка уже решена (например, в боте). Обновите список.')
      throw e
    }
  })
  // Стили ников (Б11): пустые признаки снимаются; если пусто всё — стиль удаляется.
  handle('hubAdmin:styleSave', (st) => {
    const x = (st && typeof st === 'object' ? st : {}) as Record<string, unknown>
    const color = typeof x.color === 'string' && (/^[a-z]{3,10}$/.test(x.color) || /^#[0-9a-f]{6}$/.test(x.color)) ? x.color : null
    const badge = typeof x.badge === 'string' && (DON_BADGES as readonly string[]).includes(x.badge) ? x.badge : null
    return donMutate('/admin/donations/style', 'PUT', { nick: oneLine(x.nick, 32), color, emoji: cleanEmoji(x.emoji), badge, glow: x.glow === true }, 'Стиль ника')
  })
  handle('hubAdmin:styleDelete', (nick) => donMutate('/admin/donations/style', 'DELETE', { nick: oneLine(nick, 32) }, 'Стиль ника'))
  // Шаблоны ответов и подпись (Б13).
  handle('hubAdmin:templates', async () => {
    try {
      const d = await adminCall('/admin/templates', 'POST')
      return { templates: cleanTemplates(d.templates), sign: oneLine(d.sign, 120) }
    } catch (e) {
      return newRoute(e, 'Шаблоны')
    }
  })
  handle('hubAdmin:templatesSave', async (templates, sign) => {
    try {
      const d = await adminCall('/admin/templates', 'PUT', { templates: cleanTemplates(templates), sign: oneLine(sign, 120) })
      return { templates: cleanTemplates(d.templates ?? templates), sign: oneLine(d.sign ?? sign, 120) }
    } catch (e) {
      return newRoute(e, 'Шаблоны')
    }
  })
  handle('hubAdmin:warns', async () => {
    try {
      return cleanWarns((await adminCall('/admin/warns', 'POST')).warns)
    } catch (e) {
      return newRoute(e, 'Предупреждения')
    }
  })
  /** Предупредить по коду установки (6–32 знака из сообщения бота). */
  handle('hubAdmin:warn', async (install, lvl, text) => {
    const code = String(install ?? '').toLowerCase().replace(/[^0-9a-f]/g, '')
    if (code.length < 6 || code.length > 32) throw new AdminError('Код установки — от 6 до 32 знаков (цифры и буквы a–f), как в сообщении бота.')
    const t = multiLine(text, 1500)
    if (t.length < 2) throw new AdminError('Напишите текст предупреждения.')
    try {
      // Поле install у запросов автора занято кодом этого устройства (postJson), поэтому код цели — в target.
      const d = await adminCall('/admin/warn', 'POST', { target: code, lvl: lvl === 'yellow' ? 'yellow' : 'red', text: t })
      const w = (d.warn && typeof d.warn === 'object' ? d.warn : d) as Record<string, unknown>
      return { id: Number(w.id) || 0 }
    } catch (e) {
      if (e instanceof AdminError && /\(ambiguous\)/.test(e.message)) throw new AdminError('Под этот код подходит несколько установок. Введите код длиннее.')
      if (e instanceof AdminError && /\(not_found\)/.test(e.message)) throw new AdminError('Установка с таким кодом не найдена (или на сервере ещё нет предупреждений — обновите Hub).')
      throw e
    }
  })
  // Публичный сбор для страницы «Поддержка» (без ключа): свой модуль, регистрируется здесь.
  registerHubDonationsIpc()
}
