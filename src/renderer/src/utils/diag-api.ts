/**
 * «Диагностика» и панель сервисов: типы и вызовы IPC. Типы повторяют те, что
 * отдаёт src/main/core/diag*.ts (renderer не импортирует код main).
 */
interface IpcResult<T> {
  ok: boolean
  value?: T
  message?: string
}

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const res = (await window.electron.ipcRenderer.invoke(channel, ...args)) as IpcResult<T>
  if (!res || !res.ok) {
    throw new Error(res?.message ?? `IPC ${channel} failed`)
  }
  return res.value as T
}

// ---- панель сервисов ------------------------------------------------------------

export type ServiceId = 'youtube' | 'discord' | 'telegram' | 'twitch' | 'steam' | 'chatgpt' | 'claude' | 'gemini'
export type ServiceState = 'ok' | 'slow' | 'down' | 'region' | 'unchecked'

/** Плитки в порядке показа; домен — для «Проверки сайта». */
export const SERVICE_META: { id: ServiceId; name: string; siteDomain: string }[] = [
  { id: 'youtube', name: 'YouTube', siteDomain: 'youtube.com' },
  { id: 'discord', name: 'Discord', siteDomain: 'discord.com' },
  { id: 'telegram', name: 'Telegram', siteDomain: 'web.telegram.org' },
  { id: 'twitch', name: 'Twitch', siteDomain: 'twitch.tv' },
  { id: 'steam', name: 'Steam', siteDomain: 'store.steampowered.com' },
  { id: 'chatgpt', name: 'ChatGPT', siteDomain: 'chatgpt.com' },
  { id: 'claude', name: 'Claude', siteDomain: 'claude.ai' },
  { id: 'gemini', name: 'Gemini', siteDomain: 'gemini.google.com' }
]

export interface ServiceResult {
  id: ServiceId
  name: string
  siteDomain: string
  state: ServiceState
  detail: string
  ms: number | null
}

export interface ServicesReport {
  at: number | null
  results: ServiceResult[]
  cached: boolean
}

/** force=false: свежий кэш (моложе 10 минут) отдаётся без запросов, иначе идёт проверка. */
export const diagServices = (force = false): Promise<ServicesReport> => invoke('diag:services', force)

// ---- нейросети по DNS -------------------------------------------------------------

export type AiDnsState = 'open' | 'region' | 'fail'

export interface AiDnsCell {
  providerId: string
  serviceId: string
  state: AiDnsState
  ip: string | null
  ms: number | null
  detail: string
}

export type AiDnsEvent =
  | { kind: 'plan'; providers: { id: string; name: string }[]; services: { id: string; name: string }[] }
  | { kind: 'cell'; providerId: string; serviceId: string; state: AiDnsState | 'running'; ip?: string | null; ms?: number | null; detail?: string }

export interface AiDnsResult {
  checkedAt: number
  providers: { id: string; name: string }[]
  services: { id: string; name: string }[]
  cells: AiDnsCell[]
  bestId: string | null
}

export const diagAiDns = (): Promise<AiDnsResult> => invoke('diag:aiDns')

/** Подписка на ход проверки (событие diag:aiDnsCell); возвращает функцию отписки. */
export function onAiDnsEvent(cb: (e: AiDnsEvent) => void): () => void {
  const listener = (_e: unknown, payload: AiDnsEvent): void => cb(payload)
  const offIpc = window.electron.ipcRenderer.on('diag:aiDnsCell', listener)
  return () => {
    offIpc()
  }
}

// ---- утечки -------------------------------------------------------------------------

export type Tone = 'ok' | 'warn' | 'bad' | 'info'

export interface IpView {
  ip: string | null
  countryCode: string | null
  country: string | null
}

export interface LeakResult {
  checkedAt: number
  vpn: {
    running: boolean
    mode: 'tun' | 'system_proxy' | 'only_proxy' | null
    routing: 'bypass-ru' | 'global' | 'direct' | null
    exitLag: boolean
    hijackDns: boolean | null
  }
  seen: IpView
  direct: IpView & { measurable: boolean; reason?: string }
  vpnExit: IpView | null
  v6: { seen: string | null; direct: string | null; measurable: boolean }
  dns: { system: string[]; tunnel: string | null }
  verdict: { kind: Tone; headline: string; items: { kind: Tone; text: string }[]; todo: string[] }
}

export const diagLeaks = (): Promise<LeakResult> => invoke('diag:leaks')

// ---- Wi-Fi --------------------------------------------------------------------------

export type WifiBand = '2.4' | '5' | '6'

export interface ScanNetwork {
  ssid: string
  bssid: string | null
  signalPct: number | null
  rssiDbm: number | null
  channel: number | null
  band: WifiBand | null
  phy: string | null
  connected?: boolean
}

export interface ChannelStat {
  band: WifiBand
  channel: number
  count: number
  overlap: number
  own: boolean
}

export interface WifiResult {
  checkedAt: number
  platform: 'win32' | 'darwin' | 'other'
  link: { type: 'wired' | 'wifi' | 'wifi-unknown' | 'unknown'; ifaceName: string | null }
  current: {
    ssid: string | null
    signalPct: number | null
    rssiDbm: number | null
    band: WifiBand | null
    channel: number | null
    phy: string | null
    rxMbps: number | null
    txMbps: number | null
  } | null
  networks: ScanNetwork[]
  channels: ChannelStat[]
  advice: { lines: { kind: Tone; text: string }[]; wifiLikelyCause: boolean | null }
  problem?: 'location' | 'service' | 'no-adapter' | 'unsupported'
  message?: string
}

export const diagWifi = (): Promise<WifiResult> => invoke('diag:wifi')

// ---- белые списки --------------------------------------------------------------------

export interface WhitelistResult {
  checkedAt: number
  available: boolean
  message?: string
  probes: { host: string; group: 'ru' | 'foreign'; ok: boolean; ms: number | null; error?: string }[]
  verdict: { kind: 'whitelist' | 'normal' | 'no-internet' | 'unclear'; headline: string; advice: string } | null
}

export const diagWhitelist = (): Promise<WhitelistResult> => invoke('diag:whitelist')

// ---- IP: маскирование ------------------------------------------------------------------

/** «203.0.113.45» → «203.0.*.*»; IPv6 — первые две группы и «:****» (та же логика, что maskIp в main). */
export function maskIp(ip: string): string {
  const v = ip.trim()
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(v)) {
    const p = v.split('.')
    return `${p[0]}.${p[1]}.*.*`
  }
  if (v.includes(':')) {
    const groups = v.split(':').filter((g) => g !== '')
    return groups.length >= 2 ? `${groups[0]}:${groups[1]}:****` : '****'
  }
  return '••••'
}

/** Сколько минут назад (для подписей «проверено …»). */
export function agoText(at: number | null, now = Date.now()): string {
  if (!at) return 'не проверялось'
  const m = Math.floor((now - at) / 60000)
  if (m < 1) return 'проверено только что'
  return `проверено ${m} мин назад`
}
