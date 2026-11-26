/**
 * Страница «Твики»: сетевые настройки системы с понятными пояснениями и полным откатом.
 *
 * Правила:
 *  - ничего не меняется без явного действия пользователя, при запуске программы не вызывается ничего;
 *  - перед ПЕРВЫМ изменением параметра его исходное значение (включая «параметра не было»)
 *    записывается в net-tweaks-backup.json в каталоге данных приложения;
 *  - выключение твика возвращает ровно записанное значение, а не «значение по умолчанию»;
 *  - «Вернуть всё как было» откатывает все записанные параметры и удаляет файл;
 *  - твики применяются к физическому адаптеру с маршрутом по умолчанию, а не к TUN-адаптеру VPN.
 *
 * Windows: реестр через reg.exe (вывод разбирается по структуре, не по словам), адаптеры через PowerShell
 * с ConvertTo-Json. macOS: команды с правами администратора идут через osascript, как в dns-mac.ts.
 */
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { ipcMain } from 'electron'
import { dataDir } from '../utils/dirs'
import { writeFileAtomic } from '../utils/atomic-write'
import { decodeConsole } from '../utils/console-decode'
import { appLog } from '../utils/app-logger'
import { MAC_PING, parseMacPingRtts } from '../utils/mac-net'
import { buildAdminScript, isOsascriptCancel, readableOsascriptError } from './incy-mac-lxd'
import { physicalSourceIp } from './core-probe'

// ---- Типы, которые видит страница -------------------------------------------------

export type TweakState = 'on' | 'off' | 'unavailable'

export interface TweakAdapter {
  name: string
  description: string
  kind: 'wifi' | 'wired'
  mtu: number | null
}

export interface TweakInfo {
  id: string
  title: string
  does: string
  helps: string
  caveat?: string
  platform: 'win32' | 'darwin'
  state: TweakState
  /** Причина, если твик недоступен. */
  reason?: string
  /** Значение выставлено не нами (в бэкапе его нет) — откатывать нечего. */
  external?: boolean
  /** Пояснение, если твик привязан к другому адаптеру, чем активный сейчас. */
  note?: string
}

export interface TweakActionInfo {
  id: string
  title: string
  does: string
  helps: string
  caveat?: string
  /** Перед выполнением нужно подтверждение. */
  confirm?: boolean
}

export interface TweaksList {
  platform: 'win32' | 'darwin' | 'other'
  adapter: TweakAdapter | null
  adapterReason?: string
  tweaks: TweakInfo[]
  actions: TweakActionInfo[]
  /** id твиков, чьи исходные значения сейчас записаны (то есть что-то применено). */
  applied: string[]
  mtuBackup: { adapter: string; value: number } | null
  /** Есть ли что откатывать (твики или MTU). */
  canRevert: boolean
}

export interface TweakResult {
  message: string
  /** Нужна перезагрузка, чтобы изменения вступили в силу. */
  restart?: boolean
}

export interface MtuProbeResult {
  ok: boolean
  message: string
  adapter: string | null
  currentMtu: number | null
  /** Найденный MTU (размер пакета без фрагментации + 28). */
  foundMtu: number | null
  target: string
}

export interface RevertAllResult {
  reverted: string[]
  failed: { id: string; message: string }[]
  message: string
}

// ---- Запуск программ ---------------------------------------------------------------

const IS_WIN = process.platform === 'win32'
const IS_MAC = process.platform === 'darwin'

interface RunResult {
  code: number
  out: string
  err: string
}

function run(file: string, args: string[], timeout = 20_000): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { windowsHide: true, timeout, maxBuffer: 4 * 1024 * 1024, encoding: 'buffer' },
      (error, stdout, stderr) => {
        const raw = error ? (error as { code?: unknown }).code : 0
        const code = error ? (typeof raw === 'number' ? raw : 1) : 0
        resolve({ code, out: decodeConsole(stdout ?? Buffer.alloc(0)), err: decodeConsole(stderr ?? Buffer.alloc(0)) })
      }
    )
  })
}

function psq(s: string): string {
  return `'${s.replace(/'/g, "''")}'`
}

/**
 * PowerShell: скрипт передаётся в -EncodedCommand (UTF-16LE, base64), поэтому русские имена адаптеров
 * не ломаются на кавычках и кодировках. Вывод — UTF-8. Ошибка скрипта → исключение с её текстом.
 */
