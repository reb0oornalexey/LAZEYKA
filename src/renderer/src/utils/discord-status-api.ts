/** Дополнение к streamer-api: расширенный статус Discord и кнопка «Проверить снова» (канал streamer:discordRetry). */
interface IpcResult<T> {
  ok: boolean
  value?: T
  message?: string
}

/** Поля, которые main добавляет к DiscordStatusInfo (старые типы их не знают). */
export interface DiscordStatusExtra {
  activity?: 'none' | 'sending' | 'confirmed' | 'error'
  error?: string | null
  user?: string | null
  confirmedAt?: number | null
}

export async function streamerDiscordRetry(): Promise<DiscordStatusExtra & { link: 'off' | 'waiting' | 'connected' }> {
  const res = (await window.electron.ipcRenderer.invoke('streamer:discordRetry')) as IpcResult<DiscordStatusExtra & { link: 'off' | 'waiting' | 'connected' }>
  if (!res?.ok) throw new Error(res?.message ?? 'IPC streamer:discordRetry failed')
  return res.value as DiscordStatusExtra & { link: 'off' | 'waiting' | 'connected' }
}
