/**
 * Проверка сервисов: что сейчас реально работает с этого компьютера.
 * Одна функция для панели «Сервисы» на главной и для мастера «Ничего не открывается?».
 *
 * У каждого сервиса несколько точек (diag-logic.ts, SERVICE_POINTS): то, без
 * чего им нельзя пользоваться (у Discord — сервер чата gateway.discord.gg, а не
 * только discord.com), и части (видео, картинки, обновления). Итог плитки
 * решает decideTile — те же правила для панели и мастера.
 *
 * Каким путём идут запросы:
 *  - HTTPS — сетевым стеком Chromium (net.fetch): файл hosts, системный DNS и
 *    системный прокси, через VPN в режиме TUN — как у браузера и у клиентов
 *    Discord/Steam/Twitch, которые сами построены на Chromium;
 *  - Telegram — обычный TCP-сокет на адреса дата-центров (как у приложения
 *    Telegram без прокси) или на локальный Telegram-прокси LAZEYKA, если он запущен.
 * Ни один запрос не привязывается к адаптеру и не идёт мимо VPN.
 *
 * Проверка идёт только по запросу: при открытии главной (если с прошлой прошло
 * больше 10 минут), по кнопке «Проверить» и из мастера. Сама по себе — никогда.
 * Все точки — параллельно, с общим пределом по времени, без повторов.
 */
import net from 'node:net'
import { onServiceStatusChanged } from '../utils/status-bus'
import { randomBytes } from 'node:crypto'
import { broadcast, plainFetch } from './diag-net'
import {
  SERVICES,
  SERVICE_POINTS,
  SERVICE_TIMEOUT_MS,
  SLOW_RESPONSE_MS,
  classifyPointResponse,
  decideTile,
  describeNetError,
  telegramPoints,
  type PointResult,
  type PointRole,
  type PointState,
  type ServiceId,
  type ServicePoint,
  type TileState
} from './diag-logic'
import {
  TELEGRAM_DC_TARGETS,
  abridgedFirstPacket,
  abridgedTakePacket,
  buildReqPqMulti,
  describeResPq,
  intermediateTakePacket,
  obfuscatedInit,
  paddedPacket,
  parseResPq,
  proxySecretBytes
} from './tg-probe-logic'
import { getTgwsStatus } from './tgws'
import { getIncyStatus } from './incy-engine'
import { getZapretStatus } from './zapret'
import { getAppConfig } from '../config'

export const SERVICES_TTL_MS = 10 * 60 * 1000
/** Общий предел на всю проверку: точка, не ответившая к этому сроку, считается неответившей. */
export const SERVICES_DEADLINE_MS = SERVICE_TIMEOUT_MS + 2000

export interface ServicePointReport {
  key: string
  label: string
  host: string
  role: PointRole
  state: PointState
  detail: string
  ms: number | null
}

export interface ServiceResult {
  id: ServiceId
  name: string
  siteDomain: string
  state: TileState
  detail: string
  /** Короткая подпись под плиткой: что не работает или «через прокси LAZEYKA». */
  note: string | null
  /** Через что идёт сервис: proxy — Telegram через прокси LAZEYKA. */
  via: 'proxy' | null
  /** Адрес для «Проверки сайта» при клике (первая неответившая точка или сайт сервиса). */
  checkDomain: string
  ms: number | null
  points: ServicePointReport[]
}

export interface ServicesReport {
  /** Когда проверено (мс с начала эпохи); null — ещё не проверялось. */
  at: number | null
  results: ServiceResult[]
  /** Ответ взят из кэша. */
  cached: boolean
}

let cache: { route: string; at: number; results: ServiceResult[] } | null = null
let inflight: { route: string; report: Promise<ServicesReport> } | null = null

function serviceRouteState(): string {
  const vpn = getIncyStatus()
  const zapret = getZapretStatus()
  return JSON.stringify([getTgwsStatus().state, zapret.state, vpn.state, vpn.activeNodeId, vpn.connectedAt, vpn.connectionMode, vpn.routingMode])
}

