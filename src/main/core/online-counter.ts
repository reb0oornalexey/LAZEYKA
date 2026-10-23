/**
 * «Сейчас онлайн» — сколько копий LAZEYKA запущено прямо сейчас.
 *
 * Раз в 5 минут (со случайным сдвигом) программа отправляет на свой
 * Cloudflare Worker (cloudflare/online-counter) анонимный случайный ID этой
 * установки и получает в ответ число онлайн и общую статистику (всего
 * установок, активные за 24 ч / 7 / 30 дней, рекорд). Ключей в программе нет — только
 * публичный адрес. Выключается в настройках («Показывать, сколько людей
 * онлайн»): тогда не отправляется ничего.
 */
import { BrowserWindow } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { dataDir } from '../utils/dirs'
import { getAppConfig } from '../config'
import { logToFile } from '../utils/file-logger'

/**
 * Адрес развёрнутого счётчика (README в cloudflare/online-counter).
 * Пусто — функция выключена и на главной ничего не показывается.
 */
export const ONLINE_COUNTER_URL = 'https://lazeyka-online.reb0oorn-alexey.workers.dev'

const INTERVAL_MS = 5 * 60 * 1000
const JITTER_MS = 40 * 1000

let lastOnline: OnlineStats | null = null
let timer: ReturnType<typeof setTimeout> | null = null
let zapretHintDone = false
/** Подряд неудачных отметок — после сбоя повторяем через минуту, а не через 5. */
let failures = 0

function numFile(): string {
  return path.join(dataDir(), 'online-num')
}

/** Номер установки, сохранённый с прошлых запусков (виден до первой отметки сессии). */
function savedNum(): number | undefined {
  try {
    const n = Number(readFileSync(numFile(), 'utf-8').trim())
    return Number.isSafeInteger(n) && n > 0 ? n : undefined
  } catch {
    return undefined
  }
}

function saveNum(n: number): void {
  try {
    mkdirSync(path.dirname(numFile()), { recursive: true })
    writeFileSync(numFile(), String(n), 'utf-8')
  } catch {
    /* не критично */
  }
}

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
    /* не сохранили — посчитаемся новым ID, не страшно */
  }
  return id
}

function broadcast(): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('app:onlineCount', lastOnline)
  }
}

async function enabled(): Promise<boolean> {
  if (!ONLINE_COUNTER_URL) return false
  try {
    return (await getAppConfig()).onlineStats !== false
  } catch {
    return true
  }
}

/** Провайдер режет workers.dev — один раз за запуск добавляем его в список Zapret. */
async function hintZapret(): Promise<void> {
  if (zapretHintDone || !/\.workers\.dev(?:\/|$)/i.test(ONLINE_COUNTER_URL)) return
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

/** Неотрицательное целое число из ответа Worker или undefined (старый Worker этих полей не присылает). */
function count(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : undefined
}

/** Запрос: сначала сетевой стек Chromium (как браузер), при ошибке — fetch Node. */
async function postPing(url: string, body: string): Promise<Record<string, unknown> | null> {
  const opts = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'LAZEYKA' },
    body
  }
  try {
    const { net } = await import('electron')
    const res = await net.fetch(url, { ...opts, signal: AbortSignal.timeout(15_000) })
    return (await res.json().catch(() => null)) as Record<string, unknown> | null
  } catch {
    const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(15_000) })
    return (await res.json().catch(() => null)) as Record<string, unknown> | null
  }
}

async function ping(): Promise<boolean> {
  if (!(await enabled())) {
    if (lastOnline) {
      lastOnline = null
      broadcast()
    }
    return true
  }
  try {
    const data = await postPing(`${ONLINE_COUNTER_URL.replace(/\/+$/, '')}/ping`, JSON.stringify({ id: installId() }))
    const online = count(data?.online)
    if (data && online !== undefined) {
      lastOnline = {
        online,
        at: Date.now(),
        installs: count(data.installs),
        active24h: count(data.active24h),
        active7d: count(data.active7d),
        active30d: count(data.active30d),
        peakOnline: count(data.peakOnline),
        num: ((): number | undefined => {
          const n = count(data.num)
          if (n && n > 0) {
            saveNum(n)
            return n
          }
          return savedNum()
        })()
      }
      broadcast()
      failures = 0
      return true
    }
    throw new Error('пустой ответ')
  } catch (e) {
    failures++
    const cause = e instanceof Error && (e as Error & { cause?: { code?: string } }).cause?.code
    logToFile({
      time: Date.now(),
      type: 'warn',
      source: 'app',
      payload: `счётчик онлайна недоступен: ${e instanceof Error ? e.message : String(e)}${cause ? ` (${cause})` : ''}` +
        (failures <= 3 ? ' — повтор через минуту' : '')
    })
    void hintZapret()
    return false
  }
}

function schedule(delay: number): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    void ping().then((ok) =>
      schedule(!ok && failures <= 3 ? 60_000 : INTERVAL_MS + Math.round((Math.random() * 2 - 1) * JITTER_MS))
    )
  }, delay)
}

/**
 * Запустить отметки. Первая — через 60–90 с: в первые секунды после старта
 * перезапускается Zapret, и соединения в этот момент рвутся.
 */
export function startOnlineCounter(): void {
  if (!ONLINE_COUNTER_URL) return
  schedule(60_000 + Math.round(Math.random() * 30_000))
}

/** Последнее известное число (null — выключено или ещё не получено). */
export function getOnlineCount(): OnlineStats | null {
  if (lastOnline && Date.now() - lastOnline.at > 20 * 60 * 1000) return null
  return lastOnline
}

/** Номер установки с прошлых запусков (для показа до первой отметки сессии). */
export function getSavedInstallNum(): number | null {
  return savedNum() ?? null
}

/** Сразу перепроверить (после смены настройки). */
export function refreshOnlineCounter(): void {
  if (ONLINE_COUNTER_URL) schedule(500)
}

export function isOnlineCounterConfigured(): boolean {
  return Boolean(ONLINE_COUNTER_URL) && existsSync(dataDir())
}
