/** Вызовы главного процесса для страницы «Локальная сеть» (каналы lan:*). */
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

export interface LanSettings {
  autostart: boolean
  hubPort: number
  proxyPort: number
  remote: boolean
  share: boolean
  proxyUser: string
  proxyPass: string
}

export interface LanGuide {
  id: string
  title: string
  steps: string[]
  note?: string
  /** Какие приложения на этом устройстве системный прокси обычно игнорируют. */
  ignores?: string
}

export interface LanTelegramLinks {
  tg: string
  https: string
}

export interface LanProxyStats {
  active: number
  total: number
  devices: string[]
  bytesFromClients: number
  bytesToClients: number
}

export interface LanFirewallBlocker {
  id: string
  name: string
  profiles: string
}

export interface LanState {
  enabled: boolean
  busy: boolean
  error?: string
  platform: string
  settings: LanSettings
  address: string | null
  remoteUrl: string | null
  setupUrl: string | null
  proxy: { host: string; port: number; active: boolean; authRequired: boolean } | null
  stats: LanProxyStats | null
  networkCategory: 'public' | 'private' | 'domain' | 'unknown'
  firewallRule: boolean
  /** Запрещающие правила брандмауэра для самой программы; null — ещё не проверяли. */
  firewallBlockers: LanFirewallBlocker[] | null
  guides: LanGuide[]
  honestNote: string
  quicHint: string
  telegramHint: string
  /** Подсказка: VPN на телефоне может не пускать к адресам домашней сети. */
  phoneVpnHint: string
  telegram: LanTelegramLinks | null
  hotspot: {
    address: string
    setupUrl: string | null
    proxy: { host: string; port: number; authRequired: boolean } | null
    telegram: LanTelegramLinks | null
  } | null
  zapretOn: boolean
  vpn: { on: boolean; mode: 'tun' | 'system_proxy' | 'only_proxy' }
}

export interface HotspotInfo {
  supported: boolean
  reason?: string
  on: boolean
  ssid: string
  password: string
  clients: number
  /** Подключённые устройства: имя (если известно) и MAC-адрес. */
  devices: { name: string; mac: string }[]
  wifiQr: string
}

export const lanCheckYouTubeProxy = (): Promise<{ label: string; ok: boolean; detail: string }[]> => invoke('lan:checkYouTubeProxy')
export const lanGetState = (): Promise<LanState> => invoke('lan:getState')
export const lanSetEnabled = (on: boolean): Promise<LanState> => invoke('lan:setEnabled', on)
export const lanSetSettings = (patch: Partial<LanSettings>): Promise<LanState> => invoke('lan:setSettings', patch)
export const lanRotateToken = (): Promise<LanState> => invoke('lan:rotateToken')
export const lanFirewall = (mode: 'allow' | 'remove' | 'unblock'): Promise<LanState> => invoke('lan:firewall', mode)
/** Открыть пульт (ссылку с кодом из QR) в браузере этого компьютера — для проверки. */
export const lanOpenRemote = (): Promise<void> => invoke('lan:openRemote')
export const lanHotspotState = (): Promise<HotspotInfo> => invoke('lan:hotspotState')
export const lanHotspotSet = (arg: { on?: boolean; ssid?: string; password?: string }): Promise<HotspotInfo> =>
  invoke('lan:hotspotSet', arg)

/** Подписка на событие lan:state. Возвращает функцию отписки. */
export function onLanState(cb: (s: LanState) => void): () => void {
  const listener = (_e: unknown, s: LanState): void => cb(s)
  const off = window.electron.ipcRenderer.on('lan:state', listener as never) as unknown
  return typeof off === 'function' ? (off as () => void) : () => window.electron.ipcRenderer.removeAllListeners('lan:state')
}
