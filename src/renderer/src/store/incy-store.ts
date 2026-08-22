import { create } from 'zustand'
import { incyGetStatus, type IncyStatus } from '@renderer/utils/ipc'

interface IncyStore {
  status: IncyStatus
  setStatus: (s: IncyStatus) => void
}

export const useIncyStore = create<IncyStore>((set) => ({
  status: {
    state: 'stopped',
    activeNodeId: null,
    selectedNodeId: null,
    connectionMode: 'tun',
    routingMode: 'bypass-ru'
  },
  setStatus: (status): void => set({ status })
}))

let listener: ((event: unknown, payload: IncyStatus) => void) | null = null

export const attachIncyStore = (): (() => void) => {
  window.electron.ipcRenderer.removeAllListeners('incy:status')
  listener = (_e, payload) => useIncyStore.getState().setStatus(payload)
  window.electron.ipcRenderer.on('incy:status', listener)
  incyGetStatus()
    .then((s) => useIncyStore.getState().setStatus(s))
    .catch(() => void 0)
  return () => {
    if (listener) {
      window.electron.ipcRenderer.removeListener('incy:status', listener)
      listener = null
    }
  }
}
