/**
 * Свои стратегии Zapret, конструктор, проверка и автоподбор (main: core/zapret-lab.ts).
 * Типы повторяют main/core/zapret-model.ts и zapret-probe.ts.
 */
interface IpcResult<T> {
  ok: boolean
  value?: T
  message?: string
}

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const res = (await window.electron.ipcRenderer.invoke(channel, ...args)) as IpcResult<T>
  if (!res || !res.ok) throw new Error(res?.message ?? `IPC ${channel} failed`)
  return res.value as T
}

export type FamilyId =
  | 'fakedsplit'
  | 'multisplit-seqovl'
  | 'fake-hostfakesplit'
  | 'fake-multisplit-badseq'
  | 'syndata'
  | 'fake-badseq'
  | 'fake-ts'
  | 'fake-multisplit-seqovl'
  | 'fake-multidisorder'
  | 'hostfakesplit'

export type Fooling = 'ts' | 'badseq' | 'md5sig'

export interface TcpParams {
  repeats: number
  fooling: Fooling[]
  badseqIncrement: number
  seqovl: number
  splitPos: string
  seqovlPattern: string
  fakeTls: string[]
  tlsMod: '' | 'none' | 'rnd'
  tlsSni: string
  fakeHttp: string
  host: string
  altorder: boolean
}

export type TcpField = keyof TcpParams

export interface StrategyModel {
  v: 1
  family: FamilyId
  tcp: TcpParams
  quic: { enabled: boolean; repeats: number; fake: string }
  discordVoice: boolean
  cloudflare: boolean
  game: boolean
}

export interface FamilySpec {
  id: FamilyId
  desync: string
  title: string
  what: string
  helps: string
  reference: string
  uses: TcpField[]
  preset: TcpParams
}

export interface LabLimits {
  repeats: { min: number; max: number }
  seqovl: { min: number; max: number }
  badseqIncrement: { min: number; max: number }
  quicRepeats: { min: number; max: number }
}

export interface CustomStrategy {
  id: string
  name: string
  file: string
  model: StrategyModel
  origin: 'manual' | 'autopick' | 'import'
  basedOn?: string
  createdAt: number
  updatedAt: number
}

export interface TargetScore {
  id: string
  label: string
  tls12: boolean
  tls13: boolean
  stallOk: boolean | null
  ok: boolean
}

export interface EvalResult {
  targets: TargetScore[]
  okChecks: number
  totalChecks: number
  score: number
  allOpen: boolean
}

export interface CheckReport {
  result: EvalResult
  launchError?: string
  ms: number
}

export type Verdict = 'ok' | 'sni' | 'stall' | 'ip' | 'dns' | 'cert' | 'fakeip' | 'other'

export interface AutopickState {
  phase: 'idle' | 'diagnose' | 'families' | 'refine' | 'done' | 'error' | 'stopped'
  startedAt?: number
  finishedAt?: number
  step: number
  totalSteps: number
  current?: string
  diag?: { id: string; label: string; verdict: Verdict; text: string }[]
  problem?: { sni: boolean; stall: boolean; unfixable: Verdict[] }
  tries: { label: string; family: FamilyId; score: number; allOpen: boolean; okChecks: number; totalChecks: number; error?: string }[]
  outcome?: 'found' | 'partial' | 'not-needed' | 'unfixable' | 'nothing'
  model?: StrategyModel
  modelLabel?: string
  why?: string
  result?: EvalResult
  suggestedName?: string
  message?: string
}

export const labFamilies = (): Promise<{ families: FamilySpec[]; limits: LabLimits; defaults: StrategyModel }> => invoke('zapretlab:families')
export const labBinFiles = (): Promise<{ tls: string[]; quic: string[]; all: string[] }> => invoke('zapretlab:binFiles')
export const labList = (): Promise<CustomStrategy[]> => invoke('zapretlab:list')
export const labSave = (input: { id?: string; name: string; model: StrategyModel; origin?: CustomStrategy['origin']; basedOn?: string }): Promise<CustomStrategy> =>
  invoke('zapretlab:save', input)
export const labDelete = (id: string): Promise<void> => invoke('zapretlab:delete', id)
export const labExport = (id: string): Promise<string> => invoke('zapretlab:export', id)
export const labImport = (text: string): Promise<CustomStrategy> => invoke('zapretlab:import', text)
export const labPreview = (model: StrategyModel, name: string): Promise<{ command: string; bat: string; model: StrategyModel }> =>
  invoke('zapretlab:preview', model, name)
export const labFromStrategy = (file: string): Promise<{ model: StrategyModel; approximate: boolean; title: string }> =>
  invoke('zapretlab:fromStrategy', file)
export const labCheck = (model: StrategyModel): Promise<CheckReport> => invoke('zapretlab:check', model)
export const labStopCheck = (): Promise<boolean> => invoke('zapretlab:stopCheck')
export const labAutopickStart = (): Promise<AutopickState> => invoke('zapretlab:autopickStart')
export const labAutopickStop = (): Promise<boolean> => invoke('zapretlab:autopickStop')
export const labAutopickState = (): Promise<AutopickState> => invoke('zapretlab:autopickState')
export const labActivate = (file: string): Promise<void> => invoke('zapretlab:activate', file)

export const isAutopickRunning = (s: AutopickState | null): boolean =>
  !!s && (s.phase === 'diagnose' || s.phase === 'families' || s.phase === 'refine')
