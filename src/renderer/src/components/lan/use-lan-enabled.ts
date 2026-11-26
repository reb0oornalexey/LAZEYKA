import { useEffect, useState } from 'react'
import { lanGetState, onLanState } from '@renderer/utils/lan-api'

/**
 * Включён ли раздел «Локальная сеть» — для точки в левом меню.
 * Один запрос при появлении меню, дальше — только событие lan:state (main шлёт его при каждом включении,
 * выключении и перезапуске раздела). Своего таймера нет.
 */
export function useLanEnabled(): boolean {
  const [on, setOn] = useState(false)
  useEffect(() => {
    let alive = true
    lanGetState()
      .then((s) => alive && setOn(s.enabled))
      .catch(() => void 0)
    const off = onLanState((s) => {
      if (alive) setOn(s.enabled)
    })
    return () => {
      alive = false
      off()
    }
  }, [])
  return on
}
