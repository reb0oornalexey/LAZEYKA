/**
 * Тест скорости через выбранный сервер INCY.
 *
 * Замер идёт через отдельное временное ядро, а не через поднятый туннель:
 * VPN не рвётся, и проверить можно любой сервер, а не только подключённый.
 * Сервер замера — speed.cloudflare.com (тот же, что у speed.cloudflare.com в
 * браузере): задержка, скачивание в несколько потоков и отдача.
 *
 * Расход трафика ограничен: не больше ~60 МБ на скачивание и 10 МБ на
 * отдачу, даже на очень быстром канале (важно для подписок с лимитом).
 */
import tls from 'node:tls'
import { performance } from 'node:perf_hooks'
import { BrowserWindow } from 'electron'
import { startTempCore, socksConnect, withCoreSlot, type TempCore } from './core-probe'
import { loadIncyNodes } from './incy-engine'

const HOST = 'speed.cloudflare.com'
const DOWNLOAD_STREAMS = 3
const DOWNLOAD_SECONDS = 8
const DOWNLOAD_CAP_BYTES = 60 * 1024 * 1024
const UPLOAD_BYTES = 10 * 1024 * 1024
const UPLOAD_TIMEOUT_MS = 20_000

let running = false

export interface SpeedTestProgress {
  nodeId: string
  phase: 'connect' | 'ping' | 'download' | 'upload' | 'done' | 'error'
  /** Текущая скорость текущей фазы, Мбит/с. */
  mbps?: number
  pingMs?: number | null
  downloadMbps?: number | null
}

export interface SpeedTestResult {
  nodeId: string
  nodeName: string
  pingMs: number | null
  downloadMbps: number | null
  uploadMbps: number | null
  downloadedMB: number
  error?: string
}

function send(p: SpeedTestProgress): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('incy:speedTestProgress', p)
  }
}

async function openTls(socksPort: number): Promise<tls.TLSSocket> {
  const raw = await socksConnect(socksPort, HOST, 443, 10_000)
  return new Promise((resolve, reject) => {
    const t = tls.connect({ socket: raw, servername: HOST, ALPNProtocols: ['http/1.1'] })
    t.setTimeout(12_000, () => {
      t.destroy()
      reject(new Error('таймаут TLS'))
    })
    t.once('secureConnect', () => {
      t.setTimeout(0)
      resolve(t)
    })
    t.once('error', reject)
    t.once('close', () => reject(new Error('соединение закрыто')))
  })
}

/** Задержка: медиана трёх пустых запросов по одному соединению (keep-alive). */
async function measurePing(port: number): Promise<number | null> {
  let sock: tls.TLSSocket | null = null
  try {
    sock = await openTls(port)
    const s = sock
    const samples: number[] = []
    for (let i = 0; i < 4; i++) {
      const ms = await new Promise<number | null>((resolve) => {
        let buf = ''
        const t0 = performance.now()
        const timer = setTimeout(() => done(null), 5000)
        const onData = (d: Buffer): void => {
          buf += d.toString('latin1')
          if (buf.includes('\r\n\r\n')) done(performance.now() - t0)
        }
        const done = (v: number | null): void => {
          clearTimeout(timer)
          s.off('data', onData)
          resolve(v)
        }
        s.on('data', onData)
        s.write(`GET /__down?bytes=0 HTTP/1.1\r\nHost: ${HOST}\r\nUser-Agent: LAZEYKA\r\nConnection: keep-alive\r\n\r\n`)
      })
      if (ms == null) break
      // Первый запрос включает «прогрев» соединения — его не считаем.
      if (i > 0) samples.push(ms)
    }
    if (samples.length === 0) return null
    samples.sort((a, b) => a - b)
    return Math.max(1, Math.round(samples[Math.floor(samples.length / 2)]))
  } catch {
    return null
  } finally {
    sock?.destroy()
  }
}

/** Скачивание в несколько потоков, время считается с первого байта. */
async function measureDownload(port: number, nodeId: string, pingMs: number | null): Promise<{ mbps: number | null; bytes: number }> {
  let total = 0
  let firstByteAt = 0
  let stopped = false
  const socks: tls.TLSSocket[] = []
  const perStream = Math.ceil(DOWNLOAD_CAP_BYTES / DOWNLOAD_STREAMS)

  const ticker = setInterval(() => {
    if (!firstByteAt) return
    const sec = (performance.now() - firstByteAt) / 1000
    if (sec > 0.3) send({ nodeId, phase: 'download', mbps: (total * 8) / sec / 1e6, pingMs })
  }, 400)

  const deadline = new Promise<void>((resolve) => setTimeout(resolve, (DOWNLOAD_SECONDS + 4) * 1000))
  const streams = Array.from({ length: DOWNLOAD_STREAMS }, async () => {
    let s: tls.TLSSocket
    try {
      s = await openTls(port)
    } catch {
      return
    }
    socks.push(s)
    await new Promise<void>((resolve) => {
      let headerDone = false
      let head = Buffer.alloc(0)
      s.on('data', (d: Buffer) => {
        if (stopped) return
        let body = d
        if (!headerDone) {
          head = Buffer.concat([head, d])
          const idx = head.indexOf('\r\n\r\n')
          if (idx === -1) return
          headerDone = true
          body = head.subarray(idx + 4)
        }
        if (!firstByteAt && body.length > 0) firstByteAt = performance.now()
        total += body.length
        const elapsed = firstByteAt ? (performance.now() - firstByteAt) / 1000 : 0
        if (total >= DOWNLOAD_CAP_BYTES || elapsed >= DOWNLOAD_SECONDS) {
          stopped = true
          resolve()
        }
      })
      s.once('close', () => resolve())
      s.once('error', () => resolve())
      s.write(`GET /__down?bytes=${perStream} HTTP/1.1\r\nHost: ${HOST}\r\nUser-Agent: LAZEYKA\r\nConnection: close\r\n\r\n`)
    })
  })
  await Promise.race([Promise.all(streams), deadline])
  stopped = true
  clearInterval(ticker)
  const seconds = firstByteAt ? (performance.now() - firstByteAt) / 1000 : 0
  for (const s of socks) s.destroy()
  if (!firstByteAt || seconds <= 0 || total < 64 * 1024) return { mbps: null, bytes: total }
  return { mbps: (total * 8) / seconds / 1e6, bytes: total }
}

