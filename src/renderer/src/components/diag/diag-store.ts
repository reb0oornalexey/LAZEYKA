import { create } from 'zustand'
import { toast } from 'sonner'
import { optimizerCheckSite, type SiteCheckResult } from '@renderer/utils/ipc'
import { diagLeaks, diagWifi, diagWhitelist, type LeakResult, type WhitelistResult, type WifiResult } from '@renderer/utils/diag-api'

/*
 * Результаты проверок страницы «Диагностика» (Е9). Раньше каждая карточка
 * держала свой результат сама; теперь они общие, чтобы пульт сверху видел
 * итог всех четырёх проверок и результаты не терялись при переключении
 * вкладок. Проверки запускаются только кнопками, фоновых опросов нет.
 */

interface Check<T> {
  busy: boolean
  r: T | null
}

interface DiagStore {
  site: Check<SiteCheckResult> & { url: string; previous: SiteCheckResult | null; error: string | null }
  leak: Check<LeakResult>
  wifi: Check<WifiResult>
  whitelist: Check<WhitelistResult>
  /** Адрес, который уже проверили по ссылке ?site= (чтобы не перепроверять при смене вкладок). */
  autoSite: string | null
  setUrl: (url: string) => void
  setSite: (fn: (r: SiteCheckResult | null) => SiteCheckResult | null) => void
  runSite: (target?: string) => Promise<void>
  runLeak: () => Promise<void>
  runWifi: () => Promise<void>
  runWhitelist: () => Promise<void>
  setAutoSite: (v: string | null) => void
}

const fail = (e: unknown): void => {
  toast.error('Проверка не удалась', { description: e instanceof Error ? e.message : String(e) })
}

export const useDiagStore = create<DiagStore>((set, get) => ({
  site: { busy: false, r: null, url: '', previous: null, error: null },
  leak: { busy: false, r: null },
  wifi: { busy: false, r: null },
  whitelist: { busy: false, r: null },
  autoSite: null,

  setUrl: (url) => set((s) => ({ site: { ...s.site, url } })),
  setSite: (fn) => set((s) => ({ site: { ...s.site, r: fn(s.site.r) } })),
  setAutoSite: (v) => set({ autoSite: v }),

  runSite: async (target) => {
    const url = (target ?? get().site.url).trim()
    if (!url || get().site.busy) return
    const old = get().site.r
    set((s) => ({ site: { ...s.site, url: target ?? s.site.url, busy: true, error: null } }))
    try {
      const r = await optimizerCheckSite(url)
      set((s) => ({ site: { ...s.site, r, previous: old?.url === r.url ? old : null } }))
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      set((s) => ({ site: { ...s.site, error } }))
    } finally {
      set((s) => ({ site: { ...s.site, busy: false } }))
    }
  },

  runLeak: async () => {
    if (get().leak.busy) return
    set((s) => ({ leak: { ...s.leak, busy: true } }))
    try {
      const r = await diagLeaks()
      set({ leak: { busy: false, r } })
    } catch (e) {
      fail(e)
      set((s) => ({ leak: { ...s.leak, busy: false } }))
    }
  },

  runWifi: async () => {
    if (get().wifi.busy) return
    set((s) => ({ wifi: { ...s.wifi, busy: true } }))
    try {
      const r = await diagWifi()
      set({ wifi: { busy: false, r } })
    } catch (e) {
      fail(e)
      set((s) => ({ wifi: { ...s.wifi, busy: false } }))
    }
  },

  runWhitelist: async () => {
    if (get().whitelist.busy) return
    set((s) => ({ whitelist: { ...s.whitelist, busy: true } }))
    try {
      const r = await diagWhitelist()
      set({ whitelist: { busy: false, r } })
    } catch (e) {
      fail(e)
      set((s) => ({ whitelist: { ...s.whitelist, busy: false } }))
    }
  }
}))
