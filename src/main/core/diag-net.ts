/**
 * «Диагностика»: общие сетевые помощники — события в окна, физический адаптер,
 * обычный запрос (как у любой программы на этом компьютере) и запрос с
 * привязкой к адресу адаптера (мимо VPN).
 */
import { BrowserWindow, net as enet } from 'electron'
import { execFile } from 'node:child_process'
import https from 'node:https'
import os from 'node:os'
import { performance } from 'node:perf_hooks'
import { physicalSourceIp } from './core-probe'
import { getIncyStatus } from './incy-engine'
import { decodeConsole } from '../utils/console-decode'
import { parseMacDefaultRoute, parseWinDefaultRoute } from './prematch-stats'
import { describeNetError } from './diag-logic'

export function broadcast(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) {
      try {
        w.webContents.send(channel, payload)
      } catch {
        /* окно закрывается */
      }
    }
  }
}

/** Запуск утилиты; вывод декодируется с учётом OEM-кодировки русской Windows. Ненулевой код — не ошибка. */
export function runCmd(file: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    try {
      execFile(
        file,
        args,
        { windowsHide: true, timeout: timeoutMs, encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 },
        (_e, stdout) => resolve(decodeConsole(stdout ?? Buffer.alloc(0)))
      )
    } catch {
      resolve('')
    }
  })
}

// ---- физический адаптер ---------------------------------------------------------------

export interface PhysAdapter {
  ip: string | null
  /** Имя соединения (Windows) / интерфейс enN (macOS). */
  iface: string | null
}

function ifaceNameByIp(ip: string): string | null {
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    if (list?.some((a) => a.family === 'IPv4' && a.address === ip)) return name
  }
  return null
}

/** Физический адаптер с маршрутом по умолчанию (не туннель). */
export async function physAdapter(): Promise<PhysAdapter> {
  try {
    if (process.platform === 'win32') {
      const d = parseWinDefaultRoute(await runCmd('route.exe', ['print', '-4', '0.0.0.0'], 5000))
      if (d?.ip) return { ip: d.ip, iface: ifaceNameByIp(d.ip) }
    } else if (process.platform === 'darwin') {
      const d = parseMacDefaultRoute(await runCmd('/usr/sbin/netstat', ['-rn', '-f', 'inet'], 5000))
      if (d?.iface) {
        const a = os.networkInterfaces()[d.iface]?.find((x) => x.family === 'IPv4' && !x.internal)
        return { ip: a?.address ?? null, iface: d.iface }
      }
    }
  } catch {
    /* ниже — пусто */
  }
  return { ip: null, iface: null }
}

export interface DirectSource {
  /** Адрес физического адаптера; null — привязка не нужна (VPN выключен) или невозможна. */
  ip: string | null
  /** Можно ли сделать запрос мимо VPN. false — нельзя, причина в reason. */
  measurable: boolean
  reason?: string
}

/**
 * Откуда слать запросы «мимо VPN». Windows: сокет, привязанный к адресу
 * физического адаптера, уходит мимо TUN. macOS: привязка по адресу маршрут не
 * определяет, поэтому при включённом VPN мимо него измерить нельзя; при
 * выключенном — обычный запрос и есть «напрямую».
 */
export async function directSource(): Promise<DirectSource> {
  const vpnOn = getIncyStatus().state === 'running'
  if (process.platform === 'win32') {
    const ip = await physicalSourceIp()
    if (ip) return { ip, measurable: true }
    return vpnOn
      ? { ip: null, measurable: false, reason: 'не удалось определить сетевой адаптер, через который выходит компьютер' }
      : { ip: null, measurable: true }
  }
  if (!vpnOn) return { ip: null, measurable: true }
  return { ip: null, measurable: false, reason: 'на этом компьютере запрос мимо работающего VPN сделать нельзя' }
}

// ---- обычный запрос ---------------------------------------------------------------------

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'

export interface PlainResponse {
  status: number
  finalHost: string
  body: string
  cfChallenge: boolean
  ms: number
  /** Сколько байт тела прочитано. */
  bytes: number
  /** Тело дочитано до конца (а не обрезано по maxBytes и не оборвано). */
  bodyDone: boolean
}

