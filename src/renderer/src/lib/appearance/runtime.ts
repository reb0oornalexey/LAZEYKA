import { useAppearanceStore, resolveState, snapshotOf } from './store'
import { liveVars, varsToCss } from './resolve'
import { applyResolved, writeBootCache, writeLiveCss } from './apply'
import { appearanceSave } from '@renderer/utils/ipc'

const SAVE_DEBOUNCE_MS = 500

let started = false
let raf = 0
let saveTimer: ReturnType<typeof setTimeout> | null = null

let live: Record<string, string> = {}
let liveRaf = 0

function persistable(): AppearanceConfig {
  const s = useAppearanceStore.getState()
  return {
    version: 1,
    presetId: s.presetId,
    mode: s.mode,
    tokens: s.tokens,
    settings: s.settings,
    custom: s.custom,
    recentColors: s.recentColors,
    system: s.system
  }
}

function applyNow(): void {
  raf = 0
  const s = useAppearanceStore.getState()
  applyResolved(resolveState(s))
  clearLive()
  s.bump()
}

/**
 * «Живое» изменение цвета во время перетаскивания. Пишется ТОЛЬКО в маленький
 * отдельный <style> (выбранный цвет и его производные), раз в кадр. Хранилище и
 * React не трогаются — итог попадает в них по отпусканию (setToken).
 */
export function liveSetToken(key: string, value: string): void {
  const s = useAppearanceStore.getState()
  Object.assign(live, liveVars(key, value, snapshotOf(s), s.custom, s.system.accent ? s.systemAccent : null))
  if (!liveRaf) {
    liveRaf = requestAnimationFrame(() => {
      liveRaf = 0
      writeLiveCss(varsToCss(':root', live))
    })
  }
}

export function clearLive(): void {
  live = {}
  if (liveRaf) {
    cancelAnimationFrame(liveRaf)
    liveRaf = 0
  }
  writeLiveCss('')
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(flushAppearanceSave, SAVE_DEBOUNCE_MS)
}

/**
 * Подписка на хранилище: применяет оформление к документу (не чаще раза за кадр)
 * и сохраняет в конфиг с задержкой. Постоянных таймеров нет: всё срабатывает
 * только в ответ на действие пользователя.
 */
export function startAppearanceRuntime(): void {
  if (started) return
  started = true
  useAppearanceStore.subscribe((s, prev) => {
    if (!s.loaded) return
    const first = !prev.loaded
    const visual =
      first ||
      s.presetId !== prev.presetId ||
      s.mode !== prev.mode ||
      s.tokens !== prev.tokens ||
      s.settings !== prev.settings ||
      s.custom !== prev.custom ||
      s.system !== prev.system ||
      s.systemAccent !== prev.systemAccent
    if (visual && !raf) raf = requestAnimationFrame(applyNow)
    if (first) {
      writeBootCache(resolveState(s))
      return
    }
    const persisted =
      s.presetId !== prev.presetId ||
      s.mode !== prev.mode ||
      s.tokens !== prev.tokens ||
      s.settings !== prev.settings ||
      s.custom !== prev.custom ||
      s.recentColors !== prev.recentColors ||
      s.system !== prev.system
    if (persisted) scheduleSave()
  })
}

/** Сохранить немедленно (например, при уходе со страницы). */
export function flushAppearanceSave(): void {
  if (!saveTimer) return
  clearTimeout(saveTimer)
  saveTimer = null
  const st = useAppearanceStore.getState()
  writeBootCache(resolveState(st))
  void appearanceSave(persistable()).catch(() => undefined)
}
