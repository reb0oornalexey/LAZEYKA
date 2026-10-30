import { execFile, spawnSync } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { domainToASCII } from 'node:url'
import { dataDir } from './dirs'
import { decodeConsole } from './console-decode'

const execFileAsync = promisify(execFile)

const KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'

/**
 * Какой системный прокси стоял до того, как его включила LAZEYKA.
 *
 * Раньше при каждом запуске, выходе и отключении писалось `ProxyEnable=0`,
 * даже если прокси ставила не LAZEYKA: корпоративный прокси или v2rayN
 * пользователя молча выключался. Теперь мы трогаем прокси, только если сами
 * его включали, и при выключении возвращаем прежние значения.
 */
interface SavedProxy {
  enable: number
  server: string | null
  override: string | null
}

function ownedFile(): string {
  return path.join(dataDir(), 'system-proxy-owned.json')
}

function regQuery(name: string): string | null {
  const r = spawnSync('reg.exe', ['query', KEY, '/v', name], { windowsHide: true, timeout: 3000 })
  if (r.status !== 0 || !r.stdout) return null
  const out = decodeConsole(r.stdout)
  const m = new RegExp(`${name}\\s+REG_\\w+\\s*(.*)$`, 'im').exec(out)
  return m ? m[1].trim() : null
}

function readSaved(): SavedProxy | null {
  try {
    if (!existsSync(ownedFile())) return null
    return JSON.parse(readFileSync(ownedFile(), 'utf-8')) as SavedProxy
  } catch {
    return null
  }
}

/** WinINet сравнивает исключения с punycode: `*.рф` → `*.xn--p1ai`. */
function toAsciiMask(entry: string): string {
  const m = /^(\*\.)?(.+)$/.exec(entry.trim())
  if (!m) return entry
  const [, star = '', host] = m
  if (!/[^\x00-\x7f]/.test(host)) return entry.trim()
  return star + (domainToASCII(host) || host)
}

async function regAdd(name: string, type: 'REG_DWORD' | 'REG_SZ', data: string): Promise<void> {
  await execFileAsync('reg.exe', ['add', KEY, '/v', name, '/t', type, '/d', data, '/f'], { windowsHide: true })
}

export async function setWindowsSystemProxy(port = 20808, bypassDomains: string[] = []): Promise<void> {
  if (process.platform !== 'win32') return

  const domainList = bypassDomains.length > 0 ? bypassDomains.map(toAsciiMask).join(';') : '<local>'
  const override = `${domainList};<local>;127.*;10.*;192.168.*`

  try {
    // Запоминаем чужой прокси один раз — до первого включения нашего.
    if (!existsSync(ownedFile())) {
      const enableRaw = regQuery('ProxyEnable')
      const saved: SavedProxy = {
        enable: enableRaw ? Number(enableRaw) || 0 : 0,
        server: regQuery('ProxyServer'),
        override: regQuery('ProxyOverride')
      }
      mkdirSync(path.dirname(ownedFile()), { recursive: true })
      writeFileSync(ownedFile(), JSON.stringify(saved), 'utf-8')
    }
    await regAdd('ProxyServer', 'REG_SZ', `127.0.0.1:${port}`)
    await regAdd('ProxyOverride', 'REG_SZ', override)
    await regAdd('ProxyEnable', 'REG_DWORD', '1')
  } catch { /* best effort */ }
}

/** Прокси, указывающий на этот же ПК, — наш старый, возвращать его нельзя. */
function isLoopbackProxy(server: string | null): boolean {
  return !!server && /^(?:https?=)?(?:127\.|localhost)/i.test(server.trim())
}

/**
 * Порт системного прокси INCY (mixedPort из настроек, по умолчанию 20808).
 * Нужен, чтобы после обновления со старой версии (она не вела учёт) или
 * после аварийного выхода распознать «зависший» прокси LAZEYKA и снять его,
 * не трогая прокси других программ на других портах.
 */
