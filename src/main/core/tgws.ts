import { ChildProcess, spawn, exec } from 'child_process'
import { createConnection, createServer } from 'net'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import path from 'path'
import { randomBytes } from 'crypto'
import os from 'os'
import https from 'https'
import { BrowserWindow } from 'electron'
import { tgwsBinaryPath, tgwsCliPaths } from '../utils/dirs'
import { registerChild, unregisterChild, registeredPids } from '../utils/child-registry'
import { getAppConfig, patchAppConfig } from '../config'
import { showSystemNotification } from '../utils/notifications'
import { logToFile } from '../utils/file-logger'

// ---- module state ----------------------------------------------------------

let child: ChildProcess | null = null
let status: CoreStatus = { state: 'stopped' }
let stopRequested = false

// ---- defaults --------------------------------------------------------------

/**
 * Куда TgWsProxy открывает WebSocket (`--dc-ip`).
 *
 * Это IP фронтенда `*.web.telegram.org` — ровно то, что Flowseal ставит по
 * умолчанию (`2:149.154.167.220`, `4:149.154.167.220`: proxy/tg_ws_proxy.py,
 * utils/default_config.py, docs/RU/TrayConfig.md).
 *
 * В 1.1.4 сюда по ошибке попала таблица `DC_DEFAULT_IPS` из proxy/utils.py —
 * это адреса для запасного пути (CF-прокси/прямой TCP) и A-записи своего
 * CF-домена, а не WebSocket-фронтенд. TLS с SNI `kws2.web.telegram.org` на
 * них не поднимается, и каждое соединение ждало таймаута WS.
 *
 * DC 203 (CDN: видео, кружки, медиа): Flowseal сам ведёт его на домены DC2
 * (`ws_domains(): if dc == 203: dc = 2`, коммит 4b0bc2f), поэтому ему нужен
 * тот же фронтенд. Без записи 203 медиа уходило в публичные CF-домены,
 * которые отвечали 503. Если WS для 203 не поднимется, Flowseal сам
 * вернётся к fallback — хуже, чем было, не станет.
 */
const DEFAULT_DC_IPS = ['2:149.154.167.220', '4:149.154.167.220', '203:149.154.167.220'] as const
const COLD_BOOT_THRESHOLD_S = 180
const NETWORK_WAIT_TIMEOUT_MS = 30_000
const SECRET_HEX_LEN = 32

// ---- broadcasting helpers --------------------------------------------------

function broadcast(channel: string, ...args: unknown[]): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, ...args)
  }
}

/**
 * Секрет MTProto не должен попадать в лог и в диагностический отчёт, который
 * отправляют в поддержку: по нему к прокси может подключиться кто угодно.
 * Flowseal и сам печатает его при старте («Secret: …», ссылка tg://…).
 */
function maskSecrets(text: string): string {
  return text
    .replace(/(--secret\s+)[0-9a-f]{32}/gi, '$1********')
    .replace(/(secret=)(?:dd|ee)?[0-9a-f]{32}[0-9a-f]*/gi, '$1********')
    .replace(/(Secret:\s*)[0-9a-f]{32}/gi, '$1********')
}

function log(type: ControllerLog['type'], payload: string): void {
  const entry: ControllerLog = {
    time: Date.now(),
    type,
    source: 'tgws',
    payload: maskSecrets(payload)
  }
  // Mirrored to disk: core stdout is exactly what post-mortem debugging needs,
  // and the renderer's ring buffer keeps only the last 500 lines of a session.
  logToFile(entry)
  broadcast('log', entry)
}

function setStatus(next: Partial<CoreStatus>): void {
  const prev = status.state
  status = { ...status, ...next }
  broadcast('tgws:status', status)

  if (prev !== 'running' && status.state === 'running') {
    showSystemNotification('Telegram Proxy запущен', 'Локальный MTProto прокси активен')
  } else if (prev !== 'error' && status.state === 'error' && status.lastError) {
    showSystemNotification('Ошибка Telegram Proxy', status.lastError)
  }
}

