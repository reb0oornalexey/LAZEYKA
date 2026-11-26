/**
 * Прокси для раздачи интернета компьютера на другие устройства (телефон, приставка, телевизор).
 *
 * HTTP-прокси (обычные запросы и CONNECT) и SOCKS5 (только CONNECT, без UDP) на ОДНОМ порту:
 * по первому байту соединения (0x05 — SOCKS5) определяется протокол.
 *
 * Важно: исходящие соединения открывает сам компьютер обычным net.connect, без привязки к адаптеру.
 * Поэтому на них автоматически действуют Zapret (он обрабатывает исходящий трафик компьютера) и
 * включённый VPN в режиме TUN. Это же и ограничение: прокси не обходит ничего сверх того, что
 * компьютер делает для самого себя.
 *
 * Файл не зависит от Electron — его можно поднять в обычном node (так он и проверяется).
 */
import dns from 'node:dns'
import net from 'node:net'
import os from 'node:os'
import { createHash, timingSafeEqual } from 'node:crypto'

const PHONE_PROXY_CHECK_HOST = 'lazeyka-proxy-check.invalid'
export const PHONE_PROXY_CHECK_ORIGIN = `http://${PHONE_PROXY_CHECK_HOST}`
export const PHONE_PROXY_CHECK_PATH = '/remote-check'

// ---- Чистые функции: адреса -----------------------------------------------------

/** Убрать «::ffff:» у IPv4, записанного как IPv6, и «%зону» у IPv6. */
export function normalizeIp(addr: string | undefined | null): string {
  if (!addr) return ''
  let a = addr.trim()
  const z = a.indexOf('%')
  if (z > 0) a = a.slice(0, z)
  if (a.toLowerCase().startsWith('::ffff:') && net.isIPv4(a.slice(7))) return a.slice(7)
  return a
}

function octets(ip: string): [number, number, number, number] | null {
  if (!net.isIPv4(ip)) return null
  const p = ip.split('.').map(Number)
  return [p[0], p[1], p[2], p[3]]
}

/**
 * Частный адрес локальной сети: 10/8, 172.16/12, 192.168/16, 169.254/16, 127/8
 * (для IPv6 — только ::1, fe80::/10 и fc00::/7). Всё остальное — чужой адрес.
 */
export function isPrivateAddress(addr: string | undefined | null): boolean {
  const ip = normalizeIp(addr)
  const o = octets(ip)
  if (o) {
    const [a, b] = o
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase()
    return l === '::1' || /^fe[89ab][0-9a-f]:/.test(l) || /^f[cd][0-9a-f]{2}:/.test(l)
  }
  return false
}

/**
 * Нельзя ли прокси соединяться с этим адресом: петля (127/8), link-local (169.254/16),
 * «этот узел» (0/8), многоадресные и широковещательные (224+), IPv6 ::1/::/fe80, а также
 * адреса самого компьютера (`self`) — иначе устройство получило бы доступ к службам ПК.
 */
export function isForbiddenProxyTarget(addr: string, self: Iterable<string> = []): boolean {
  const ip = normalizeIp(addr)
  const o = octets(ip)
  if (o) {
    const [a, b] = o
    if (a === 0 || a === 127 || a >= 224 || (a === 169 && b === 254)) return true
  } else if (net.isIPv6(ip)) {
    const l = ip.toLowerCase()
    if (l === '::' || l === '::1' || /^fe[89ab][0-9a-f]:/.test(l) || l.startsWith('ff')) return true
  } else {
    return true
  }
  for (const s of self) if (normalizeIp(s) === ip) return true
  return false
}

/** Все адреса сетевых интерфейсов этого компьютера. */
export function ownAddresses(): string[] {
  const out: string[] = []
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list ?? []) out.push(normalizeIp(i.address))
  }
  return out
}

/** «host:port» или «[v6]:port» → части. */
export function parseHostPort(s: string, defaultPort: number): { host: string; port: number } | null {
  let host: string
  let portStr: string | undefined
  if (s.startsWith('[')) {
    const end = s.indexOf(']')
    if (end < 0) return null
    host = s.slice(1, end)
    const rest = s.slice(end + 1)
    if (rest) {
      if (!rest.startsWith(':')) return null
      portStr = rest.slice(1)
    }
  } else {
    const i = s.lastIndexOf(':')
    if (i >= 0 && s.indexOf(':') === i) {
      host = s.slice(0, i)
      portStr = s.slice(i + 1)
    } else if (i >= 0) {
      return null // голый IPv6 без скобок
    } else {
      host = s
    }
  }
  const port = portStr === undefined || portStr === '' ? defaultPort : Number(portStr)
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return null
  return { host, port }
}

