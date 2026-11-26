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

/** Что известно о встроенной записи: откуда она и чем отличается от правки пользователя. */
export interface BuiltinMeta {
  builtin: boolean
  fromCatalog: boolean
  edited: boolean
  /** Дата смены адресов по каталогу (YYYY-MM-DD). */
  catalogUpdated?: string
  /** Значения без правок пользователя. */
  original: { ipv4: string[]; ipv6: string[]; doh: string; dohOnly: boolean }
}

export interface StaleInfo {
  id: string
  name: string
  reason: 'catalog' | 'edited'
}

export interface HealthResult {
  id: string
  name: string
  ok: boolean
  ms: number | null
  checkedAt: number
}

/** Запись, убранная автором программы у всех. */
export interface RemovedInfo {
  id: string
  name: string
  reason: string
  at?: string
  builtin: boolean
}

export interface CatalogStatus {
  fetchedAt: number | null
  catalogUpdated: string | null
  catalogVersion: number | null
  source: string | null
  meta: Record<string, BuiltinMeta>
  stale: StaleInfo | null
  health: HealthResult | null
  /** Убраны автором (в списке не показываются). Старый main не присылает — пусто. */
  removed?: RemovedInfo[]
  /** Включённый сейчас DNS убран автором. */
  removedActive?: RemovedInfo | null
  /** Скрыты пользователем только у себя. */
  hidden?: string[]
}

export interface CatalogRefreshResult {
  outcome: 'updated' | 'same' | 'fresh' | 'older' | 'failed'
  changedNames: string[]
  error?: string
  status: CatalogStatus
}

export interface BuiltinOverrideInput {
  ipv4: string[]
  ipv6?: string[]
  doh?: string
  allowFallback?: boolean
}

export const dnsCatalogStatus = (): Promise<CatalogStatus> => invoke('dnsCatalog:status')
/** Скачать каталог встроенных DNS сейчас (кнопка «Обновить список»). */
export const dnsCatalogRefresh = (): Promise<CatalogRefreshResult> => invoke('dnsCatalog:refresh', true)
/** Проверить, отвечает ли включённый DNS (два замера с паузой). null — встроенный DNS не включён. */
export const dnsCatalogHealth = (): Promise<HealthResult | null> => invoke('dnsCatalog:health')
export const dnsCatalogSaveOverride = (id: string, input: BuiltinOverrideInput): Promise<CatalogStatus> =>
  invoke('dnsCatalog:saveOverride', id, input)
export const dnsCatalogRevert = (id: string): Promise<CatalogStatus> => invoke('dnsCatalog:revert', id)
/** Скрыть встроенную запись только у себя (hidden=false — показать снова). Без сети. */
export const dnsCatalogHide = (id: string, hidden: boolean): Promise<CatalogStatus> => invoke('dnsCatalog:hide', id, hidden)

/** Подписка на «каталог обновился» (приходит из main, например после проверки при запуске). */
export function onDnsCatalogChanged(cb: () => void): () => void {
  const listener = (): void => cb()
  const offIpc = window.electron.ipcRenderer.on('dnsCatalog:changed', listener)
  return () => {
    offIpc()
  }
}
