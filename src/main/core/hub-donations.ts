/**
 * Сбор пожертвований на странице «Поддержка»: один запрос GET /donations к LAZEYKA Hub,
 * когда человек открывает страницу. Ответ хранится в памяти 10 минут — повторные открытия
 * страницы в сеть не ходят. Фоновых опросов нет. В тестовой среде запросов нет вовсе.
 * Запрос анонимный: ни идентификатора установки, ни версии в нём нет.
 *
 * IPC: hubDon:get(force?) → DonationsPublic | null (null — сервер не ответил или тестовая среда).
 */
import { ipcMain } from 'electron'
import { hubDisabled } from '../utils/test-env'
import { HUB_URL } from './hub-pure'
import { parseDonationsPublic, type DonationsPublic } from './hub-donations-logic'

const CACHE_MS = 10 * 60 * 1000
const TIMEOUT_MS = 8000

let cache: { at: number; data: DonationsPublic } | null = null
let inflight: Promise<DonationsPublic | null> | null = null

/** После правки автора в программе — следующий запрос идёт на сервер. */
export function invalidateDonations(): void {
  cache = null
}

async function fetchDonations(): Promise<DonationsPublic | null> {
  const signal = AbortSignal.timeout(TIMEOUT_MS)
  const opts = { signal, cache: 'no-store' as const, redirect: 'error' as const, headers: { 'User-Agent': 'LAZEYKA' } }
  let res: Response
  try {
    const { net } = await import('electron')
    res = await net.fetch(`${HUB_URL}/donations`, opts as Parameters<typeof net.fetch>[1])
  } catch (e) {
    if (signal.aborted) throw e
    res = await fetch(`${HUB_URL}/donations`, opts)
  }
  if (!res.ok) return null
  return parseDonationsPublic(await res.json().catch(() => null))
}

export async function getDonations(force = false): Promise<DonationsPublic | null> {
  if (hubDisabled()) return null
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.data
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const data = await fetchDonations()
      if (data) cache = { at: Date.now(), data }
      // Сервер не ответил — показываем прежние данные, если они есть.
      return data ?? cache?.data ?? null
    } catch {
      return cache?.data ?? null
    } finally {
      inflight = null
    }
  })()
  return inflight
}

export function registerHubDonationsIpc(): void {
  ipcMain.removeHandler('hubDon:get')
  ipcMain.handle('hubDon:get', async (_e, force) => {
    try {
      return { ok: true, value: await getDonations(force === true) }
    } catch {
      return { ok: false, message: 'Не удалось загрузить сбор.' }
    }
  })
}
