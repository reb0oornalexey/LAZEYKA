/**
 * Е6: «Проверять обновления через VPN INCY, если он подключён».
 *
 * Обновления (LAZEYKA, Zapret, TgWsProxy, ядра, гео-базы — всё, что ходит через
 * utils/github-release.ts, и загрузка установщика LAZEYKA) по умолчанию идут
 * напрямую, обычным fetch Node. GitHub у части провайдеров открывается плохо —
 * тогда при включённой настройке и подключённом INCY запрос идёт через тот же
 * локальный порт INCY (mixed, 127.0.0.1:mixedPort, SOCKS5), которым уже
 * пользуются проверка скорости и проверка утечек (speed-test.ts, leak-check.ts).
 *
 * Клиент — сетевой стек Chromium (session.fetch) в отдельной сессии с прокси
 * socks5://127.0.0.1:<порт>: умеет перенаправления, докачку (Range) и поток
 * тела, как fetch Node. Если VPN выключен, порт закрыт паролем или запрос
 * через прокси не удался — запрос повторяется напрямую, как раньше.
 */
import { session, type Session } from 'electron'
import { getAppConfigSync } from '../config'
import { appLog } from '../utils/app-logger'

const PARTITION = 'lazeyka-updates-via-incy'
let ses: Session | null = null
let sesPort = 0

/** Порт INCY для обновлений или null — идти напрямую. */
export async function updateProxyPort(): Promise<number | null> {
  try {
    if (getAppConfigSync().updatesViaIncy !== true) return null
    const { getIncyStatus, loadIncySettings } = await import('./incy-engine')
    if (getIncyStatus().state !== 'running') return null
    const s = loadIncySettings()
    // Порт с логином: Chromium не передаёт логин SOCKS5 — идём как раньше.
    if (s.socksAuth) return null
    const p = Number(s.mixedPort) || 20808
    return p > 0 && p < 65536 ? p : null
  } catch {
    return null
  }
}

async function proxySession(port: number): Promise<Session> {
  if (!ses) ses = session.fromPartition(PARTITION, { cache: false })
  if (sesPort !== port) {
    await ses.setProxy({ proxyRules: `socks5://127.0.0.1:${port}`, proxyBypassRules: '<-loopback>' })
    sesPort = port
  }
  return ses
}

/**
 * fetch для обновлений: через INCY, если так настроено и VPN подключён,
 * иначе (и при сбое прокси) — напрямую. redirect: 'manual' всегда напрямую:
 * ответ 3xx у двух клиентов выглядит по-разному, а этот путь — запасной.
 */
export async function updateFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const port = init.redirect === 'manual' ? null : await updateProxyPort()
  if (port) {
    try {
      const s = await proxySession(port)
      return (await s.fetch(url, init as never)) as unknown as Response
    } catch (e) {
      if (init.signal?.aborted) throw e
      appLog('warn', `[update] через VPN INCY не вышло (${e instanceof Error ? e.message : String(e)}) — напрямую`)
    }
  }
  return fetch(url, init)
}