async function runPs(script: string, timeout = 30_000): Promise<string> {
  const full =
    `[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;$ProgressPreference='SilentlyContinue';` +
    `try{\n${script}\n}catch{[Console]::Error.WriteLine($_.Exception.Message);exit 1}`
  const encoded = Buffer.from(full, 'utf16le').toString('base64')
  const r = await run(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-OutputFormat', 'Text', '-EncodedCommand', encoded],
    timeout
  )
  if (r.code !== 0) {
    const text = (r.err || r.out).replace(/^#< CLIXML[\s\S]*$/m, '').trim()
    throw new Error(text || 'PowerShell завершился с ошибкой')
  }
  return r.out.replace(/^\uFEFF/, '').trim()
}

function parseJson<T>(text: string): T | null {
  if (!text) return null
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

function asArray<T>(v: T | T[] | null | undefined): T[] {
  if (v == null) return []
  return Array.isArray(v) ? v : [v]
}

/** macOS: команда оболочки с правами администратора (системное окно пароля). */
async function runAdmin(shellCommand: string): Promise<void> {
  const r = await run('/usr/bin/osascript', ['-e', buildAdminScript(shellCommand)], 120_000)
  if (r.code === 0) return
  const text = r.err || r.out
  if (isOsascriptCancel(text)) throw new Error('Отменено: окно ввода пароля закрыто')
  throw new Error(readableOsascriptError(text) || 'Не удалось выполнить команду с правами администратора')
}

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

// ---- Реестр Windows (reg.exe) -------------------------------------------------------

/** null — значения нет; 'bad' — значение есть, но не DWORD. */
type RegValue = number | null | 'bad'

async function regQuery(key: string, name: string): Promise<RegValue> {
  const r = await run('reg.exe', ['query', key, '/v', name, '/reg:64'], 8000)
  if (r.code !== 0) return null
  for (const line of r.out.split(/\r?\n/)) {
    const m = /^\s+(\S+)\s+(REG_[A-Z_]+)\s*(.*)$/.exec(line)
    if (!m || m[1].toLowerCase() !== name.toLowerCase()) continue
    if (m[2] !== 'REG_DWORD') return 'bad'
    const n = parseInt(m[3].trim().replace(/^0x/i, ''), 16)
    return Number.isFinite(n) ? n : 'bad'
  }
  return null
}

async function regSet(key: string, name: string, value: number): Promise<void> {
  const r = await run('reg.exe', ['add', key, '/v', name, '/t', 'REG_DWORD', '/d', String(value), '/f', '/reg:64'], 8000)
  if (r.code !== 0) throw new Error(`Не удалось записать параметр ${name} в реестр: ${(r.err || r.out).trim() || 'отказано в доступе'}`)
  const back = await regQuery(key, name)
  if (back !== value) throw new Error(`Параметр ${name} записан, но система его не приняла`)
}

async function regDelete(key: string, name: string): Promise<void> {
  const before = await regQuery(key, name)
  if (before === null) return
  const r = await run('reg.exe', ['delete', key, '/v', name, '/f', '/reg:64'], 8000)
  const after = await regQuery(key, name)
  if (after !== null) throw new Error(`Не удалось удалить параметр ${name}: ${(r.err || r.out).trim() || 'отказано в доступе'}`)
}

async function regRestore(key: string, name: string, value: number | null): Promise<void> {
  if (value === null) await regDelete(key, name)
  else await regSet(key, name, value)
}

const REG_IFACES = 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces'
const REG_PROFILE = 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile'
const REG_DO = 'HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\DeliveryOptimization'

// ---- Активный физический адаптер ---------------------------------------------------

interface Adapter extends TweakAdapter {
  ip: string | null
  /** Windows: GUID вида {xxxxxxxx-…}. */
  guid?: string
  /** macOS: имя устройства (en0). */
  device?: string
}

interface AdapterResult {
  adapter: Adapter | null
  reason?: string
}

const NO_NET = 'Нет активного подключения к интернету'

async function detectWinAdapter(): Promise<AdapterResult> {
  // Берём только физические адаптеры в состоянии «Up», у которых есть маршрут по умолчанию,
  // и выбираем с наименьшей суммарной метрикой. Адаптер VPN (TUN) не физический и сюда не попадает.
  const script = `
$phys=@(Get-NetAdapter -Physical -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Up' })
$best=$null
foreach($a in $phys){
  $ifc=Get-NetIPInterface -InterfaceIndex $a.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue
  if(-not $ifc){continue}
  $rs=@(Get-NetRoute -InterfaceIndex $a.ifIndex -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue)
  foreach($r in $rs){
    $m=[int]$r.RouteMetric+[int]$ifc.InterfaceMetric
    if($null -eq $best -or $m -lt $best.m){
      $ip=Get-NetIPAddress -InterfaceIndex $a.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue | Select-Object -First 1
      $best=[pscustomobject]@{m=$m;name=[string]$a.Name;desc=[string]$a.InterfaceDescription;guid=[string]$a.InterfaceGuid;index=[int]$a.ifIndex;medium=[int]$a.NdisPhysicalMedium;mediaType=[string]$a.PhysicalMediaType;mtu=[int]$ifc.NlMtu;ip=[string]$ip.IPAddress}
    }
  }
}
if($null -eq $best){'null'}else{$best|ConvertTo-Json -Compress}
`
  try {
    const j = parseJson<{
      name: string
      desc: string
      guid: string
      medium: number
      mediaType: string
      mtu: number
      ip: string
    }>(await runPs(script))
    if (!j || !j.name) return { adapter: null, reason: NO_NET }
    // NdisPhysicalMedium: 1 — WirelessLan, 9 — Native 802.11.
    const wifi = j.medium === 1 || j.medium === 9 || /802\.11|wireless/i.test(j.mediaType ?? '')
    return {
      adapter: {
        name: j.name,
        description: j.desc || j.name,
        kind: wifi ? 'wifi' : 'wired',
        mtu: j.mtu > 0 ? j.mtu : null,
        ip: j.ip || null,
        guid: j.guid
      }
    }
  } catch (e) {
    return { adapter: null, reason: `Не удалось определить адаптер: ${errText(e)}` }
  }
}

function parseHardwarePorts(out: string): { port: string; device: string }[] {
  const res: { port: string; device: string }[] = []
  let port = ''
  for (const raw of out.split(/\r?\n/)) {
    const line = raw.trim()
    const p = /^Hardware Port:\s*(.+)$/.exec(line)
    if (p) {
      port = p[1].trim()
      continue
    }
    const d = /^Device:\s*(\S+)/.exec(line)
    if (d && port) {
      res.push({ port, device: d[1] })
      port = ''
    }
  }
  return res
}

/** `netstat -rn -f inet`: интерфейсы en* со строкой default; маршруты без флага «I» (не привязанные к интерфейсу) идут первыми. */
function parseDefaultRouteDevices(out: string): string[] {
  const primary: string[] = []
  const scoped: string[] = []
  for (const line of out.split(/\r?\n/)) {
    const t = line.trim().split(/\s+/)
    if (t[0] !== 'default' || t.length < 4) continue
    const dev = t[t.length - 1]
    if (!/^en\d+$/.test(dev)) continue
    ;(/I/.test(t[2]) ? scoped : primary).push(dev)
  }
  return [...primary, ...scoped]
}

async function macMtu(device: string): Promise<number | null> {
  const r = await run('/sbin/ifconfig', [device], 5000)
  const m = /\bmtu\s+(\d+)/.exec(r.out)
  return m ? Number(m[1]) : null
}

async function detectMacAdapter(): Promise<AdapterResult> {
  const hw = parseHardwarePorts((await run('/usr/sbin/networksetup', ['-listallhardwareports'], 8000)).out)
  const route = parseDefaultRouteDevices((await run('/usr/sbin/netstat', ['-rn', '-f', 'inet'], 8000)).out)
  // Запасной путь: любое устройство en* с адресом IPv4 в порядке списка.
  const candidates = [...new Set([...route, ...hw.map((h) => h.device).filter((d) => /^en\d+$/.test(d))])]
  for (const dev of candidates) {
    const ip = await run('/usr/sbin/ipconfig', ['getifaddr', dev], 4000)
    const addr = ip.out.trim()
    if (ip.code !== 0 || !/^\d+\.\d+\.\d+\.\d+$/.test(addr)) continue
    const port = hw.find((h) => h.device === dev)?.port ?? dev
    return {
      adapter: {
        name: port,
        description: `${port} (${dev})`,
        kind: /wi-?fi|airport/i.test(port) ? 'wifi' : 'wired',
        mtu: await macMtu(dev),
        ip: addr,
        device: dev
      }
    }
  }
  return { adapter: null, reason: NO_NET }
}

async function detectAdapter(): Promise<AdapterResult> {
  if (IS_WIN) return detectWinAdapter()
  if (IS_MAC) return detectMacAdapter()
  return { adapter: null, reason: 'Эта система не поддерживается' }
}

// ---- Файл с исходными значениями ---------------------------------------------------

interface NagleSnap {
  guid: string
  adapter: string
  ack: number | null
  noDelay: number | null
}
interface ThrottleSnap {
  value: number | null
}
interface PowerSnap {
  adapter: string
  /** Прежнее значение «Разрешить отключение устройства», если мы его меняли. */
  pnp: 'Enabled' | 'Disabled' | null
  props: { k: string; v: string[] }[]
}
interface DoSnap {
  value: number | null
}
interface WifiSnap {
  adapter: string
  autoconfig: boolean
}
interface AwdlSnap {
  up: boolean
}
interface MtuBackup {
  /** Windows: имя адаптера; macOS: устройство (en0). */
  adapter: string
  value: number
}

interface BackupFile {
  version: 1
  platform: string
  entries: Record<string, unknown>
  mtu: MtuBackup | null
}

function backupPath(): string {
  return path.join(dataDir(), 'net-tweaks-backup.json')
}

function emptyBackup(): BackupFile {
  return { version: 1, platform: process.platform, entries: {}, mtu: null }
}

function loadBackup(): BackupFile {
  const file = backupPath()
  if (!existsSync(file)) return emptyBackup()
  try {
    const j = JSON.parse(readFileSync(file, 'utf-8')) as BackupFile
    if (!j || typeof j !== 'object' || typeof j.entries !== 'object' || j.entries === null) throw new Error('bad shape')
    if (j.platform !== process.platform) return emptyBackup()
    return { version: 1, platform: j.platform, entries: j.entries, mtu: j.mtu ?? null }
  } catch {
    // Повреждённый файл не затираем: откладываем в сторону, чтобы значения можно было достать вручную.
    try {
      renameSync(file, `${file}.bad`)
    } catch {
      /* noop */
    }
    appLog('warn', 'Твики: файл с исходными значениями повреждён, перенесён в net-tweaks-backup.json.bad')
    return emptyBackup()
  }
}

function saveBackup(b: BackupFile): void {
  const file = backupPath()
  if (Object.keys(b.entries).length === 0 && !b.mtu) {
    try {
      if (existsSync(file)) unlinkSync(file)
    } catch {
      /* noop */
    }
    return
  }
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileAtomic(file, JSON.stringify(b, null, 2))
}

/** Все изменения идут по одному: иначе два быстрых нажатия затрут запись в файле. */
let queue: Promise<unknown> = Promise.resolve()
function locked<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn)
  queue = next.catch(() => void 0)
  return next
}

