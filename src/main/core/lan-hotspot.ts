/**
 * Мобильный хот-спот Windows («Раздать Wi-Fi») через PowerShell и WinRT:
 * NetworkOperatorTetheringManager.CreateFromConnectionProfile(GetInternetConnectionProfile()).
 * Только Windows 10/11. Не зависит от Electron: чистые функции (сценарий, разбор, проверка, Wi-Fi QR)
 * проверяются обычным node.
 */
import { execFile, spawnSync } from 'node:child_process'
import os from 'node:os'

export interface HotspotInfo {
  /** Раздача Wi-Fi возможна на этой системе. */
  supported: boolean
  /** Если не поддерживается или не прочитано — объяснение. */
  reason?: string
  on: boolean
  ssid: string
  password: string
  clients: number
  /** Подключённые устройства: имя (если устройство его сообщило) и MAC-адрес. Может быть пустым, даже если clients > 0. */
  devices: HotspotDevice[]
  /** Строка для QR подключения к Wi-Fi. */
  wifiQr: string
}

export interface HotspotDevice {
  name: string
  mac: string
}

export interface HotspotRaw {
  state: number
  clients: number
  ssid: string
  pass: string
  devices: HotspotDevice[]
}

const SENTINEL = 'LZHS:'

/** Строка QR для подключения к Wi-Fi: WIFI:T:WPA;S:имя;P:пароль;; (спецсимволы экранируются). */
export function wifiQrString(ssid: string, password: string): string {
  const esc = (s: string): string => s.replace(/([\\;,:"])/g, '\\$1')
  return `WIFI:T:WPA;S:${esc(ssid)};P:${esc(password)};;`
}

export function validateHotspotConfig(ssid: string, password: string): string | null {
  if (!ssid || Buffer.byteLength(ssid, 'utf8') > 32) return 'Имя сети: от 1 до 32 байт (русские буквы занимают по 2 байта).'
  if (password.length < 8 || password.length > 63) return 'Пароль Wi-Fi: от 8 до 63 символов.'
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(ssid + password)) return 'В имени и пароле нельзя использовать управляющие символы.'
  return null
}

/** Сообщение по коду TetheringOperationStatus. */
export function tetheringStatusMessage(code: number): string | null {
  switch (code) {
    case 0:
      return null
    case 2:
      return 'Мобильный модем выключен.'
    case 3:
      return 'Wi-Fi адаптер выключен. Включите Wi-Fi в системе.'
    case 4:
    case 5:
      return 'Оператор не разрешил раздачу.'
    case 6:
      return 'Система ещё выполняет предыдущую операцию. Повторите через несколько секунд.'
    case 7:
      return 'Bluetooth выключен.'
    case 8:
      return 'У подключения к интернету ограниченный доступ: раздавать нечего.'
    default:
      return `Не удалось (код ${code}).`
  }
}

const b64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64')
const psStr = (s: string): string => `[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64(s)}'))`

/** Общая часть сценария: ожидание WinRT-задач и получение менеджера. */
const PS_PRELUDE = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Networking.Connectivity.NetworkInformation, Windows.Networking.Connectivity, ContentType = WindowsRuntime]
$null = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager, Windows.Networking.NetworkOperators, ContentType = WindowsRuntime]
$ext = [System.WindowsRuntimeSystemExtensions]
$opName = 'IAsyncOperation' + [char]96 + '1'
$asTaskOp = ($ext.GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq $opName })[0]
$asTaskAct = ($ext.GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction' })[0]
function Await($op, $type) { $t = $asTaskOp.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }
function AwaitAction($act) { $t = $asTaskAct.Invoke($null, @($act)); $t.Wait(-1) | Out-Null }
$prof = [Windows.Networking.Connectivity.NetworkInformation]::GetInternetConnectionProfile()
if (-not $prof) { throw 'NOINTERNET' }
$mgr = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager]::CreateFromConnectionProfile($prof)
$resType = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringOperationResult, Windows.Networking.NetworkOperators, ContentType = WindowsRuntime]
`

const PS_EMIT = `
$cfg = $mgr.GetCurrentAccessPointConfiguration()
$devs = @()
try {
  foreach ($c in @($mgr.GetTetheringClients())) {
    $dn = ''; $ip = ''
    foreach ($h in @($c.HostNames)) {
      $t = [int]$h.Type
      if ($t -eq 0 -and -not $dn) { $dn = [string]$h.DisplayName } elseif ($t -eq 1 -and -not $ip) { $ip = [string]$h.DisplayName }
    }
    $nm = if ($dn) { $dn } else { $ip }
    $devs += [pscustomobject]@{ n = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$nm)); m = [string]$c.MacAddress }
  }
} catch { }
$o = [pscustomobject]@{
  state = [int]$mgr.TetheringOperationalState
  clients = [int]$mgr.ClientCount
  ssid = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$cfg.Ssid))
  pass = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$cfg.Passphrase))
  devices = @($devs)
}
Write-Output ('${SENTINEL}' + ($o | ConvertTo-Json -Compress -Depth 4))
`

export type HotspotAction = { kind: 'read' } | { kind: 'start' } | { kind: 'stop' } | { kind: 'configure'; ssid: string; password: string }

export function buildHotspotScript(a: HotspotAction): string {
  let body = ''
  if (a.kind === 'start') {
    body = `
