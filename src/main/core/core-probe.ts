/**
 * Общие инструменты замеров для INCY, ExitLag и автовыбора узла.
 *
 *  - временное ядро (Xray или sing-box — то же, что поднял бы туннель) с
 *    SOCKS5 на loopback для проверки узла «настоящим трафиком»;
 *  - TCP/ICMP-замер задержки ДО узла в обход поднятого TUN: сокет
 *    привязывается к адресу физического адаптера, поэтому Windows отправляет
 *    его мимо виртуального (иначе TUN-стек отвечал на рукопожатие сам и у
 *    всех узлов было одинаковое число).
 */
import net from 'node:net'
import tls from 'node:tls'
import dns from 'node:dns'
import path from 'node:path'
import { execFile, spawn, ChildProcess } from 'node:child_process'
import { writeFileSync, unlinkSync, existsSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import {
  loadIncySettings,
  buildSingBoxOutbound,
  buildWireGuardEndpoint,
  type IncyNode
} from './incy-engine'
import { corePreferenceFor, computePorts } from './incy-topology'
import { buildXrayConfig } from './incy-xray'
import { dataDir, incyBinaryPath, isXrayAvailable, xrayAssetsDir, xrayBinaryPath } from '../utils/dirs'
import { registerChild, unregisterChild } from '../utils/child-registry'

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// ---- concurrency ------------------------------------------------------------

/** Не больше трёх временных ядер одновременно — иначе замер сам грузит ПК. */
const CORE_SLOTS = 3
let busySlots = 0
const slotQueue: (() => void)[] = []

export async function withCoreSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (busySlots >= CORE_SLOTS) await new Promise<void>((r) => slotQueue.push(r))
  busySlots++
  try {
    return await fn()
  } finally {
    busySlots--
    slotQueue.shift()?.()
  }
}

// ---- temporary core ------------------------------------------------------------

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.unref()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      srv.close(() => resolve(port))
    })
  })
}

async function waitListening(port: number, cp: ChildProcess, timeoutMs = 6000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (cp.exitCode !== null) return false
    const ok = await new Promise<boolean>((resolve) => {
      const s = net.createConnection({ host: '127.0.0.1', port })
      s.once('connect', () => {
        s.destroy()
        resolve(true)
      })
      s.once('error', () => resolve(false))
    })
    if (ok) return true
    await sleep(120)
  }
  return false
}

export interface TempCore {
  core: 'xray' | 'sing-box'
  port: number
  stop: () => void
}

/** Поднять временное ядро с SOCKS5 (UDP включён) на loopback для одного узла. */
export async function startTempCore(node: IncyNode): Promise<TempCore> {
  const settings = {
    ...loadIncySettings(),
    // Замер: весь трафик через узел, без блокировок.
    blockUdp: false,
    customRoutingRules: [],
    routingMode: 'global' as const
  }
  const port = await freePort()
  const pref = corePreferenceFor(node, settings)
  const useXray = pref === 'xray' && isXrayAvailable()
  const tmp = path.join(dataDir(), `temp-probe-${randomBytes(5).toString('hex')}.json`)

  let bin: string
  let env: NodeJS.ProcessEnv = process.env
  if (useXray) {
    const ports = { ...computePorts(port), bridge: port }
    const cfg = buildXrayConfig(node, settings, {
      ports,
      chained: true,
      bypassDomains: [],
      routingMode: 'global',
      geoTier: 'none'
    }) as Record<string, any> | null
    if (!cfg) throw new Error('узел не поддерживается ядром Xray')
    cfg.log = { loglevel: 'none', access: 'none' }
    writeFileSync(tmp, JSON.stringify(cfg), 'utf-8')
    bin = xrayBinaryPath()
    env = { ...process.env, XRAY_LOCATION_ASSET: xrayAssetsDir() }
  } else {
    const isWg = node.protocol === 'wireguard'
    const cfg: Record<string, unknown> = {
      log: { level: 'error' },
      inbounds: [{ type: 'mixed', tag: 'in', listen: '127.0.0.1', listen_port: port }],
      ...(isWg ? { endpoints: [buildWireGuardEndpoint(node)] } : {}),
      outbounds: isWg
        ? [{ type: 'direct', tag: 'direct' }]
        : [buildSingBoxOutbound(node, settings), { type: 'direct', tag: 'direct' }],
      route: { final: 'proxy', auto_detect_interface: true }
    }
    writeFileSync(tmp, JSON.stringify(cfg), 'utf-8')
    bin = incyBinaryPath()
  }
  if (!existsSync(bin)) throw new Error(`ядро не найдено: ${bin}`)

  const cp = spawn(bin, ['run', '-c', tmp], { windowsHide: true, env, cwd: path.dirname(bin), stdio: 'ignore' })
  registerChild(cp.pid, bin)
  let stopped = false
  const stop = (): void => {
    if (stopped) return
    stopped = true
    try {
      if (process.platform === 'win32' && cp.pid) {
        spawn('taskkill.exe', ['/F', '/T', '/PID', String(cp.pid)], { windowsHide: true }).on('error', () => void 0)
      } else {
        cp.kill('SIGKILL')
      }
    } catch { /* noop */ }
    unregisterChild(cp.pid)
    try { if (existsSync(tmp)) unlinkSync(tmp) } catch { /* noop */ }
  }
  cp.on('exit', () => unregisterChild(cp.pid))
  if (!(await waitListening(port, cp))) {
    stop()
    throw new Error('ядро не запустилось')
  }
  return { core: useXray ? 'xray' : 'sing-box', port, stop }
}