// ---- Описание твиков ---------------------------------------------------------------

interface Ctx {
  adapter: Adapter | null
  adapterReason?: string
}

interface Probe {
  state: TweakState
  reason?: string
  note?: string
}

interface TweakDef<S> {
  info: Omit<TweakInfo, 'state' | 'reason' | 'external' | 'note'>
  /** Состояние сейчас; snap — запись из бэкапа, если твик применён нами (тогда смотрим на тот же адаптер). */
  probe(ctx: Ctx, snap: S | null): Promise<Probe>
  /** Прочитать исходное значение. Бросает, если твик на этом компьютере невозможен. */
  snapshot(ctx: Ctx): Promise<S>
  apply(ctx: Ctx, snap: S): Promise<void>
  restore(snap: S): Promise<void>
  /** macOS: команда оболочки для отката (чтобы собрать несколько в одно окно пароля). */
  restoreCommand?(snap: S): string
  /** Какой результат сообщить после включения/выключения. */
  restartHint?: boolean
}

const unavailable = (reason: string): Probe => ({ state: 'unavailable', reason })

function adapterNote(ctx: Ctx, stored: string | null): string | undefined {
  if (stored && ctx.adapter && ctx.adapter.name !== stored) {
    return `Твик включён для адаптера «${stored}», а сейчас активен «${ctx.adapter.name}». Выключите его и включите заново, чтобы применить к текущему.`
  }
  return undefined
}

// 1. Алгоритм Нейгла
const nagle: TweakDef<NagleSnap> = {
  info: {
    id: 'nagle',
    title: 'Алгоритм Нейгла',
    does: 'Отправляет мелкие TCP-пакеты сразу, не накапливая их, и подтверждает приём без задержки (TcpAckFrequency=1, TCPNoDelay=1).',
    helps: 'Играм и программам, которые общаются по TCP: часть MMO и старые сетевые игры. В CS2 и Dota 2 игровой трафик идёт по UDP, там эффекта почти нет.',
    caveat:
      'Значения записываются для текущего адаптера и действуют на новые соединения: запущенные игры перезапустите, иногда нужна перезагрузка. При смене Wi-Fi на кабель твик нужно включить заново.',
    platform: 'win32'
  },
  async probe(ctx, snap) {
    const guid = snap?.guid ?? ctx.adapter?.guid
    if (!guid) return unavailable(ctx.adapterReason ?? NO_NET)
    const key = `${REG_IFACES}\\${guid}`
    const [ack, nd] = await Promise.all([regQuery(key, 'TcpAckFrequency'), regQuery(key, 'TCPNoDelay')])
    if (ack === 'bad' || nd === 'bad') return unavailable('Параметр в реестре имеет нестандартный тип, трогать его небезопасно')
    return { state: ack === 1 && nd === 1 ? 'on' : 'off', note: adapterNote(ctx, snap?.adapter ?? null) }
  },
  async snapshot(ctx) {
    const a = ctx.adapter
    if (!a?.guid) throw new Error(ctx.adapterReason ?? NO_NET)
    const key = `${REG_IFACES}\\${a.guid}`
    const [ack, nd] = await Promise.all([regQuery(key, 'TcpAckFrequency'), regQuery(key, 'TCPNoDelay')])
    if (ack === 'bad' || nd === 'bad') throw new Error('Параметр в реестре имеет нестандартный тип, трогать его небезопасно')
    return { guid: a.guid, adapter: a.name, ack, noDelay: nd }
  },
  async apply(_ctx, s) {
    const key = `${REG_IFACES}\\${s.guid}`
    await regSet(key, 'TcpAckFrequency', 1)
    await regSet(key, 'TCPNoDelay', 1)
  },
  async restore(s) {
    const key = `${REG_IFACES}\\${s.guid}`
    await regRestore(key, 'TcpAckFrequency', s.ack)
    await regRestore(key, 'TCPNoDelay', s.noDelay)
  },
  restartHint: true
}

