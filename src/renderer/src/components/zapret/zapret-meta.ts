import { create } from 'zustand'
import { platform } from '@renderer/utils/init'
import {
  autopilotGetStatus,
  gameModeGetStatus,
  zapretGetGameFilter,
  zapretGetIpsetFilter,
  zapretGetWindowsServiceStatus,
  zapretMacGetState,
  type AutopilotStatus,
  type GameFilterMode,
  type GameModeStatus,
  type IpsetFilterSnapshot,
  type ZapretMacServiceInfo,
  type ZapretServiceStatus
} from '@renderer/utils/ipc'

/*
 * Сводка для чипов пульта Zapret: служба Windows (или служба macOS), Game Filter,
 * IPset, автопилот и игровой режим. Читается один раз при открытии раздела и
 * после изменений на вкладках «Списки» / «Настройки» — без опроса по таймеру.
 */

interface ZapretMeta {
  service: ZapretServiceStatus | null
  mac: ZapretMacServiceInfo | null
  gameFilter: GameFilterMode | null
  ipset: IpsetFilterSnapshot | null
  autopilot: AutopilotStatus | null
  gameMode: GameModeStatus | null
  /** Частичное обновление (настройки сообщают своё новое значение). */
  patch: (p: Partial<Omit<ZapretMeta, 'patch'>>) => void
}

export const useZapretMeta = create<ZapretMeta>((set) => ({
  service: null,
  mac: null,
  gameFilter: null,
  ipset: null,
  autopilot: null,
  gameMode: null,
  patch: (p) => set(p)
}))

const isMac = platform === 'darwin'

/** Перечитать сводку. Ошибки молча оставляют прежнее значение: чип просто не покажется. */
export async function refreshZapretMeta(): Promise<void> {
  if (platform === 'linux') return
  const patch = useZapretMeta.getState().patch
  const tasks: Promise<unknown>[] = [
    zapretGetIpsetFilter().then((ipset) => patch({ ipset })),
    autopilotGetStatus().then((autopilot) => patch({ autopilot })),
    gameModeGetStatus().then((gameMode) => patch({ gameMode }))
  ]
  if (isMac) {
    tasks.push(zapretMacGetState().then((mac) => patch({ mac })))
  } else {
    tasks.push(zapretGetWindowsServiceStatus().then((service) => patch({ service })))
    tasks.push(zapretGetGameFilter().then((gameFilter) => patch({ gameFilter })))
  }
  await Promise.allSettled(tasks)
}
