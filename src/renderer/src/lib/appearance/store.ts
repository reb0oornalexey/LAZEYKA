import { create } from 'zustand'
import { DEFAULT_PRESET_ID, DEFAULT_SETTINGS, getBuiltinPreset } from './presets'
import { effectiveTokens, resolveAppearance, type AppearanceSnapshot } from './resolve'
import { VALID_KEYS } from './tokens'
import { isSafeCssValue } from './color'

const HISTORY_LIMIT = 20
const COALESCE_MS = 900

interface AppearanceState extends AppearanceSnapshot {
  custom: CustomAppearanceTheme[]
  recentColors: string[]
  loaded: boolean
  past: AppearanceSnapshot[]
  future: AppearanceSnapshot[]
  /** Состояние на момент открытия страницы: для «Сравнить» и «Отменить изменения». */
  baseline: AppearanceSnapshot | null
  compare: boolean
  system: AppearanceSystemOptions
  systemDark: boolean | null
  systemAccent: string | null
  setSystem: (patch: Partial<AppearanceSystemOptions>) => void
  setSystemInfo: (info: { dark: boolean; accent: string | null }) => void
  applyTokens: (patch: Record<string, string>) => void
  emergencyReset: () => void
  /** Растёт после каждого применения к документу — чтобы поля читали актуальные вычисленные цвета. */
  tick: number
  bump: () => void

  hydrate: (cfg: AppearanceConfig | undefined, appTheme: AppearanceMode) => void
  markBaseline: () => void
  setCompare: (v: boolean) => void
  selectPreset: (id: string) => void
  /** Готовая тема (например, подобранная под обои) одним шагом истории. */
  applyGenerated: (t: { mode: AppearanceMode; tokens: Record<string, string>; settings: Partial<AppearanceSettings> }) => void
  setToken: (key: string, value: string) => void
  resetToken: (key: string) => void
  resetTokens: () => void
  setSettings: (patch: Partial<AppearanceSettings>) => void
  resetSettings: () => void
  setMode: (mode: AppearanceMode) => void
  undo: () => void
  redo: () => void
  revertToBaseline: () => void
  saveAsCustom: (name: string) => void
  updateCustom: () => void
  renameCustom: (id: string, name: string) => void
  duplicateCustom: (id: string) => void
  deleteCustom: (id: string) => void
  importTheme: (json: string) => string | null
  exportTheme: () => string
  pushRecent: (color: string) => void
}

export const DEFAULT_SYSTEM: AppearanceSystemOptions = { follow: false, lightPreset: 'light', darkPreset: 'dark', accent: false }

export const snapshotOf = (s: AppearanceSnapshot): AppearanceSnapshot => ({
  presetId: s.presetId,
  mode: s.mode,
  tokens: s.tokens,
  settings: s.settings
})

/** Итоговое оформление с учётом акцента Windows (если включён). */
export function resolveState(s: AppearanceState, snapshot: AppearanceSnapshot = snapshotOf(s)): ReturnType<typeof resolveAppearance> {
  return resolveAppearance(snapshot, s.custom, s.system.accent ? s.systemAccent : null)
}

const snap = (s: AppearanceState): AppearanceSnapshot => ({
  presetId: s.presetId,
  mode: s.mode,
  tokens: s.tokens,
  settings: s.settings
})

let lastKey = ''
let lastAt = 0

const newId = (): string => `c-${Math.random().toString(36).slice(2, 10)}`

function mergeSettings(raw: Partial<AppearanceSettings> | undefined): AppearanceSettings {
  return { ...DEFAULT_SETTINGS, ...(raw ?? {}) }
}