// 2. Троттлинг сети
const THROTTLE_OFF = 0xffffffff
const throttle: TweakDef<ThrottleSnap> = {
  info: {
    id: 'throttle',
    title: 'Ограничение сети при мультимедиа',
    does: 'Снимает ограничение NetworkThrottlingIndex: по умолчанию Windows придерживает сетевые пакеты, пока работают мультимедийные задачи.',
    helps: 'Тем, у кого пинг в игре подскакивает, пока в фоне играет музыка или видео. На современных Windows 10 и 11 разница обычно небольшая.',
    caveat: 'Параметр системный, действует на весь компьютер, а не на один адаптер. Может понадобиться перезагрузка.',
    platform: 'win32'
  },
  async probe() {
    const v = await regQuery(REG_PROFILE, 'NetworkThrottlingIndex')
    if (v === 'bad') return unavailable('Параметр в реестре имеет нестандартный тип, трогать его небезопасно')
    return { state: v === THROTTLE_OFF ? 'on' : 'off' }
  },
  async snapshot() {
    const v = await regQuery(REG_PROFILE, 'NetworkThrottlingIndex')
    if (v === 'bad') throw new Error('Параметр в реестре имеет нестандартный тип, трогать его небезопасно')
    return { value: v }
  },
  async apply() {
    await regSet(REG_PROFILE, 'NetworkThrottlingIndex', THROTTLE_OFF)
  },
  async restore(s) {
    await regRestore(REG_PROFILE, 'NetworkThrottlingIndex', s.value)
  },
  restartHint: true
}

// 3. Энергосбережение адаптера
const SAVING_KEYWORDS = ['*EEE', 'EEELinkAdvertisement', 'EnableGreenEthernet', 'GreenEthernet', 'PowerSavingMode', 'AdvancedEEE', 'EeePhyEnable']

interface PowerRead {
  pnp: string | null
  props: { k: string; v: string[] }[]
}

async function readPower(name: string): Promise<PowerRead> {
  const q = psq(name)
  const kw = SAVING_KEYWORDS.map(psq).join(',')
  const script = `
$n=${q}
$kw=@(${kw})
$pnp=$null
try{$pm=Get-NetAdapterPowerManagement -Name $n -ErrorAction Stop;$pnp=[string]$pm.AllowComputerToTurnOffDevice}catch{}
$ps=@()
try{foreach($p in @(Get-NetAdapterAdvancedProperty -Name $n -ErrorAction Stop)){if($kw -contains $p.RegistryKeyword){$ps+=[pscustomobject]@{k=[string]$p.RegistryKeyword;v=@($p.RegistryValue|ForEach-Object{[string]$_})}}}}catch{}
[pscustomobject]@{pnp=$pnp;props=$ps}|ConvertTo-Json -Compress -Depth 4
`
  const j = parseJson<{ pnp: string | null; props: { k: string; v: string | string[] }[] | { k: string; v: string | string[] } }>(await runPs(script))
  if (!j) throw new Error('Не удалось прочитать свойства адаптера')
  return { pnp: j.pnp ?? null, props: asArray(j.props).map((p) => ({ k: p.k, v: asArray(p.v) })) }
}

/** Что из энергосберегающего сейчас включено — только то, чем можно управлять: Enabled у PnP и «1» у свойств. */
function powerOn(r: PowerRead): { pnp: boolean; props: { k: string; v: string[] }[]; total: number } {
  const pnpControl = r.pnp === 'Enabled' || r.pnp === 'Disabled'
  const propControls = r.props.filter((p) => p.v.length === 1 && (p.v[0] === '0' || p.v[0] === '1'))
  return {
    pnp: r.pnp === 'Enabled',
    props: propControls.filter((p) => p.v[0] === '1'),
    total: (pnpControl ? 1 : 0) + propControls.length
  }
}

const power: TweakDef<PowerSnap> = {
  info: {
    id: 'power',
    title: 'Энергосбережение сетевого адаптера',
    does: 'Запрещает Windows отключать адаптер для экономии энергии и выключает «зелёный Ethernet» (EEE), если драйвер их показывает.',
    helps: 'Ноутбукам и ПК, где соединение иногда «засыпает» или первые пакеты после паузы идут с задержкой.',
    caveat:
      'Ноутбук будет немного быстрее разряжаться. Если драйвер меняет свои свойства, соединение пропадает на несколько секунд.',
    platform: 'win32'
  },
  async probe(ctx, snap) {
    const name = snap?.adapter ?? ctx.adapter?.name
    if (!name) return unavailable(ctx.adapterReason ?? NO_NET)
    try {
      const st = powerOn(await readPower(name))
      if (st.total === 0) return unavailable('Драйвер адаптера не показывает настройки энергосбережения')
      const on = !st.pnp && st.props.length === 0
      return { state: on ? 'on' : 'off', note: adapterNote(ctx, snap?.adapter ?? null) }
    } catch (e) {
      return unavailable(`Не удалось прочитать настройки адаптера: ${errText(e)}`)
    }
  },
  async snapshot(ctx) {
    const a = ctx.adapter
    if (!a) throw new Error(ctx.adapterReason ?? NO_NET)
    const st = powerOn(await readPower(a.name))
    if (st.total === 0) throw new Error('Драйвер адаптера не показывает настройки энергосбережения')
    // В запись попадает только то, что мы действительно изменим.
    return { adapter: a.name, pnp: st.pnp ? 'Enabled' : null, props: st.props }
  },
  async apply(_ctx, s) {
    const q = psq(s.adapter)
    const lines: string[] = []
    if (s.pnp) lines.push(`Set-NetAdapterPowerManagement -Name ${q} -AllowComputerToTurnOffDevice Disabled`)
    for (const p of s.props) {
      lines.push(`Set-NetAdapterAdvancedProperty -Name ${q} -RegistryKeyword ${psq(p.k)} -RegistryValue @('0')`, 'Start-Sleep -Seconds 3')
    }
    if (lines.length > 0) await runPs(lines.join('\n'), 90_000)
    const st = powerOn(await readPower(s.adapter))
    if (st.pnp || st.props.length > 0) throw new Error('Драйвер не принял изменения энергосбережения')
  },
  async restore(s) {
    const q = psq(s.adapter)
    const lines: string[] = []
    for (const p of s.props) {
      lines.push(
        `Set-NetAdapterAdvancedProperty -Name ${q} -RegistryKeyword ${psq(p.k)} -RegistryValue @(${p.v.map(psq).join(',')})`,
        'Start-Sleep -Seconds 3'
      )
    }
    if (s.pnp) lines.push(`Set-NetAdapterPowerManagement -Name ${q} -AllowComputerToTurnOffDevice ${s.pnp}`)
    if (lines.length > 0) await runPs(lines.join('\n'), 90_000)
  }
}

