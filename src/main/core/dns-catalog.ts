/**
 * Удалённый каталог встроенных DNS (dns-presets.json в репозитории приложения).
 *
 *  - скачивается при запуске (не чаще раза в 6 часов) и по кнопке «Обновить список»;
 *    источники: LAZEYKA Hub (/dns), GitHub raw, jsDelivr — берётся наибольшая version;
 *  - строго проверяется (dns-catalog-logic.ts), невалидный файл игнорируется целиком;
 *  - если адреса СЕЙЧАС включённого сервера изменились — системные настройки молча
 *    не трогаем: интерфейс показывает плашку, а уведомление приходит один раз;
 *  - проверка живости включённого DNS — только при открытой странице DNS и один раз
 *    при запуске; постоянных опросов нет;
 *  - правка встроенной записи пользователем приоритетнее каталога, пока её не сбросили.
 *
 *  - автор может убрать запись у всех (поле removed каталога): такие записи в списке не
 *    показываются; если убранный DNS сейчас включён — настройки не трогаем, окно
 *    показывает плашку, системное уведомление — один раз;
 *  - пользователь может скрыть ненужную встроенную запись только у себя (без сети).
 *
 * IPC-каналы: dnsCatalog:status, dnsCatalog:refresh, dnsCatalog:health,
 * dnsCatalog:saveOverride, dnsCatalog:revert, dnsCatalog:hide. Событие для окон: dnsCatalog:changed.
 */
import https from 'node:https'
import net from 'node:net'
import { BrowserWindow, ipcMain } from 'electron'
import {
  CATALOG_MAX_BYTES,
  CATALOG_REFRESH_MS,
  CATALOG_TIMEOUT_MS,
  CATALOG_URLS,
  addrSignature,
  allAddrs,
  changedPresetIds,
  isPublicIPv4,
  pickNewest,
  validateCatalog,
  type Catalog
} from './dns-catalog-logic'
import {
  loadCatalogCache,
  loadHidden,
  loadMeta,
  loadOverrides,
  removeOverride,
  saveCatalogCache,
  saveMeta,
  saveOverride,
  setHidden,
  touchCatalogCache
} from './dns-catalog-store'
import {
  LEGACY_ADDRS,
  allProviders,
  builtinsWithoutOverrides,
  getSystemDnsState,
  pingProvider,
  readDnsActive,
  type DohProvider,
  type SystemDnsState
} from './dns-doh'
import { appLog } from '../utils/app-logger'
import { showSystemNotification } from '../utils/notifications'

// ---- скачивание ---------------------------------------------------------------------

/** GET с ограничением по времени и размеру; перенаправления не выполняем. */
function getCapped(urlStr: string, timeoutMs: number, accept: string, pinnedIp?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false
    const done = (err: Error | null, value?: string): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (err) reject(err)
      else resolve(value ?? '')
    }
    const lookup = pinnedIp
      ? (_h: string, opts: { all?: boolean }, cb: (...a: unknown[]) => void): void =>
          opts && opts.all ? cb(null, [{ address: pinnedIp, family: 4 }]) : cb(null, pinnedIp, 4)
      : undefined
    const req = https.get(
      urlStr,
      { headers: { 'User-Agent': 'LAZEYKA-DNS', Accept: accept }, ...(lookup ? { lookup: lookup as never } : {}) },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume()
          return done(new Error(`HTTP ${res.statusCode}`))
        }
        const len = Number(res.headers['content-length'] ?? 0)
        if (len > CATALOG_MAX_BYTES) {
          res.destroy()
          return done(new Error('файл больше 64 КБ'))
        }
        const chunks: Buffer[] = []
        let size = 0
        res.on('data', (c: Buffer) => {
          size += c.length
          if (size > CATALOG_MAX_BYTES) {
            res.destroy()
            done(new Error('файл больше 64 КБ'))
            return
          }
          chunks.push(c)
        })
        res.on('end', () => done(null, Buffer.concat(chunks).toString('utf-8')))
        res.on('error', (e) => done(e))
      }
    )
    const timer = setTimeout(() => {
      req.destroy()
      done(new Error('таймаут'))
    }, timeoutMs)
    req.on('error', (e) => done(e))
  })
}

/**
 * Адрес сайта через шифрованный DNS по IP (Cloudflare, затем Google), мимо системных
 * настроек. Нужен именно тогда, когда включённый DNS перестал работать и обычное
 * имя raw.githubusercontent.com не находится — иначе каталог не скачать.
 */
