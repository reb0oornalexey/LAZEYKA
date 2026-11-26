/** Новая установка или обновление (каналы install:*). */
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

export interface InstallState {
  /** Программа запускается впервые на этом компьютере (в этой папке данных). */
  fresh: boolean
  /** Версия прошлого запуска; 'legacy' — стояла версия старше 1.3.0. */
  previousVersion: string | null
  version: string
}

export const getInstallState = (): Promise<InstallState> => invoke('install:state')
/** Окно открылось: запомнить текущую версию как последнюю запущенную. */
export const ackInstallState = (): Promise<void> => invoke('install:ack')
