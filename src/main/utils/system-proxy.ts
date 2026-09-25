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