async function bootstrapResolve(host: string): Promise<string | null> {
  const asks = [
    `https://1.1.1.1/dns-query?name=${encodeURIComponent(host)}&type=A`,
    `https://8.8.8.8/resolve?name=${encodeURIComponent(host)}&type=A`
  ]
  for (const u of asks) {
    try {
      const j = JSON.parse(await getCapped(u, 4000, 'application/dns-json')) as { Answer?: { type?: number; data?: string }[] }
      const ip = (j.Answer ?? []).find((a) => a.type === 1 && typeof a.data === 'string' && isPublicIPv4(a.data))?.data
      if (ip) return ip
    } catch {
      /* следующий резолвер */
    }
  }
  return null
}

async function fetchCatalogText(url: string): Promise<string> {
  try {
    return await getCapped(url, CATALOG_TIMEOUT_MS, 'application/json')
  } catch (first) {
    // Сеть есть, но имя не находится (сломанный DNS) — пробуем по адресу, найденному в обход системы.
    const host = new URL(url).hostname
    const ip = await bootstrapResolve(host)
    if (!ip) throw first
    return getCapped(url, CATALOG_TIMEOUT_MS, 'application/json', ip)
  }
}

// ---- обновление каталога -----------------------------------------------------------

export type RefreshOutcome = 'updated' | 'same' | 'fresh' | 'older' | 'failed'

export interface RefreshResult {
  outcome: RefreshOutcome
  /** Названия записей, у которых изменились адреса или DoH. */
  changedNames: string[]
  error?: string
  status: CatalogStatus
}

let inflight: Promise<RefreshResult> | null = null

export function broadcastChanged(): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) {
      try {
        w.webContents.send('dnsCatalog:changed', null)
      } catch {
        /* окно закрывается */
      }
    }
  }
}

async function doRefresh(force: boolean): Promise<RefreshResult> {
  const prev = loadCatalogCache()
  if (!force && prev && Date.now() - prev.fetchedAt < CATALOG_REFRESH_MS) {
    return { outcome: 'fresh', changedNames: [], status: await getStatus() }
  }
  // Все источники параллельно (Hub, GitHub, jsDelivr); из проверенных берём каталог с наибольшей version.
  const errors: string[] = []
  const got = await Promise.all(
    CATALOG_URLS.map(async (url): Promise<{ catalog: Catalog; source: string } | null> => {
      const host = new URL(url).hostname
      try {
        const check = validateCatalog(await fetchCatalogText(url))
        if (check.ok) return { catalog: check.catalog, source: host }
        errors.push(`${host}: файл отклонён (${check.reason})`)
      } catch (e) {
        errors.push(`${host}: ${e instanceof Error ? e.message : String(e)}`)
      }
      return null
    })
  )
  const fetched = pickNewest(got.filter((x): x is { catalog: Catalog; source: string } => x !== null))
  if (!fetched) {
    appLog('warn', 'dns-catalog: обновить не удалось — ' + errors.join('; '))
    return { outcome: 'failed', changedNames: [], error: errors.join('; '), status: await getStatus() }
  }
  // Защита от отката: «кэш» CDN бывает старше основной копии. Равная версия с другим содержимым — принимаем.
  if (prev && fetched.catalog.version < prev.catalog.version) {
    touchCatalogCache()
    return { outcome: 'older', changedNames: [], status: await getStatus() }
  }
  const changedIds = changedPresetIds(prev?.catalog ?? null, fetched.catalog)
  const same = prev ? JSON.stringify(prev.catalog) === JSON.stringify(fetched.catalog) : false
  saveCatalogCache(fetched)
  const names = changedIds.map((id) => fetched!.catalog.presets.find((p) => p.id === id)?.name ?? id)
  if (!same) broadcastChanged()
  await notifyIfStale()
  await notifyIfRemoved()
  return { outcome: same ? 'same' : 'updated', changedNames: names, status: await getStatus() }
}

export function refreshCatalog(force: boolean): Promise<RefreshResult> {
  if (!inflight) {
    inflight = doRefresh(force).finally(() => {
      inflight = null
    })
  }
  return inflight
}

// ---- что сейчас включено и устарело ------------------------------------------------

