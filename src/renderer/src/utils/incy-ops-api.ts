/**
 * Общий менеджер «Проверить пинг» / «Обновить подписки» (каналы incy:ops*, src/main/core/incy-ops-ipc.ts).
 * Одно действие на всё приложение: его же видит и может остановить пульт с телефона.
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

export type OpKind = 'ping' | 'refresh'

export type OpScope =
  | { type: 'all' }
  | { type: 'sub'; subId: string | null }
  | { type: 'ids'; ids: string[]; label?: string }

export interface OpView {
  kind: OpKind
  source: 'app' | 'remote'
  scope: OpScope['type']
  subId?: string | null
  scopeLabel: string
  running: boolean
  stopping?: boolean
  stopped?: boolean
  done: number
  total: number
  ok?: boolean
  text?: string
  seq: number
  startedAt: number
  finishedAt?: number
}

export interface OpSnapshot {
  view: OpView | null
  targetIds: string[]
  results: Record<string, { latencyMs: number | null; at: number }>
}

export interface OpStartResult {
  ok: boolean
  joined?: boolean
  code?: string
  message?: string
  view: OpView | null
}

export const opsGet = (): Promise<OpSnapshot> => invoke('incy:opsGet')
export const opsStart = (kind: OpKind, scope: OpScope): Promise<OpStartResult> => invoke('incy:opsStart', kind, scope)
export const opsStop = (): Promise<{ ok: boolean; view: OpView | null }> => invoke('incy:opsStop')

/** Подписка на ход действия. Возвращает отписку. */
export function onOpsUpdate(fn: (snap: OpSnapshot) => void): () => void {
  return window.electron.ipcRenderer.on('incy:opsUpdate', (_e, snap) => fn(snap as OpSnapshot))
}
