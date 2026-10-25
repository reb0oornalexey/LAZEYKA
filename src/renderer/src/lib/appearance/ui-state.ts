import { create } from 'zustand'
import { ADVANCED_GROUPS, SIMPLE_GROUPS } from './tokens'

export type AppearanceTab = 'themes' | 'colors' | 'interface' | 'advanced'
export type PreviewPage = 'home' | 'zapret' | 'settings'

const LS_KEY = 'lazeyka.appearance.ui'
const TABS: AppearanceTab[] = ['themes', 'colors', 'interface', 'advanced']

function load(): { tab: AppearanceTab; drawer: boolean } {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) ?? '{}') as { tab?: string; drawer?: boolean }
    return { tab: TABS.includes(raw.tab as AppearanceTab) ? (raw.tab as AppearanceTab) : 'themes', drawer: raw.drawer === true }
  } catch {
    return { tab: 'themes', drawer: false }
  }
}

function save(tab: AppearanceTab, drawer: boolean): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ tab, drawer }))
  } catch {
    /* хранилище недоступно — не страшно */
  }
}

const SIMPLE_KEYS = new Set(SIMPLE_GROUPS.flatMap((g) => g.colors.map((c) => c.key)))
const ADV_GROUP_OF = new Map<string, string>(ADVANCED_GROUPS.flatMap((g) => g.blocks.flatMap((b) => b.tokens.map((t) => [t.key, g.id] as const))))

/** Куда вести клик по элементу предпросмотра: ключ цвета или `setting:<имя>`. */
export function tabOfControl(key: string): AppearanceTab {
  if (key.startsWith('setting:bg') || key === 'setting:panelOpacity') return 'themes'
  if (key.startsWith('setting:')) return 'interface'
  return SIMPLE_KEYS.has(key) ? 'colors' : 'advanced'
}

const COACH_KEY = 'lazeyka.appearance.coachSeen'
const coachUnseen = (): boolean => {
  try {
    return localStorage.getItem(COACH_KEY) !== '1'
  } catch {
    return true
  }
}

interface UiState {
  /** Подсказка при первом заходе; «Понятно» запоминается навсегда. */
  coach: boolean
  showCoach: () => void
  dismissCoach: () => void
  tab: AppearanceTab
  drawer: boolean
  /** Подсвеченный элемент (ключ цвета / setting:*) — гаснет сам. */
  focusKey: string | null
  openAdv: string[]
  previewPage: PreviewPage
  showStates: boolean
  /** «Режим настройки» предпросмотра: клик открывает настройки элемента, а не работает как обычно. */
  configMode: boolean
  setConfigMode: (v: boolean) => void
  saver: { open: boolean; name: string }
  openSaver: (name: string) => void
  setSaverName: (name: string) => void
  closeSaver: () => void
  setTab: (t: AppearanceTab) => void
  setDrawer: (v: boolean) => void
  setPage: (p: PreviewPage) => void
  setShowStates: (v: boolean) => void
  toggleAdv: (id: string) => void
  focusControl: (key: string) => void
}

let timer: ReturnType<typeof setTimeout> | null = null
const init = load()

export const useUiState = create<UiState>((set, get) => ({
  tab: init.tab,
  drawer: init.drawer,
  focusKey: null,
  openAdv: [],
  configMode: true,
  coach: coachUnseen(),
  showCoach: () => set({ coach: true }),
  dismissCoach: () => {
    set({ coach: false })
    try {
      localStorage.setItem(COACH_KEY, '1')
    } catch {
      /* noop */
    }
  },
  setConfigMode: (configMode) => set({ configMode }),
  previewPage: 'home',
  showStates: false,
  saver: { open: false, name: '' },
  openSaver: (name) => set({ saver: { open: true, name }, tab: 'themes' }),
  setSaverName: (name) => set((s) => ({ saver: { ...s.saver, name } })),
  closeSaver: () => set({ saver: { open: false, name: '' } }),
  setTab: (tab) => {
    set({ tab })
    save(tab, get().drawer)
  },
  setDrawer: (drawer) => {
    set({ drawer })
    save(get().tab, drawer)
  },
  setPage: (previewPage) => set({ previewPage }),
  setShowStates: (showStates) => set({ showStates }),
  toggleAdv: (id) => set((s) => ({ openAdv: s.openAdv.includes(id) ? s.openAdv.filter((x) => x !== id) : [...s.openAdv, id] })),
  focusControl: (key) => {
    const tab = tabOfControl(key)
    const adv = ADV_GROUP_OF.get(key)
    set((s) => ({ tab, focusKey: key, openAdv: adv ? [adv] : s.openAdv }))
    save(tab, get().drawer)
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => set({ focusKey: null }), 1800)
    // Ждём отрисовку вкладки, затем прокручиваем к элементу.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => document.querySelector(`[data-ctl="${key}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
    )
  }
}))
