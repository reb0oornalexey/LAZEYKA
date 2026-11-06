/**
 * Тест скорости интернета «как у всех»: если INCY подключён — через него,
 * иначе напрямую. Сервис замера выбирает пользователь.
 *
 * Замер честный и долгий: скачивание ~12 с в 6 потоков, отдача ~10 с в 4
 * потока; первые 2 с (разгон TCP) в скорость не идут. «Экономный» режим
 * ограничивает расход (~150 МБ на скачивание), «Полный» — без лимита.
 *
 * Сервисы:
 *  - Cloudflare (speed.cloudflare.com) — тот же, что в браузере;
 *  - Speedtest by Ookla — ближайший сервер из публичного списка speedtest.net;
 *  - Яндекс Интернетометр — CDN Яндекса (зонды yandex.ru/internet).
 */
import net from 'node:net'
import tls from 'node:tls'
import { BrowserWindow } from 'electron'
import { socksConnect, startTempCore, withCoreSlot, type TempCore } from './core-probe'
import { getIncyStatus, loadIncyNodes, loadIncySettings } from './incy-engine'

export type SpeedService = 'cloudflare' | 'ookla' | 'yandex'

export interface NetSpeedProgress {
  /** Замер через конкретный сервер INCY (вкладка INCY); пусто — замер с главной. */
  nodeId?: string
  phase: 'prepare' | 'ping' | 'download' | 'upload' | 'done' | 'error'
  mbps?: number
  pingMs?: number | null
  downloadMbps?: number | null
  /** 0..1 — доля текущей фазы. */
  progress?: number
  message?: string
}

export interface NetSpeedResult {
  service: SpeedService
  server: string
  viaVpn: boolean
  pingMs: number | null
  jitterMs: number | null
  downloadMbps: number | null
  uploadMbps: number | null
  downloadedMB: number
  uploadedMB: number
  error?: string
}

interface Endpoint {
  host: string
  port: number
}
interface Plan {
  server: string
  ping: Endpoint & { path: string }
  download: (Endpoint & { path: string })[]
  upload: Endpoint & { path: (size: number) => string; chunk: number }
}

const DOWNLOAD_SECONDS = 12
const UPLOAD_SECONDS = 10
const WARMUP_SECONDS = 2
const DOWNLOAD_STREAMS = 6
const UPLOAD_STREAMS = 4
const ECONOMY_CAP = 200 * 1024 * 1024

let running = false
let currentNodeId: string | undefined

function send(p: NetSpeedProgress): void {
  const msg = currentNodeId ? { ...p, nodeId: currentNodeId } : p
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('speed:progress', msg)
  }
}

// ---- соединение: через INCY (SOCKS) или напрямую ---------------------------

function viaSocksPort(): number | null {
  try {
    const st = getIncyStatus()
    if (st.state !== 'running') return null
    const s = loadIncySettings()
    if (s.socksAuth) return null // в TUN трафик и так идёт через VPN
    return s.mixedPort || 20808
  } catch {
    return null
  }
}

async function openTls(ep: Endpoint, socksPort: number | null): Promise<tls.TLSSocket> {
  const raw = socksPort
    ? await socksConnect(socksPort, ep.host, ep.port, 10_000)
    : await new Promise<net.Socket>((resolve, reject) => {
        const s = net.createConnection({ host: ep.host, port: ep.port })
        s.setTimeout(10_000, () => {
          s.destroy()
          reject(new Error('таймаут соединения'))
        })
        s.once('connect', () => {
          s.setTimeout(0)
          resolve(s)
        })
        s.once('error', reject)
      })
  return new Promise((resolve, reject) => {
    const t = tls.connect({ socket: raw, servername: ep.host, ALPNProtocols: ['http/1.1'] })
    t.setTimeout(12_000, () => {
      t.destroy()
      reject(new Error('таймаут TLS'))
    })
    t.once('secureConnect', () => {
      t.setTimeout(0)
      resolve(t)
    })
    t.once('error', reject)
  })
}