// ---- Защита от подбора ----------------------------------------------------------

/** Счётчик неудач по IP: после `max` неудач адрес блокируется на `blockMs`. */
export class FailGuard {
  private map = new Map<string, { n: number; until: number }>()
  constructor(
    private readonly max = 10,
    private readonly blockMs = 10 * 60_000,
    private readonly now: () => number = Date.now
  ) {}

  isBlocked(ip: string): boolean {
    const e = this.map.get(ip)
    if (!e || !e.until) return false
    if (e.until > this.now()) return true
    this.map.delete(ip)
    return false
  }

  fail(ip: string): void {
    if (this.map.size > 2000) this.map.clear()
    const e = this.map.get(ip) ?? { n: 0, until: 0 }
    e.n += 1
    if (e.n >= this.max) e.until = this.now() + this.blockMs
    this.map.set(ip, e)
  }

  reset(): void {
    this.map.clear()
  }
}

/** Сравнение строк за постоянное время. */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest()
  const hb = createHash('sha256').update(b).digest()
  return timingSafeEqual(ha, hb) && a.length === b.length
}

// ---- Разбор HTTP-запроса --------------------------------------------------------

export interface HttpHead {
  method: string
  target: string
  version: string
  headers: [string, string][]
}

export function parseHttpHead(head: Buffer | string): HttpHead | null {
  const text = typeof head === 'string' ? head : head.toString('latin1')
  const lines = text.split('\r\n')
  const m = /^([A-Za-z]+) (\S+) (HTTP\/\d\.\d)$/.exec(lines[0] ?? '')
  if (!m) return null
  const headers: [string, string][] = []
  for (let i = 1; i < lines.length; i++) {
    const l = lines[i]
    if (!l) continue
    const c = l.indexOf(':')
    if (c <= 0) return null
    headers.push([l.slice(0, c).trim(), l.slice(c + 1).trim()])
  }
  return { method: m[1].toUpperCase(), target: m[2], version: m[3], headers }
}

/** Логин и пароль из заголовка Proxy-Authorization: Basic …. */
export function parseBasicAuth(value: string | undefined): { user: string; pass: string } | null {
  if (!value) return null
  const m = /^Basic\s+(\S+)$/i.exec(value.trim())
  if (!m) return null
  const raw = Buffer.from(m[1], 'base64').toString('utf8')
  const i = raw.indexOf(':')
  if (i < 0) return null
  return { user: raw.slice(0, i), pass: raw.slice(i + 1) }
}

// ---- Прокси ---------------------------------------------------------------------

export interface LanProxyOptions {
  host: string
  port: number
  username?: string
  password?: string
  /** Предохранитель от переполнения дескрипторов; по умолчанию 4096. */
  maxConnections?: number
  idleMs?: number
  connectTimeoutMs?: number
  /** Кому можно подключаться к прокси. По умолчанию — только частные адреса. */
  isClientAllowed?: (ip: string) => boolean
  /** Куда соединяться нельзя. По умолчанию — isForbiddenProxyTarget с адресами самого ПК. */
  isTargetForbidden?: (ip: string) => boolean
  /**
   * Собственная служба программы (адрес + порт пульта/страницы /setup): к ней прокси пропускает, даже если адрес — адрес
   * самого компьютера. Только к ней: остальные адреса компьютера и частные адреса сети по-прежнему закрыты.
   */
  isSelfService?: (ip: string, port: number) => boolean
  log?: (message: string) => void
}

export interface LanProxyStats {
  active: number
  total: number
  devices: string[]
  bytesFromClients: number
  bytesToClients: number
}

type DialResult = { socket: net.Socket } | { code: 'forbidden' | 'unreachable' | 'refused' | 'timeout' }

const DEVICE_TTL_MS = 60_000
const MAX_HEAD = 64 * 1024