export interface StaleInfo {
  id: string
  name: string
  /** catalog — адреса сменились в каталоге; edited — пользователь изменил запись. */
  reason: 'catalog' | 'edited'
}

const sameSet = (a: string[], b: string[]): boolean => a.length === b.length && a.every((x) => b.includes(x))

/**
 * Включённый сейчас встроенный DNS, у которого актуальные адреса (или DoH) уже
 * не совпадают с теми, что выставила LAZEYKA. Системные настройки не меняем.
 */
export async function findStaleActive(known?: SystemDnsState | null): Promise<StaleInfo | null> {
  const active = readDnsActive()
  if (!active) return null
  const st = known !== undefined ? known : await getSystemDnsState().catch(() => null)
  if (!st?.providerId || st.providerId !== active.providerId) return null
  const p = (await allProviders().catch(() => [] as DohProvider[])).find((x) => x.id === active.providerId)
  if (!p || p.custom) return null
  const cur = allAddrs({ ipv4: [p.ip, p.secondaryIp].filter((a): a is string => Boolean(a)), ipv6: p.ipv6 })
  const applied = active.appliedAddrs ?? active.profileAddrs
  let stale: boolean
  if (applied) {
    stale = !sameSet(applied, cur) || (active.appliedDoh !== undefined && active.appliedDoh !== (p.url || ''))
  } else {
    // Запись о выставленных адресах не велась (поставлено прошлой версией): если в системе стоят
    // только прежние адреса сервера, а не нынешние — он устарел.
    const old = LEGACY_ADDRS[p.id] ?? []
    stale = !st.servers.some((s) => cur.includes(s)) && st.servers.some((s) => old.includes(s))
  }
  return stale ? { id: p.id, name: p.name, reason: p.edited ? 'edited' : 'catalog' } : null
}

async function notifyIfStale(): Promise<void> {
  const stale = await findStaleActive().catch(() => null)
  if (!stale || stale.reason !== 'catalog') return
  const p = (await allProviders().catch(() => [] as DohProvider[])).find((x) => x.id === stale.id)
  if (!p) return
  const sig = `${p.id}:${addrSignature({ ipv4: [p.ip, p.secondaryIp].filter((a): a is string => Boolean(a)), ipv6: p.ipv6, doh: p.url })}`
  if (loadMeta().notifiedChange === sig) return
  saveMeta({ notifiedChange: sig })
  showSystemNotification('LAZEYKA: у DNS сменились адреса', `У «${p.name}» сменились адреса. Откройте вкладку «DNS» и нажмите «Обновить», чтобы применить новые.`, undefined, 'author')
}

// ---- убранные автором ---------------------------------------------------------------

export interface RemovedInfo {
  id: string
  name: string
  reason: string
  at?: string
  /** Запись есть в коде программы (одна из семи встроенных). */
  builtin: boolean
}

/** Убранные автором записи каталога с названиями (из каталога, иначе из кода). */
export function removedList(): RemovedInfo[] {
  const cat = loadCatalogCache()?.catalog
  if (!cat?.removed.length) return []
  const all = builtinsWithoutOverrides()
  return cat.removed.map((r) => {
    const p = all.find((x) => x.id === r.id)
    return { id: r.id, name: r.name || p?.name || r.id, reason: r.reason, at: r.at, builtin: Boolean(p && !p.fromCatalog) }
  })
}

/**
 * Включённый сейчас DNS, который автор убрал из программы. Системные настройки не
 * меняем: окно показывает плашку «Выбрать другой / Сбросить на стандартный».
 */
export async function findRemovedActive(known?: SystemDnsState | null): Promise<RemovedInfo | null> {
  const active = readDnsActive()
  if (!active) return null
  const r = removedList().find((x) => x.id === active.providerId)
  if (!r) return null
  const st = known !== undefined ? known : await getSystemDnsState().catch(() => null)
  return st?.providerId === active.providerId ? r : null
}

async function notifyIfRemoved(): Promise<void> {
  const r = await findRemovedActive().catch(() => null)
  const shown = loadMeta().notifiedRemoved
  if (!r) {
    // Пользователь сменил DNS или автор вернул запись — следующее удаление снова сообщим.
    if (shown && (readDnsActive()?.providerId !== shown || !removedList().some((x) => x.id === shown))) saveMeta({ notifiedRemoved: undefined })
    return
  }
  if (shown === r.id) return
  saveMeta({ notifiedRemoved: r.id })
  showSystemNotification(
    'LAZEYKA: DNS убран из списка',
    `«${r.name}» убран из списка автором программы${r.reason ? ` (${r.reason})` : ''}. Он пока остаётся включённым. Откройте вкладку «DNS», чтобы выбрать другой.`, undefined, 'author'
  )
}