/**
 * Один HTTP/1.1-запрос по уже открытому соединению (keep-alive). Считает байты
 * тела через onBytes. Понимает Content-Length и chunked.
 */
function httpRequest(
  sock: tls.TLSSocket,
  host: string,
  method: 'GET' | 'POST',
  path: string,
  body: Buffer | null,
  onBytes: (n: number) => void,
  shouldStop: () => boolean
): Promise<number> {
  return new Promise((resolve, reject) => {
    let head = Buffer.alloc(0)
    let headerDone = false
    let remaining = -1
    let chunked = false
    let status = 0
    const finish = (err?: Error): void => {
      sock.off('data', onData)
      sock.off('error', onErr)
      sock.off('close', onClose)
      if (err) reject(err)
      else resolve(status)
    }
    const onErr = (e: Error): void => finish(e)
    const onClose = (): void => finish(headerDone ? undefined : new Error('соединение закрыто'))
    const onData = (d: Buffer): void => {
      if (!headerDone) {
        head = Buffer.concat([head, d])
        const idx = head.indexOf('\r\n\r\n')
        if (idx < 0) return
        const text = head.subarray(0, idx).toString('latin1')
        status = Number(/^HTTP\/1\.\d (\d{3})/.exec(text)?.[1] ?? 0)
        const cl = /\r\ncontent-length:\s*(\d+)/i.exec(text)
        chunked = /\r\ntransfer-encoding:\s*chunked/i.test(text)
        remaining = cl ? Number(cl[1]) : -1
        headerDone = true
        d = head.subarray(idx + 4)
        if (d.length === 0) {
          if (remaining === 0) finish()
          return
        }
      }
      onBytes(d.length)
      if (remaining >= 0) {
        remaining -= d.length
        if (remaining <= 0) return finish()
      } else if (chunked && d.subarray(-5).toString('latin1') === '0\r\n\r\n') {
        return finish()
      }
      if (shouldStop()) {
        sock.destroy()
        finish()
      }
    }
    sock.on('data', onData)
    sock.once('error', onErr)
    sock.once('close', onClose)
    const headers =
      `${method} ${path} HTTP/1.1\r\nHost: ${host}\r\nUser-Agent: Mozilla/5.0 LAZEYKA\r\nAccept: */*\r\nConnection: keep-alive\r\n` +
      (body ? `Content-Type: application/octet-stream\r\nContent-Length: ${body.length}\r\n` : '') +
      '\r\n'
    sock.write(headers)
    if (body) sock.write(body)
  })
}

// ---- планы сервисов ----------------------------------------------------------

async function fetchJson<T>(url: string, socksPort: number | null): Promise<T> {
  const u = new URL(url)
  const sock = await openTls({ host: u.hostname, port: Number(u.port) || 443 }, socksPort)
  try {
    const chunks: Buffer[] = []
    await new Promise<void>((resolve, reject) => {
      let head = true
      sock.write(`GET ${u.pathname}${u.search} HTTP/1.1\r\nHost: ${u.hostname}\r\nUser-Agent: Mozilla/5.0 LAZEYKA\r\nAccept: application/json\r\nConnection: close\r\n\r\n`)
      sock.on('data', (d: Buffer) => chunks.push(d))
      sock.once('end', () => resolve())
      sock.once('close', () => resolve())
      sock.once('error', reject)
      setTimeout(() => {
        if (head) {
          head = false
          sock.destroy()
        }
      }, 12_000)
    })
    const raw = Buffer.concat(chunks).toString('utf8')
    let body = raw.slice(raw.indexOf('\r\n\r\n') + 4)
    if (/\r\ntransfer-encoding:\s*chunked/i.test(raw.slice(0, raw.indexOf('\r\n\r\n')))) {
      // склеиваем куски chunked
      let out = ''
      let rest = body
      for (;;) {
        const nl = rest.indexOf('\r\n')
        const size = parseInt(rest.slice(0, nl), 16)
        if (!size) break
        out += rest.slice(nl + 2, nl + 2 + size)
        rest = rest.slice(nl + 2 + size + 2)
      }
      body = out
    }
    return JSON.parse(body) as T
  } finally {
    sock.destroy()
  }
}

