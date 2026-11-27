/**
 * Локальный HTTP-сервер раздела «Локальная сеть»: веб-приложение «Пульт LAZEYKA» для телефона.
 * Не зависит от Electron — поднимается обычным node (так он и проверяется).
 *
 * Страницы: «/» и «/setup» отдают одну оболочку с вкладками (lan-remote-page.ts). Сама оболочка данных не содержит,
 * кроме адреса и порта прокси для вкладки «Подключение» (как раньше /setup; пароль прокси не раскрывается).
 * Всё управление — только через /api/* и только с кодом доступа.
 *
 * Защита: только частные адреса; код доступа — в заголовке X-LZ-Key (телефон хранит его в localStorage) или в cookie
 * HttpOnly SameSite=Strict (ставится при входе по ссылке из QR); сравнение за постоянное время;
 * 10 неверных кодов с одного IP → блок на 10 минут; лимит запросов в минуту; POST только с X-LZ: 1 и верным Origin/Host.
 */
import http from 'node:http'
import { randomBytes } from 'node:crypto'
import { NONCE_TOKEN, buildManifest, buildShellPage, type SetupInfo } from './lan-remote-page'
import { LAN_ICONS } from './lan-icons'
import { PHONE_PROXY_CHECK_ORIGIN, PHONE_PROXY_CHECK_PATH, FailGuard, isPrivateAddress, listenErrorMessage, normalizeIp, safeEqual } from './lan-proxy'

export const REMOTE_SERVICES = ['zapret', 'vpn', 'tg', 'exitlag'] as const
export type RemoteService = (typeof REMOTE_SERVICES)[number]

/** Ответ на действие пульта. code — машинный признак для страницы (например, need_server → кнопка выбора сервера). */
export interface RemoteResult {
  ok: boolean
  message?: string
  code?: string
}

export interface LanServerHandlers {
  telegramLink?(host: string): Promise<{ link: string | null; message?: string }>
  getState(): Promise<unknown> | unknown
  /** Быстро отвечает: долгие действия идут в фоне, результат страница видит в состоянии. */
  toggle(service: RemoteService, on: boolean): Promise<RemoteResult | void>
  scenario(id: string): Promise<RemoteResult>
  all?(on: boolean): Promise<RemoteResult>
  vpnNodes?(): Promise<unknown> | unknown
  vpnSelect?(id: string): Promise<RemoteResult>
  /** «Обновить подписки» / «Проверить пинг»: запускает действие в фоне; прогресс — в vpnNodes().job. */
  vpnJob?(kind: 'refresh' | 'ping' | 'stop', body?: Record<string, unknown>): Promise<RemoteResult> | RemoteResult
  dnsState?(ping: boolean): Promise<unknown>
  dnsApply?(id: string): Promise<RemoteResult>
  proxyShare?(on: boolean, peer: { ip: string; port: number }): Promise<RemoteResult>
  youtubeCheck?(): Promise<{ label: string; ok: boolean; detail: string }[]>
}

export interface LanServerOptions {
  host: string
  port: number
  getToken: () => string
  handlers: LanServerHandlers
  /** Включён ли пульт (иначе /api отвечает 404, а оболочка показывает только «Подключение»). */
  isRemoteEnabled?: () => boolean
  /** Данные вкладки «Подключение» для адреса, по которому открыли страницу (Host без порта); null — раздача выключена. */
  getSetupInfo?: (host: string) => SetupInfo | null
  isClientAllowed?: (ip: string) => boolean
  maxFails?: number
  blockMs?: number
  /** Лимиты запросов с одного адреса в минуту: всего и действий (POST). */
  rateLimit?: { perMinute: number; postsPerMinute: number }
  log?: (message: string) => void
}

const COOKIE = 'lz'
const KEY_HEADER = 'x-lz-key'

/** Строгая политика: ни внешних адресов, ни чужих скриптов; inline только с одноразовым кодом страницы. */
export function cspFor(nonce: string | null): string {
  const base = "base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'"
  if (!nonce) return `default-src 'none'; ${base}`
  return `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self' ${PHONE_PROXY_CHECK_ORIGIN}${PHONE_PROXY_CHECK_PATH}; img-src 'self' data:; manifest-src 'self'; ${base}`
}

const SECURITY_HEADERS: Record<string, string> = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Resource-Policy': 'same-origin'
}

function closeServer(srv: http.Server): Promise<void> {
  return new Promise<void>((r) => {
    srv.close(() => r())
    srv.closeAllConnections()
  })
}

function parseCookies(h: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of (h ?? '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim()
  }
  return out
}