/**
 * Запрос средствами Chromium приложения: системные DNS и прокси, проверка
 * сертификата — так же, как у обычной программы. Тело читаем до maxBytes.
 */
export async function plainFetch(url: string, timeoutMs: number, maxBytes = 4096): Promise<PlainResponse> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  const t0 = performance.now()
  try {
    const res = await enet.fetch(url, {
      signal: ac.signal,
      redirect: 'follow',
      headers: { 'user-agent': UA, accept: '*/*', 'accept-language': 'en-US,en;q=0.8' }
    })
    const ms = Math.round(performance.now() - t0)
    let finalHost = ''
    try {
      finalHost = new URL(res.url || url).hostname
    } catch {
      /* пусто */
    }
    let body = ''
    let got = 0
    let bodyDone = true
    if (res.body) {
      bodyDone = false
      const reader = res.body.getReader()
      const chunks: Buffer[] = []
      try {
        while (got < maxBytes) {
          const { done, value } = await reader.read()
          if (done || !value) {
            bodyDone = true
            break
          }
          chunks.push(Buffer.from(value))
          got += value.byteLength
        }
      } catch {
        /* тело оборвалось (или вышло время) — достаточно того, что пришло */
      }
      void reader.cancel().catch(() => void 0)
      body = Buffer.concat(chunks).subarray(0, Math.min(maxBytes, 64 * 1024)).toString('utf-8')
    }
    return {
      status: res.status,
      finalHost,
      body,
      cfChallenge: (res.headers.get('cf-mitigated') ?? '').toLowerCase() === 'challenge',
      ms,
      bytes: got,
      bodyDone
    }
  } catch (e) {
    if (ac.signal.aborted) throw new Error(describeNetError(new Error('timeout'), Math.round(timeoutMs / 1000)))
    throw new Error(describeNetError(e, Math.round(timeoutMs / 1000)))
  } finally {
    clearTimeout(timer)
  }
}

// ---- запрос Node (привязка к адресу, подключение на IP) --------------------------------

export interface HttpsOpts {
  timeoutMs: number
  /** Адрес физического адаптера. */
  localAddress?: string
  family?: 4 | 6
  /** Не проверять сертификат (нужно для проверки доступности российских сайтов с чужим корневым центром). */
  insecure?: boolean
  /** Подключиться на этот адрес, а имя оставить в SNI и Host. */
  connectIp?: string
  maxBytes?: number
}

export interface HttpsResult {
  status: number
  headers: Record<string, string | string[] | undefined>
  body: string
  ms: number
}

export function httpsGet(url: string, o: HttpsOpts): Promise<HttpsResult> {
  return new Promise((resolve, reject) => {
    let u: URL
    try {
      u = new URL(url)
    } catch (e) {
      return reject(e)
    }
    const t0 = performance.now()
    const max = o.maxBytes ?? 4096
    const req = https.request(
      {
        host: o.connectIp ?? u.hostname,
        port: Number(u.port) || 443,
        path: `${u.pathname}${u.search}`,
        method: 'GET',
        servername: o.connectIp && !/^[\d.:]+$/.test(u.hostname) ? u.hostname : undefined,
        headers: { Host: u.host, 'User-Agent': UA, Accept: '*/*', 'Accept-Encoding': 'identity', Connection: 'close' },
        localAddress: o.localAddress,
        family: o.family ?? (o.localAddress && !o.localAddress.includes(':') ? 4 : undefined),
        rejectUnauthorized: !o.insecure,
        agent: false
      },
      (res) => {
        const ms = Math.round(performance.now() - t0)
        const chunks: Buffer[] = []
        let got = 0
        res.on('data', (d: Buffer) => {
          chunks.push(d)
          got += d.length
          if (got >= max) {
            clearTimeout(timer)
            res.destroy()
            finish()
          }
        })
        const finish = (): void => {
          clearTimeout(timer)
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).subarray(0, max).toString('utf-8'), ms })
        }
        res.on('end', finish)
        res.on('close', finish)
        res.on('error', finish)
      }
    )
    const timer = setTimeout(() => req.destroy(new Error('timeout')), o.timeoutMs)
    req.on('error', (e) => {
      clearTimeout(timer)
      reject(new Error(describeNetError(e, Math.round(o.timeoutMs / 1000))))
    })
    req.end()
  })
}
