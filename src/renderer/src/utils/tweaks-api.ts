/** Вызовы главного процесса для страницы «Твики» (каналы tweaks:*). */
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
  reason?: string
  /** Значение выставлено не программой — откатывать нечего. */
  external?: boolean
  note?: string
}

export interface TweakActionInfo {
  id: string
  title: string
  does: string
  helps: string
  caveat?: string
  confirm?: boolean
}

export interface TweaksList {
  platform: 'win32' | 'darwin' | 'other'
  adapter: TweakAdapter | null
  adapterReason?: string
  tweaks: TweakInfo[]
  actions: TweakActionInfo[]
  applied: string[]
  mtuBackup: { adapter: string; value: number } | null
  canRevert: boolean
}

export interface TweakResult {
  message: string
  restart?: boolean
}

export interface MtuProbeResult {
  ok: boolean
  message: string
  adapter: string | null
  currentMtu: number | null
  foundMtu: number | null
  target: string
}

export interface RevertAllResult {
  reverted: string[]
  failed: { id: string; message: string }[]
  message: string
}

export const tweaksList = (): Promise<TweaksList> => invoke('tweaks:list')
export const tweaksSet = (id: string, on: boolean): Promise<TweakResult> => invoke('tweaks:set', id, on)
export const tweaksAction = (id: string): Promise<TweakResult> => invoke('tweaks:action', id)
export const tweaksMtuProbe = (): Promise<MtuProbeResult> => invoke('tweaks:mtuProbe')
/** value = null — вернуть прежний MTU из резервной копии. */
export const tweaksMtuApply = (value: number | null): Promise<TweakResult> => invoke('tweaks:mtuApply', value)
export const tweaksRevertAll = (): Promise<RevertAllResult> => invoke('tweaks:revertAll')
