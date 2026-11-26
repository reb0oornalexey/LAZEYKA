import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

/*
 * Е6: «Открывать при запуске: Главная / последний раздел».
 *
 * Последний открытый раздел запоминается в localStorage этого окна (без
 * запросов в main). При запуске, если выбрано «последний раздел», окно один
 * раз переходит туда с Главной. Раздел автора (/admin) не запоминается —
 * вместо него откроется Главная. Перезагрузка окна (импорт профиля) переход
 * не повторяет: адрес раздела и так сохраняется.
 */

const KEY = 'lazeyka.lastRoute'
const DONE_KEY = 'lazeyka.startRouteDone'

/** Разделы, которые можно открыть при запуске. */
export const START_ROUTES = new Set([
  '/home',
  '/telegram',
  '/zapret',
  '/dns',
  '/scenarios',
  '/incy',
  '/exitlag',
  '/optimizer',
  '/prematch',
  '/tweaks',
  '/streamer',
  '/lan',
  '/diagnostics',
  '/logs',
  '/settings',
  '/appearance',
  '/about',
  '/support'
])

function read(key: string, store: Storage | undefined): string | null {
  try {
    return store?.getItem(key) ?? null
  } catch {
    return null
  }
}

// Читаем до первого сохранения: окно стартует на Главной и сразу её запомнит.
const savedAtLoad = typeof window !== 'undefined' ? read(KEY, window.localStorage) : null
let done = typeof window !== 'undefined' && read(DONE_KEY, window.sessionStorage) === '1'

export function useStartRoute(startPage: 'home' | 'last' | undefined, ready: boolean): void {
  const { pathname } = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    if (!START_ROUTES.has(pathname)) return
    try {
      localStorage.setItem(KEY, pathname)
    } catch {
      /* не запомнится — не страшно */
    }
  }, [pathname])

  useEffect(() => {
    if (!ready || done) return
    done = true
    try {
      sessionStorage.setItem(DONE_KEY, '1')
    } catch {
      /* noop */
    }
    if (startPage !== 'last') return
    // Окно уже открыто на другом разделе (ссылка, горячая клавиша) — не мешаем.
    if (pathname !== '/home' && pathname !== '/') return
    if (savedAtLoad && savedAtLoad !== '/home' && START_ROUTES.has(savedAtLoad)) navigate(savedAtLoad, { replace: true })
  }, [ready, startPage, navigate, pathname])
}