function lazeykaProxyPort(): number {
  try {
    const s = JSON.parse(readFileSync(path.join(dataDir(), 'incy-settings.json'), 'utf-8'))
    const p = Number(s?.mixedPort)
    return p > 0 ? p : 20808
  } catch {
    return 20808
  }
}

/** Прокси включён и указывает на наш порт, но записи о владении нет. */
function staleOwnProxy(): boolean {
  if (regQuery('ProxyEnable') == null || Number(regQuery('ProxyEnable')) !== 1) return false
  const server = regQuery('ProxyServer') ?? ''
  return new RegExp(`^(?:https?=)?127\\.0\\.0\\.1:${lazeykaProxyPort()}(?:;|$)`).test(server.trim())
}

export async function clearWindowsSystemProxy(): Promise<void> {
  if (process.platform !== 'win32') return
  const saved = readSaved()
  if (!saved) {
    if (staleOwnProxy()) {
      try { await regAdd('ProxyEnable', 'REG_DWORD', '0') } catch { /* best effort */ }
    }
    return
  }
  try {
    const restoreUser = saved.enable === 1 && !isLoopbackProxy(saved.server)
    if (restoreUser && saved.server) await regAdd('ProxyServer', 'REG_SZ', saved.server)
    if (restoreUser && saved.override != null) await regAdd('ProxyOverride', 'REG_SZ', saved.override)
    await regAdd('ProxyEnable', 'REG_DWORD', restoreUser ? '1' : '0')
    try { unlinkSync(ownedFile()) } catch { /* noop */ }
  } catch { /* best effort */ }
}

/** То же синхронно — для аварийного выхода, когда асинхронный код уже не успеет. */
export function clearWindowsSystemProxySync(): void {
  if (process.platform !== 'win32') return
  const saved = readSaved()
  const opts = { windowsHide: true, timeout: 2000 } as const
  if (!saved) {
    if (staleOwnProxy()) spawnSync('reg.exe', ['add', KEY, '/v', 'ProxyEnable', '/t', 'REG_DWORD', '/d', '0', '/f'], opts)
    return
  }
  const restoreUser = saved.enable === 1 && !isLoopbackProxy(saved.server)
  try {
    if (restoreUser && saved.server) spawnSync('reg.exe', ['add', KEY, '/v', 'ProxyServer', '/t', 'REG_SZ', '/d', saved.server, '/f'], opts)
    if (restoreUser && saved.override != null) spawnSync('reg.exe', ['add', KEY, '/v', 'ProxyOverride', '/t', 'REG_SZ', '/d', saved.override, '/f'], opts)
    spawnSync('reg.exe', ['add', KEY, '/v', 'ProxyEnable', '/t', 'REG_DWORD', '/d', restoreUser ? '1' : '0', '/f'], opts)
    unlinkSync(ownedFile())
  } catch { /* best effort */ }
}

// ---------------------------------------------------------------------------
// macOS: networksetup
// ---------------------------------------------------------------------------

/** Состояние одного прокси (web / secure web / socks) сетевой службы. */
interface DarwinProxyState {
  enabled: boolean
  server: string
  port: number
}

interface DarwinServiceSaved {
  service: string
  web: DarwinProxyState
  secure: DarwinProxyState
  socks: DarwinProxyState
  bypass: string[]
}

/** Что сохраняем в ownedFile на macOS (на Windows там SavedProxy). */
interface SavedDarwinProxy {
  darwin: DarwinServiceSaved[]
}

const NETWORKSETUP = '/usr/sbin/networksetup'

/** Исключения, которые добавляем всегда: локальная сеть не должна идти через прокси. */
const DARWIN_BASE_BYPASS = ['*.local', '169.254/16', '127.0.0.1', 'localhost', '10.0.0.0/8', '192.168.0.0/16']

/** Включённые сетевые службы: первая строка — пояснение, `*` в начале — служба отключена. */
function parseServiceList(out: string): string[] {
  return out
    .split(/\r?\n/)
    .slice(1)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('*'))
}

