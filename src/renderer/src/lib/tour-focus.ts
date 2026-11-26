/**
 * Переключение внутренних вкладок страниц по запросу экскурсии.
 *
 * Экскурсия вызывает requestTourFocus({ route, tab }). Если страница уже открыта,
 * её хук useTourTab получает событие и переключает вкладку. Если страница ещё не
 * смонтирована, запрос ждёт её появления и применяется при монтировании.
 */
import { useEffect, useRef } from 'react'

const FOCUS_EVENT = 'lazeyka:tour-focus'

interface FocusRequest {
  route: string
  tab?: string
}

let pending: FocusRequest | null = null

/** Попросить страницу `route` открыть вкладку `tab`. Без `tab` просто сбрасывает прежний запрос. */
export function requestTourFocus(req: FocusRequest): void {
  pending = req.tab ? req : null
  if (req.tab) window.dispatchEvent(new CustomEvent<FocusRequest>(FOCUS_EVENT, { detail: req }))
}

/** Забыть отложенный запрос (экскурсия закрыта). */
export function clearTourFocus(): void {
  pending = null
}

/** Страница с вкладками вызывает хук один раз: `useTourTab('/incy', setActiveTab)`. */
export function useTourTab<T extends string>(route: string, setTab: (tab: T) => void): void {
  const ref = useRef(setTab)
  useEffect(() => {
    ref.current = setTab
  }, [setTab])

  useEffect(() => {
    if (pending && pending.route === route && pending.tab) {
      const tab = pending.tab as T
      pending = null
      ref.current(tab)
    }
    const onFocus = (e: Event): void => {
      const d = (e as CustomEvent<FocusRequest>).detail
      if (d?.route !== route || !d.tab) return
      pending = null
      ref.current(d.tab as T)
    }
    window.addEventListener(FOCUS_EVENT, onFocus)
    return () => window.removeEventListener(FOCUS_EVENT, onFocus)
  }, [route])
}