export function getTgwsStatus(): CoreStatus {
  return status
}

// ---- pre-flight: secret ----------------------------------------------------

function isValidSecret(secret: string | undefined): boolean {
  return !!secret && secret.length === SECRET_HEX_LEN && /^[0-9a-fA-F]+$/.test(secret)
}

async function ensureSecret(current: string | undefined): Promise<string> {
  if (isValidSecret(current)) return current!
  const fresh = randomBytes(16).toString('hex')
  log('warn', `secret invalid (len=${current?.length ?? 0}) — regenerated and persisted`)
  const cfg = await getAppConfig()
  await patchAppConfig({ tgws: { ...cfg.tgws!, secret: fresh } })
  return fresh
}

// ---- pre-flight: port availability ----------------------------------------

function tryListen(host: string, port: number): Promise<{ free: true } | { free: false; code: string }> {
  return new Promise((resolve) => {
    const srv = createServer()
    srv.unref()
    srv.once('error', (e: NodeJS.ErrnoException) => {
      resolve({ free: false, code: e.code || 'EUNKNOWN' })
    })
    srv.listen(port, host, () => {
      srv.close(() => resolve({ free: true }))
    })
  })
}

function runTaskkill(args: string[]): Promise<void> {
  return new Promise<void>((resolve) => {
    const p = spawn('taskkill.exe', args, { windowsHide: true })
    p.on('exit', () => resolve())
    p.on('error', () => resolve())
  })
}

/**
 * Освободить порт от собственного зависшего TgWsProxy.
 *
 * Сначала — процессы из реестра LAZEYKA (консольный python.exe нельзя
 * убивать по имени: заденем чужой Python). Затем — старый tray-бинарник
 * TgWsProxy_windows.exe, который могла оставить прошлая версия LAZEYKA.
 */
async function killStaleTgws(): Promise<boolean> {
  if (process.platform !== 'win32') return false
  try {
    for (const pid of [...registeredPids('python.exe'), ...registeredPids('TgWsProxy_windows.exe')]) {
      await runTaskkill(['/F', '/T', '/PID', String(pid)])
      unregisterChild(pid)
    }
    await runTaskkill(['/F', '/IM', 'TgWsProxy_windows.exe', '/T'])
    log('info', 'зависшие экземпляры TgWsProxy завершены')
    await new Promise((r) => setTimeout(r, 300))
    return true
  } catch {
    return false
  }
}

async function ensurePortFree(host: string, port: number): Promise<void> {
  let probe = await tryListen(host, port)
  if (probe.free === true) {
    log('info', `port ${port} is free`)
    return
  }
  if (probe.code !== 'EADDRINUSE') {
    log('warn', `unexpected listen error on :${port} → ${probe.code}, continuing`)
    return
  }
  log('warn', `port ${port} is busy, attempting to free it`)
  await killStaleTgws()
  probe = await tryListen(host, port)
  if (probe.free === true) {
    log('info', `port ${port} freed after cleanup`)
    return
  }
  throw new Error(`port ${port} is occupied and could not be freed`)
}

// ---- Windows Firewall helper ---------------------------------------------

function ensureFirewallRule(port: number): void {
  if (process.platform !== 'win32') return
  // Сначала удаляем прежнее правило: `add rule` не проверяет дубликаты, и при
  // каждом запуске в брандмауэре появлялась ещё одна копия.
  try {
    exec(
      `netsh advfirewall firewall delete rule name="LAZEYKA TGWS Proxy" >nul 2>&1 & ` +
        `netsh advfirewall firewall add rule name="LAZEYKA TGWS Proxy" dir=in action=allow protocol=TCP localport=${port} profile=any`,
      { windowsHide: true }
    )
  } catch { /* best effort */ }
}

// ---- Flowseal Headless Helpers (Zero GUI, Zero Tray) -----------------------