let lastRouteState: string | undefined
let routeVersion = 0
function serviceRouteKey(): string {
  const state = serviceRouteState()
  if (state !== lastRouteState) {
    lastRouteState = state
    routeVersion++
  }
  return String(routeVersion)
}
onServiceStatusChanged(() => { serviceRouteKey() })

// ---- HTTPS ----------------------------------------------------------------------------

async function checkHttp(p: ServicePoint): Promise<PointResult> {
  if (p.probe.kind !== 'http') throw new Error('not http')
  try {
    const r = await plainFetch(p.probe.url, SERVICE_TIMEOUT_MS, p.probe.minBytes ?? 4096)
    return classifyPointResponse(p, r)
  } catch (e) {
    // Ошибка Chromium (в том числе net::ERR_CONNECTION_RESET / _CLOSED, они же
    // «handshake failed … net_error -101/-100» в консоли) уже переведена в текст
    // в plainFetch. Повторов нет: точка просто «не ответила».
    return { key: p.key, state: 'down', detail: e instanceof Error ? e.message : String(e), ms: null }
  }
}

// ---- Telegram: напрямую ---------------------------------------------------------------

interface MtResult {
  ok: boolean
  detail: string
  ms: number | null
  /** TCP-соединение открылось. */
  connected: boolean
}

/**
 * Один запрос req_pq_multi на адрес дата-центра (abridged).
 * Успех — пришёл resPQ с нашим nonce.
 */
function mtprotoDirect(ip: string, port: number, timeoutMs: number): Promise<MtResult> {
  return new Promise((resolve) => {
    const nonce = randomBytes(16)
    const t0 = Date.now()
    let connected = false
    let buf = Buffer.alloc(0)
    let settled = false
    const s = net.createConnection({ host: ip, port })
    const done = (r: Omit<MtResult, 'connected'>): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      s.destroy()
      resolve({ ...r, connected })
    }
    const timer = setTimeout(
      () =>
        done({
          ok: false,
          ms: null,
          detail: connected ? 'соединение открывается, но сервер не отвечает (похоже на блокировку)' : `нет ответа за ${Math.round(timeoutMs / 1000)} с`
        }),
      timeoutMs
    )
    s.once('connect', () => {
      connected = true
      try {
        s.write(abridgedFirstPacket(buildReqPqMulti(nonce)))
      } catch (e) {
        done({ ok: false, ms: null, detail: describeNetError(e) })
      }
    })
    s.on('data', (d: Buffer) => {
      buf = Buffer.concat([buf, d])
      if (buf.length > 4096) return done({ ok: false, ms: null, detail: describeResPq({ ok: false, reason: 'bad' }) })
      const pkt = abridgedTakePacket(buf)
      if (!pkt) return
      const v = parseResPq(pkt, nonce)
      done({ ok: v.ok, ms: Date.now() - t0, detail: v.ok ? `ответ за ${Date.now() - t0} мс` : describeResPq(v) })
    })
    s.once('error', (e) => done({ ok: false, ms: null, detail: describeNetError(e, Math.round(timeoutMs / 1000)) }))
    s.once('close', () =>
      done({
        ok: false,
        ms: null,
        detail: buf.length ? describeResPq({ ok: false, reason: 'bad' }) : 'соединение сбрасывается (похоже на блокировку)'
      })
    )
  })
}