async function planFor(service: SpeedService, socksPort: number | null): Promise<Plan> {
  if (service === 'cloudflare') {
    const ep = { host: 'speed.cloudflare.com', port: 443 }
    return {
      server: 'speed.cloudflare.com',
      ping: { ...ep, path: '/__down?bytes=0' },
      download: [{ ...ep, path: '/__down?bytes=25000000' }],
      upload: { ...ep, path: () => '/__up', chunk: 4 * 1024 * 1024 }
    }
  }
  if (service === 'ookla') {
    type S = { host: string; name: string; sponsor: string; country: string }
    const list = await fetchJson<S[]>('https://www.speedtest.net/api/js/servers?engine=js&limit=5&https_functional=true', socksPort)
    if (!Array.isArray(list) || list.length === 0) throw new Error('Speedtest не вернул список серверов')
    // Ближайший по задержке из пяти предложенных.
    let best: { s: S; ms: number } | null = null
    for (const s of list) {
      const [h, p] = s.host.split(':')
      const t0 = Date.now()
      try {
        const sock = await openTls({ host: h, port: Number(p) || 8080 }, socksPort)
        sock.destroy()
        const ms = Date.now() - t0
        if (!best || ms < best.ms) best = { s, ms }
      } catch {
        /* следующий */
      }
    }
    if (!best) throw new Error('Серверы Speedtest недоступны')
    const [host, port] = best.s.host.split(':')
    const ep = { host, port: Number(port) || 8080 }
    return {
      server: `${best.s.sponsor} — ${best.s.name}`,
      ping: { ...ep, path: '/hello' },
      download: [{ ...ep, path: '/download?size=25000000' }],
      upload: { ...ep, path: () => '/upload', chunk: 4 * 1024 * 1024 }
    }
  }
  // Яндекс Интернетометр: зонды выдаёт yandex.ru/internet.
  type Probe = { url: string }
  type Probes = { latency: { probes: Probe[] }; download: { probes: Probe[] }; upload: { probes: Probe[] } }
  const j = await fetchJson<Probes>('https://yandex.ru/internet/api/v0/get-probes', socksPort)
  const toEp = (url: string): Endpoint & { path: string } => {
    const u = new URL(url)
    return { host: u.hostname, port: Number(u.port) || 443, path: `${u.pathname}${u.search}` }
  }
  const big = j.download.probes.filter((p) => /\/50mb|\/100mb|\/20mb|\/10mb/.test(p.url)).map((p) => toEp(p.url))
  const up = j.upload.probes[0]
  if (!big.length || !up || !j.latency.probes[0]) throw new Error('Яндекс не выдал зонды для замера')
  const upEp = toEp(up.url)
  return {
    server: `Яндекс (${big[0].host.split('.')[0]})`,
    ping: toEp(j.latency.probes[0].url),
    download: big,
    upload: {
      host: upEp.host,
      port: upEp.port,
      // Зонд отдачи принимает тело того размера, что указан в ссылке.
      path: (size) => upEp.path.replace(/size=\d+/, `size=${size}`),
      chunk: 1024 * 1024
    }
  }
}

// ---- фазы замера -------------------------------------------------------------