$r = Await ($mgr.StartTetheringAsync()) $resType
if ([int]$r.Status -ne 0) { throw ('STATUS:' + [int]$r.Status) }
`
  } else if (a.kind === 'stop') {
    body = `
$r = Await ($mgr.StopTetheringAsync()) $resType
if ([int]$r.Status -ne 0) { throw ('STATUS:' + [int]$r.Status) }
`
  } else if (a.kind === 'configure') {
    body = `
$c = $mgr.GetCurrentAccessPointConfiguration()
$c.Ssid = ${psStr(a.ssid)}
$c.Passphrase = ${psStr(a.password)}
AwaitAction ($mgr.ConfigureAccessPointAsync($c))
`
  }
  return PS_PRELUDE + body + PS_EMIT
}

/** Разбор вывода сценария: ищем строку с меткой, остальное (предупреждения, мусор) игнорируем. */
export function parseHotspotOutput(stdout: string): HotspotRaw | null {
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.startsWith(SENTINEL)) continue
    try {
      const j = JSON.parse(line.slice(SENTINEL.length)) as Record<string, unknown>
      const dec = (v: unknown): string => Buffer.from(String(v ?? ''), 'base64').toString('utf8')
      const list = Array.isArray(j.devices) ? j.devices : j.devices && typeof j.devices === 'object' ? [j.devices] : []
      const devices: HotspotDevice[] = []
      for (const d of list as Record<string, unknown>[]) {
        const mac = String(d?.m ?? '').slice(0, 40)
        // eslint-disable-next-line no-control-regex
        const name = dec(d?.n).replace(/[\u0000-\u001f]/g, '').slice(0, 64)
        if (mac || name) devices.push({ name, mac })
      }
      return { state: Number(j.state), clients: Number(j.clients) || 0, ssid: dec(j.ssid), pass: dec(j.pass), devices }
    } catch {
      return null
    }
  }
  return null
}

/** Понятное сообщение об ошибке PowerShell/WinRT. */
export function hotspotErrorMessage(stderr: string): string {
  const st = /STATUS:(\d+)/.exec(stderr)
  if (st) return tetheringStatusMessage(Number(st[1])) ?? 'Не удалось.'
  if (stderr.includes('NOINTERNET')) return 'Нет подключения к интернету: раздавать нечего.'
  if (/0x80070005|Access is denied|Отказано в доступе/i.test(stderr)) return 'Нет прав на раздачу Wi-Fi.'
  return 'Не удалось управлять раздачей Wi-Fi. Проверьте, что включён Wi-Fi адаптер и есть интернет.'
}

export function toHotspotInfo(raw: HotspotRaw): HotspotInfo {
  return {
    supported: true,
    on: raw.state === 1,
    ssid: raw.ssid,
    password: raw.pass,
    clients: raw.clients,
    devices: raw.state === 1 ? (raw.devices ?? []) : [],
    wifiQr: wifiQrString(raw.ssid, raw.pass)
  }
}

function runPowerShell(script: string, timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true, timeout: timeoutMs, encoding: 'utf8', maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) reject(Object.assign(new Error(hotspotErrorMessage(`${stderr}\n${stdout}\n${err.message}`)), { stderr }))
        else resolve({ stdout: String(stdout), stderr: String(stderr) })
      }
    )
  })
}

let chain: Promise<unknown> = Promise.resolve()
/** Команды PowerShell идут по одной. */
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn)
  chain = next.catch(() => void 0)
  return next
}

/** Имя адаптера раздачи: «Подключение по локальной сети* N» (рус.), «Local Area Connection* N», Wi-Fi Direct. */
const HOTSPOT_IFACE = /(подключение по локальной сети|local area connection)\*|wi-?fi direct/i

type IfaceMap = NodeJS.Dict<os.NetworkInterfaceInfo[]>

/**
 * Адрес компьютера в сети, которую он раздаёт (обычно 192.168.137.1 — так задаёт общий доступ к подключению Windows).
 * Ищем IPv4 на адаптере раздачи по имени; если имя нестандартное — по подсети 192.168.137.0/24.
 * Чистая функция: сетевые адаптеры передаются параметром.
 */
export function findHotspotIp(ifaces: IfaceMap = os.networkInterfaces()): string | null {
  let bySubnet: string | null = null
  for (const [name, list] of Object.entries(ifaces)) {
    for (const i of list ?? []) {
      if (i.family !== 'IPv4' || i.internal) continue
      if (HOTSPOT_IFACE.test(name) && i.address.startsWith('192.168.')) return i.address
      if (!bySubnet && i.address.startsWith('192.168.137.')) bySubnet = i.address
    }
  }
  return bySubnet
}

export const HOTSPOT_UNSUPPORTED_MAC =
  'macOS не умеет раздавать Wi-Fi с того же Wi-Fi-адаптера. Используйте раздачу через прокси.'

export function emptyHotspot(reason: string): HotspotInfo {
  return { supported: false, reason, on: false, ssid: '', password: '', clients: 0, devices: [], wifiQr: '' }
}

export async function runHotspot(a: HotspotAction): Promise<HotspotInfo> {
  if (process.platform !== 'win32') return emptyHotspot(process.platform === 'darwin' ? HOTSPOT_UNSUPPORTED_MAC : 'Раздача Wi-Fi доступна только в Windows.')
  const { stdout } = await serial(() => runPowerShell(buildHotspotScript(a), a.kind === 'read' ? 25_000 : 60_000))
  const raw = parseHotspotOutput(stdout)
  if (!raw) throw new Error('Не удалось прочитать состояние раздачи Wi-Fi.')
  return toHotspotInfo(raw)
}

export const readHotspot = (): Promise<HotspotInfo> => runHotspot({ kind: 'read' })
export const startHotspot = (): Promise<HotspotInfo> => runHotspot({ kind: 'start' })
export const stopHotspot = (): Promise<HotspotInfo> => runHotspot({ kind: 'stop' })
export const configureHotspot = (ssid: string, password: string): Promise<HotspotInfo> => {
  const bad = validateHotspotConfig(ssid, password)
  if (bad) return Promise.reject(new Error(bad))
  return runHotspot({ kind: 'configure', ssid, password })
}

/** Остановить хот-спот синхронно (при выходе из программы). */
export function stopHotspotSync(): void {
  if (process.platform !== 'win32') return
  try {
    const encoded = Buffer.from(buildHotspotScript({ kind: 'stop' }), 'utf16le').toString('base64')
    spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { windowsHide: true, timeout: 8000 })
  } catch {
    /* не вышло — хот-спот останется включённым, пользователь выключит вручную */
  }
}