function parseProxyState(out: string): DarwinProxyState {
  const get = (key: string): string => new RegExp(`^${key}:\\s*(.*)$`, 'im').exec(out)?.[1]?.trim() ?? ''
  return {
    enabled: /^yes$/i.test(get('Enabled')),
    server: get('Server'),
    port: Number(get('Port')) || 0
  }
}

function parseBypass(out: string): string[] {
  if (/there aren't any bypass domains/i.test(out)) return []
  return out
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
}

function nsSync(args: string[], timeout = 3000): string | null {
  try {
    const r = spawnSync(NETWORKSETUP, args, { timeout, encoding: 'utf8' })
    return r.status === 0 ? String(r.stdout ?? '') : null
  } catch {
    return null
  }
}

async function nsAsync(args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(NETWORKSETUP, args, { timeout: 5000 })
    return String(stdout)
  } catch {
    return null
  }
}

function readSavedDarwin(): SavedDarwinProxy | null {
  try {
    if (!existsSync(ownedFile())) return null
    const j = JSON.parse(readFileSync(ownedFile(), 'utf-8')) as Partial<SavedDarwinProxy>
    return Array.isArray(j.darwin) ? (j as SavedDarwinProxy) : null
  } catch {
    return null
  }
}

function snapshotDarwinService(service: string): DarwinServiceSaved {
  const web = parseProxyState(nsSync(['-getwebproxy', service]) ?? '')
  const secure = parseProxyState(nsSync(['-getsecurewebproxy', service]) ?? '')
  const socks = parseProxyState(nsSync(['-getsocksfirewallproxy', service]) ?? '')
  const bypass = parseBypass(nsSync(['-getproxybypassdomains', service]) ?? '')
  return { service, web, secure, socks, bypass }
}

/** Прокси, указывающий на наш порт на этой машине (наш прежний, возвращать нельзя). */
function isOwnDarwinProxy(p: DarwinProxyState, port: number): boolean {
  return p.enabled && /^(127\.0\.0\.1|localhost)$/i.test(p.server) && p.port === port
}

/** Команды, которые выставляют наш прокси на одной службе. */
function darwinSetCommands(service: string, port: number, bypass: string[]): string[][] {
  const p = String(port)
  return [
    ['-setwebproxy', service, '127.0.0.1', p],
    ['-setsecurewebproxy', service, '127.0.0.1', p],
    ['-setsocksfirewallproxy', service, '127.0.0.1', p],
    ['-setproxybypassdomains', service, ...bypass],
    ['-setwebproxystate', service, 'on'],
    ['-setsecurewebproxystate', service, 'on'],
    ['-setsocksfirewallproxystate', service, 'on']
  ]
}

/** Команды возврата прежнего состояния службы. Наш собственный (loopback:port) прокси не возвращаем. */
function darwinRestoreCommands(sv: DarwinServiceSaved, ourPort: number): string[][] {
  const cmds: string[][] = []
  const one = (st: DarwinProxyState, setCmd: string, stateCmd: string): void => {
    if (st.enabled && st.server && st.port > 0 && !isOwnDarwinProxy(st, ourPort)) {
      cmds.push([setCmd, sv.service, st.server, String(st.port)])
      cmds.push([stateCmd, sv.service, 'on'])
    } else {
      cmds.push([stateCmd, sv.service, 'off'])
    }
  }
  one(sv.web, '-setwebproxy', '-setwebproxystate')
  one(sv.secure, '-setsecurewebproxy', '-setsecurewebproxystate')
  one(sv.socks, '-setsocksfirewallproxy', '-setsocksfirewallproxystate')
  // «Empty» — служебное значение networksetup для пустого списка исключений.
  cmds.push(['-setproxybypassdomains', sv.service, ...(sv.bypass.length > 0 ? sv.bypass : ['Empty'])])
  return cmds
}