/** Отдача: 10 МБ одним POST, время — до ответа сервера (он отвечает после приёма). */
async function measureUpload(port: number, nodeId: string, pingMs: number | null, downloadMbps: number | null): Promise<number | null> {
  let s: tls.TLSSocket | null = null
  try {
    s = await openTls(port)
    const sock = s
    const chunk = Buffer.alloc(64 * 1024, 0x61)
    let sent = 0
    const t0 = performance.now()
    const ticker = setInterval(() => {
      const sec = (performance.now() - t0) / 1000
      if (sec > 0.3) send({ nodeId, phase: 'upload', mbps: (sent * 8) / sec / 1e6, pingMs, downloadMbps })
    }, 400)
    try {
      const result = await new Promise<number | null>((resolve) => {
        const timer = setTimeout(() => {
          // Не успели за 20 с — считаем по тому, что ушло.
          const sec = (performance.now() - t0) / 1000
          resolve(sent > 256 * 1024 ? (sent * 8) / sec / 1e6 : null)
        }, UPLOAD_TIMEOUT_MS)
        sock.once('data', () => {
          clearTimeout(timer)
          const sec = (performance.now() - t0) / 1000
          resolve(sec > 0 ? (UPLOAD_BYTES * 8) / sec / 1e6 : null)
        })
        sock.once('error', () => {
          clearTimeout(timer)
          resolve(null)
        })
        sock.write(
          `POST /__up HTTP/1.1\r\nHost: ${HOST}\r\nUser-Agent: LAZEYKA\r\nContent-Type: application/octet-stream\r\nContent-Length: ${UPLOAD_BYTES}\r\nConnection: close\r\n\r\n`
        )
        const pump = (): void => {
          while (sent < UPLOAD_BYTES) {
            const n = Math.min(chunk.length, UPLOAD_BYTES - sent)
            sent += n
            if (!sock.write(n === chunk.length ? chunk : chunk.subarray(0, n))) {
              sock.once('drain', pump)
              return
            }
          }
        }
        pump()
      })
      return result
    } finally {
      clearInterval(ticker)
    }
  } catch {
    return null
  } finally {
    s?.destroy()
  }
}

export async function runIncySpeedTest(nodeId: string): Promise<SpeedTestResult> {
  const node = loadIncyNodes().find((n) => n.id === nodeId)
  if (!node) throw new Error('Сервер не найден в списке')
  if (running) throw new Error('Тест скорости уже идёт')
  running = true
  const base: SpeedTestResult = {
    nodeId,
    nodeName: node.name,
    pingMs: null,
    downloadMbps: null,
    uploadMbps: null,
    downloadedMB: 0
  }
  try {
    return await withCoreSlot(async () => {
      let tc: TempCore | null = null
      try {
        send({ nodeId, phase: 'connect' })
        tc = await startTempCore(node)
        send({ nodeId, phase: 'ping' })
        const pingMs = await measurePing(tc.port)
        if (pingMs == null) {
          const r = { ...base, error: 'Сервер не пропускает трафик — замерить скорость нельзя' }
          send({ nodeId, phase: 'error' })
          return r
        }
        send({ nodeId, phase: 'download', pingMs })
        const dl = await measureDownload(tc.port, nodeId, pingMs)
        send({ nodeId, phase: 'upload', pingMs, downloadMbps: dl.mbps })
        const ul = await measureUpload(tc.port, nodeId, pingMs, dl.mbps)
        const result: SpeedTestResult = {
          ...base,
          pingMs,
          downloadMbps: dl.mbps == null ? null : Math.round(dl.mbps * 10) / 10,
          uploadMbps: ul == null ? null : Math.round(ul * 10) / 10,
          downloadedMB: Math.round((dl.bytes / 1048576) * 10) / 10
        }
        send({ nodeId, phase: 'done', pingMs, downloadMbps: result.downloadMbps })
        return result
      } catch (e) {
        send({ nodeId, phase: 'error' })
        return { ...base, error: e instanceof Error ? e.message : String(e) }
      } finally {
        tc?.stop()
      }
    })
  } finally {
    running = false
  }
}
