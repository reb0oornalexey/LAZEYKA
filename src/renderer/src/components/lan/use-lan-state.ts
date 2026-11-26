import { useCallback, useEffect, useRef, useState } from 'react'
import { lanGetState, onLanState, type LanState } from '@renderer/utils/lan-api'

/**
 * Состояние раздела «Локальная сеть». Счётчики прокси обновляются опросом раз в 3 секунды,
 * только пока раздел включён, страница открыта и окно видно; остальное приходит событием lan:state.
 */
export function useLanState(): { state: LanState | null; reload: () => Promise<void>; setState: (s: LanState) => void; loadError: string | null } {
  const [state, setState] = useState<LanState | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const alive = useRef(true)

  const reload = useCallback(async () => {
    try {
      const s = await lanGetState()
      if (alive.current) {
        setState(s)
        setLoadError(null)
      }
    } catch (e) {
      if (alive.current) setLoadError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    alive.current = true
    void reload()
    const off = onLanState((s) => alive.current && setState(s))
    return () => {
      alive.current = false
      off()
    }
  }, [reload])

  const enabled = state?.enabled ?? false
  useEffect(() => {
    if (!enabled) return
    let timer: ReturnType<typeof setInterval> | null = null
    const start = (): void => {
      if (timer) clearInterval(timer)
      timer = setInterval(() => void reload(), 3000)
    }
    const stop = (): void => {
      if (timer) clearInterval(timer)
      timer = null
    }
    const onVis = (): void => (document.visibilityState === 'visible' ? start() : stop())
    if (document.visibilityState === 'visible') start()
    document.addEventListener('visibilitychange', onVis)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [enabled, reload])

  return { state, reload, setState, loadError }
}
