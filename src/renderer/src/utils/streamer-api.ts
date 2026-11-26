/** Вызовы главного процесса для блока «Стример» (каналы streamer:*). */
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

export type StreamerModeSetting = 'off' | 'on' | 'auto'
export type SensitiveCategory = 'ip' | 'node' | 'link' | 'qr' | 'id'
export const SENSITIVE_CATEGORIES: SensitiveCategory[] = ['ip', 'node', 'link', 'qr', 'id']

export interface StreamerSettings {
  mode: StreamerModeSetting
  categories: Record<SensitiveCategory, boolean>
  hideNotifications: boolean
  discordEnabled: boolean
  discordShowPing: boolean
}

export interface DiscordStatusInfo {
  enabled: boolean
  link: 'off' | 'waiting' | 'connected'
  preview: { details: string; state: string | null } | null
}

export interface StreamerState {
  active: boolean
  reason: 'manual' | 'program' | 'none'
  program: string | null
  reasonText: string
  settings: StreamerSettings
  discord: DiscordStatusInfo
  platform: string
}

export type IngestPlatform = 'twitch' | 'youtube' | 'kick' | 'custom'

export interface IngestServer {
  id: string
  platform: IngestPlatform
  name: string
  host: string
  port: number
}

export interface IngestList {
  servers: IngestServer[]
  twitchLive: boolean
}

export interface IngestResult {
  id: string
  samples: number[]
  medianMs: number | null
  spreadMs: number
  lost: number
  error?: string
}

export interface IngestRun {
  results: IngestResult[]
  direct: boolean
}

export interface IngestProgress {
  done: number
  total: number
  result: IngestResult
}

export const streamerGetState = (): Promise<StreamerState> => invoke('streamer:getState')
export const streamerSetSettings = (patch: Partial<Omit<StreamerSettings, 'categories'>> & { categories?: Partial<Record<SensitiveCategory, boolean>> }): Promise<StreamerState> =>
  invoke('streamer:setSettings', patch)
export const streamerIngestList = (): Promise<IngestList> => invoke('streamer:ingestList')
export const streamerIngestTest = (servers: IngestServer[]): Promise<IngestRun> => invoke('streamer:ingestTest', servers)
export const streamerDiscordStatus = (): Promise<DiscordStatusInfo> => invoke('streamer:discordStatus')
export const streamerObsDirect = (): Promise<{ message: string }> => invoke('streamer:obsDirect')

interface StreamerEvents {
  'streamer:state': StreamerState
  'streamer:ingestProgress': IngestProgress
}

export function onStreamer<K extends keyof StreamerEvents>(channel: K, cb: (payload: StreamerEvents[K]) => void): () => void {
  const listener = (_e: unknown, payload: StreamerEvents[K]): void => cb(payload)
  const offIpc = window.electron.ipcRenderer.on(channel, listener)
  return () => {
    offIpc()
  }
}

/** Классы на корневом элементе: streamer-mode и sm-hide-<категория> для каждой включённой. */
export function applyStreamerClasses(state: StreamerState | null): void {
  const root = document.documentElement
  const wanted = new Set<string>()
  if (state?.active) {
    wanted.add('streamer-mode')
    for (const c of SENSITIVE_CATEGORIES) if (state.settings.categories[c]) wanted.add(`sm-hide-${c}`)
  }
  for (const cls of Array.from(root.classList)) {
    if ((cls === 'streamer-mode' || cls.startsWith('sm-hide-')) && !wanted.has(cls)) root.classList.remove(cls)
  }
  wanted.forEach((cls) => root.classList.add(cls))
}