// ---- проверка живости --------------------------------------------------------------

export interface HealthResult {
  id: string
  name: string
  ok: boolean
  ms: number | null
  checkedAt: number
}

let lastHealth: HealthResult | null = null
let healthInflight: Promise<HealthResult | null> | null = null
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function doHealth(): Promise<HealthResult | null> {
  const active = readDnsActive()
  if (!active) return null
  const st = await getSystemDnsState().catch(() => null)
  if (!st?.providerId || st.providerId !== active.providerId) return null
  const p = (await allProviders().catch(() => [] as DohProvider[])).find((x) => x.id === st.providerId)
  if (!p) return null
  // Два замера подряд с паузой: один неудачный запрос ещё не повод считать сервер упавшим.
  let ms = await pingProvider(p)
  if (ms == null) {
    await sleep(3000)
    ms = await pingProvider(p)
  }
  lastHealth = { id: p.id, name: p.name, ok: ms != null, ms, checkedAt: Date.now() }
  return lastHealth
}

/** Проверка включённого DNS: вызывается страницей DNS при открытии и один раз при запуске. */
export function checkActiveHealth(): Promise<HealthResult | null> {
  if (!healthInflight) {
    healthInflight = doHealth().finally(() => {
      healthInflight = null
    })
  }
  return healthInflight
}

// ---- состояние для интерфейса ------------------------------------------------------

export interface BuiltinMeta {
  builtin: boolean
  fromCatalog: boolean
  edited: boolean
  /** Дата смены адресов по каталогу (YYYY-MM-DD). */
  catalogUpdated?: string
  /** Значения без правок пользователя — к ним вернёт «Вернуть как было». */
  original: { ipv4: string[]; ipv6: string[]; doh: string; dohOnly: boolean }
}

export interface CatalogStatus {
  fetchedAt: number | null
  catalogUpdated: string | null
  catalogVersion: number | null
  source: string | null
  meta: Record<string, BuiltinMeta>
  stale: StaleInfo | null
  /** Последний результат проверки живости (если был недавно). */
  health: HealthResult | null
  /** Убраны автором у всех (в списке не показываются). */
  removed: RemovedInfo[]
  /** Включённый сейчас DNS убран автором — плашка с выбором. */
  removedActive: RemovedInfo | null
  /** Скрыты пользователем только у себя. */
  hidden: string[]
}

export async function getStatus(): Promise<CatalogStatus> {
  const cache = loadCatalogCache()
  const ov = loadOverrides()
  const meta: Record<string, BuiltinMeta> = {}
  for (const b of builtinsWithoutOverrides()) {
    meta[b.id] = {
      builtin: true,
      fromCatalog: Boolean(b.fromCatalog),
      edited: Boolean(ov[b.id]),
      catalogUpdated: b.catalogUpdated,
      original: {
        ipv4: [b.ip, b.secondaryIp].filter((a): a is string => Boolean(a)),
        ipv6: b.ipv6 ?? [],
        doh: b.url,
        dohOnly: Boolean(b.strict)
      }
    }
  }
  // Состояние системы читаем один раз: на Windows это запуск PowerShell.
  const st = readDnsActive() ? await getSystemDnsState().catch(() => null) : null
  return {
    fetchedAt: cache?.fetchedAt ?? null,
    catalogUpdated: cache?.catalog.updated ?? null,
    catalogVersion: cache?.catalog.version ?? null,
    source: cache?.source ?? null,
    meta,
    stale: await findStaleActive(st).catch(() => null),
    health: lastHealth && Date.now() - lastHealth.checkedAt < 10 * 60 * 1000 ? lastHealth : null,
    removed: removedList(),
    removedActive: await findRemovedActive(st).catch(() => null),
    hidden: loadHidden()
  }
}

// ---- правка встроенной записи ------------------------------------------------------

export interface OverrideInput {
  ipv4: string[]
  ipv6?: string[]
  doh?: string
  allowFallback?: boolean
}