async function measurePing(plan: Plan, socksPort: number | null): Promise<{ ping: number | null; jitter: number | null }> {
  const sock = await openTls(plan.ping, socksPort)
  const samples: number[] = []
  try {
    for (let i = 0; i < 8; i++) {
      const t0 = performance.now()
      await httpRequest(sock, plan.ping.host, 'GET', plan.ping.path, null, () => void 0, () => false)
      samples.push(performance.now() - t0)
      send({ phase: 'ping', progress: (i + 1) / 8 })
    }
  } catch {
    /* сколько успели */
  } finally {
    sock.destroy()
  }
  if (samples.length < 2) return { ping: null, jitter: null }
  const rest = samples.slice(1).sort((a, b) => a - b) // первый — с прогревом
  const ping = rest[Math.floor(rest.length / 2)]
  const diffs = samples.slice(2).map((v, i) => Math.abs(v - samples[i + 1]))
  const jitter = diffs.length ? diffs.reduce((a, b) => a + b, 0) / diffs.length : null
  return { ping: Math.round(ping), jitter: jitter == null ? null : Math.round(jitter) }
}

/**
 * Скорость, Мбит/с. Обычно — по данным после разгона. Если замер закончился
 * раньше (быстрый канал упёрся в лимит экономного режима до конца разгона),
 * считаем по всему объёму — раньше в этом случае выходил прочерк.
 */
function rate(start: number, warm: number, end: number, total: number, afterWarm: number): number | null {
  const now = Math.min(performance.now(), end)
  const warmSecs = (now - warm) / 1000
  if (warmSecs > 1 && afterWarm >= 1024 * 1024) return (afterWarm * 8) / warmSecs / 1e6
  const secs = (now - start) / 1000
  if (secs > 0.3 && total >= 256 * 1024) return (total * 8) / secs / 1e6
  return null
}

async function measureDownload(plan: Plan, socksPort: number | null, economy: boolean, pingMs: number | null): Promise<{ mbps: number | null; bytes: number }> {
  const start = performance.now()
  const end = start + DOWNLOAD_SECONDS * 1000
  const warm = start + WARMUP_SECONDS * 1000
  let total = 0
  let afterWarm = 0
  const stop = (): boolean => performance.now() > end || (economy && total > ECONOMY_CAP)
  const tick = setInterval(() => {
    const now = performance.now()
    const secs = (now - Math.max(warm, start)) / 1000
    send({
      phase: 'download',
      pingMs,
      progress: Math.min(1, (now - start) / (DOWNLOAD_SECONDS * 1000)),
      mbps: now > warm && secs > 0 ? (afterWarm * 8) / secs / 1e6 : undefined
    })
  }, 400)
  const worker = async (i: number): Promise<void> => {
    const ep = plan.download[i % plan.download.length]
    while (!stop()) {
      let sock: tls.TLSSocket | null = null
      try {
        sock = await openTls(ep, socksPort)
        while (!stop()) {
          await httpRequest(sock, ep.host, 'GET', ep.path, null, (n) => {
            total += n
            if (performance.now() > warm) afterWarm += n
          }, stop)
          if (sock.destroyed) break
        }
      } catch {
        await new Promise((r) => setTimeout(r, 300))
      } finally {
        sock?.destroy()
      }
    }
  }
  await Promise.all(Array.from({ length: DOWNLOAD_STREAMS }, (_, i) => worker(i)))
  clearInterval(tick)
  return { mbps: rate(start, warm, end, total, afterWarm), bytes: total }
}

