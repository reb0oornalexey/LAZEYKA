/**
 * Действия сценариев из версии 1.3.0: режим стримера, мини-окно, раздача в локальной сети,
 * сессия «Перед каткой», статус в Discord. Чистая логика без Electron.
 * Старые сценарии этих полей не имеют: отсутствие поля читается как «не трогать».
 */

/** «Не трогать» хранится как отсутствие поля. */
export type ExtraToggle = 'on' | 'off'
export type StreamerAction = 'on' | 'off' | 'auto'
export type MiniAction = 'panel' | 'indicator' | 'hide'

export interface ScenarioExtra {
  /** Режим стримера: включить, выключить или авто (по запущенной программе для стримов). */
  streamer?: StreamerAction
  /** Мини-окно: панель, индикатор или скрыть. */
  mini?: MiniAction
  /** Раздача в локальной сети (раздел «Локальная сеть»). */
  lan?: ExtraToggle
  /** Сессия «Перед каткой»: нужна заданная цель, иначе шаг пропускается. */
  prematch?: ExtraToggle
  /** Статус в Discord. */
  discord?: ExtraToggle
}

export const EXTRA_KEYS = ['streamer', 'mini', 'lan', 'prematch', 'discord'] as const

const TOGGLE: readonly string[] = ['keep', 'on', 'off']
const STREAMER: readonly string[] = ['keep', 'on', 'off', 'auto']
const MINI: readonly string[] = ['keep', 'panel', 'indicator', 'hide']

/** Приводит значения к допустимым. Незнакомое или пустое — «не трогать» (поле не записывается). */
export function normalizeExtra(raw: unknown): ScenarioExtra {
  const r = (raw ?? {}) as Record<string, unknown>
  const out: ScenarioExtra = {}
  if (typeof r.streamer === 'string' && STREAMER.includes(r.streamer) && r.streamer !== 'keep') out.streamer = r.streamer as StreamerAction
  if (typeof r.mini === 'string' && MINI.includes(r.mini) && r.mini !== 'keep') out.mini = r.mini as MiniAction
  for (const k of ['lan', 'prematch', 'discord'] as const) {
    const v = r[k]
    if (typeof v === 'string' && TOGGLE.includes(v) && v !== 'keep') out[k] = v as ExtraToggle
  }
  return out
}

/** Что сценарий хочет изменить из нового: список для проверок и вывода. */
export function extraWants(s: ScenarioExtra): { key: (typeof EXTRA_KEYS)[number]; value: string }[] {
  const n = normalizeExtra(s)
  return EXTRA_KEYS.filter((k) => n[k] !== undefined).map((k) => ({ key: k, value: String(n[k]) }))
}

/** Для шага «Перед каткой»: что делать при текущем состоянии. */
export function prematchPlan(want: ExtraToggle, hasSession: boolean, target: string): 'start' | 'stop' | 'already-on' | 'already-off' | 'skip-no-target' {
  if (want === 'off') return hasSession ? 'stop' : 'already-off'
  if (hasSession) return 'already-on'
  return target.trim() ? 'start' : 'skip-no-target'
}

/**
 * Порядок шагов сценария (2.0). Ключи действий в порядке выполнения по умолчанию — так было до 2.0.
 * Сценарий может хранить свой порядок (`order`), его задают перетаскиванием в конструкторе.
 */
export const STEP_KEYS = ['dns', 'zapret', 'exitlag', 'incy', 'tgws', 'streamer', 'mini', 'lan', 'discord', 'prematch'] as const
export type StepKey = (typeof STEP_KEYS)[number]

/** Свой порядок из сохранённого сценария: только знакомые ключи, без повторов. Пусто/ошибка — нет порядка. */
export function normalizeOrder(raw: unknown): StepKey[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: StepKey[] = []
  for (const k of raw) {
    if (typeof k === 'string' && (STEP_KEYS as readonly string[]).includes(k) && !out.includes(k as StepKey)) out.push(k as StepKey)
  }
  return out.length ? out : undefined
}

/** Все ключи в порядке выполнения: сначала свой порядок, затем остальные — в порядке по умолчанию. */
export function orderedStepKeys(order: unknown): StepKey[] {
  const own = normalizeOrder(order) ?? []
  return [...own, ...STEP_KEYS.filter((k) => !own.includes(k))]
}
