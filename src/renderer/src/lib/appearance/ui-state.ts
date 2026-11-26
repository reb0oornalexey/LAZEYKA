import { create } from 'zustand'
import { SIMPLE_GROUPS } from './tokens'
import { locateSlot, variantOfKey } from './workshop'

export type AppearanceTab = 'themes' | 'colors' | 'interface' | 'advanced'

const LS_KEY = 'lazeyka.appearance.ui'
const TABS: AppearanceTab[] = ['themes', 'colors', 'interface', 'advanced']

function load(): { tab: AppearanceTab; collapsed: boolean } {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) ?? '{}') as { tab?: string; pvCollapsed?: boolean }
    return { tab: TABS.includes(raw.tab as AppearanceTab) ? (raw.tab as AppearanceTab) : 'themes', collapsed: raw.pvCollapsed === true }
  } catch {
    return { tab: 'themes', collapsed: false }
  }
}

function save(tab: AppearanceTab, pvCollapsed: boolean): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ tab, pvCollapsed }))
  } catch {
    /* хранилище недоступно — не страшно */
  }
}

const SIMPLE_KEYS = new Set(SIMPLE_GROUPS.flatMap((g) => g.colors.map((c) => c.key)))

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
  /** Предпросмотр свёрнут в полоску у правого края (только на узком окне). Запоминается. */
  pvCollapsed: boolean
  /** Подсвеченный элемент (ключ цвета / setting:*) — гаснет сам. */
  focusKey: string | null
  /** «Тонкая настройка»: открытая мастерская компонента (id из ADVANCED_GROUPS) или галерея (null). */
  advComp: string | null
  /** Выбранный вариант в мастерской (например, «primary» у кнопок). */
  advVariant: string | null
  /** Выделенный слот цвета в мастерской. */
  advSlot: string | null
  openComp: (id: string | null, variant?: string | null, slot?: string | null) => void
  selectSlot: (key: string | null, variant?: string | null) => void
  showStates: boolean
  /** «Режим настройки» предпросмотра: клик открывает настройки элемента, а не работает как обычно. */
  configMode: boolean
  setConfigMode: (v: boolean) => void
  saver: { open: boolean; name: string }
  openSaver: (name: string) => void
  setSaverName: (name: string) => void
  closeSaver: () => void
  setTab: (t: AppearanceTab) => void
  setPvCollapsed: (v: boolean) => void
  setShowStates: (v: boolean) => void
  /** Перейти к настройке: вкладка, мастерская компонента (comp — если ключ общий для нескольких), подсветка. */
  focusControl: (key: string, comp?: string) => void
}

let timer: ReturnType<typeof setTimeout> | null = null
const init = load()

export const useUiState = create<UiState>((set, get) => ({
  tab: init.tab,
  pvCollapsed: init.collapsed,
  focusKey: null,
  advComp: null,
  advVariant: null,
  advSlot: null,
  openComp: (advComp, advVariant = null, advSlot = null) => set({ advComp, advVariant, advSlot }),
  selectSlot: (advSlot, variant) => set((s) => ({ advSlot, advVariant: variant === undefined ? s.advVariant : variant })),
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
  showStates: false,
  saver: { open: false, name: '' },
  openSaver: (name) => set({ saver: { open: true, name }, tab: 'themes' }),
  setSaverName: (name) => set((s) => ({ saver: { ...s.saver, name } })),
  closeSaver: () => set({ saver: { open: false, name: '' } }),
  setTab: (tab) => {
    // Ушли с «Тонкой настройки» — при возвращении снова галерея (переход из предпросмотра откроет нужный компонент сам).
    set(tab === 'advanced' ? { tab } : { tab, advComp: null, advSlot: null })
    save(tab, get().pvCollapsed)
  },
  setPvCollapsed: (pvCollapsed) => {
    set({ pvCollapsed })
    save(get().tab, pvCollapsed)
  },
  setShowStates: (showStates) => set({ showStates }),
  focusControl: (key, comp) => {
    const tab = tabOfControl(key)
    const loc = tab === 'advanced' ? (comp ? { comp, variant: variantOfKey(comp, key) } : locateSlot(key)) : null
    set((s) => ({
      tab,
      focusKey: key,
      ...(loc ? { advComp: loc.comp, advVariant: loc.variant, advSlot: key } : { advComp: s.advComp })
    }))
    save(tab, get().pvCollapsed)
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => set({ focusKey: null }), 1800)
    // Ждём отрисовку вкладки, затем прокручиваем к элементу.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => document.querySelector(`[data-ctl="${key}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
    )
  }
}))