function userDohTemplate(raw?: string): string {
  const v = String(raw ?? '').trim()
  if (!v) return ''
  let u: URL
  try {
    u = new URL(v)
  } catch {
    throw new Error('Шаблон DoH должен быть ссылкой вида https://dns.example.com/dns-query')
  }
  if (u.protocol !== 'https:') throw new Error('Шаблон DoH должен начинаться с https://')
  return u.toString()
}

async function saveBuiltinOverride(id: string, input: OverrideInput): Promise<CatalogStatus> {
  const base = builtinsWithoutOverrides().find((b) => b.id === id)
  if (!base) throw new Error('Это не встроенный DNS')
  const v4 = (input.ipv4 ?? []).map((a) => String(a).trim()).filter(Boolean)
  const v6 = (input.ipv6 ?? []).map((a) => String(a).trim()).filter(Boolean)
  if (v4.length === 0) throw new Error('Нужен хотя бы один IPv4-адрес')
  if (v4.length > 2 || v6.length > 2) throw new Error('Можно указать не больше двух адресов каждого вида')
  for (const a of v4) if (!net.isIPv4(a)) throw new Error(`«${a}» — не IPv4-адрес`)
  for (const a of v6) if (!net.isIPv6(a)) throw new Error(`«${a}» — не IPv6-адрес`)
  const doh = userDohTemplate(input.doh)
  const dohOnly = Boolean(doh) && !input.allowFallback
  const same =
    addrSignature({ ipv4: v4, ipv6: v6, doh }) ===
      addrSignature({ ipv4: [base.ip, base.secondaryIp].filter((a): a is string => Boolean(a)), ipv6: base.ipv6 ?? [], doh: base.url }) &&
    dohOnly === Boolean(base.strict)
  if (same) removeOverride(id)
  else saveOverride(id, { ipv4: v4, ipv6: v6, doh, dohOnly, editedAt: Date.now() })
  return getStatus()
}

// ---- IPC и запуск ------------------------------------------------------------------

type Handler = (...args: unknown[]) => Promise<unknown> | unknown

function h(fn: Handler) {
  return async (_event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => {
    try {
      return { ok: true, value: await fn(...args) }
    } catch (e: unknown) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) }
    }
  }
}

/** Один раз после запуска: каталог (если прошло 6 часов) и проверка включённого DNS. */
async function startupJob(): Promise<void> {
  try {
    await refreshCatalog(false)
  } catch (e) {
    appLog('warn', 'dns-catalog: ошибка обновления при запуске — ' + (e instanceof Error ? e.message : String(e)))
  }
  try {
    await notifyIfRemoved()
  } catch {
    /* уведомление — необязательное */
  }
  try {
    const hres = await checkActiveHealth()
    if (!hres) return
    if (hres.ok) {
      if (loadMeta().notifiedDead) saveMeta({ notifiedDead: undefined })
      return
    }
    if (loadMeta().notifiedDead !== hres.id) {
      saveMeta({ notifiedDead: hres.id })
      showSystemNotification('LAZEYKA: DNS не отвечает', `«${hres.name}» не отвечает. Возможно, сервис сменил адреса. Откройте вкладку «DNS» и нажмите «Обновить список».`, undefined, 'errors')
    }
  } catch {
    /* проверка при запуске — необязательная */
  }
}

export function registerDnsCatalogIpc(): void {
  ipcMain.handle('dnsCatalog:status', h(() => getStatus()))
  ipcMain.handle('dnsCatalog:refresh', h((force) => refreshCatalog(force !== false)))
  ipcMain.handle('dnsCatalog:health', h(() => checkActiveHealth()))
  ipcMain.handle('dnsCatalog:saveOverride', h((id, input) => saveBuiltinOverride(String(id), input as OverrideInput)))
  ipcMain.handle(
    'dnsCatalog:revert',
    h((id) => {
      removeOverride(String(id))
      return getStatus()
    })
  )
  /** Скрыть встроенную запись только у себя (или показать снова). Без сети. */
  ipcMain.handle(
    'dnsCatalog:hide',
    h((id, hidden) => {
      const sid = String(id)
      if (!builtinsWithoutOverrides().some((b) => b.id === sid)) throw new Error('Скрыть можно только встроенный DNS')
      setHidden(sid, hidden !== false)
      return getStatus()
    })
  )
  // Через 25 секунд после запуска — не мешаем самому запуску. Таймер одноразовый.
  setTimeout(() => void startupJob(), 25_000).unref?.()
}