async function measureUpload(plan: Plan, socksPort: number | null, economy: boolean, pingMs: number | null, downloadMbps: number | null): Promise<{ mbps: number | null; bytes: number }> {
  const start = performance.now()
  const end = start + UPLOAD_SECONDS * 1000
  const warm = start + WARMUP_SECONDS * 1000
  let total = 0
  let afterWarm = 0
  const body = Buffer.alloc(plan.upload.chunk, 0x61)
  const stop = (): boolean => performance.now() > end || (economy && total > ECONOMY_CAP / 2)
  const tick = setInterval(() => {
    const now = performance.now()
    const secs = (now - warm) / 1000
    send({
      phase: 'upload',
      pingMs,
      downloadMbps,
      progress: Math.min(1, (now - start) / (UPLOAD_SECONDS * 1000)),
      mbps: now > warm && secs > 0 ? (afterWarm * 8) / secs / 1e6 : undefined
    })
  }, 400)
  const worker = async (): Promise<void> => {
    const ep = plan.upload
    while (!stop()) {
      let sock: tls.TLSSocket | null = null
      try {
        sock = await openTls(ep, socksPort)
        const s = sock
        while (!stop()) {
          // Кусок засчитывается, только когда сервер подтвердил приём кодом 2xx.
          // Раньше считался любой ответ: сервер, сразу отвечавший ошибкой, давал
          // «отдано 54 МБ» за секунду, а скорость отдачи выходила пустой.
          const status = await httpRequest(s, ep.host, 'POST', ep.path(body.length), body, () => void 0, () => false)
          if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`)
          total += body.length
          if (performance.now() > warm) afterWarm += body.length
          if (s.destroyed) break
        }
      } catch {
        await new Promise((r) => setTimeout(r, 300))
      } finally {
        sock?.destroy()
      }
    }
  }
  await Promise.all(Array.from({ length: UPLOAD_STREAMS }, () => worker()))
  clearInterval(tick)
  return { mbps: rate(start, warm, end, total, afterWarm), bytes: total }
}

/**
 * Замер через конкретный сервер INCY — во временном ядре, не трогая
 * подключённый VPN. Сервис замера — тот же выбор, что и на главной.
 */
export async function runNodeSpeedTest(nodeId: string, service: SpeedService, economy = false): Promise<NetSpeedResult> {
  const node = loadIncyNodes().find((n) => n.id === nodeId)
  if (!node) throw new Error('Сервер не найден в списке')
  if (running) throw new Error('Замер уже идёт')
  currentNodeId = nodeId
  try {
    return await withCoreSlot(async () => {
      let tc: TempCore | null = null
      try {
        send({ phase: 'prepare', message: 'Подключаюсь к серверу (VPN не разрывается)…' })
        tc = await startTempCore(node)
        const r = await runNetSpeedTest(service, economy, { socksPort: tc.port, viaVpn: true })
        return { ...r, server: r.server ? `${node.name} → ${r.server}` : node.name }
      } finally {
        tc?.stop()
      }
    })
  } finally {
    currentNodeId = undefined
  }
}

export async function runNetSpeedTest(
  service: SpeedService,
  economy = false,
  via?: { socksPort: number; viaVpn: boolean }
): Promise<NetSpeedResult> {
  if (running) throw new Error('Замер уже идёт')
  running = true
  const socksPort = via ? via.socksPort : viaSocksPort()
  const viaVpn = via ? via.viaVpn : getIncyStatus().state === 'running'
  const base: NetSpeedResult = {
    service,
    server: '',
    viaVpn,
    pingMs: null,
    jitterMs: null,
    downloadMbps: null,
    uploadMbps: null,
    downloadedMB: 0,
    uploadedMB: 0
  }
  try {
    send({ phase: 'prepare', message: 'Выбираю сервер…' })
    const plan = await planFor(service, socksPort)
    base.server = plan.server
    const { ping, jitter } = await measurePing(plan, socksPort)
    base.pingMs = ping
    base.jitterMs = jitter
    const dl = await measureDownload(plan, socksPort, economy, ping)
    base.downloadMbps = dl.mbps == null ? null : Math.round(dl.mbps * 10) / 10
    base.downloadedMB = Math.round((dl.bytes / 1048576) * 10) / 10
    const ul = await measureUpload(plan, socksPort, economy, ping, base.downloadMbps)
    base.uploadMbps = ul.mbps == null ? null : Math.round(ul.mbps * 10) / 10
    base.uploadedMB = Math.round((ul.bytes / 1048576) * 10) / 10
    if (base.downloadMbps == null && base.uploadMbps == null) throw new Error('Сервер замера не ответил — попробуйте другой сервис')
    send({ phase: 'done', pingMs: base.pingMs, downloadMbps: base.downloadMbps, mbps: base.uploadMbps ?? undefined })
    return base
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    send({ phase: 'error', message: msg })
    return { ...base, error: msg }
  } finally {
    running = false
  }
}