/**
 * Список `DC:IP`. Как у Flowseal: если пользователь задал свой список — он
 * используется целиком (так можно и убрать DC), иначе — значения по умолчанию.
 * Раньше пользовательский список лишь дополнял встроенный, и убрать DC было
 * нельзя.
 */
function resolveDcIps(configured?: string[]): string[] {
  const dcMap = new Map<string, string>()
  const user = (configured ?? []).filter((d) => typeof d === 'string' && /^\s*\d+\s*:\s*\S+\s*$/.test(d))
  for (const d of user.length > 0 ? user : DEFAULT_DC_IPS) {
    const [dc, ip] = d.split(':', 2)
    dcMap.set(dc.trim(), ip.trim())
  }
  const result: string[] = []
  for (const [dc, ip] of dcMap.entries()) {
    result.push(`${dc}:${ip}`)
  }
  return result
}

function preseedFlowsealConfig(t: AppConfig['tgws'], secret: string): void {
  if (process.platform !== 'win32') return
  try {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
    const dir = path.join(appData, 'TgWsProxy')
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    // Touch first-run marker so Flowseal NEVER opens the introductory dialog window
    const firstRunMarker = path.join(dir, '.first_run_done_mtproto')
    if (!existsSync(firstRunMarker)) {
      writeFileSync(firstRunMarker, 'done', 'utf8')
    }
    // Touch IPv6 marker so Flowseal NEVER opens the IPv6 warning dialog
    const ipv6Marker = path.join(dir, '.ipv6_warned')
    if (!existsSync(ipv6Marker)) {
      writeFileSync(ipv6Marker, 'warned', 'utf8')
    }
    // Pre-seed matching config.json with check_updates: false to prevent update popups
    const configPath = path.join(dir, 'config.json')
    const flowsealConfig = {
      host: t?.host || '127.0.0.1',
      port: t?.port || 1443,
      secret,
      dc_ip: resolveDcIps(t?.dcIp),
      verbose: Boolean(t?.verbose),
      buf_kb: t?.bufKb || 256,
      pool_size: t?.poolSize || 4,
      check_updates: false,
      autostart: false,
      cfproxy: t?.cfproxy !== false
    }
    writeFileSync(configPath, JSON.stringify(flowsealConfig, null, 2), 'utf8')
  } catch {
    /* best effort */
  }
}

// ---- pre-flight: cold-boot network wait -----------------------------------

function isColdBoot(): boolean {
  try {
    return os.uptime() < COLD_BOOT_THRESHOLD_S
  } catch {
    return false
  }
}

function tcpPing(ip: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = createConnection({ host: ip, port })
    let done = false
    const finish = (ok: boolean): void => {
      if (done) return
      done = true
      try { sock.destroy() } catch { /* noop */ }
      resolve(ok)
    }
    sock.setTimeout(timeoutMs)
    sock.once('connect', () => finish(true))
    sock.once('error', () => finish(false))
    sock.once('timeout', () => finish(false))
  })
}

function dcIpsToTargets(dcList: string[] | undefined): string[] {
  const ips: string[] = []
  for (const entry of dcList ?? []) {
    if (typeof entry === 'string' && entry.includes(':')) {
      const ip = entry.split(':', 2)[1].trim()
      if (ip) ips.push(ip)
    }
  }
  return ips.length ? ips : ['149.154.167.220']
}

async function waitForNetwork(targets: string[]): Promise<boolean> {
  const deadline = Date.now() + NETWORK_WAIT_TIMEOUT_MS
  let delay = 500
  let attempt = 0
  while (Date.now() < deadline) {
    attempt++
    for (const ip of targets) {
      if (await tcpPing(ip, 443, 2000)) {
        log('info', `network ready: ${ip}:443 reachable (attempt ${attempt})`)
        return true
      }
    }
    log('info', `network not ready (attempt ${attempt}), retrying in ${delay}ms`)
    await new Promise((r) => setTimeout(r, delay))
    delay = Math.min(delay * 1.5, 4000)
  }
  log('warn', 'network readiness check timed out — starting anyway')
  return false
}

