import { create } from 'zustand'
import { toast } from 'sonner'
import {
  applyStreamerClasses,
  onStreamer,
  streamerGetState,
  streamerIngestList,
  streamerIngestTest,
  streamerObsDirect,
  streamerSetSettings,
  type IngestList,
  type IngestPlatform,
  type IngestResult,
  type IngestServer,
  type StreamerSettings,
  type StreamerState,
  type SensitiveCategory
} from '@renderer/utils/streamer-api'

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

type SettingsPatch = Partial<Omit<StreamerSettings, 'categories'>> & { categories?: Partial<Record<SensitiveCategory, boolean>> }

interface StreamerStore {
  state: StreamerState | null
  list: IngestList | null
  listLoading: boolean
  custom: IngestServer[]
  /** Какие списки входят в проверку. */
  include: { twitch: boolean; youtube: boolean }
  results: Record<string, IngestResult>
  progress: { done: number; total: number } | null
  running: boolean
  /** Замер шёл с адреса физического адаптера (мимо VPN). null — ещё не мерили. */
  direct: boolean | null
  obsBusy: boolean

  setState: (s: StreamerState) => void
  patchSettings: (patch: SettingsPatch) => Promise<void>
  loadList: () => Promise<void>
  setInclude: (key: 'twitch' | 'youtube', v: boolean) => void
  addCustom: (platform: IngestPlatform, host: string, port: number, label: string) => void
  removeCustom: (id: string) => void
  runTest: () => Promise<void>
  obsDirect: () => Promise<void>
}

export const useStreamerStore = create<StreamerStore>((set, get) => ({
  state: null,
  list: null,
  listLoading: false,
  custom: [],
  include: { twitch: true, youtube: true },
  results: {},
  progress: null,
  running: false,
  direct: null,
  obsBusy: false,

  setState: (s) => {
    set({ state: s })
    applyStreamerClasses(s)
  },

  patchSettings: async (patch) => {
    try {
      const s = await streamerSetSettings(patch)
      get().setState(s)
    } catch (e) {
      toast.error(msg(e))
    }
  },

  loadList: async () => {
    if (get().listLoading) return
    set({ listLoading: true })
    try {
      set({ list: await streamerIngestList() })
    } catch (e) {
      toast.error(msg(e))
    } finally {
      set({ listLoading: false })
    }
  },

  setInclude: (key, v) => set((s) => ({ include: { ...s.include, [key]: v } })),

  addCustom: (platform, host, port, label) =>
    set((s) => {
      const id = `custom:${host}:${port}`
      if (s.custom.some((c) => c.id === id)) return s
      return { custom: [...s.custom, { id, platform, name: label, host, port }] }
    }),

  removeCustom: (id) => set((s) => ({ custom: s.custom.filter((c) => c.id !== id) })),

  runTest: async () => {
    const { list, include, custom } = get()
    const servers = [
      ...(list?.servers ?? []).filter((x) => (x.platform === 'twitch' ? include.twitch : x.platform === 'youtube' ? include.youtube : false)),
      ...custom
    ]
    if (servers.length === 0) {
      toast.error('Нет серверов для проверки')
      return
    }
    set({ running: true, results: {}, progress: { done: 0, total: servers.length } })
    try {
      const run = await streamerIngestTest(servers)
      const map: Record<string, IngestResult> = {}
      for (const r of run.results) map[r.id] = r
      set({ results: map, direct: run.direct })
    } catch (e) {
      toast.error(msg(e))
    } finally {
      set({ running: false, progress: null })
    }
  },

  obsDirect: async () => {
    set({ obsBusy: true })
    try {
      const r = await streamerObsDirect()
      toast.success(r.message)
    } catch (e) {
      toast.error(msg(e))
    } finally {
      set({ obsBusy: false })
    }
  }
}))

let attachedStop: (() => void) | null = null

/**
 * Режим стримера в окне: берёт состояние из main и держит классы на <html>.
 * Вызовите один раз при старте приложения (App.tsx). Возвращает функцию отписки.
 */
export function initStreamerMode(): () => void {
  if (attachedStop) return attachedStop
  const st = useStreamerStore
  const offState = onStreamer('streamer:state', (s) => st.getState().setState(s))
  const offProgress = onStreamer('streamer:ingestProgress', (p) =>
    st.setState((s) => (s.running ? { results: { ...s.results, [p.result.id]: p.result }, progress: { done: p.done, total: p.total } } : s))
  )
  streamerGetState()
    .then((s) => st.getState().setState(s))
    .catch(() => undefined)
  attachedStop = () => {
    offState()
    offProgress()
    attachedStop = null
  }
  return attachedStop
}