/**
 * Убрать из текста для телефона то, что не должно уходить из программы: адреса, ссылки, пути к файлам,
 * хвосты логов ядра. Названия серверов остаются.
 */
export function sanitizeRemoteMessage(input: unknown, max = 220): string {
  let s = String(input ?? '').replace(/[\r\n\t]+/g, ' ')
  s = s.replace(/\s*Последние строки:.*$/i, '')
  s = s.replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, '…')
  s = s.replace(/[A-Za-z]:\\[^\s,;)]+/g, '…')
  s = s.replace(/(?:\/(?:Users|home|Applications|private|var|tmp|opt|Library)\/)[^\s,;)]+/g, '…')
  s = s.replace(/\[?\b(?:[0-9a-f]{1,4}:){4,7}[0-9a-f]{1,4}\b\]?(?::\d+)?/gi, '…')
  s = s.replace(/\[?\b(?:[0-9a-f]{1,4}:)*[0-9a-f]{0,4}::(?:[0-9a-f]{1,4}:?)*\]?/gi, (m) => (m.length > 3 ? '…' : m))
  s = s.replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, '…')
  s = s.replace(/\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?!(?:exe|bat|cmd|dll|sys|json|log|txt|ps1|plist|conf|ya?ml)\b)[a-z]{2,24}(?::\d+)?\b/gi, '…')
  s = s.replace(/\(\s*(?:…\s*,?\s*)+\)/g, '').replace(/(?:…\s*,\s*)+…/g, '…')
  s = s.replace(/\s{2,}/g, ' ').trim()
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

/** Скользящее окно: не больше N запросов в минуту с одного адреса. */
export class RateLimiter {
  private map = new Map<string, number[]>()
  constructor(
    private readonly limit: number,
    private readonly windowMs = 60_000,
    private readonly now: () => number = Date.now
  ) {}

  hit(key: string): boolean {
    const t = this.now()
    if (this.map.size > 2000) this.map.clear()
    const list = (this.map.get(key) ?? []).filter((x) => t - x < this.windowMs)
    if (list.length >= this.limit) {
      this.map.set(key, list)
      return false
    }
    list.push(t)
    this.map.set(key, list)
    return true
  }
}

export class LanServer {
  private readonly servers = new Map<string, http.Server>()
  readonly guard: FailGuard
  private readonly rate: RateLimiter
  private readonly postRate: RateLimiter

  constructor(private readonly opts: LanServerOptions) {
    this.guard = new FailGuard(opts.maxFails ?? 10, opts.blockMs ?? 10 * 60_000)
    this.rate = new RateLimiter(opts.rateLimit?.perMinute ?? 300)
    this.postRate = new RateLimiter(opts.rateLimit?.postsPerMinute ?? 40)
  }