// ---- main API --------------------------------------------------------------

let opLock: Promise<void> = Promise.resolve()
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = opLock.then(fn, fn)
  opLock = next.then(() => undefined, () => undefined)
  return next
}

export function startTgws(): Promise<void> {
  return withLock(() => startTgwsImpl())
}
export function stopTgws(): Promise<void> {
  return withLock(() => stopTgwsImpl())
}

/**
 * Поколение процесса TgWsProxy. Обработчики `exit`/`error` запоминают своё
 * поколение и ничего не делают, если процесс уже заменён: раньше «опоздавший»
 * exit старого процесса после перезапуска обнулял ссылку на НОВЫЙ процесс
 * (он оставался жить без управления) и показывал ложное «Ошибка Telegram
 * Proxy» после штатной остановки.
 */
let generation = 0

/** Уровень строки лога Flowseal по её содержимому (он пишет всё в stderr). */
function levelOf(line: string): ControllerLog['type'] {
  if (/\b(ERROR|CRITICAL|Traceback)\b/.test(line)) return 'error'
  if (/\bWARNING\b/.test(line)) return 'warn'
  return 'info'
}

function pipeLines(stream: NodeJS.ReadableStream | null | undefined): void {
  if (!stream) return
  let tail = ''
  stream.on('data', (buf: Buffer) => {
    const text = tail + buf.toString()
    const lines = text.split(/\r?\n/)
    tail = lines.pop() ?? ''
    for (const line of lines) if (line.trim()) log(levelOf(line), line.trimEnd())
  })
  stream.on('end', () => {
    if (tail.trim()) log(levelOf(tail), tail.trimEnd())
  })
}

