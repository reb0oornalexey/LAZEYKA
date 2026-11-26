/** Свои звуки пользователя (каналы customSounds:*, src/main/core/custom-sounds.ts). */
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

export interface CustomSoundInfo {
  id: string
  name: string
  file: string
  size: number
  addedAt: number
}

export const customSoundsList = (): Promise<CustomSoundInfo[]> => invoke('customSounds:list')
/** Системный диалог выбора файла; null — пользователь отменил. */
export const customSoundsPick = (): Promise<CustomSoundInfo | null> => invoke('customSounds:pick')
export const customSoundsRead = (id: string): Promise<Uint8Array> => invoke('customSounds:read', id)
export const customSoundsRemove = (id: string): Promise<void> => invoke('customSounds:remove', id)