class Reader {
  private buf: Buffer = Buffer.alloc(0)
  private ended = false
  private wake: (() => void) | null = null
  private readonly onData = (c: Buffer): void => {
    this.buf = Buffer.concat([this.buf, c])
    this.notify()
  }
  private readonly onEnd = (): void => {
    this.ended = true
    this.notify()
  }
  constructor(private readonly s: net.Socket) {
    s.on('data', this.onData)
    s.on('end', this.onEnd)
    s.on('close', this.onEnd)
  }
  private notify(): void {
    const w = this.wake
    this.wake = null
    w?.()
  }
  private wait(): Promise<void> {
    return new Promise((r) => {
      this.wake = r
    })
  }
  async take(n: number): Promise<Buffer | null> {
    while (this.buf.length < n) {
      if (this.ended) return null
      await this.wait()
    }
    const b = this.buf.subarray(0, n)
    this.buf = this.buf.subarray(n)
    return b
  }
  async peekByte(): Promise<number | null> {
    while (this.buf.length < 1) {
      if (this.ended) return null
      await this.wait()
    }
    return this.buf[0]
  }
  async takeHead(max: number): Promise<Buffer | null> {
    for (;;) {
      const i = this.buf.indexOf('\r\n\r\n')
      if (i >= 0) {
        const head = this.buf.subarray(0, i + 4)
        this.buf = this.buf.subarray(i + 4)
        return head
      }
      if (this.buf.length > max || this.ended) return null
      await this.wait()
    }
  }
  /** Отдать накопленные, но не разобранные байты и перестать слушать сокет. */
  detach(): Buffer {
    this.s.off('data', this.onData)
    this.s.off('end', this.onEnd)
    this.s.off('close', this.onEnd)
    this.s.pause()
    const rest = this.buf
    this.buf = Buffer.alloc(0)
    return rest
  }
}

const HANDSHAKE_MS = 30_000
const TUNNEL_IDLE_MS = 5 * 60_000
const STREAM_HWM = 128 * 1024
const HELLO_WAIT_MS = 300
const HELLO_MAX = 18 * 1024 + 5
const DNS_TTL_MS = 30_000
const SELF_TTL_MS = 5_000

/**
 * Первый кусок данных клиента отправить наружу ОДНИМ write.
 * Если это начало TLS (ClientHello), ждём всю запись по её длине (не дольше HELLO_WAIT_MS с первого байта):
 * Zapret на компьютере режет именно первый пакет, и ClientHello, разбитый на два отправления, может не обработаться.
 * Дальше — обычная пересылка через pipe (с обратным давлением).
 */
export function forwardFirstFlight(client: net.Socket, up: net.Socket, initial: Buffer, waitMs = HELLO_WAIT_MS): void {
  let buf = initial
  let timer: NodeJS.Timeout | null = null
  let done = false
  const complete = (b: Buffer): boolean => {
    if (b.length === 0) return false
    if (b[0] !== 0x16) return true
    if (b.length >= 2 && b[1] !== 0x03) return true
    if (b.length < 5) return false
    const total = 5 + b.readUInt16BE(3)
    return b.length >= total || total > HELLO_MAX
  }
  const finish = (): void => {
    if (done) return
    done = true
    if (timer) clearTimeout(timer)
    timer = null
    client.off('data', onData)
    client.off('end', finish)
    client.pause()
    if (buf.length && !up.destroyed) up.write(buf)
    buf = Buffer.alloc(0)
    client.pipe(up)
  }
  const onData = (c: Buffer): void => {
    buf = buf.length ? Buffer.concat([buf, c]) : c
    if (complete(buf)) return finish()
    if (!timer) timer = setTimeout(finish, waitMs)
  }
  if (complete(buf)) {
    done = true
    if (buf.length && !up.destroyed) up.write(buf)
    client.pipe(up)
    client.resume()
    return
  }
  if (buf.length) timer = setTimeout(finish, waitMs)
  client.on('data', onData)
  client.once('end', finish)
  client.resume()
}

export class LanProxy {
  private readonly servers = new Map<string, net.Server>()
  private readonly clients = new Set<net.Socket>()
  private readonly upstreams = new Set<net.Socket>()
  private readonly live = new Set<{ c: net.Socket; u: net.Socket }>()
  private readonly deviceMap = new Map<string, { active: number; last: number }>()
  private readonly dnsCache = new Map<string, { addr: string; until: number }>()
  private readonly dnsPending = new Map<string, Promise<string | null>>()
  private selfCache: { at: number; list: string[] } | null = null
  private user: string
  private pass: string
  /** Байты уже закрытых соединений; открытые считаются по счётчикам сокетов при запросе статистики. */
  private bytesFrom = 0
  private bytesTo = 0
  private totalConn = 0
  private readonly guard = new FailGuard()