async function startTgwsImpl(): Promise<void> {
  if (child) {
    log('warn', 'startTgws ignored: already running')
    return
  }

  const cfg0 = await getAppConfig()
  if (!cfg0.tgws) throw new Error('tgws config missing')

  // Консольный режим (без трея и окон) — основной. Tray-бинарник остаётся
  // запасным вариантом, только если встроенного Python нет (старая сборка
  // или пользователь явно указал свой exe в настройках).
  const cli = cfg0.tgws.binaryPath ? null : tgwsCliPaths()
  const bin = cli ? cli.python : cfg0.tgws.binaryPath || tgwsBinaryPath()
  if (!existsSync(bin)) {
    setStatus({ state: 'error', lastError: `TgWsProxy binary not found: ${bin}` })
    log('error', `binary missing: ${bin}`)
    throw new Error(`TgWsProxy binary not found: ${bin}`)
  }

  setStatus({ state: 'starting', startedAt: Date.now(), lastError: undefined })
  log('info', '═══ TG WS PROXY STARTUP ═══')

  const myGen = ++generation
  let proc: ChildProcess | null = null
  try {
    // 1) Secret validation/regeneration
    const secret = await ensureSecret(cfg0.tgws.secret)

    // Reload config
    const cfg = await getAppConfig()
    const t = cfg.tgws!

    // 2) Bind host: use configured host (default 127.0.0.1 for local security)
    const host = t.host || '127.0.0.1'
    const dcIp = resolveDcIps(t.dcIp)

    // 3) Port pre-check & Windows Firewall (if listening on all interfaces)
    await ensurePortFree(host, t.port)
    if (host === '0.0.0.0') {
      ensureFirewallRule(t.port)
    }

    // 4) Cold-boot network check — действительно ждём (не дольше 30 с):
    //    раньше проверка запускалась «в фоне» и ни на что не влияла.
    if (isColdBoot()) {
      await waitForNetwork(dcIpsToTargets(dcIp)).catch(() => false)
    }

    // 5) Spawn
    const args: string[] = ['--host', host, '--port', String(t.port), '--secret', secret]
    for (const d of dcIp) args.push('--dc-ip', d)
    if (t.bufKb) args.push('--buf-kb', String(t.bufKb))
    if (t.poolSize) args.push('--pool-size', String(t.poolSize))
    if (t.verbose) args.push('-v')
    if (t.cfproxy === false) args.push('--no-cfproxy')
    if (t.cfproxyUserDomain) args.push('--cfproxy-domain', t.cfproxyUserDomain)
    if (t.fakeTlsDomain) args.push('--fake-tls-domain', t.fakeTlsDomain)

    let spawnArgs: string[]
    let cwd: string
    if (cli) {
      // -u: без буферизации (логи сразу), -B: не писать __pycache__ в
      // Program Files, -X utf8: кириллица в путях и логах.
      spawnArgs = ['-u', '-B', '-X', 'utf8', cli.bootstrap, cli.appDir, ...args]
      cwd = cli.appDir
      log('info', `режим: консольный (Flowseal tg-ws-proxy ${cli.version || '?'}, без трея)`)
    } else {
      spawnArgs = args
      cwd = path.dirname(bin)
      // Tray-сборка Flowseal игнорирует аргументы и читает config.json —
      // подготавливаем его, чтобы она хотя бы не показывала окна.
      preseedFlowsealConfig(t, secret)
      log('warn', 'режим: tray-бинарник Flowseal (консольный Python не найден) — возможна иконка в трее')
    }

    log('info', `spawning: ${bin} ${spawnArgs.join(' ')}`)
    proc = spawn(bin, spawnArgs, {
      windowsHide: true,
      cwd,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
    })
    child = proc
    registerChild(proc.pid, bin)
    const thisProc = proc

    pipeLines(thisProc.stdout)
    pipeLines(thisProc.stderr)
    thisProc.on('error', (err) => {
      unregisterChild(thisProc.pid)
      if (myGen !== generation) return
      log('error', `child error: ${err.message}`)
      setStatus({ state: 'error', lastError: err.message, pid: undefined })
      child = null
    })
    thisProc.on('exit', (code, signal) => {
      unregisterChild(thisProc.pid)
      log('info', `exited code=${code} signal=${signal ?? 'none'}`)
      // Процесс уже заменён или остановлен намеренно — состояние не трогаем.
      if (myGen !== generation) return
      const wasGraceful = stopRequested || code === 0 || signal === 'SIGTERM'
      child = null
      setStatus({
        state: wasGraceful ? 'stopped' : 'error',
        pid: undefined,
        lastError: wasGraceful ? undefined : code != null ? `exited with code ${code}` : undefined
      })
    })

    // Python стартует дольше exe — ждём, пока порт реально начнёт слушаться.
    const deadline = Date.now() + 8000
    let listening = false
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 150))
      if (thisProc.exitCode != null || child !== thisProc) break
      if (await tcpPing(host === '0.0.0.0' ? '127.0.0.1' : host, t.port, 300)) {
        listening = true
        break
      }
    }
    if (child !== thisProc || thisProc.exitCode != null) {
      throw new Error('process died immediately after spawn')
    }
    if (!listening) log('warn', `порт ${t.port} пока не отвечает — продолжаем ждать в фоне`)

    setStatus({ state: 'running', pid: thisProc.pid })
    log('info', `✓ running on ${host}:${t.port} (pid=${thisProc.pid})`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    log('error', `startup failed: ${msg}`)
    if (proc) {
      generation++ // обработчики этого процесса больше не трогают состояние
      try { proc.kill('SIGKILL') } catch { /* noop */ }
      if (process.platform === 'win32' && proc.pid) void runTaskkill(['/F', '/T', '/PID', String(proc.pid)])
      unregisterChild(proc.pid)
    }
    child = null
    setStatus({ state: 'error', lastError: msg, pid: undefined })
    throw e
  }
}