export const useAppearanceStore = create<AppearanceState>((set, get) => {
  /** Применить изменение с записью в историю (подряд идущие правки одного поля склеиваются). */
  const commit = (patch: Partial<AppearanceSnapshot>, key: string): void => {
    const s = get()
    const now = Date.now()
    const coalesce = key === lastKey && now - lastAt < COALESCE_MS
    lastKey = key
    lastAt = now
    const past = coalesce ? s.past : [...s.past, snap(s)].slice(-HISTORY_LIMIT)
    set({ ...patch, past, future: [] })
  }

  const effectiveFull = (s: AppearanceState): Record<string, string> => {
    const eff = effectiveTokens(snap(s), s.custom)
    return Object.fromEntries(Object.entries(eff).filter(([k, v]) => VALID_KEYS.has(k) && isSafeCssValue(v)))
  }

  return {
    presetId: DEFAULT_PRESET_ID,
    mode: 'dark',
    tokens: {},
    settings: { ...DEFAULT_SETTINGS },
    custom: [],
    recentColors: [],
    loaded: false,
    past: [],
    future: [],
    baseline: null,
    compare: false,
    system: { ...DEFAULT_SYSTEM },
    systemDark: null,
    systemAccent: null,
    setSystem: (patch) => {
      set((s) => ({ system: { ...s.system, ...patch } }))
      get().setSystemInfo({ dark: get().systemDark ?? true, accent: get().systemAccent })
    },
    // Событие от системы: тема Windows / акцент изменились (опроса нет).
    setSystemInfo: ({ dark, accent }) => {
      const s = get()
      const patch: Partial<AppearanceState> = { systemDark: dark, systemAccent: accent }
      if (s.system.follow) {
        const target = dark ? s.system.darkPreset : s.system.lightPreset
        const custom = s.custom.find((c) => c.id === target)
        const builtin = getBuiltinPreset(target)
        const mode = custom?.mode ?? builtin?.mode
        if (mode && target !== s.presetId) {
          patch.presetId = target
          patch.mode = mode
          patch.tokens = {}
          if (custom) patch.settings = { ...custom.settings }
        }
      }
      set(patch)
    },
    applyTokens: (patch) => commit({ tokens: { ...get().tokens, ...patch } }, 'apply-tokens'),
    // Аварийный сброс (Ctrl+Shift+R): «Тёмная», без правок, настройки по умолчанию; свои темы остаются.
    emergencyReset: () => {
      const s = get()
      lastKey = ''
      set({
        past: [...s.past, snap(s)].slice(-HISTORY_LIMIT),
        future: [],
        presetId: DEFAULT_PRESET_ID,
        mode: 'dark',
        tokens: {},
        settings: { ...DEFAULT_SETTINGS },
        system: { ...DEFAULT_SYSTEM }
      })
    },
    tick: 0,
    bump: () => set((s) => ({ tick: s.tick + 1 })),

    hydrate: (cfg, appTheme) => {
      if (!cfg) {
        const p = getBuiltinPreset(appTheme) ?? getBuiltinPreset(DEFAULT_PRESET_ID)!
        set({ presetId: p.id, mode: p.mode, tokens: {}, settings: { ...DEFAULT_SETTINGS }, custom: [], recentColors: [], system: { ...DEFAULT_SYSTEM }, loaded: true, past: [], future: [] })
        return
      }
      set({
        presetId: cfg.presetId,
        mode: cfg.mode,
        tokens: { ...cfg.tokens },
        settings: mergeSettings(cfg.settings),
        custom: cfg.custom ?? [],
        recentColors: cfg.recentColors ?? [],
        system: { ...DEFAULT_SYSTEM, ...(cfg.system ?? {}) },
        loaded: true,
        past: [],
        future: []
      })
    },
    markBaseline: () => set((s) => ({ baseline: snap(s), compare: false })),
    setCompare: (v) => set({ compare: v }),

    selectPreset: (id) => {
      const s = get()
      const c = s.custom.find((x) => x.id === id)
      if (s.system.follow) {
        // При слежении за системой выбранный пресет занимает свой слот (светлый/тёмный).
        const m = c?.mode ?? getBuiltinPreset(id)?.mode
        if (m) set({ system: { ...s.system, [m === 'dark' ? 'darkPreset' : 'lightPreset']: id } })
      }
      if (c) commit({ presetId: id, mode: c.mode, tokens: {}, settings: { ...c.settings } }, `preset:${id}`)
      else {
        const p = getBuiltinPreset(id)
        if (p) commit({ presetId: id, mode: p.mode, tokens: {} }, `preset:${id}`)
      }
    },
    applyGenerated: (t) =>
      commit(
        { presetId: t.mode, mode: t.mode, tokens: { ...t.tokens }, settings: { ...get().settings, ...t.settings } },
        `gen:${Date.now()}`
      ),
    setToken: (key, value) => commit({ tokens: { ...get().tokens, [key]: value } }, `tok:${key}`),
    resetToken: (key) => {
      const next = { ...get().tokens }
      delete next[key]
      commit({ tokens: next }, `rtok:${key}`)
    },
    resetTokens: () => commit({ tokens: {} }, 'reset-tokens'),
    setSettings: (patch) => commit({ settings: { ...get().settings, ...patch } }, `set:${Object.keys(patch).join(',')}`),
    resetSettings: () => commit({ settings: { ...DEFAULT_SETTINGS } }, 'reset-settings'),
    setMode: (mode) => commit({ mode }, 'mode'),

    undo: () => {
      const s = get()
      const prev = s.past[s.past.length - 1]
      if (!prev) return
      lastKey = ''
      set({ ...prev, past: s.past.slice(0, -1), future: [snap(s), ...s.future].slice(0, HISTORY_LIMIT) })
    },
    redo: () => {
      const s = get()
      const next = s.future[0]
      if (!next) return
      lastKey = ''
      set({ ...next, future: s.future.slice(1), past: [...s.past, snap(s)].slice(-HISTORY_LIMIT) })
    },
    revertToBaseline: () => {
      const b = get().baseline
      if (b) {
        lastKey = ''
        commit({ ...b }, 'revert')
      }
    },

    saveAsCustom: (name) => {
      const s = get()
      const theme: CustomAppearanceTheme = {
        id: newId(),
        name: name.trim().slice(0, 40) || 'Моя тема',
        mode: s.mode,
        tokens: effectiveFull(s),
        settings: { ...s.settings }
      }
      lastKey = ''
      set({ past: [...s.past, snap(s)].slice(-HISTORY_LIMIT), future: [], custom: [...s.custom, theme], presetId: theme.id, tokens: {} })
    },
    updateCustom: () => {
      const s = get()
      const c = s.custom.find((x) => x.id === s.presetId)
      if (!c) return
      const updated = { ...c, mode: s.mode, tokens: effectiveFull(s), settings: { ...s.settings } }
      lastKey = ''
      set({ past: [...s.past, snap(s)].slice(-HISTORY_LIMIT), future: [], custom: s.custom.map((x) => (x.id === c.id ? updated : x)), tokens: {} })
    },
    renameCustom: (id, name) =>
      set((s) => ({ custom: s.custom.map((c) => (c.id === id ? { ...c, name: name.trim().slice(0, 40) || c.name } : c)) })),
    duplicateCustom: (id) => {
      const s = get()
      const c = s.custom.find((x) => x.id === id)
      if (!c) return
      const copy = { ...c, id: newId(), name: `${c.name} (копия)`.slice(0, 40), tokens: { ...c.tokens }, settings: { ...c.settings } }
      set({ custom: [...s.custom, copy] })
    },
    deleteCustom: (id) => {
      const s = get()
      const custom = s.custom.filter((c) => c.id !== id)
      if (s.presetId === id) {
        const p = getBuiltinPreset(DEFAULT_PRESET_ID)!
        lastKey = ''
        set({ custom, presetId: p.id, mode: p.mode, tokens: {}, past: [...s.past, snap(s)].slice(-HISTORY_LIMIT), future: [] })
      } else set({ custom })
    },
    importTheme: (json) => {
      try {
        const d = JSON.parse(json) as Partial<CustomAppearanceTheme> & { app?: string }
        if (d.app !== 'lazeyka-theme' || !d.tokens || typeof d.tokens !== 'object') return 'Это не файл темы LAZEYKA'
        const tokens: Record<string, string> = {}
        for (const [k, v] of Object.entries(d.tokens)) if (VALID_KEYS.has(k) && isSafeCssValue(v)) tokens[k] = v
        const theme: CustomAppearanceTheme = {
          id: newId(),
          name: String(d.name ?? 'Импортированная').slice(0, 40),
          mode: d.mode === 'light' ? 'light' : 'dark',
          tokens,
          // Картинку фона из чужого файла не берём — только числовые и цветовые настройки.
          settings: { ...mergeSettings(d.settings), bgImage: '' }
        }
        const s = get()
        lastKey = ''
        set({ custom: [...s.custom, theme], past: [...s.past, snap(s)].slice(-HISTORY_LIMIT), future: [], presetId: theme.id, mode: theme.mode, tokens: {}, settings: { ...theme.settings } })
        return null
      } catch {
        return 'Не удалось прочитать файл темы'
      }
    },
    exportTheme: () => {
      const s = get()
      const c = s.custom.find((x) => x.id === s.presetId)
      const name = c?.name ?? getBuiltinPreset(s.presetId)?.name ?? 'Тема'
      return JSON.stringify(
        { app: 'lazeyka-theme', version: 1, name, mode: s.mode, tokens: effectiveFull(s), settings: { ...s.settings, bgImage: '' } },
        null,
        2
      )
    },
    pushRecent: (color) =>
      set((s) => ({ recentColors: [color, ...s.recentColors.filter((c) => c.toLowerCase() !== color.toLowerCase())].slice(0, 10) }))
  }
})