// ---- SOCKS5 -------------------------------------------------------------------

/** SOCKS5 CONNECT к host:port через временное ядро. */
export function socksConnect(socksPort: number, host: string, port: number, timeoutMs: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const s = net.createConnection({ host: '127.0.0.1', port: socksPort })
    let stage = 0
    let buf = Buffer.alloc(0)
    const fail = (e: Error): void => {
      s.destroy()
      reject(e)
    }
    s.setTimeout(timeoutMs, () => fail(new Error('timeout')))
    s.once('error', fail)
    s.once('connect', () => s.write(Buffer.from([0x05, 0x01, 0x00])))
    const onData = (d: Buffer): void => {
      buf = Buffer.concat([buf, d])
      if (stage === 0 && buf.length >= 2) {
        if (buf[1] !== 0x00) return fail(new Error('SOCKS auth rejected'))
        buf = buf.subarray(2)
        stage = 1
        const h = Buffer.from(host, 'utf8')
        s.write(Buffer.concat([Buffer.from([0x05, 0x01, 0x00, 0x03, h.length]), h, Buffer.from([port >> 8, port & 0xff])]))
      }
      // Длина ответа зависит от типа адреса: IPv4 — 10 байт, IPv6 — 22,
      // домен — 7 + длина. Лишние байты ответа не должны попасть в TLS.
      const need =
        buf.length >= 5 ? (buf[3] === 0x04 ? 22 : buf[3] === 0x03 ? 7 + buf[4] : 10) : Infinity
      if (stage === 1 && buf.length >= need) {
        if (buf[1] !== 0x00) return fail(new Error(`SOCKS CONNECT refused (${buf[1]})`))
        s.off('data', onData)
        s.setTimeout(0)
        resolve(s)
      }
    }
    s.on('data', onData)
  })
}

/**
 * Настоящий HTTP-запрос к тестовому адресу через узел — время от начала
 * соединения до первого байта ответа (так же считает «URL test» в Clash /
 * sing-box). Включает рукопожатие с узлом, поэтому число больше, чем чистый
 * пинг до узла, — зато проверяет, что трафик реально проходит.
 */
export async function httpViaCore(
  node: IncyNode,
  testUrl: string,
  method: 'GET' | 'HEAD',
  timeoutMs: number
): Promise<number | null> {
  let url: URL
  try {
    url = new URL(testUrl)
  } catch {
    url = new URL('https://www.gstatic.com/generate_204')
  }
  const https = url.protocol === 'https:'
  const port = Number(url.port) || (https ? 443 : 80)
  return withCoreSlot(async () => {
    let tc: TempCore | null = null
    try {
      tc = await startTempCore(node)
      const t0 = performance.now()
      const raw = await socksConnect(tc.port, url.hostname, port, timeoutMs)
      const sock: net.Socket = https
        ? await new Promise<net.Socket>((resolve, reject) => {
            const t = tls.connect({ socket: raw, servername: url.hostname, ALPNProtocols: ['http/1.1'] })
            t.setTimeout(timeoutMs, () => {
              t.destroy()
              reject(new Error('timeout'))
            })
            t.once('secureConnect', () => resolve(t))
            t.once('error', reject)
          })
        : raw
      const ms = await new Promise<number | null>((resolve) => {
        sock.setTimeout(timeoutMs, () => resolve(null))
        sock.once('data', () => resolve(performance.now() - t0))
        sock.once('error', () => resolve(null))
        sock.write(
          `${method} ${url.pathname || '/'}${url.search} HTTP/1.1\r\nHost: ${url.hostname}\r\nUser-Agent: LAZEYKA\r\nConnection: close\r\n\r\n`
        )
      })
      sock.destroy()
      return ms == null ? null : Math.max(1, Math.round(ms))
    } catch {
      return null
    } finally {
      tc?.stop()
    }
  })
}