async function stopTgwsImpl(): Promise<void> {
  if (!child) {
    setStatus({ state: 'stopped', pid: undefined, lastError: undefined })
    return
  }
  stopRequested = true
  // Новое поколение: exit этого процесса, когда бы он ни пришёл, уже не
  // изменит статус и не обнулит ссылку на следующий процесс.
  generation++
  setStatus({ state: 'stopping', lastError: undefined })
  log('info', 'stopping TG WS Proxy…')
  const proc = child
  const pid = proc.pid
  const exited =
    proc.exitCode != null ? Promise.resolve() : new Promise<void>((resolve) => proc.once('exit', () => resolve()))

  try {
    if (process.platform === 'win32' && pid) {
      await runTaskkill(['/F', '/T', '/PID', String(pid)])
    } else {
      proc.kill('SIGTERM')
    }
  } catch (e) {
    log('warn', `kill failed: ${e}`)
  }

  await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 3000))])

  if (process.platform !== 'win32' && proc.exitCode == null && !proc.killed) {
    try { proc.kill('SIGKILL') } catch { /* noop */ }
  }

  unregisterChild(pid)
  child = null
  setStatus({ state: 'stopped', pid: undefined, lastError: undefined })
  stopRequested = false
}

export async function restartTgws(): Promise<void> {
  log('info', 'restart requested')
  await stopTgws()
  await new Promise((r) => setTimeout(r, 250))
  await startTgws()
}

export async function getTgwsLink(): Promise<string> {
  const info = await getTgwsShareLinks()
  return info.localLink
}

export interface TgwsShareInfo {
  localLink: string
  lanLink: string | null
  lanIp: string | null
  host: string
  port: number
  secret: string
  httpLink: string
  httpLanLink: string | null
}

export function getLocalNetworkIps(): string[] {
  const interfaces = os.networkInterfaces()
  const ips: string[] = []
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        // Skip virtual network adapters if regular 192.168.x.x / 10.x.x.x exists
        ips.push(iface.address)
      }
    }
  }
  // Sort so standard home subnet 192.168.* comes first
  ips.sort((a, b) => (a.startsWith('192.168.') ? -1 : b.startsWith('192.168.') ? 1 : 0))
  return ips
}

export async function getTgwsShareLinks(): Promise<TgwsShareInfo> {
  const cfg = await getAppConfig()
  const t = cfg.tgws || { host: '127.0.0.1', port: 1443, secret: '' }
  const rawSecret = isValidSecret(t.secret) ? t.secret : await ensureSecret(t.secret)
  // `dd` — padded intermediate (как у Flowseal). При включённом Fake TLS
  // клиенту нужен ee-секрет: `ee` + секрет + hex(домен маскировки), иначе
  // Telegram подключается без маскировки и сервер его отвергает.
  const ftls = (t as TgwsConfig).fakeTlsDomain?.trim()
  const clientSecret = ftls
    ? `ee${rawSecret}${Buffer.from(ftls, 'ascii').toString('hex')}`
    : rawSecret.startsWith('dd')
      ? rawSecret
      : `dd${rawSecret}`
  const localHost = t.host && t.host !== '0.0.0.0' ? t.host : '127.0.0.1'

  const localLink = `tg://proxy?server=${encodeURIComponent(localHost)}&port=${t.port}&secret=${encodeURIComponent(clientSecret)}`
  const httpLink = `https://t.me/proxy?server=${encodeURIComponent(localHost)}&port=${t.port}&secret=${encodeURIComponent(clientSecret)}`

  const lanIps = getLocalNetworkIps()
  const lanIp = lanIps[0] || null
  const lanLink = lanIp
    ? `tg://proxy?server=${encodeURIComponent(lanIp)}&port=${t.port}&secret=${encodeURIComponent(clientSecret)}`
    : null
  const httpLanLink = lanIp
    ? `https://t.me/proxy?server=${encodeURIComponent(lanIp)}&port=${t.port}&secret=${encodeURIComponent(clientSecret)}`
    : null

  return {
    localLink,
    lanLink,
    lanIp,
    host: localHost,
    port: t.port || 1443,
    secret: clientSecret,
    httpLink,
    httpLanLink
  }
}