// 4. Delivery Optimization
const deliveryOpt: TweakDef<DoSnap> = {
  info: {
    id: 'delivery',
    title: 'Раздача обновлений Windows другим компьютерам',
    does: 'Запрещает компьютеру отдавать скачанные обновления другим устройствам (политика Оптимизации доставки, DODownloadMode=0).',
    helps: 'Тем, у кого фоновая раздача занимает исходящий канал и вызывает скачки пинга в играх.',
    caveat:
      'Обновления по-прежнему скачиваются с серверов Microsoft. В настройках Windows может появиться надпись, что параметром управляет организация.',
    platform: 'win32'
  },
  async probe() {
    const v = await regQuery(REG_DO, 'DODownloadMode')
    if (v === 'bad') return unavailable('Параметр в реестре имеет нестандартный тип, трогать его небезопасно')
    return { state: v === 0 ? 'on' : 'off' }
  },
  async snapshot() {
    const v = await regQuery(REG_DO, 'DODownloadMode')
    if (v === 'bad') throw new Error('Параметр в реестре имеет нестандартный тип, трогать его небезопасно')
    return { value: v }
  },
  async apply() {
    await regSet(REG_DO, 'DODownloadMode', 0)
  },
  async restore(s) {
    await regRestore(REG_DO, 'DODownloadMode', s.value)
  }
}

// 5. Фоновое сканирование Wi-Fi
/**
 * `netsh wlan show settings` пишет строку про автонастройку для каждого интерфейса, имя в кавычках.
 * Текст локализован, поэтому ищем строку с именем интерфейса в кавычках (предпочитая ту, где есть
 * слова про автонастройку) и по корню слова определяем «включена / отключена».
 */
export function parseWlanAutoconfig(out: string, name: string): boolean | null {
  const lines = out.split(/\r?\n/).filter((l) => l.includes(`"${name}"`))
  if (lines.length === 0) return null
  const line = lines.find((l) => /auto\s*config|автоконфиг|автоматическ|автонастро/i.test(l)) ?? lines[0]
  if (/disabled|отключ|выключ/i.test(line)) return false
  if (/enabled|включ/i.test(line)) return true
  return null
}

async function wlanAutoconfig(name: string): Promise<boolean | null> {
  const r = await run('netsh.exe', ['wlan', 'show', 'settings'], 10_000)
  if (r.code !== 0) return null
  return parseWlanAutoconfig(r.out, name)
}

async function setWlanAutoconfig(name: string, on: boolean): Promise<void> {
  const r = await run('netsh.exe', ['wlan', 'set', 'autoconfig', `enabled=${on ? 'yes' : 'no'}`, `interface=${name}`], 15_000)
  if (r.code !== 0) throw new Error(`netsh не смог изменить автонастройку Wi-Fi: ${(r.out || r.err).trim() || 'отказано в доступе'}`)
  const now = await wlanAutoconfig(name)
  if (now !== null && now !== on) throw new Error('Windows не приняла изменение автонастройки Wi-Fi')
}

const wifiScan: TweakDef<WifiSnap> = {
  info: {
    id: 'wifiscan',
    title: 'Фоновое сканирование Wi-Fi',
    does: 'Отключает автонастройку беспроводной сети: Windows перестаёт периодически искать другие сети, и это больше не отнимает у адаптера время.',
    helps: 'Тем, кто играет по Wi-Fi и видит короткие скачки пинга раз в минуту или две.',
    caveat:
      'Пока твик включён, Wi-Fi не переподключится сам, а новые сети не видны. Если соединение оборвётся, подключитесь вручную или верните твик. На проводном соединении он не нужен.',
    platform: 'win32'
  },
  async probe(ctx, snap) {
    const name = snap?.adapter ?? (ctx.adapter?.kind === 'wifi' ? ctx.adapter.name : null)
    if (!name) {
      return unavailable(ctx.adapter ? 'Сейчас вы подключены по кабелю, этот твик нужен только для Wi-Fi' : (ctx.adapterReason ?? NO_NET))
    }
    const st = await wlanAutoconfig(name)
    if (st === null) return unavailable('Не удалось определить состояние автонастройки Wi-Fi (служба WLAN выключена или язык системы не распознан)')
    return { state: st ? 'off' : 'on', note: adapterNote(ctx, snap?.adapter ?? null) }
  },
  async snapshot(ctx) {
    const a = ctx.adapter
    if (!a || a.kind !== 'wifi') throw new Error('Активное подключение не Wi-Fi')
    const st = await wlanAutoconfig(a.name)
    if (st === null) throw new Error('Не удалось определить текущее состояние автонастройки Wi-Fi, поэтому изменять его небезопасно')
    return { adapter: a.name, autoconfig: st }
  },
  async apply(_ctx, s) {
    await setWlanAutoconfig(s.adapter, false)
  },
  async restore(s) {
    await setWlanAutoconfig(s.adapter, s.autoconfig)
  }
}