  private listenOn(host: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const srv = http.createServer((req, res) => {
        this.onRequest(req, res).catch((e) => {
          this.opts.log?.(`пульт: ${e instanceof Error ? e.message : String(e)}`)
          if (!res.headersSent) this.send(res, 500, 'text/plain; charset=utf-8', 'Внутренняя ошибка')
          else res.end()
        })
      })
      srv.requestTimeout = 15_000
      srv.headersTimeout = 10_000
      srv.keepAliveTimeout = 5_000
      const onErr = (e: NodeJS.ErrnoException): void => reject(Object.assign(new Error(listenErrorMessage(e, this.opts.port, 'Пульт')), { code: e.code }))
      srv.once('error', onErr)
      srv.listen(this.opts.port, host, () => {
        srv.off('error', onErr)
        srv.on('error', (e) => this.opts.log?.(`пульт: ${e.message}`))
        this.servers.set(host, srv)
        resolve()
      })
    })
  }

  start(): Promise<void> {
    return this.listenOn(this.opts.host)
  }

  /** Слушать ещё и на этом адресе (например, на адресе раздаваемой сети Wi-Fi). Тот же порт. */
  async addHost(host: string): Promise<void> {
    if (!this.servers.has(host)) await this.listenOn(host)
  }

  async removeHost(host: string): Promise<void> {
    const srv = this.servers.get(host)
    if (!srv || host === this.opts.host) return
    this.servers.delete(host)
    await closeServer(srv)
  }

  /** Адреса, на которых сервер сейчас слушает. */
  hosts(): string[] {
    return [...this.servers.keys()]
  }

  async stop(): Promise<void> {
    const list = [...this.servers.values()]
    this.servers.clear()
    await Promise.all(list.map(closeServer))
  }

  private allowedHosts(): Set<string> {
    const p = this.opts.port
    const s = new Set([`127.0.0.1:${p}`, `localhost:${p}`])
    for (const h of this.servers.keys()) s.add(`${h}:${p}`)
    return s
  }

  private send(res: http.ServerResponse, status: number, type: string, body: string | Buffer, extra: Record<string, string> = {}): void {
    const isHtml = type.startsWith('text/html')
    const nonce = isHtml ? randomBytes(16).toString('base64') : null
    const text = nonce && typeof body === 'string' ? body.split(NONCE_TOKEN).join(nonce) : body
    res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Security-Policy': cspFor(nonce), 'Content-Type': type, ...extra })
    res.end(text)
  }

  private json(res: http.ServerResponse, status: number, data: unknown, extra: Record<string, string> = {}): void {
    this.send(res, status, 'application/json; charset=utf-8', JSON.stringify(data), extra)
  }

  /** Код верный? Пустой токен в программе — никому. */
  private checkKey(k: string | undefined | null): boolean {
    const token = this.opts.getToken()
    return Boolean(token && k && safeEqual(k, token))
  }

  private async onRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const ip = normalizeIp(req.socket.remoteAddress)
    if (!(this.opts.isClientAllowed ?? isPrivateAddress)(ip)) return this.send(res, 403, 'text/plain; charset=utf-8', 'Forbidden')
    if (this.guard.isBlocked(ip)) {
      return this.send(res, 429, 'text/plain; charset=utf-8', 'Слишком много неверных кодов. Подождите 10 минут.')
    }
    const host = req.headers.host ?? ''
    if (!this.allowedHosts().has(host)) return this.send(res, 400, 'text/plain; charset=utf-8', 'Bad Host')

    const method = req.method ?? 'GET'
    if (method !== 'GET' && method !== 'POST') return this.send(res, 405, 'text/plain; charset=utf-8', 'Method Not Allowed', { Allow: 'GET, POST' })
    if (!this.rate.hit(ip) || (method === 'POST' && !this.postRate.hit(ip))) {
      return this.json(res, 429, { ok: false, message: 'Слишком много запросов. Подождите минуту.' }, { 'Retry-After': '30' })
    }
    const url = new URL(req.url ?? '/', `http://${host}`)
    const path = url.pathname
    const remoteOn = this.opts.isRemoteEnabled ? this.opts.isRemoteEnabled() : true

    // ---- Открытое всем в сети: значки и описание веб-приложения (без данных) ----
    if (method === 'GET') {
      const icon = LAN_ICONS[path.slice(1)] ?? (path === '/favicon.ico' ? LAN_ICONS['icon-192.png'] : undefined)
      if (icon) {
        return this.send(res, 200, 'image/png', Buffer.from(icon.b64, 'base64'), { 'Cache-Control': 'public, max-age=604800' })
      }
      if (path === '/manifest.webmanifest') {
        // С верным кодом (s=…) значок на экране «Домой» сразу откроет пульт с этим кодом:
        // на iPhone у установленного приложения своё хранилище, отдельное от Safari.
        const s = url.searchParams.get('s')
        let start = '/?app=1'
        if (s && remoteOn) {
          if (this.checkKey(s)) start = `/?app=1&k=${encodeURIComponent(s)}`
          else this.guard.fail(ip)
        }
        return this.send(res, 200, 'application/manifest+json; charset=utf-8', JSON.stringify(buildManifest(start)))
      }
    }

    // ---- Оболочка: «/» (пульт) и «/setup» (подключение) ----
    if (method === 'GET' && (path === '/' || path === '/setup')) {
      const setup = this.opts.getSetupInfo?.(host.replace(/:\d+$/, '')) ?? null
      if (!remoteOn && !setup) return this.send(res, 404, 'text/plain; charset=utf-8', 'Not Found')
      const extra: Record<string, string> = {}
      let keyBad = false
      const k = url.searchParams.get('k')
      if (k !== null && remoteOn) {
        if (this.checkKey(k)) extra['Set-Cookie'] = `${COOKIE}=${encodeURIComponent(k)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`
        else {
          this.guard.fail(ip)
          keyBad = true
        }
      }
      const html = buildShellPage({ setup, remote: remoteOn, tab: path === '/setup' ? 'setup' : 'remote', keyBad })
      return this.send(res, 200, 'text/html; charset=utf-8', html, extra)
    }

    if (!path.startsWith('/api/')) return this.send(res, 404, 'text/plain; charset=utf-8', 'Not Found')
    if (!remoteOn) return this.json(res, 404, { ok: false, code: 'off', message: 'Пульт выключен в программе' })

    if (method === 'POST') {
      if (req.headers['x-lz'] !== '1') return this.send(res, 403, 'text/plain; charset=utf-8', 'Forbidden')
      if (req.headers.origin !== `http://${host}`) return this.send(res, 403, 'text/plain; charset=utf-8', 'Forbidden')
    }

    const hdr = req.headers[KEY_HEADER]
    const fromHeader = typeof hdr === 'string' && hdr ? hdr : null
    const fromCookie = parseCookies(req.headers.cookie)[COOKIE]
    const cookieKey = fromCookie ? safeDecode(fromCookie) : null
    const authed = this.checkKey(fromHeader) || this.checkKey(cookieKey)
    if (!authed) {
      const had = Boolean(fromHeader || cookieKey)
      if (had) this.guard.fail(ip)
      // Устаревшую cookie стираем, чтобы следующие запросы не считались неверными попытками.
      const clear: Record<string, string> = cookieKey ? { 'Set-Cookie': `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0` } : {}
      return this.json(res, 401, { ok: false, code: 'auth', had, message: 'Нужен код доступа' }, clear)
    }

    const hd = this.opts.handlers
    if (method === 'GET') {
      if (path === '/api/telegram/link' && hd.telegramLink) return this.json(res, 200, { ok: true, value: await hd.telegramLink(req.socket.localAddress?.replace(/^::ffff:/, '') || '') })
      if (path === '/api/state') return this.json(res, 200, { ok: true, value: await hd.getState() })
      if (path === '/api/vpn/nodes' && hd.vpnNodes) return this.json(res, 200, { ok: true, value: await hd.vpnNodes() })
      if (path === '/api/dns' && hd.dnsState) return this.json(res, 200, { ok: true, value: await hd.dnsState(url.searchParams.get('ping') === '1') })
      return this.json(res, 404, { ok: false, message: 'Not Found' })
    }

    const body = await readJson(req)
    if (!body) return this.json(res, 400, { ok: false, message: 'Неверный запрос' })
    const bad = (): void => this.json(res, 400, { ok: false, message: 'Неверный запрос' })
    const idOf = (v: unknown): string | null => (typeof v === 'string' && v && v.length <= 200 ? v : null)
    try {
      let r: RemoteResult | void
      if (path === '/api/proxy/share' && hd.proxyShare) {
        if (typeof body.on !== 'boolean') return bad()
        r = await hd.proxyShare(body.on, { ip, port: req.socket.remotePort ?? 0 })
      } else if (path === '/api/proxy/youtube' && hd.youtubeCheck) {
        const checks = await hd.youtubeCheck()
        return this.json(res, 200, {
          ok: true,
          value: checks.map((check) => ({
            label: check.label,
            ok: check.ok,
            detail: sanitizeRemoteMessage(check.detail, 160)
          }))
        })
      } else if (path === '/api/toggle') {
        if (typeof body.on !== 'boolean' || !REMOTE_SERVICES.includes(body.service as RemoteService)) return bad()
        r = await hd.toggle(body.service as RemoteService, body.on)
      } else if (path === '/api/scenario') {
        const id = idOf(body.id)
        if (!id) return bad()
        r = await hd.scenario(id)
      } else if (path === '/api/all' && hd.all) {
        if (typeof body.on !== 'boolean') return bad()
        r = await hd.all(body.on)
      } else if (path === '/api/vpn/select' && hd.vpnSelect) {
        const id = idOf(body.id)
        if (!id) return bad()
        r = await hd.vpnSelect(id)
      } else if ((path === '/api/vpn/refresh' || path === '/api/vpn/ping' || path === '/api/vpn/stop') && hd.vpnJob) {
        r = await hd.vpnJob(path === '/api/vpn/refresh' ? 'refresh' : path === '/api/vpn/stop' ? 'stop' : 'ping', body)
      } else if (path === '/api/dns' && hd.dnsApply) {
        const id = idOf(body.id)
        if (!id) return bad()
        r = await hd.dnsApply(id)
      } else {
        return this.json(res, 404, { ok: false, message: 'Not Found' })
      }
      const out: RemoteResult = r ?? { ok: true }
      return this.json(res, 200, { ...out, message: out.message ? sanitizeRemoteMessage(out.message) : undefined })
    } catch (e) {
      return this.json(res, 200, { ok: false, message: sanitizeRemoteMessage(e instanceof Error ? e.message : String(e)) })
    }
  }
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

function readJson(req: http.IncomingMessage): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > 4096) {
        resolve(null)
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
        resolve(v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null)
      } catch {
        resolve(null)
      }
    })
    req.on('error', () => resolve(null))
  })
}