  constructor(private readonly opts: LanProxyOptions) {
    this.user = opts.username ?? ''
    this.pass = opts.password ?? ''
  }

  get port(): number {
    for (const s of this.servers.values()) {
      const a = s.address()
      if (a && typeof a === 'object') return a.port
    }
    return this.opts.port
  }

  /** Адреса, на которых прокси сейчас слушает. */
  hosts(): string[] {
    return [...this.servers.keys()]
  }

  get authRequired(): boolean {
    return Boolean(this.user && this.pass)
  }

  setAuth(user: string, pass: string): void {
    this.user = user
    this.pass = pass
    this.guard.reset()
  }

  private listenOn(host: string, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const srv = net.createServer({ highWaterMark: STREAM_HWM, noDelay: true } as net.ServerOpts, (s) => this.onConnection(s))
      const onErr = (e: NodeJS.ErrnoException): void => {
        reject(Object.assign(new Error(listenErrorMessage(e, port, 'Прокси')), { code: e.code }))
      }
      srv.once('error', onErr)
      srv.listen({ port, host, backlog: 1024 }, () => {
        srv.off('error', onErr)
        srv.on('error', (e) => this.opts.log?.(`прокси: ${e.message}`))
        this.servers.set(host, srv)
        this.selfCache = null
        resolve()
      })
    })
  }

  start(): Promise<void> {
    return this.listenOn(this.opts.host, this.opts.port)
  }

  /** Начать слушать ещё и на этом адресе (например, на адресе раздаваемой сети Wi-Fi). Тот же порт. */
  async addHost(host: string): Promise<void> {
    if (this.servers.has(host)) return
    await this.listenOn(host, this.port)
  }

  async removeHost(host: string): Promise<void> {
    const srv = this.servers.get(host)
    if (!srv || host === this.opts.host) return
    this.servers.delete(host)
    this.selfCache = null
    await new Promise<void>((r) => srv.close(() => r()))
  }

  async stop(): Promise<void> {
    const list = [...this.servers.values()]
    this.servers.clear()
    for (const s of this.clients) s.destroy()
    for (const s of this.upstreams) s.destroy()
    this.clients.clear()
    this.upstreams.clear()
    this.live.clear()
    this.deviceMap.clear()
    this.dnsCache.clear()
    await Promise.all(list.map((srv) => new Promise<void>((r) => srv.close(() => r()))))
  }

  /** Отличить прямой запрос пульта от запроса, который проходит через наш прокси. */
  ownsUpstream(ip: string, port: number): boolean {
    for (const socket of this.upstreams) {
      if (socket.localPort === port && normalizeIp(socket.localAddress) === ip) return true
    }
    return false
  }

  stats(): LanProxyStats {
    const now = Date.now()
    const devices: string[] = []
    for (const [ip, d] of this.deviceMap) {
      if (d.active > 0 || now - d.last < DEVICE_TTL_MS) devices.push(ip)
      else this.deviceMap.delete(ip)
    }
    let from = this.bytesFrom
    let to = this.bytesTo
    for (const p of this.live) {
      from += p.c.bytesRead
      to += p.c.bytesWritten
    }
    return { active: this.clients.size, total: this.totalConn, devices, bytesFromClients: from, bytesToClients: to }
  }

  // ---- соединение ----

  private clientAllowed(ip: string): boolean {
    return (this.opts.isClientAllowed ?? isPrivateAddress)(ip)
  }

  private selfAddresses(): string[] {
    const now = Date.now()
    if (this.selfCache && now - this.selfCache.at < SELF_TTL_MS) return this.selfCache.list
    const list = [...ownAddresses(), this.opts.host, ...this.servers.keys()]
    this.selfCache = { at: now, list }
    return list
  }

  private targetForbidden(ip: string): boolean {
    if (this.opts.isTargetForbidden) return this.opts.isTargetForbidden(ip)
    // Частные адреса сети тоже закрыты: прокси раздаёт интернет, а не доступ к роутеру и другим устройствам дома.
    return isForbiddenProxyTarget(ip, this.selfAddresses()) || isPrivateAddress(ip)
  }

  /** Это служба самой программы (пульт, страница /setup)? Только ей разрешён доступ к адресам компьютера. */
  private selfService(ip: string, port: number): boolean {
    return this.opts.isSelfService ? this.opts.isSelfService(normalizeIp(ip), port) : false
  }

  private onConnection(sock: net.Socket): void {
    const ip = normalizeIp(sock.remoteAddress)
    sock.on('error', () => void 0)
    if (!this.clientAllowed(ip) || this.guard.isBlocked(ip) || this.clients.size >= (this.opts.maxConnections ?? 4096)) {
      sock.destroy()
      return
    }
    sock.setNoDelay(true)
    sock.setKeepAlive(true, 30_000)
    sock.setTimeout(HANDSHAKE_MS)
    sock.on('timeout', () => sock.destroy())
    this.clients.add(sock)
    this.totalConn++
    const dev = this.deviceMap.get(ip) ?? { active: 0, last: 0 }
    dev.active++
    dev.last = Date.now()
    this.deviceMap.set(ip, dev)
    sock.on('close', () => {
      this.clients.delete(sock)
      const d = this.deviceMap.get(ip)
      if (d) {
        d.active = Math.max(0, d.active - 1)
        d.last = Date.now()
      }
    })
    this.handle(sock, ip).catch(() => sock.destroy())
  }

  private async handle(sock: net.Socket, ip: string): Promise<void> {
    const reader = new Reader(sock)
    const first = await reader.peekByte()
    if (first === null) return void sock.destroy()
    if (first === 0x05) await this.handleSocks(sock, reader, ip)
    else await this.handleHttp(sock, reader, ip)
  }

  private authOk(user: string, pass: string): boolean {
    return safeEqual(user, this.user) && safeEqual(pass, this.pass)
  }

  /** Имя → IPv4 (иначе любой адрес). Короткий кэш и один запрос на имя: поток libuv для имён небольшой. */
  private resolveName(host: string): Promise<string | null> {
    const key = host.toLowerCase()
    const hit = this.dnsCache.get(key)
    if (hit && hit.until > Date.now()) return Promise.resolve(hit.addr)
    let p = this.dnsPending.get(key)
    if (!p) {
      p = (async (): Promise<string | null> => {
        let addr: string | null = null
        try {
          addr = (await dns.promises.lookup(host, { family: 4 })).address
        } catch {
          try {
            addr = (await dns.promises.lookup(host)).address
          } catch {
            addr = null
          }
        }
        if (addr) {
          if (this.dnsCache.size > 1000) this.dnsCache.clear()
          this.dnsCache.set(key, { addr, until: Date.now() + DNS_TTL_MS })
        }
        return addr
      })().finally(() => this.dnsPending.delete(key))
      this.dnsPending.set(key, p)
    }
    return p
  }

  /**
   * Открыть исходящее соединение. Адрес проверяется ПОСЛЕ разрешения имени.
   * Соединение обычное (без привязки к адаптеру): его видит Zapret, а при включённом VPN в режиме TUN оно идёт через VPN.
   */
  private async dial(host: string, port: number): Promise<DialResult> {
    const addr = net.isIP(host) ? host : await this.resolveName(host)
    if (!addr) return { code: 'unreachable' }
    if (!this.selfService(addr, port) && this.targetForbidden(addr)) return { code: 'forbidden' }
    return new Promise<DialResult>((resolve) => {
      const up = net.connect({ host: addr, port, highWaterMark: STREAM_HWM, noDelay: true } as net.NetConnectOpts)
      this.upstreams.add(up)
      up.setNoDelay(true)
      up.setTimeout(this.opts.connectTimeoutMs ?? 15_000)
      const fail = (code: 'unreachable' | 'refused' | 'timeout'): void => {
        up.destroy()
        resolve({ code })
      }
      up.once('timeout', () => fail('timeout'))
      up.once('error', (e: NodeJS.ErrnoException) => fail(e.code === 'ECONNREFUSED' ? 'refused' : 'unreachable'))
      up.once('connect', () => {
        up.removeAllListeners('timeout')
        up.removeAllListeners('error')
        up.on('error', () => void 0)
        up.setKeepAlive(true, 30_000)
        up.setTimeout(this.opts.idleMs ?? TUNNEL_IDLE_MS)
        up.on('timeout', () => up.destroy())
        resolve({ socket: up })
      })
      up.once('close', () => this.upstreams.delete(up))
    })
  }

  /** Склеить клиента и узел: пересылка в обе стороны через pipe, счёт байтов — по счётчикам сокетов. */
  private relay(client: net.Socket, up: net.Socket, initial: Buffer): void {
    if (client.destroyed) return void up.destroy()
    const pair = { c: client, u: up }
    this.live.add(pair)
    let closed = false
    const end = (): void => {
      if (closed) return
      closed = true
      this.live.delete(pair)
      this.bytesFrom += client.bytesRead
      this.bytesTo += client.bytesWritten
      client.destroy()
      up.destroy()
    }
    client.on('close', end)
    up.on('close', end)
    client.setTimeout(this.opts.idleMs ?? TUNNEL_IDLE_MS)
    up.pipe(client)
    forwardFirstFlight(client, up, initial)
  }

  private isControlOrigin(origin: string): boolean {
    try {
      const parsed = new URL(origin)
      return parsed.protocol === 'http:' && parsed.origin === origin &&
        this.selfService(parsed.hostname.replace(/^\[|\]$/g, ''), Number(parsed.port || 80))
    } catch {
      return false
    }
  }

  // ---- HTTP ----

  private async handleHttp(sock: net.Socket, reader: Reader, ip: string): Promise<void> {
    const raw = await reader.takeHead(MAX_HEAD)
    if (!raw) return void sock.destroy()
    const head = parseHttpHead(raw)
    const reply = (code: number, text: string, extra = ''): void => {
      const body = `${text}\n`
      sock.end(
        `HTTP/1.1 ${code} ${text}\r\n${extra}Content-Type: text/plain; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`
      )
    }
    if (!head) return reply(400, 'Bad Request')
    const hv = (name: string): string | undefined => head.headers.find(([k]) => k.toLowerCase() === name)?.[1]

    if (this.authRequired) {
      const cred = parseBasicAuth(hv('proxy-authorization'))
      if (!cred) return reply(407, 'Proxy Authentication Required', 'Proxy-Authenticate: Basic realm="LAZEYKA"\r\n')
      if (!this.authOk(cred.user, cred.pass)) {
        this.guard.fail(ip)
        return reply(407, 'Proxy Authentication Required', 'Proxy-Authenticate: Basic realm="LAZEYKA"\r\n')
      }
    }

    if (head.method === 'CONNECT') {
      const hp = parseHostPort(head.target, 443)
      if (!hp) return reply(400, 'Bad Request')
      const r = await this.dial(hp.host, hp.port)
      if ('code' in r) return reply(r.code === 'forbidden' ? 403 : r.code === 'timeout' ? 504 : 502, r.code === 'forbidden' ? 'Forbidden' : 'Bad Gateway')
      const rest = reader.detach()
      sock.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      this.relay(sock, r.socket, rest)
      return
    }

    let url: URL
    try {
      url = new URL(head.target)
    } catch {
      return reply(400, 'Bad Request: this is a proxy, use it in device network settings')
    }
    if (url.protocol !== 'http:') return reply(400, 'Bad Request')

    // Этот контрольный домен не разрешается в DNS. Страница открывается
    // только через HTTP-прокси после обычной проверки доступа.
    if (url.hostname === PHONE_PROXY_CHECK_HOST) {
      if (head.method !== 'GET' || url.port || url.username || url.password || url.search) {
        return reply(404, 'Not Found')
      }
      if (url.pathname === PHONE_PROXY_CHECK_PATH) {
        const origin = hv('origin')
        if (!origin || !this.isControlOrigin(origin)) return reply(403, 'Forbidden')
        const body = '{"proxy":"lazeyka"}'
        sock.end(
          `HTTP/1.1 200 OK\r\nAccess-Control-Allow-Origin: ${origin}\r\nAccess-Control-Allow-Credentials: true\r\nVary: Origin\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n${body}`
        )
        return
      }
      if (url.pathname !== '/') return reply(404, 'Not Found')
      const body = 'LAZEYKA: браузер подключён к прокси компьютера. Теперь откройте YouTube в этом же браузере.'
      sock.end(
        `HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(body)}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n${body}`
      )
      return
    }
    const port = url.port ? Number(url.port) : 80
    const hostname = url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname
    const r = await this.dial(hostname, port)
    if ('code' in r) return reply(r.code === 'forbidden' ? 403 : r.code === 'timeout' ? 504 : 502, r.code === 'forbidden' ? 'Forbidden' : 'Bad Gateway')
    const drop = new Set(['proxy-authorization', 'proxy-connection', 'connection', 'keep-alive', 'host'])
    const lines = [`${head.method} ${url.pathname || '/'}${url.search} HTTP/1.1`, `Host: ${url.host}`]
    for (const [k, v] of head.headers) if (!drop.has(k.toLowerCase())) lines.push(`${k}: ${v}`)
    lines.push('Connection: close', '', '')
    const rest = reader.detach()
    this.relay(sock, r.socket, Buffer.concat([Buffer.from(lines.join('\r\n'), 'latin1'), rest]))
  }

  // ---- SOCKS5 ----

  private async handleSocks(sock: net.Socket, reader: Reader, ip: string): Promise<void> {
    const h = await reader.take(2)
    if (!h) return void sock.destroy()
    const methods = await reader.take(h[1])
    if (!methods) return void sock.destroy()
    const offered = new Set(methods)
    const readUserPass = async (): Promise<{ u: Buffer; p: Buffer } | null> => {
      const v = await reader.take(2)
      if (!v || v[0] !== 1) return null
      const u = await reader.take(v[1])
      const pl = u && (await reader.take(1))
      const p = pl && (await reader.take(pl[0]))
      return u && p ? { u, p } : null
    }
    if (this.authRequired) {
      if (!offered.has(0x02)) return void sock.end(Buffer.from([5, 0xff]))
      sock.write(Buffer.from([5, 0x02]))
      const up = await readUserPass()
      if (!up) return void sock.destroy()
      if (!this.authOk(up.u.toString('utf8'), up.p.toString('utf8'))) {
        this.guard.fail(ip)
        return void sock.end(Buffer.from([1, 1]))
      }
      sock.write(Buffer.from([1, 0]))
    } else if (offered.has(0x00)) {
      sock.write(Buffer.from([5, 0x00]))
    } else if (offered.has(0x02)) {
      // Пароль не нужен, но клиент (например, Telegram с заполненными полями) предлагает только «логин и пароль»: принимаем любые.
      sock.write(Buffer.from([5, 0x02]))
      if (!(await readUserPass())) return void sock.destroy()
      sock.write(Buffer.from([1, 0]))
    } else {
      return void sock.end(Buffer.from([5, 0xff]))
    }

    const rh = await reader.take(4)
    if (!rh || rh[0] !== 5) return void sock.destroy()
    const refuse = (code: number): void => void sock.end(Buffer.from([5, code, 0, 1, 0, 0, 0, 0, 0, 0]))
    let host: string
    if (rh[3] === 1) {
      const a = await reader.take(4)
      if (!a) return void sock.destroy()
      host = [...a].join('.')
    } else if (rh[3] === 3) {
      const l = await reader.take(1)
      const d = l && (await reader.take(l[0]))
      if (!l || !d) return void sock.destroy()
      host = d.toString('latin1')
    } else if (rh[3] === 4) {
      const a = await reader.take(16)
      if (!a) return void sock.destroy()
      const parts: string[] = []
      for (let i = 0; i < 16; i += 2) parts.push(a.readUInt16BE(i).toString(16))
      host = parts.join(':')
    } else {
      return refuse(8)
    }
    const pb = await reader.take(2)
    if (!pb) return void sock.destroy()
    if (rh[1] !== 1) return refuse(7)
    const r = await this.dial(host, pb.readUInt16BE(0))
    if ('code' in r) return refuse(r.code === 'forbidden' ? 2 : r.code === 'refused' ? 5 : r.code === 'timeout' ? 6 : 4)
    const rest = reader.detach()
    sock.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]))
    this.relay(sock, r.socket, rest)
  }
}

export function listenErrorMessage(e: NodeJS.ErrnoException, port: number, what: string): string {
  if (e.code === 'EADDRINUSE') return `${what}: порт ${port} занят другой программой. Выберите другой порт в настройках.`
  if (e.code === 'EACCES') return `${what}: нет прав на порт ${port}. Выберите порт больше 1024.`
  if (e.code === 'EADDRNOTAVAIL') return `${what}: адрес компьютера в сети изменился. Выключите и включите раздел заново.`
  return `${what}: не удалось запустить на порту ${port} (${e.message}).`
}
