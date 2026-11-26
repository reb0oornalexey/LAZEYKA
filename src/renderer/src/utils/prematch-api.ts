/**
 * «Перед каткой»: типы и вызовы IPC. Типы повторяют те, что отдаёт
 * src/main/core/prematch.ts (renderer не импортирует код main).
 */

interface IpcResult<T> {
  ok: boolean
  value?: T
  message?: string
}

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const res = (await window.electron.ipcRenderer.invoke(channel, ...args)) as IpcResult<T>
  if (!res || !res.ok) {
    throw new Error(res?.message ?? `IPC ${channel} failed`)
  }
  return res.value as T
}

// ---- типы ---------------------------------------------------------------------

export type PrematchMethod = 'icmp' | 'a2s'
export type VerdictKind = 'good' | 'warn' | 'bad' | 'unknown'
export type Severity = 'bad' | 'warn' | 'info' | 'ok'

export interface LagSettings {
  enabled: boolean
  spikeMs: number
  lossStreak: number
  cooldownSec: number
  sound: boolean
  notify: boolean
}

export interface PrematchSettings {
  lastTarget: string
  checkLoad: boolean
  lag: LagSettings
}

export interface SeriesStats {
  sent: number
  received: number
  lossPct: number
  avgMs: number | null
  minMs: number | null
  maxMs: number | null
  medianMs: number | null
  jitterMs: number | null
}

export interface SessionStats extends SeriesStats {
  spikes: number
  lossBursts: number
}

export interface Issue {
  id: string
  severity: Severity
  title: string
  advice: string
  short?: string
}

export interface Verdict {
  kind: VerdictKind
  headline: string
  issues: Issue[]
}

export interface WifiInfo {
  ifaceName: string | null
  signalPct: number | null
  rssiDbm: number | null
  band: '2.4' | '5' | '6' | null
  channel: number | null
  phy: string | null
}

export interface LinkInfo {
  type: 'wired' | 'wifi' | 'wifi-unknown' | 'unknown'
  ifaceName: string | null
  wifi: WifiInfo | null
}

export interface CheckResult {
  at: number
  target: {
    label: string
    ip: string
    port: number
    method: PrematchMethod | null
    stats: SeriesStats | null
    route: string
  }
  gateway: { ip: string | null; stats: SeriesStats | null }
  link: LinkInfo
  load: {
    grade: string
    idleMs: number | null
    loadedMs: number | null
    increaseMs: number | null
    lossPct: number
    downloadMbps: number | null
    verdict: string
  } | null
  viaPhysical: boolean
  verdict: Verdict
}

export type CheckStep = 'link' | 'gateway' | 'target' | 'load'

export interface CheckProgress {
  step: CheckStep
  state: 'run' | 'done' | 'skip' | 'fail'
  detail?: string
}

export interface SessionState {
  id: string
  label: string
  ip: string
  port: number
  method: PrematchMethod
  startedAt: number
  gapMs: number
  intervalMs: number
  maxMs: number
  samples: (number | null)[]
  baselineMs: number | null
  lagAlerts: number
}

export interface MatchReport {
  id: string
  startedAt: number
  endedAt: number
  durationMs: number
  endedBy: 'user' | 'timeout' | 'quit'
  target: { label: string; ip: string; port: number }
  method: PrematchMethod
  stats: SessionStats
  baselineMs: number | null
  lagAlerts: number
  verdict: { kind: VerdictKind; text: string }
  series: (number | null)[]
  seriesMax: (number | null)[]
  seriesLost: number[]
  perPoint: number
}

export interface RegionEntry {
  id: string
  name: string
  ip: string
  preferred: boolean
}

export interface PrematchState {
  session: SessionState | null
  checking: boolean
  lastCheck: CheckResult | null
}

export interface LagEventPayload {
  kind: 'spike' | 'loss'
  at: number
  rttMs: number | null
  baselineMs: number | null
  lostInRow: number
  message: string
  sessionId: string
  sound: boolean
  notify: boolean
}

export interface NatResult {
  type: 'open' | 'moderate' | 'strict' | 'blocked' | 'unknown'
  title: string
  summary: string
  forGames: string
  forVoice: string
  advice: string[]
  externalIp: string | null
  mappings: { server: string; ip: string; port: number }[]
  queried: number
  replied: number
  viaPhysical: boolean
}

/**
 * Датацентры Faceit. В коде проекта списка адресов нет, поэтому пока пусто:
 * когда появятся проверенные IP, добавьте их сюда ({ id, name, ip }) — группа
 * «Faceit» на странице появится сама.
 */
export const FACEIT_DATACENTERS: { id: string; name: string; ip: string }[] = []

// ---- вызовы -------------------------------------------------------------------

export const prematchCheck = (target: string, opts: { load: boolean }): Promise<CheckResult> =>
  invoke('prematch:check', target, opts)
export const prematchStart = (target: string): Promise<SessionState> => invoke('prematch:start', target)
export const prematchStop = (): Promise<MatchReport | null> => invoke('prematch:stop')
export const prematchState = (): Promise<PrematchState> => invoke('prematch:state')
export const prematchGetSettings = (): Promise<PrematchSettings> => invoke('prematch:getSettings')
export const prematchSetSettings = (patch: {
  lastTarget?: string
  checkLoad?: boolean
  lag?: Partial<LagSettings>
}): Promise<PrematchSettings> => invoke('prematch:setSettings', patch)
export const prematchHistory = (): Promise<MatchReport[]> => invoke('prematch:history')
export const prematchDeleteReport = (id: string): Promise<MatchReport[]> => invoke('prematch:deleteReport', id)
export const prematchSaveImage = (dataUrl: string, name: string): Promise<{ saved: boolean; path?: string }> =>
  invoke('prematch:saveImage', dataUrl, name)
export const prematchCopyImage = (dataUrl: string): Promise<void> => invoke('prematch:copyImage', dataUrl)
export const prematchNat = (): Promise<NatResult> => invoke('prematch:nat')
export const prematchRegions = (): Promise<RegionEntry[]> => invoke('prematch:regions')

// ---- события ------------------------------------------------------------------

export interface PrematchEvents {
  'prematch:progress': CheckProgress
  'prematch:sample': { sessionId: string; seq: number; rtt: number | null }
  'prematch:lag': LagEventPayload
  'prematch:ended': { sessionId: string; reason: 'user' | 'timeout' | 'quit'; report: MatchReport | null }
}

/** Подписка на событие main; возвращает функцию отписки. */
export function onPrematch<K extends keyof PrematchEvents>(channel: K, cb: (payload: PrematchEvents[K]) => void): () => void {
  const listener = (_e: unknown, payload: PrematchEvents[K]): void => cb(payload)
  const offIpc = window.electron.ipcRenderer.on(channel, listener)
  return () => {
    offIpc()
  }
}
