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
// Отписка — функцией, которую вернул on(): removeListener через мост не находит слушателя.
let offIpc: (() => void) | null = null

export const attachIncyStore = (): (() => void) => {
  window.electron.ipcRenderer.removeAllListeners('incy:status')
  listener = (_e, payload) => useIncyStore.getState().setStatus(payload)
  offIpc = window.electron.ipcRenderer.on('incy:status', listener)
  incyGetStatus()
    .then((s) => useIncyStore.getState().setStatus(s))
    .catch(() => void 0)
  return () => {
    if (listener) {
      offIpc?.()
      offIpc = null
      listener = null
    }
  }
}
