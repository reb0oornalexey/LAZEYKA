import { useSyncExternalStore } from 'react'
import { useAppearanceStore } from './store'
import { ADVANCED_PAIRS, failingMap, type Failing } from './contrast-state'
import { CONTRAST_PAIRS, type ContrastPair } from './contrast'

type Data = { byKey: Map<string, Failing>; total: number; list: Failing[] }

/**
 * Проверка читаемости вне React: пересчитывается не чаще, чем раз в ~150 мс после изменений,
 * и только пока есть подписчики (вкладка «Цвета» или «Тонкая настройка» открыта).
 * Два независимых набора: основные цвета и цвета отдельных элементов.
 */
function createWatch(pairs: ContrastPair[]): {
  subscribe: (cb: () => void) => () => void
  get: () => Data
} {
  const listeners = new Set<() => void>()
  let data: Data = { byKey: new Map(), total: 0, list: [] }
  let timer: ReturnType<typeof setTimeout> | null = null
  let unsub: (() => void) | null = null

  const recompute = (): void => {
    timer = null
    const next = failingMap(useAppearanceStore.getState(), pairs)
    // Сохраняем прежние объекты, если ничего не изменилось: строки не перерисовываются зря.
    for (const [k, v] of next.byKey) {
      const old = data.byKey.get(k)
      if (old && old.pair === v.pair && old.ratio.toFixed(1) === v.ratio.toFixed(1)) next.byKey.set(k, old)
    }
    const same =
      next.total === data.total &&
      next.byKey.size === data.byKey.size &&
      [...next.byKey].every(([k, v]) => data.byKey.get(k) === v) &&
      next.list.every((f, i) => data.list[i]?.pair === f.pair)
    if (same) return
    data = next
    listeners.forEach((l) => l())
  }

  const schedule = (): void => {
    if (!timer) timer = setTimeout(recompute, 150)
  }

  const subscribe = (cb: () => void): (() => void) => {
    listeners.add(cb)
    if (listeners.size === 1) {
      unsub = useAppearanceStore.subscribe((s, p) => {
        if (s.tokens !== p.tokens || s.presetId !== p.presetId || s.mode !== p.mode || s.settings !== p.settings || s.custom !== p.custom || s.tick !== p.tick) schedule()
      })
      recompute()
    }
    return () => {
      listeners.delete(cb)
      if (listeners.size === 0) {
        unsub?.()
        unsub = null
        if (timer) clearTimeout(timer)
        timer = null
      }
    }
  }
  return { subscribe, get: () => data }
}

const basic = createWatch(CONTRAST_PAIRS)
const advanced = createWatch(ADVANCED_PAIRS)
const pick = (adv?: boolean): ReturnType<typeof createWatch> => (adv ? advanced : basic)

export const useContrastIssues = (adv?: boolean): Data => {
  const w = pick(adv)
  return useSyncExternalStore(w.subscribe, w.get)
}

export const useIssue = (key: string, adv?: boolean): Failing | undefined => {
  const w = pick(adv)
  return useSyncExternalStore(w.subscribe, () => w.get().byKey.get(key))
}

export const useIssueTotal = (adv?: boolean): number => {
  const w = pick(adv)
  return useSyncExternalStore(w.subscribe, () => w.get().total)
}