// ---- in front of the TUN ---------------------------------------------------------

let srcCache: { at: number; ip: string | null } | null = null

/**
 * IPv4 физического адаптера с маршрутом по умолчанию (не TUN 172.19.0.x).
 * Сокет, привязанный к этому адресу, Windows отправляет через физический
 * адаптер — мимо TUN.
 */
export function physicalSourceIp(): Promise<string | null> {
  if (srcCache && Date.now() - srcCache.at < 30_000) return Promise.resolve(srcCache.ip)
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(null)
    execFile('route.exe', ['print', '-4', '0.0.0.0'], { windowsHide: true, timeout: 4000 }, (_e, stdout) => {
      let best: { ip: string; metric: number } | null = null
      for (const line of String(stdout ?? '').split(/\r?\n/)) {
        const m = /^\s*0\.0\.0\.0\s+0\.0\.0\.0\s+(\S+)\s+(\d+\.\d+\.\d+\.\d+)\s+(\d+)/.exec(line)
        if (!m) continue
        const [, gw, ip, metric] = m
        if (ip.startsWith('172.19.0.') || !net.isIPv4(gw)) continue
        if (!best || Number(metric) < best.metric) best = { ip, metric: Number(metric) }
      }
      srcCache = { at: Date.now(), ip: best?.ip ?? null }
      resolve(srcCache.ip)
    })
  })
}

async function resolve4(host: string): Promise<string | null> {
  if (net.isIPv4(host)) return host
  try {
    // getaddrinfo без таймаута может висеть десятки секунд и занять пул
    // потоков libuv — тогда встают все замеры разом.
    let timer: NodeJS.Timeout | undefined
    const res = await Promise.race([
      dns.promises.lookup(host, { family: 4 }).then((r) => r.address),
      new Promise<null>((r) => {
        timer = setTimeout(() => r(null), 3000)
      })
    ])
    clearTimeout(timer)
    return res
  } catch {
    return null
  }
}

function tcpOnce(ip: string, port: number, timeoutMs: number, localAddress?: string): Promise<number | null> {
  return new Promise((resolve) => {
    const start = performance.now()
    const s = net.createConnection({ host: ip, port, ...(localAddress ? { localAddress } : {}) })
    const done = (v: number | null): void => {
      s.destroy()
      resolve(v)
    }
    s.setTimeout(timeoutMs, () => done(null))
    s.once('connect', () => done(Math.max(1, Math.round(performance.now() - start))))
    s.once('error', () => done(null))
  })
}

/** Медиана трёх TCP-рукопожатий с узлом (1 RTT каждое). */
export async function tcpRtt(host: string, port: number, timeoutMs: number, localAddress?: string): Promise<number | null> {
  const ip = await resolve4(host)
  if (!ip) return null
  const samples: number[] = []
  for (let i = 0; i < 3; i++) {
    const r = await tcpOnce(ip, port, timeoutMs, localAddress)
    if (r == null && i === 0) return null
    if (r != null) samples.push(r)
  }
  samples.sort((a, b) => a - b)
  return samples.length ? samples[Math.floor(samples.length / 2)] : null
}

/** ICMP-пинг (для UDP-узлов: Hysteria2, WireGuard), медиана трёх ответов. */
export function icmpRtt(host: string, timeoutMs: number, sourceIp?: string | null): Promise<number | null> {
  return resolve4(host).then(
    (ip) =>
      new Promise((resolve) => {
        if (!ip || process.platform !== 'win32') return resolve(null)
        const args = ['-n', '3', '-w', String(Math.min(timeoutMs, 2000)), ...(sourceIp ? ['-S', sourceIp] : []), ip]
        execFile('ping.exe', args, { windowsHide: true, timeout: 9000, encoding: 'latin1' }, (_e, stdout) => {
          const v = [...String(stdout ?? '').matchAll(/[=<](\d+)\s*[^\s\d]{0,4}\s+TTL=/gi)].map((m) => Math.max(1, Number(m[1])))
          v.sort((a, b) => a - b)
          resolve(v.length ? v[Math.floor(v.length / 2)] : null)
        })
      })
  )
}