async function setDarwinSystemProxy(port: number, bypassDomains: string[]): Promise<void> {
  try {
    const listed = await nsAsync(['-listallnetworkservices'])
    if (listed == null) return
    const services = parseServiceList(listed)
    if (services.length === 0) return
    // Запоминаем чужие настройки один раз — до первого включения нашего прокси.
    if (!existsSync(ownedFile())) {
      const saved: SavedDarwinProxy = { darwin: services.map(snapshotDarwinService) }
      mkdirSync(path.dirname(ownedFile()), { recursive: true })
      writeFileSync(ownedFile(), JSON.stringify(saved), 'utf-8')
    }
    const bypass = [...new Set([...bypassDomains.map((d) => d.trim()).filter(Boolean), ...DARWIN_BASE_BYPASS])]
    for (const service of services) {
      for (const args of darwinSetCommands(service, port, bypass)) await nsAsync(args)
    }
  } catch { /* best effort */ }
}

/** Прокси включён на нашем порту у какой-либо службы, но записи о владении нет. */
function darwinStaleOwnServices(): string[] {
  const listed = nsSync(['-listallnetworkservices'])
  if (listed == null) return []
  const port = lazeykaProxyPort()
  return parseServiceList(listed).filter(
    (svc) =>
      isOwnDarwinProxy(parseProxyState(nsSync(['-getwebproxy', svc]) ?? ''), port) ||
      isOwnDarwinProxy(parseProxyState(nsSync(['-getsocksfirewallproxy', svc]) ?? ''), port)
  )
}

function darwinOffCommands(service: string): string[][] {
  return [
    ['-setwebproxystate', service, 'off'],
    ['-setsecurewebproxystate', service, 'off'],
    ['-setsocksfirewallproxystate', service, 'off']
  ]
}

async function clearDarwinSystemProxy(): Promise<void> {
  try {
    const saved = readSavedDarwin()
    const port = lazeykaProxyPort()
    if (!saved) {
      for (const svc of darwinStaleOwnServices()) {
        for (const args of darwinOffCommands(svc)) await nsAsync(args)
      }
      return
    }
    // Службы, которые пропали с момента сохранения, пропускаем: команда на них упадёт.
    const listed = await nsAsync(['-listallnetworkservices'])
    const alive = new Set(listed ? parseServiceList(listed) : saved.darwin.map((s) => s.service))
    for (const sv of saved.darwin) {
      if (!alive.has(sv.service)) continue
      for (const args of darwinRestoreCommands(sv, port)) await nsAsync(args)
    }
    try { unlinkSync(ownedFile()) } catch { /* noop */ }
  } catch { /* best effort */ }
}

function clearDarwinSystemProxySync(): void {
  try {
    const saved = readSavedDarwin()
    const port = lazeykaProxyPort()
    if (!saved) {
      for (const svc of darwinStaleOwnServices()) {
        for (const args of darwinOffCommands(svc)) nsSync(args, 2000)
      }
      return
    }
    const listed = nsSync(['-listallnetworkservices'], 2000)
    const alive = new Set(listed ? parseServiceList(listed) : saved.darwin.map((s) => s.service))
    for (const sv of saved.darwin) {
      if (!alive.has(sv.service)) continue
      for (const args of darwinRestoreCommands(sv, port)) nsSync(args, 2000)
    }
    unlinkSync(ownedFile())
  } catch { /* best effort */ }
}

// ---------------------------------------------------------------------------
// Нейтральные точки входа: диспетчер по платформе
// ---------------------------------------------------------------------------

export async function setSystemProxy(port = 20808, bypassDomains: string[] = []): Promise<void> {
  if (process.platform === 'darwin') return setDarwinSystemProxy(port, bypassDomains)
  return setWindowsSystemProxy(port, bypassDomains)
}

export async function clearSystemProxy(): Promise<void> {
  if (process.platform === 'darwin') return clearDarwinSystemProxy()
  return clearWindowsSystemProxy()
}

export function clearSystemProxySync(): void {
  if (process.platform === 'darwin') return clearDarwinSystemProxySync()
  clearWindowsSystemProxySync()
}
