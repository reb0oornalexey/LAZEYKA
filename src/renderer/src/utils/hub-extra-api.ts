/**
 * LAZEYKA Hub: дополнительные вызовы IPC (кнопка «Проверить», темы «на проверке»).
 * Типы повторяют те, что отдаёт src/main/core/hub-client.ts.
 */
import type { HubInbox } from './hub-api'

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

/** Тема автора, ожидающая решения. */
export interface PendingTheme {
  name: string
  at: number
}

/** «Проверить»: спросить сервер сразу. reached = false — сервер не ответил. */
export const hubCheckNow = (): Promise<{ reached: boolean; inbox: HubInbox }> => invoke('hub:checkNow')
/** Мои темы, ожидающие решения автора. */
export const hubPendingThemes = (): Promise<PendingTheme[]> => invoke('hub:pending')