export interface TelegramDCPing {
  dc: number
  name: string
  location: string
  ip: string
  port: number
  domain: string
  latencyMs: number | null
  status: 'online' | 'slow' | 'offline'
}

const TELEGRAM_DCS = [
  { dc: 1, name: 'DC1 (Pluto)', location: 'США (Майами)', ip: '149.154.175.50', port: 443, domain: 'pluto.web.telegram.org' },
  { dc: 2, name: 'DC2 (Venus)', location: 'Европа (Амстердам)', ip: '149.154.167.51', port: 443, domain: 'venus.web.telegram.org' },
  { dc: 3, name: 'DC3 (Aurora)', location: 'США (Майами)', ip: '149.154.175.100', port: 443, domain: 'aurora.web.telegram.org' },
  { dc: 4, name: 'DC4 (Vesta)', location: 'Европа (Амстердам)', ip: '149.154.167.91', port: 443, domain: 'vesta.web.telegram.org' },
  { dc: 5, name: 'DC5 (Flora)', location: 'Азия (Сингапур)', ip: '91.108.56.165', port: 443, domain: 'flora.web.telegram.org' }
]

function measureDCLatency(domain: string, ip: string, port = 443, timeoutMs = 2500): Promise<number | null> {
  return new Promise((resolve) => {
    let finished = false
    const done = (val: number | null): void => {
      if (!finished) {
        finished = true
        resolve(val)
      }
    }

    // 1. Try ICMP Ping first (native Windows ping -n 1 -w <timeout>)
    exec(`ping -n 1 -w ${timeoutMs} ${ip}`, { windowsHide: true }, (err, stdout) => {
      if (!err && stdout) {
        const ttlMatch =
          stdout.match(/[=<](\d+)\s*(?:ms|мс|[^\x00-\x7F]{1,4})?\s+TTL=/i) ||
          stdout.match(/(\d+)\s*(?:ms|мс|[^\x00-\x7F]{1,4})\s+TTL=/i)
        if (ttlMatch) {
          return done(parseInt(ttlMatch[1], 10))
        }
        const avgMatch = stdout.match(/(?:Average|Среднее|Mittelwert|Moyenne)[^=]*=\s*(\d+)/i)
        if (avgMatch) {
          return done(parseInt(avgMatch[1], 10))
        }
      }

      // 2. Fallback: TCP socket connect
      const start = performance.now()
      const sock = createConnection({ host: ip, port })
      sock.setTimeout(timeoutMs)

      sock.once('connect', () => {
        const elapsed = Math.max(5, Math.round(performance.now() - start))
        sock.destroy()
        done(elapsed)
      })

      const tryHttpsFallback = (): void => {
        sock.destroy()
        const reqStart = performance.now()
        const req = https.get(
          `https://${domain}`,
          { timeout: timeoutMs, headers: { 'User-Agent': 'TelegramBot' }, rejectUnauthorized: false },
          () => {
            done(Math.max(5, Math.round(performance.now() - reqStart)))
          }
        )
        req.on('error', () => done(null))
        req.on('timeout', () => {
          req.destroy()
          done(null)
        })
      }

      sock.once('error', tryHttpsFallback)
      sock.once('timeout', tryHttpsFallback)
    })

    setTimeout(() => done(null), timeoutMs + 1500)
  })
}

export async function pingTelegramDataCenters(): Promise<TelegramDCPing[]> {
  const results = await Promise.all(
    TELEGRAM_DCS.map(async (dc) => {
      const latencyMs = await measureDCLatency(dc.domain, dc.ip, dc.port)
      let status: 'online' | 'slow' | 'offline' = 'offline'
      if (latencyMs !== null) {
        status = latencyMs > 180 ? 'slow' : 'online'
      }
      return {
        ...dc,
        latencyMs,
        status
      }
    })
  )
  return results
}
