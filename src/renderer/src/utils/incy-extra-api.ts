/**
 * Вызовы главного процесса для окна «Соединения», памяти маршрутов и цепочки
 * узлов INCY (каналы incyx:*).
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

// ---- Соединения ----------------------------------------------------------------

export type ConnRoute = 'vpn' | 'direct' | 'block' | 'other'

export interface ConnRow {
  id: string
  process: string
  /** macOS: путь бандла — для сравнения со списком ExitLag. */
  appRule?: string
  host: string
  hostIsIp: boolean
  port: number
  network: string
  route: ConnRoute
  rule: string
  customRule: boolean
  downSpeed: number
  upSpeed: number
  download: number
  upload: number
  start: number
}

export interface ConnectionsEvent {
  at: number
  state: 'ok' | 'unavailable'
  reason?: string
  rows: ConnRow[]
  total: number
  more: number
  downTotal: number
  upTotal: number
  viaNode?: string
}

export type RuleAction = 'proxy' | 'direct' | 'block'

export const connStart = (): Promise<void> => invoke('incyx:connStart')
export const connStop = (): Promise<void> => invoke('incyx:connStop')
export const connClose = (id: string): Promise<boolean> => invoke('incyx:connClose', id)
export const ruleForDomain = (
  domain: string,
  action: RuleAction
): Promise<{ created: boolean; reapplied: boolean }> => invoke('incyx:ruleForDomain', domain, action)

/** Подписка на события списка соединений; возвращает функцию отписки. */
export function onConnections(cb: (ev: ConnectionsEvent) => void): () => void {
  const listener = (_e: unknown, payload: ConnectionsEvent): void => cb(payload)
  const offIpc = window.electron.ipcRenderer.on('incyx:connections', listener)
  return () => {
    offIpc()
  }
}

// ---- Память маршрутов -------------------------------------------------------------

export type RouteFix = 'zapret' | 'vpn' | 'direct'

export interface RouteMemoryItem {
  domain: string
  fix: RouteFix
  at: number
  source: string
  ruleActive: boolean
}

export const routeMemoryList = (): Promise<RouteMemoryItem[]> => invoke('incyx:routeMemoryList')
export const routeMemoryAdd = (
  domain: string,
  fix: RouteFix,
  source = 'manual'
): Promise<{ zapretAdded?: number; zapretRestarted?: boolean }> =>
  invoke('incyx:routeMemoryAdd', domain, fix, source)
export const routeMemoryRemove = (domain: string): Promise<boolean> => invoke('incyx:routeMemoryRemove', domain)
export const routeMemoryReapply = (): Promise<number> => invoke('incyx:routeMemoryReapply')

/**
 * Запомнить решение для сайта: «всегда так». Вызывается кнопкой в «Проверке
 * сайта» ('zapret' — помог Zapret, 'vpn' — нужен VPN).
 */
export const rememberRoute = (domain: string, fix: RouteFix): Promise<{ zapretAdded?: number; zapretRestarted?: boolean }> =>
  routeMemoryAdd(domain, fix, 'site-check')

// ---- Цепочка узлов ------------------------------------------------------------------

export interface ChainInfo {
  entryNodeId: string | null
  exitNodeId: string | null
  applicable: boolean
  reason?: string
  active: boolean
  eligibleEntryIds: string[]
  /** Узлы, которые могут быть выходом цепочки. */
  eligibleExitIds?: string[]
}

export const chainProbe = (): Promise<boolean | null> => invoke('incyx:chainProbe')
export const chainExitCheck = (id: string): Promise<{ ok: boolean; reason?: string }> => invoke('incyx:chainExitCheck', id)
export const chainGet = (): Promise<ChainInfo> => invoke('incyx:chainGet')
export const chainSet = (
  entryNodeId: string | null
): Promise<{ applied: boolean; reason?: string; reconnecting?: boolean }> => invoke('incyx:chainSet', entryNodeId)
