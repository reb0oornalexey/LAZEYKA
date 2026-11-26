/** Вызовы главного процесса для мини-окна (каналы mini:*). */
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

export type MiniMode = 'panel' | 'indicator'

export interface MiniSettings {
  /** Прозрачность панели, %, 60–100. */
  opacity: number
  /** panel — переключатели и пинг; indicator — только что включено. */
  mode: MiniMode
  /** Индикатор закреплён: клики проходят сквозь него. */
  locked: boolean
  /** Прозрачность индикатора, %, 30–100. */
  indOpacity: number
}

export interface MiniState extends MiniSettings {
  open: boolean
}

export const MINI_IND_MIN_OPACITY = 30
export const MINI_MIN_OPACITY = 60
export const MINI_MAX_OPACITY = 100

export const miniOpen = (): Promise<MiniState> => invoke('mini:open')
export const miniClose = (): Promise<MiniState> => invoke('mini:close')
export const miniToggle = (): Promise<MiniState> => invoke('mini:toggle')
export const miniState = (): Promise<MiniState> => invoke('mini:state')
export const miniGetSettings = (): Promise<MiniSettings> => invoke('mini:getSettings')
export const miniSetSettings = (patch: Partial<MiniSettings>): Promise<MiniSettings> => invoke('mini:setSettings', patch)
export const miniOpenMain = (): Promise<void> => invoke('mini:openMain')

/** Подписка на изменение состояния мини-окна; возвращает функцию отписки. */
export function onMiniChanged(cb: (state: MiniState) => void): () => void {
  const listener = (_e: unknown, payload: MiniState): void => cb(payload)
  const offIpc = window.electron.ipcRenderer.on('mini:changed', listener)
  return () => {
    offIpc()
  }
}
