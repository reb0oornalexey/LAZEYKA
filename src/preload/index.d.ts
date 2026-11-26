/* eslint-disable @typescript-eslint/no-explicit-any -- окно передаёт и получает данные любых каналов, как и раньше с типами @electron-toolkit */
import type { IpcRendererEvent } from 'electron'

/** То, что preload отдаёт окну (см. src/preload/index.ts). */
interface LazeykaIpcRenderer {
  invoke(channel: string, ...args: any[]): Promise<any>
  send(channel: string, ...args: any[]): void
  on(channel: string, listener: (event: IpcRendererEvent, ...args: any[]) => void): () => void
  once(channel: string, listener: (event: IpcRendererEvent, ...args: any[]) => void): () => void
  removeListener(channel: string, listener: (...args: any[]) => void): void
  removeAllListeners(channel: string): void
}

declare global {
  interface Window {
    electron: { ipcRenderer: LazeykaIpcRenderer }
    api: { platform: NodeJS.Platform }
  }
}
