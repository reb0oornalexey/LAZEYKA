import { create } from 'zustand'
import {
  labAutopickState,
  labFamilies,
  labList,
  type AutopickState,
  type CustomStrategy,
  type FamilySpec,
  type LabLimits,
  type StrategyModel
} from '@renderer/utils/zapret-lab-api'

export type ZapretTab = 'strategies' | 'builder' | 'lists' | 'settings'

const TAB_KEY = 'lazeyka.zapret.tab'
const TABS: ZapretTab[] = ['strategies', 'builder', 'lists', 'settings']

function savedTab(): ZapretTab {
  try {
    const v = localStorage.getItem(TAB_KEY) as ZapretTab | null
    return v && TABS.includes(v) ? v : 'strategies'
  } catch {
    return 'strategies'
  }
}

/** Черновик конструктора: что редактируем и на чём основано. */
export interface BuilderDraft {
  model: StrategyModel
  name: string
  /** Есть — правим свою стратегию с этим id. */
  editingId?: string
  basedOn?: string
  approximate?: boolean
}

interface LabStore {
  tab: ZapretTab
  setTab: (t: ZapretTab) => void
  families: FamilySpec[]
  limits: LabLimits | null
  defaults: StrategyModel | null
  custom: CustomStrategy[]
  refreshCustom: () => Promise<void>
  draft: BuilderDraft | null
  setDraft: (d: BuilderDraft | null) => void
  autopick: AutopickState | null
  autopickOpen: boolean
  setAutopickOpen: (v: boolean) => void
  /** Идёт проверка стратегии из конструктора. */
  checking: boolean
  setChecking: (v: boolean) => void
}

export const useZapretLab = create<LabStore>((set) => ({
  tab: savedTab(),
  setTab: (tab) => {
    try {
      localStorage.setItem(TAB_KEY, tab)
    } catch {
      /* нет хранилища — вкладка не запомнится */
    }
    set({ tab })
  },
  families: [],
  limits: null,
  defaults: null,
  custom: [],
  refreshCustom: async () => {
    const custom = await labList().catch(() => [] as CustomStrategy[])
    set({ custom })
  },
  draft: null,
  setDraft: (draft) => set({ draft }),
  autopick: null,
  autopickOpen: false,
  setAutopickOpen: (autopickOpen) => set({ autopickOpen }),
  checking: false,
  setChecking: (checking) => set({ checking })
}))

let attached = false

/** Подписка на события автоподбора и начальная загрузка справочника. Вызывается страницей; повторный вызов ничего не делает. */
export function attachZapretLab(): () => void {
  if (attached) return () => void 0
  attached = true
  const off = window.electron.ipcRenderer.on('zapretlab:autopick', (_e: unknown, s: unknown) => {
    useZapretLab.setState({ autopick: s as AutopickState })
  })
  void labFamilies()
    .then((r) => useZapretLab.setState({ families: r.families, limits: r.limits, defaults: r.defaults }))
    .catch(() => void 0)
  void labAutopickState()
    .then((s) => useZapretLab.setState({ autopick: s }))
    .catch(() => void 0)
  void useZapretLab.getState().refreshCustom()
  return () => {
    off()
    attached = false
  }
}