// 6. AWDL (macOS)
async function awdlUp(): Promise<boolean | null> {
  const r = await run('/sbin/ifconfig', ['awdl0'], 5000)
  if (r.code !== 0) return null
  const m = /flags=\d+<([^>]*)>/.exec(r.out)
  if (!m) return null
  return m[1].split(',').includes('UP')
}

const awdlCmd = (up: boolean): string => `/sbin/ifconfig awdl0 ${up ? 'up' : 'down'}`

const awdl: TweakDef<AwdlSnap> = {
  info: {
    id: 'awdl',
    title: 'AWDL (AirDrop и AirPlay по Wi-Fi)',
    does: 'Выключает служебный интерфейс awdl0, из-за которого Wi-Fi-модуль периодически отвлекается на другой канал.',
    helps: 'Играющим по Wi-Fi на Mac: убирает периодические скачки пинга.',
    caveat:
      'Пока выключено, не работают AirDrop, AirPlay и Sidecar. Система может сама включить интерфейс обратно, поэтому показано его реальное состояние. Потребуется пароль администратора.',
    platform: 'darwin'
  },
  async probe() {
    const up = await awdlUp()
    if (up === null) return unavailable('Интерфейс awdl0 не найден: на этом Mac AirDrop по Wi-Fi не используется')
    return { state: up ? 'off' : 'on' }
  },
  async snapshot() {
    const up = await awdlUp()
    if (up === null) throw new Error('Интерфейс awdl0 не найден')
    return { up }
  },
  async apply() {
    await runAdmin(awdlCmd(false))
    await new Promise((r) => setTimeout(r, 800))
    if ((await awdlUp()) !== false) throw new Error('Система сразу включила AWDL обратно, отключить не удалось')
  },
  async restore(s) {
    await runAdmin(awdlCmd(s.up))
  },
  restoreCommand: (s) => awdlCmd(s.up)
}

/** Реестр твиков. Тип снимка у каждого свой, наружу он не выходит. */
type AnyDef = TweakDef<any> // eslint-disable-line @typescript-eslint/no-explicit-any
const DEFS: AnyDef[] = [nagle, throttle, power, deliveryOpt, wifiScan, awdl]

function defsForPlatform(): AnyDef[] {
  return DEFS.filter((d) => d.info.platform === process.platform)
}

function findDef(id: unknown): AnyDef {
  const d = typeof id === 'string' ? defsForPlatform().find((x) => x.info.id === id) : undefined
  if (!d) throw new Error('Неизвестный твик или он не поддерживается на этой системе')
  return d
}

// ---- Разовые действия --------------------------------------------------------------

const ACTIONS: (TweakActionInfo & { platform: 'all' | 'win32' })[] = [
  {
    id: 'flushDns',
    platform: 'all',
    title: 'Сбросить кэш DNS',
    does: 'Очищает сохранённые в системе ответы DNS-сервера.',
    helps: 'Если сайт или игровой сервер не открывается после смены DNS или VPN, хотя должен.'
  },
  {
    id: 'resetNetwork',
    platform: 'win32',
    title: 'Сбросить сеть',
    does: 'Сбрасывает каталог Winsock и настройки стека TCP/IP (netsh winsock reset и netsh int ip reset).',
    helps: 'Если сеть ведёт себя странно после VPN, антивируса или сторонних сетевых программ.',
    caveat:
      'Нужна перезагрузка. Сбрасываются и наши твики, и сетевые настройки, сделанные вручную; статические адреса и DNS могут вернуться к автоматическим.',
    confirm: true
  }
]

async function doAction(id: string): Promise<TweakResult> {
  if (id === 'flushDns') {
    if (IS_WIN) {
      const r = await run('ipconfig.exe', ['/flushdns'], 15_000)
      if (r.code !== 0) throw new Error('Не удалось сбросить кэш DNS (нужны права администратора)')
    } else if (IS_MAC) {
      await runAdmin('/usr/bin/dscacheutil -flushcache && /usr/bin/killall -HUP mDNSResponder')
    } else {
      throw new Error('Эта система не поддерживается')
    }
    appLog('info', 'Твики: кэш DNS сброшен')
    return { message: 'Кэш DNS сброшен.' }
  }
  if (id === 'resetNetwork') {
    if (!IS_WIN) throw new Error('Это действие есть только в Windows')
    const a = await run('netsh.exe', ['winsock', 'reset'], 60_000)
    const b = await run('netsh.exe', ['int', 'ip', 'reset'], 60_000)
    appLog('warn', `Твики: сброс сети (winsock: код ${a.code}, ip: код ${b.code})`)
    if (a.code !== 0 && b.code !== 0) throw new Error('Windows отказала в сбросе сети. Запустите программу от имени администратора.')
    const partial = a.code !== 0 || b.code !== 0
    return {
      message: partial
        ? 'Сброс выполнен частично: Windows не дала сбросить часть параметров. Перезагрузите компьютер.'
        : 'Сеть сброшена. Перезагрузите компьютер, чтобы изменения вступили в силу.',
      restart: true
    }
  }
  throw new Error('Неизвестное действие')
}

// ---- Список ------------------------------------------------------------------------

async function buildList(): Promise<TweaksList> {
  const platform: TweaksList['platform'] = IS_WIN ? 'win32' : IS_MAC ? 'darwin' : 'other'
  if (platform === 'other') {
    return { platform, adapter: null, adapterReason: 'Эта система не поддерживается', tweaks: [], actions: [], applied: [], mtuBackup: null, canRevert: false }
  }
  const backup = loadBackup()
  const ar = await detectAdapter()
  const ctx: Ctx = { adapter: ar.adapter, adapterReason: ar.reason }

  const tweaks = await Promise.all(
    defsForPlatform().map(async (d): Promise<TweakInfo> => {
      const snap = backup.entries[d.info.id] ?? null
      try {
        const p: Probe = await d.probe(ctx, snap)
        return { ...d.info, state: p.state, reason: p.reason, note: p.note, external: p.state === 'on' && !snap }
      } catch (e) {
        return { ...d.info, state: 'unavailable', reason: `Не удалось проверить: ${errText(e)}` }
      }
    })
  )
  const a = ar.adapter
  const applied = Object.keys(backup.entries)
  return {
    platform,
    adapter: a ? { name: a.name, description: a.description, kind: a.kind, mtu: a.mtu } : null,
    adapterReason: ar.reason,
    tweaks,
    actions: ACTIONS.filter((x) => x.platform === 'all' || x.platform === process.platform).map((x) => ({
      id: x.id,
      title: x.title,
      does: x.does,
      helps: x.helps,
      caveat: x.caveat,
      confirm: x.confirm
    })),
    applied,
    mtuBackup: backup.mtu ? { adapter: backup.mtu.adapter, value: backup.mtu.value } : null,
    canRevert: applied.length > 0 || backup.mtu !== null
  }
}