/** Дата-центры параллельно: ответил хоть один — Telegram доступен. */
async function checkTelegramDirect(p: ServicePoint): Promise<PointResult> {
  const all = TELEGRAM_DC_TARGETS.map((t) => mtprotoDirect(t.ip, t.port, SERVICE_TIMEOUT_MS - 500))
  const ok = await new Promise<MtResult | null>((resolve) => {
    let left = all.length
    for (const pr of all) {
      void pr.then((r) => {
        if (r.ok) resolve(r)
        else if (--left === 0) resolve(null)
      })
    }
  })
  if (ok) {
    const state: PointState = (ok.ms ?? 0) > SLOW_RESPONSE_MS ? 'slow' : 'ok'
    return { key: p.key, state, detail: state === 'slow' ? `отвечает медленно (${ok.ms} мс)` : ok.detail, ms: ok.ms }
  }
  const res = await Promise.all(all)
  const anyConnected = res.find((r) => r.connected)
  return { key: p.key, state: 'down', detail: (anyConnected ?? res[0]).detail, ms: null }
}

// ---- Telegram: через прокси LAZEYKA ---------------------------------------------------

/**
 * Тот же запрос через локальный MTProto-прокси (обфускация с секретом, padded
 * intermediate, DC 2) — так, как к нему подключается приложение Telegram.
 * В режиме маскировки под TLS (ee-секрет) сквозной запрос не собираем:
 * проверяем, что прокси принимает соединения.
 */
async function checkTelegramProxy(p: ServicePoint): Promise<PointResult> {
  const cfg = await getAppConfig()
  const t = cfg.tgws ?? { host: '127.0.0.1', port: 1443, secret: '' }
  const host = t.host && t.host !== '0.0.0.0' ? t.host : '127.0.0.1'
  const port = t.port || 1443
  const sec = proxySecretBytes(t.secret)
  const fakeTls = !!(t as { fakeTlsDomain?: string }).fakeTlsDomain?.trim() || sec?.fakeTls === true
  const timeoutMs = SERVICE_TIMEOUT_MS - 500

  return new Promise<PointResult>((resolve) => {
    const t0 = Date.now()
    let settled = false
    let connected = false
    let buf = Buffer.alloc(0)
    const nonce = randomBytes(16)
    const s = net.createConnection({ host, port })
    const done = (state: PointState, detail: string, ms: number | null = null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      s.destroy()
      resolve({ key: p.key, state, detail, ms })
    }
    const timer = setTimeout(
      () => done('down', connected ? 'прокси принял соединение, но ответа Telegram нет' : `прокси не отвечает за ${Math.round(timeoutMs / 1000)} с`),
      timeoutMs
    )
    let obf: ReturnType<typeof obfuscatedInit> | null = null
    s.once('connect', () => {
      connected = true
      if (fakeTls || !sec) {
        done('ok', fakeTls ? 'прокси запущен и принимает соединения (в режиме маскировки ответ Telegram не проверяется)' : 'прокси запущен и принимает соединения', Date.now() - t0)
        return
      }
      try {
        obf = obfuscatedInit(sec.secret, 2)
        s.write(Buffer.concat([obf.header, obf.encrypt.update(paddedPacket(buildReqPqMulti(nonce)))]))
      } catch (e) {
        done('down', describeNetError(e))
      }
    })
    s.on('data', (d: Buffer) => {
      if (!obf) return
      buf = Buffer.concat([buf, obf.decrypt.update(d)])
      if (buf.length > 8192) return done('down', describeResPq({ ok: false, reason: 'bad' }))
      const pkt = intermediateTakePacket(buf)
      if (!pkt) return
      const v = parseResPq(pkt, nonce)
      const ms = Date.now() - t0
      if (v.ok) done(ms > SLOW_RESPONSE_MS ? 'slow' : 'ok', ms > SLOW_RESPONSE_MS ? `отвечает медленно (${ms} мс)` : `Telegram ответил через прокси за ${ms} мс`, ms)
      else done('down', describeResPq(v))
    })
    s.once('error', (e) => done('down', `прокси: ${describeNetError(e, Math.round(timeoutMs / 1000))}`))
    s.once('close', () => done('down', connected ? 'прокси закрыл соединение, не получив ответа Telegram' : 'прокси не принимает соединения'))
  })
}

// ---- одна плитка ----------------------------------------------------------------------

