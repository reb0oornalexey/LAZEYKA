import { create } from 'zustand'
import { toast } from 'sonner'
import { playSound } from '@renderer/lib/sound'
import {
  onPrematch,
  prematchCheck,
  prematchDeleteReport,
  prematchGetSettings,
  prematchHistory,
  prematchNat,
  prematchRegions,
  prematchSetSettings,
  prematchStart,
  prematchState,
  prematchStop,
  type CheckProgress,
  type CheckResult,
  type CheckStep,
  type LagEventPayload,
  type LagSettings,
  type MatchReport,
  type NatResult,
  type PrematchSettings,
  type RegionEntry,
  type SessionState
} from '@renderer/utils/prematch-api'

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

interface PrematchStore {
  ready: boolean
  settings: PrematchSettings | null
  target: string
  regions: RegionEntry[]
  checkRunning: boolean
  steps: Partial<Record<CheckStep, CheckProgress>>
  check: CheckResult | null
  starting: boolean
  session: SessionState | null
  /** Отчёт только что завершённой сессии (показывается над историей). */
  report: MatchReport | null
  history: MatchReport[]
  lastLag: LagEventPayload | null
  nat: NatResult | null
  natRunning: boolean

  setTarget: (v: string) => void
  saveTarget: () => void
  setCheckLoad: (v: boolean) => void
  patchLag: (patch: Partial<LagSettings>) => void
  runCheck: () => Promise<void>
  startSession: () => Promise<void>
  stopSession: () => Promise<void>
  dismissReport: () => void
  openReport: (r: MatchReport) => void
  deleteReport: (id: string) => Promise<void>
  runNat: () => Promise<void>
}

export const usePrematchStore = create<PrematchStore>((set, get) => ({
  ready: false,
  settings: null,
  target: '',
  regions: [],
  checkRunning: false,
  steps: {},
  check: null,
  starting: false,
  session: null,
  report: null,
  history: [],
  lastLag: null,
  nat: null,
  natRunning: false,

  setTarget: (v) => set({ target: v }),

  saveTarget: () => {
    const t = get().target.trim()
    if (get().settings?.lastTarget === t) return
    prematchSetSettings({ lastTarget: t })
      .then((s) => set({ settings: s }))
      .catch(() => void 0)
  },

  setCheckLoad: (v) => {
    const cur = get().settings
    if (cur) set({ settings: { ...cur, checkLoad: v } })
    prematchSetSettings({ checkLoad: v }).catch(() => void 0)
  },

  patchLag: (patch) => {
    const cur = get().settings
    if (cur) set({ settings: { ...cur, lag: { ...cur.lag, ...patch } } })
    prematchSetSettings({ lag: patch })
      .then((s) => set({ settings: s }))
      .catch((e) => toast.error('Не удалось сохранить настройки', { description: msg(e) }))
  },

  runCheck: async () => {
    const { target, checkRunning, session } = get()
    if (checkRunning || session) return
    if (!target.trim()) {
      toast.error('Укажите сервер', { description: 'Вставьте IP из игры или выберите датацентр.' })
      return
    }
    set({ checkRunning: true, steps: {}, check: null, report: null })
    try {
      const r = await prematchCheck(target.trim(), { load: Boolean(get().settings?.checkLoad) })
      set({ check: r })
    } catch (e) {
      toast.error('Проверка не удалась', { description: msg(e) })
    } finally {
      set({ checkRunning: false })
    }
  },

  startSession: async () => {
    const { target, starting, session, checkRunning } = get()
    if (starting || session || checkRunning) return
    if (!target.trim()) {
      toast.error('Укажите сервер', { description: 'Вставьте IP из игры или выберите датацентр.' })
      return
    }
    set({ starting: true, report: null })
    try {
      const s = await prematchStart(target.trim())
      set({ session: s })
    } catch (e) {
      toast.error('Не удалось начать сессию', { description: msg(e) })
    } finally {
      set({ starting: false })
    }
  },

  stopSession: async () => {
    try {
      const r = await prematchStop()
      // Событие prematch:ended придёт тоже; здесь — чтобы окно обновилось сразу.
      set({ session: null, report: r ?? get().report })
      if (!r) toast.info('Сессия слишком короткая, отчёт не создан.')
      void prematchHistory().then((h) => set({ history: h })).catch(() => void 0)
    } catch (e) {
      toast.error('Не удалось завершить сессию', { description: msg(e) })
    }
  },

  dismissReport: () => set({ report: null }),
  openReport: (r) => set({ report: r }),

  deleteReport: async (id) => {
    try {
      const h = await prematchDeleteReport(id)
      set({ history: h, report: get().report?.id === id ? null : get().report })
    } catch (e) {
      toast.error('Не удалось удалить отчёт', { description: msg(e) })
    }
  },

  runNat: async () => {
    if (get().natRunning) return
    set({ natRunning: true })
    try {
      set({ nat: await prematchNat() })
    } catch (e) {
      toast.error('Проверка NAT не удалась', { description: msg(e) })
    } finally {
      set({ natRunning: false })
    }
  }
}))

let attached = false

/**
 * Подписывается на события main (один раз за запуск) и подтягивает текущее
 * состояние. Страница вызывает её при открытии; чтобы сигнал о лагах звучал и
 * когда открыта другая вкладка, вызовите её ещё и при старте приложения.
 */
export function initPrematchListeners(): void {
  const st = usePrematchStore
  if (!attached) {
    attached = true
    onPrematch('prematch:progress', (p) => st.setState((s) => ({ steps: { ...s.steps, [p.step]: p } })))
    onPrematch('prematch:sample', (p) => {
      const s = st.getState().session
      if (!s || s.id !== p.sessionId) return
      if (p.seq !== s.samples.length) {
        // Пропустили событие (окно было закрыто) — берём состояние целиком.
        void prematchState().then((x) => st.setState({ session: x.session })).catch(() => void 0)
        return
      }
      st.setState({ session: { ...s, samples: [...s.samples, p.rtt] } })
    })
    onPrematch('prematch:lag', (ev) => {
      const s = st.getState().session
      if (s && s.id === ev.sessionId) st.setState({ session: { ...s, lagAlerts: s.lagAlerts + 1 } })
      st.setState({ lastLag: ev })
      if (ev.sound) playSound(undefined, false, 'alerts')
      toast.warning('Лаг', { id: 'prematch-lag', description: ev.message, duration: 4000 })
    })
    onPrematch('prematch:ended', (ev) => {
      const s = st.getState().session
      if (s && s.id !== ev.sessionId) return
      st.setState({ session: null, report: ev.report ?? st.getState().report })
      void prematchHistory().then((h) => st.setState({ history: h })).catch(() => void 0)
      if (ev.reason === 'timeout') toast.info('Сессия завершена по времени (6 часов). Отчёт сохранён.')
    })
  }
  void (async () => {
    try {
      const [settings, state, history] = await Promise.all([prematchGetSettings(), prematchState(), prematchHistory()])
      st.setState((s) => ({
        ready: true,
        settings,
        target: s.ready ? s.target : settings.lastTarget,
        session: state.session,
        check: state.lastCheck ?? s.check,
        history
      }))
    } catch {
      st.setState({ ready: true })
    }
    try {
      if (st.getState().regions.length === 0) st.setState({ regions: await prematchRegions() })
    } catch { /* список регионов необязателен */ }
  })()
}