// ---- Включение и выключение --------------------------------------------------------

async function setTweak(idArg: unknown, on: unknown): Promise<TweakResult> {
  const def = findDef(idArg)
  if (typeof on !== 'boolean') throw new Error('Не указано, включать или выключать')
  const id: string = def.info.id
  return locked(async () => {
    const backup = loadBackup()
    const entry = backup.entries[id]
    if (on) {
      const ar = await detectAdapter()
      const ctx: Ctx = { adapter: ar.adapter, adapterReason: ar.reason }
      const p: Probe = await def.probe(ctx, entry ?? null)
      if (p.state === 'unavailable') throw new Error(p.reason ?? 'Твик недоступен на этом компьютере')
      if (p.state === 'on' && !entry) throw new Error('Этот параметр уже выставлен в системе, не нами. Менять его не нужно.')
      const hadEntry = entry !== undefined
      // Исходное значение записывается на диск ДО первого изменения и больше не перезаписывается.
      const snap = hadEntry ? entry : await def.snapshot(ctx)
      if (!hadEntry) {
        backup.entries[id] = snap
        saveBackup(backup)
      }
      try {
        await def.apply(ctx, snap)
      } catch (e) {
        if (!hadEntry) {
          try {
            await def.restore(snap)
            delete backup.entries[id]
            saveBackup(backup)
          } catch {
            /* запись остаётся: «Вернуть всё как было» попробует ещё раз */
          }
        }
        appLog('error', `Твики: не удалось включить «${id}»: ${errText(e)}`)
        throw e
      }
      appLog('info', `Твики: «${id}» включён, исходное значение сохранено: ${JSON.stringify(snap)}`)
      return { message: `«${def.info.title}» включён.`, restart: def.restartHint }
    }

    if (!entry) throw new Error('Программа этот параметр не меняла, откатывать нечего.')
    try {
      await def.restore(entry)
    } catch (e) {
      appLog('error', `Твики: не удалось вернуть «${id}»: ${errText(e)}`)
      throw e
    }
    delete backup.entries[id]
    saveBackup(backup)
    appLog('info', `Твики: «${id}» возвращён к исходному значению ${JSON.stringify(entry)}`)
    return { message: `«${def.info.title}» выключен, прежнее значение возвращено.`, restart: def.restartHint }
  })
}

// ---- MTU ---------------------------------------------------------------------------

const MTU_TARGETS = ['1.1.1.1', '8.8.8.8']
const MTU_MIN_PAYLOAD = 1200
const MTU_MAX_PAYLOAD = 1472
const IP_ICMP_HEADERS = 28

/** Один пакет с запретом фрагментации и заданным размером данных; true — ответ пришёл. */
async function pingDf(target: string, size: number, adapter: Adapter, src: string | null): Promise<boolean> {
  if (IS_WIN) {
    const r = await run(
      'ping.exe',
      ['-n', '2', '-w', '1500', '-f', '-l', String(size), ...(src ? ['-S', src] : []), target],
      12_000
    )
    // Локализованный текст не читаем: ответ — это строка с «TTL=»; «нужна фрагментация» и «TTL истёк» её не содержат.
    return /TTL=\d+/i.test(r.out)
  }
  const r = await run(
    MAC_PING,
    ['-D', '-s', String(size), '-c', '2', '-W', '1500', ...(adapter.device ? ['-b', adapter.device] : []), ...(src ? ['-S', src] : []), target],
    12_000
  )
  return parseMacPingRtts(r.out).length > 0
}

async function probeMtu(): Promise<MtuProbeResult> {
  const target0 = MTU_TARGETS[0]
  const ar = await detectAdapter()
  const a = ar.adapter
  if (!a) return { ok: false, message: ar.reason ?? NO_NET, adapter: null, currentMtu: null, foundMtu: null, target: target0 }
  // Пинг идёт с адреса физического адаптера, мимо VPN (см. bufferbloat.ts).
  const src = a.ip ?? (IS_WIN ? await physicalSourceIp() : null)
  const base = { adapter: a.name, currentMtu: a.mtu }
  if (!src) return { ok: false, message: 'Не удалось определить адрес активного адаптера.', foundMtu: null, target: target0, ...base }

  let target = ''
  for (const t of MTU_TARGETS) {
    if (await pingDf(t, MTU_MIN_PAYLOAD, a, src)) {
      target = t
      break
    }
  }
  if (!target) {
    return {
      ok: false,
      message: `Не получен ответ даже на пакет минимального размера (${MTU_MIN_PAYLOAD + IP_ICMP_HEADERS} байт). Возможно, нет интернета или ICMP-пинг запрещён.`,
      foundMtu: null,
      target: target0,
      ...base
    }
  }
  let lo = MTU_MIN_PAYLOAD
  let hi = MTU_MAX_PAYLOAD
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (await pingDf(target, mid, a, src)) lo = mid
    else hi = mid - 1
  }
  const found = lo + IP_ICMP_HEADERS
  appLog('info', `Твики: подобран MTU ${found} (адаптер «${a.name}», сейчас ${a.mtu ?? 'неизвестно'}, цель ${target})`)
  return { ok: true, message: 'Готово.', foundMtu: found, target, ...base }
}