function probe(p: ServicePoint): Promise<PointResult> {
  if (p.probe.kind === 'http') return checkHttp(p)
  if (p.probe.kind === 'mtproto') return checkTelegramDirect(p)
  return checkTelegramProxy(p)
}

/** Результат точки или «не ответила», если вышел общий срок. */
function withDeadline(p: ServicePoint, deadline: number): Promise<PointResult> {
  return new Promise((resolve) => {
    const left = Math.max(0, deadline - Date.now())
    const t = setTimeout(() => resolve({ key: p.key, state: 'down', detail: `нет ответа за ${Math.round(SERVICES_DEADLINE_MS / 1000)} с`, ms: null }), left)
    probe(p).then(
      (r) => {
        clearTimeout(t)
        resolve(r)
      },
      (e) => {
        clearTimeout(t)
        resolve({ key: p.key, state: 'down', detail: e instanceof Error ? e.message : String(e), ms: null })
      }
    )
  })
}

async function checkService(id: ServiceId, deadline: number, tgProxy: boolean): Promise<ServiceResult> {
  const spec = SERVICES.find((s) => s.id === id)!
  const points = id === 'telegram' ? telegramPoints(tgProxy) : SERVICE_POINTS[id]
  const results = await Promise.all(points.map((p) => withDeadline(p, deadline)))
  const via = id === 'telegram' && tgProxy ? 'proxy' : null
  const v = decideTile(points, results, { via })
  const byKey = new Map(results.map((r) => [r.key, r]))
  const coreMs = points
    .filter((p) => p.role === 'core')
    .map((p) => byKey.get(p.key)?.ms)
    .filter((x): x is number => typeof x === 'number')
  return {
    id,
    name: spec.name,
    siteDomain: spec.siteDomain,
    state: v.state,
    detail: v.detail,
    note: v.note,
    via,
    checkDomain: v.failedHost && !/^[\d.]+$/.test(v.failedHost) ? v.failedHost : spec.siteDomain,
    ms: coreMs.length ? Math.max(...coreMs) : null,
    points: points.map((p) => {
      const r = byKey.get(p.key)!
      return { key: p.key, label: p.label, host: p.host, role: p.role, state: r.state, detail: r.detail, ms: r.ms }
    })
  }
}

/** Проверить все сервисы сейчас (без кэша). */
async function runCheck(): Promise<ServiceResult[]> {
  const deadline = Date.now() + SERVICES_DEADLINE_MS
  let tgProxy = false
  try {
    tgProxy = getTgwsStatus().state === 'running'
  } catch {
    /* состояние прокси недоступно — проверяем напрямую */
  }
  return Promise.all(SERVICES.map((s) => checkService(s.id, deadline, tgProxy)))
}

/**
 * force=false: свежий кэш (моложе 10 минут) отдаётся без запросов, иначе
 * проверка запускается. force=true — всегда проверяет заново. Одновременные
 * вызовы (панель и мастер) делят одну проверку. Свежий результат рассылается
 * во все окна событием diag:servicesUpdated — панель и мастер показывают одно и то же.
 */
export function getServicesReport(force = false): Promise<ServicesReport> {
  const route = serviceRouteKey()
  if (!force && cache?.route === route && Date.now() - cache.at < SERVICES_TTL_MS) {
    return Promise.resolve({ at: cache.at, results: cache.results, cached: true })
  }
  if (inflight?.route === route) return inflight.report
  const report = runCheck()
    .then((results) => {
      if (serviceRouteKey() !== route) return getServicesReport()
      if (inflight?.report !== report) return getServicesReport()
      cache = { route, at: Date.now(), results }
      const rep: ServicesReport = { at: cache.at, results, cached: false }
      broadcast('diag:servicesUpdated', rep)
      return rep
    })
    .finally(() => {
      if (inflight?.report === report) inflight = null
    })
  inflight = { route, report }
  return report
}
