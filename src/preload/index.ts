import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

/**
 * Мост для окна программы.
 *
 * Раньше сюда целиком уходил `electronAPI` из @electron-toolkit/preload:
 * `process.env` (все переменные окружения), `sendSync`, `postMessage`,
 * `webFrame`, а слушатели получали настоящий объект события с полем
 * `sender` — тем же ipcRenderer без ограничений. Теперь окно получает только
 * то, чем пользуется: invoke / send / on / once / removeListener /
 * removeAllListeners с проверкой имени канала, и платформу.
 *
 * Preload использует только модуль `electron` — поэтому окна могут работать
 * с `sandbox: true`.
 */

/** Имя канала: `incy:status`, `window-maximized`, `appConfigUpdated`, `log`. */
const CHANNEL = /^[A-Za-z][\w-]{0,47}(?::[\w-]{1,63}){0,3}$/

function checkChannel(channel: unknown): string {
  if (typeof channel !== 'string' || !CHANNEL.test(channel)) {
    throw new Error(`Недопустимое имя канала: ${String(channel).slice(0, 48)}`)
  }
  return channel
}

type Listener = (event: IpcRendererEvent, ...args: unknown[]) => void

/** Событие без `sender` и портов: окну незачем получать ipcRenderer в обход проверки. */
const BARE_EVENT = Object.freeze({}) as IpcRendererEvent

// Обёртки слушателей, чтобы removeListener находил нужную.
const wrappers = new Map<string, Map<Listener, (e: IpcRendererEvent, ...a: unknown[]) => void>>()

function wrap(channel: string, listener: Listener): (e: IpcRendererEvent, ...a: unknown[]) => void {
  let byChannel = wrappers.get(channel)
  if (!byChannel) {
    byChannel = new Map()
    wrappers.set(channel, byChannel)
  }
  const existing = byChannel.get(listener)
  if (existing) return existing
  const w = (_e: IpcRendererEvent, ...args: unknown[]): void => listener(BARE_EVENT, ...args)
  byChannel.set(listener, w)
  return w
}

function unwrap(channel: string, listener: Listener): ((e: IpcRendererEvent, ...a: unknown[]) => void) | undefined {
  const byChannel = wrappers.get(channel)
  const w = byChannel?.get(listener)
  if (w) byChannel!.delete(listener)
  return w
}

const electronAPI = {
  ipcRenderer: {
    invoke(channel: string, ...args: unknown[]): Promise<unknown> {
      return ipcRenderer.invoke(checkChannel(channel), ...args)
    },
    send(channel: string, ...args: unknown[]): void {
      ipcRenderer.send(checkChannel(channel), ...args)
    },
    on(channel: string, listener: Listener): () => void {
      const ch = checkChannel(channel)
      const w = wrap(ch, listener)
      ipcRenderer.on(ch, w)
      return () => {
        ipcRenderer.removeListener(ch, w)
        unwrap(ch, listener)
      }
    },
    once(channel: string, listener: Listener): () => void {
      const ch = checkChannel(channel)
      const w = (_e: IpcRendererEvent, ...args: unknown[]): void => listener(BARE_EVENT, ...args)
      ipcRenderer.once(ch, w)
      return () => {
        ipcRenderer.removeListener(ch, w)
      }
    },
    removeListener(channel: string, listener: Listener): void {
      const ch = checkChannel(channel)
      const w = unwrap(ch, listener)
      if (w) ipcRenderer.removeListener(ch, w)
    },
    removeAllListeners(channel: string): void {
      const ch = checkChannel(channel)
      ipcRenderer.removeAllListeners(ch)
      wrappers.delete(ch)
    }
  }
}

// Только конкретные значения — без process.env.
const api = {
  platform: process.platform
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}

export type LazeykaElectronAPI = typeof electronAPI
