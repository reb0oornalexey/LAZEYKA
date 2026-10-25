import { useSyncExternalStore } from 'react'
import { useAppearanceStore } from './store'
import { failingMap, type Failing } from './contrast-state'

/**
 * Проверка читаемости вне React: пересчитывается не чаще, чем раз в ~150 мс после изменений,
 * и только пока есть подписчики (вкладка «Цвета» открыта).
 */
const listeners = new Set<() => void>()
let data: { byKey: Map<string, Failing>; total: number } = { byKey: new Map(), total: 0 }
let timer: ReturnType<typeof setTimeout> | null = null
let unsub: (() => void) | null = null

function recompute(): void {
  timer = null
  const next = failingMap(useAppearanceStore.getState())
  // Сохраняем прежние объекты, если ничего не изменилось: строки не перерисовываются зря.
  for (const [k, v] of next.byKey) {
    const old = data.byKey.get(k)
    if (old && old.pair === v.pair && old.ratio.toFixed(1) === v.ratio.toFixed(1)) next.byKey.set(k, old)
  }
  const same = next.total === data.total && next.byKey.size === data.byKey.size && [...next.byKey].every(([k, v]) => data.byKey.get(k) === v)
  if (same) return
  data = next
  listeners.forEach((l) => l())
}

function schedule(): void {
  if (!timer) timer = setTimeout(recompute, 150)
}

function subscribe(cb: () => void): () => void {
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

export const useContrastIssues = (): typeof data => useSyncExternalStore(subscribe, () => data)

export const useIssue = (key: string): Failing | undefined =>
  useSyncExternalStore(subscribe, () => data.byKey.get(key))

export const useIssueTotal = (): number => useSyncExternalStore(subscribe, () => data.total)
