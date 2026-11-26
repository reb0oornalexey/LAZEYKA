/** Е6: IPC новых строк «Настроек» (см. src/main/core/settings-extra.ts). */

interface IpcResult<T> {
  ok: boolean
  value?: T
  message?: string
}

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const res = (await window.electron.ipcRenderer.invoke(channel, ...args)) as IpcResult<T>
  if (!res || !res.ok) throw new Error(res?.message ?? `IPC ${channel} failed`)
  return res.value as T
}

export type CacheItemId = 'gallery' | 'logs' | 'subIcons' | 'updates' | 'web'

export interface CacheItem {
  id: CacheItemId
  title: string
  desc: string
  bytes: number
  files: number
}

export interface ProfileBackup {
  id: string
  at: number
  from: string
  to: string | null
  bytes: number
}

export const resetWindowBounds = (): Promise<{ width: number; height: number }> => invoke('settingsx:resetWindow')
export const getCacheInfo = (): Promise<CacheItem[]> => invoke('settingsx:cacheInfo')
export const clearAppCache = (): Promise<{ freedBytes: number }> => invoke('settingsx:clearCache')
export const listProfileBackups = (): Promise<ProfileBackup[]> => invoke('settingsx:backups')
export const restoreProfileBackup = (id: string): Promise<{ success: boolean; message: string }> => invoke('settingsx:restoreBackup', id)
export const getUpdateRoute = (): Promise<{ viaIncy: boolean }> => invoke('settingsx:updateRoute')

/** «1,7 МБ», «640 КБ», «0 Б». */
export function formatBytes(n: number): string {
  if (!(n > 0)) return '0 Б'
  if (n < 1024) return `${n} Б`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} КБ`
  const mb = n / 1024 / 1024
  return `${mb < 10 ? mb.toFixed(1).replace('.', ',') : Math.round(mb)} МБ`
}