async function readWinMtu(alias: string): Promise<number | null> {
  try {
    const out = await runPs(`(Get-NetIPInterface -InterfaceAlias ${psq(alias)} -AddressFamily IPv4).NlMtu`, 15_000)
    const n = Number(out.trim())
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

async function writeMtu(adapter: string, value: number): Promise<void> {
  if (IS_WIN) {
    const r = await run('netsh.exe', ['interface', 'ipv4', 'set', 'subinterface', adapter, `mtu=${value}`, 'store=persistent'], 20_000)
    if (r.code !== 0) throw new Error(`Не удалось изменить MTU: ${(r.out || r.err).trim() || 'отказано в доступе'}`)
    const now = await readWinMtu(adapter)
    if (now !== null && now !== value) throw new Error('Windows не приняла новое значение MTU')
  } else if (IS_MAC) {
    await runAdmin(macMtuCommand(adapter, value))
    const now = await macMtu(adapter)
    if (now !== null && now !== value) throw new Error('macOS не приняла новое значение MTU')
  } else {
    throw new Error('Эта система не поддерживается')
  }
}

function macMtuCommand(device: string, value: number): string {
  return `/usr/sbin/networksetup -setMTU '${device.replace(/'/g, `'\\''`)}' ${value}`
}

async function mtuApply(valueArg: unknown): Promise<TweakResult> {
  return locked(async () => {
    const backup = loadBackup()
    if (valueArg === null || valueArg === undefined) {
      if (!backup.mtu) throw new Error('MTU программой не менялся, возвращать нечего.')
      await writeMtu(backup.mtu.adapter, backup.mtu.value)
      const v = backup.mtu.value
      backup.mtu = null
      saveBackup(backup)
      appLog('info', `Твики: MTU возвращён к ${v}`)
      return { message: `MTU возвращён к прежнему значению: ${v}.` }
    }
    const value = Number(valueArg)
    if (!Number.isInteger(value) || value < 1280 || value > 1500) throw new Error('MTU должен быть целым числом от 1280 до 1500')
    const ar = await detectAdapter()
    const a = ar.adapter
    if (!a) throw new Error(ar.reason ?? NO_NET)
    const key = IS_MAC ? (a.device ?? '') : a.name
    if (!key) throw new Error('Не удалось определить адаптер')
    if (backup.mtu && backup.mtu.adapter !== key) {
      throw new Error(`MTU уже изменён на адаптере «${backup.mtu.adapter}». Сначала верните прежнее значение.`)
    }
    if (a.mtu === value) return { message: `MTU уже равен ${value}, менять нечего.` }
    const hadBackup = backup.mtu !== null
    if (!backup.mtu) {
      if (a.mtu === null) throw new Error('Не удалось прочитать текущий MTU, поэтому менять его небезопасно')
      // Исходное значение — на диск до изменения; повторные «Поставить» его не затирают.
      backup.mtu = { adapter: key, value: a.mtu }
      saveBackup(backup)
    }
    try {
      await writeMtu(key, value)
    } catch (e) {
      if (!hadBackup) {
        backup.mtu = null
        saveBackup(backup)
      }
      appLog('error', `Твики: не удалось поставить MTU ${value}: ${errText(e)}`)
      throw e
    }
    appLog('info', `Твики: MTU ${a.mtu} → ${value} на «${key}»`)
    return { message: `MTU установлен: ${value}.` }
  })
}

// ---- Вернуть всё -------------------------------------------------------------------

async function revertAll(): Promise<RevertAllResult> {
  return locked(async () => {
    const backup = loadBackup()
    const reverted: string[] = []
    const failed: { id: string; message: string }[] = []
    const ids = Object.keys(backup.entries)

    if (IS_MAC) {
      // Всё, что требует прав администратора, — одним окном пароля.
      const cmds: { id: string; cmd: string }[] = []
      for (const id of ids) {
        const d = DEFS.find((x) => x.info.id === id && x.info.platform === 'darwin')
        if (d?.restoreCommand) cmds.push({ id, cmd: d.restoreCommand(backup.entries[id]) })
      }
      if (backup.mtu) cmds.push({ id: 'mtu', cmd: macMtuCommand(backup.mtu.adapter, backup.mtu.value) })
      if (cmds.length > 0) {
        try {
          await runAdmin(cmds.map((c) => c.cmd).join(' ; '))
          for (const c of cmds) {
            if (c.id === 'mtu') backup.mtu = null
            else delete backup.entries[c.id]
            reverted.push(c.id)
          }
        } catch (e) {
          for (const c of cmds) failed.push({ id: c.id, message: errText(e) })
        }
      }
      // Записи, которых нет в списке команд (неизвестный id), не трогаем.
    } else {
      for (const id of ids) {
        const d = DEFS.find((x) => x.info.id === id && x.info.platform === process.platform)
        if (!d) {
          failed.push({ id, message: 'Неизвестный твик в файле резервной копии' })
          continue
        }
        try {
          await d.restore(backup.entries[id])
          delete backup.entries[id]
          reverted.push(id)
        } catch (e) {
          failed.push({ id, message: errText(e) })
        }
      }
      if (backup.mtu) {
        try {
          await writeMtu(backup.mtu.adapter, backup.mtu.value)
          backup.mtu = null
          reverted.push('mtu')
        } catch (e) {
          failed.push({ id: 'mtu', message: errText(e) })
        }
      }
    }
    saveBackup(backup)
    appLog(failed.length ? 'warn' : 'info', `Твики: «Вернуть всё» — возвращено ${reverted.length}, ошибок ${failed.length}`)
    const message =
      failed.length === 0
        ? reverted.length === 0
          ? 'Откатывать нечего.'
          : 'Всё возвращено как было.'
        : `Возвращено: ${reverted.length}. Не удалось вернуть: ${failed.length}.`
    return { reverted, failed, message }
  })
}

// ---- IPC ---------------------------------------------------------------------------

function h<T>(fn: (...args: unknown[]) => Promise<T> | T) {
  return async (_event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => {
    try {
      const value = await fn(...args)
      return { ok: true, value }
    } catch (e: unknown) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) }
    }
  }
}

export function registerTweaksIpc(): void {
  ipcMain.handle('tweaks:list', h(() => buildList()))
  ipcMain.handle('tweaks:set', h((id, on) => setTweak(id, on)))
  ipcMain.handle(
    'tweaks:action',
    h((id) => {
      const known = ACTIONS.find((a) => a.id === id && (a.platform === 'all' || a.platform === process.platform))
      if (!known) throw new Error('Неизвестное действие')
      return locked(() => doAction(known.id))
    })
  )
  ipcMain.handle('tweaks:mtuProbe', h(() => probeMtu()))
  ipcMain.handle('tweaks:mtuApply', h((value) => mtuApply(value)))
  ipcMain.handle('tweaks:revertAll', h(() => revertAll()))
}
