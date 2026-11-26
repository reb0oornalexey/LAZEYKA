import { create } from 'zustand'
import { appGetOnlineCount, appGetOnlineNum } from '@renderer/utils/ipc'

interface OnlineStore {
  /** Последняя статистика счётчика (null — выключен или данных ещё нет). */
  stats: OnlineStats | null
  /** Номер установки: из ответа Worker, а до первой отметки — сохранённый с прошлых запусков. */
  savedNum: number | null
  setStats: (s: OnlineStats | null) => void
}

export const useOnlineStore = create<OnlineStore>((set) => ({
  stats: null,
  savedNum: null,
  setStats: (stats): void => set({ stats })
}))

/** Номер установки для показа. */
export const selectInstallNum = (s: OnlineStore): number | null => s.stats?.num ?? s.savedNum

let listener: ((event: unknown, payload: OnlineStats | null) => void) | null = null
// Отписка — функцией, которую вернул on(): removeListener через мост не находит слушателя.
let offIpc: (() => void) | null = null

/** Один раз подписывается на `app:onlineCount` и подтягивает текущее значение. */
export const attachOnlineStore = (): (() => void) => {
  offIpc?.()
  listener = (_e, payload) => useOnlineStore.getState().setStats(payload ?? null)
  offIpc = window.electron.ipcRenderer.on('app:onlineCount', listener)
  appGetOnlineCount()
    .then((r) => useOnlineStore.getState().setStats(r ?? null))
    .catch(() => void 0)
  appGetOnlineNum()
    .then((n) => useOnlineStore.setState({ savedNum: n }))
    .catch(() => void 0)
  return () => {
    if (listener) {
      offIpc?.()
      offIpc = null
      listener = null
    }
  }
}
