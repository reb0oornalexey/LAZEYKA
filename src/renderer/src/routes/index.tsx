import { lazy, Suspense, useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import Home from '@renderer/pages/home'
import { linuxUnavailableRoutes, platform } from '@renderer/utils/init'

// Главная грузится сразу, остальные разделы — отдельными файлами при первом
// открытии (после этого они уже в памяти и открываются без задержки).
const Telegram = lazy(() => import('@renderer/pages/telegram'))
const Zapret = lazy(() => import('@renderer/pages/zapret'))
const Incy = lazy(() => import('@renderer/pages/incy'))
const ExitLag = lazy(() => import('@renderer/pages/exitlag'))
const Optimizer = lazy(() => import('@renderer/pages/optimizer'))
const Logs = lazy(() => import('@renderer/pages/logs'))
const Settings = lazy(() => import('@renderer/pages/settings'))
const About = lazy(() => import('@renderer/pages/about'))
const Support = lazy(() => import('@renderer/pages/support'))
const Dns = lazy(() => import('@renderer/pages/dns'))
const Scenarios = lazy(() => import('@renderer/pages/scenarios'))
const Appearance = lazy(() => import('@renderer/pages/appearance'))
const Prematch = lazy(() => import('@renderer/pages/prematch'))
const Tweaks = lazy(() => import('@renderer/pages/tweaks'))
const Streamer = lazy(() => import('@renderer/pages/streamer'))
const Lan = lazy(() => import('@renderer/pages/lan'))
const Diagnostics = lazy(() => import('@renderer/pages/diagnostics'))
// «Админка» — только при привязке режима автора (без неё страница сама ведёт на главную).
const Admin = lazy(() => import('@renderer/pages/admin'))

/**
 * Пока файл раздела загружается. Индикатор появляется только если загрузка
 * заняла больше 150 мс — обычно раздел открывается быстрее, и тогда ничего
 * не мигает.
 */
function PageLoading(): React.ReactElement | null {
  const [show, setShow] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setShow(true), 150)
    return () => clearTimeout(t)
  }, [])
  if (!show) return null
  return (
    <div className="flex h-full w-full items-center justify-center text-muted-foreground" role="status" aria-label="Раздел загружается">
      <Loader2 className="size-5 animate-spin" />
    </div>
  )
}

function page(Component: React.ComponentType): React.ReactElement {
  return (
    <Suspense fallback={<PageLoading />}>
      <Component />
    </Suspense>
  )
}

const routes = [
  { path: '/', element: <Navigate to="/home" replace /> },
  { path: '/home', element: <Home /> },
  { path: '/admin', element: page(Admin) },
  { path: '/telegram', element: page(Telegram) },
  { path: '/zapret', element: page(Zapret) },
  { path: '/dns', element: page(Dns) },
  { path: '/scenarios', element: page(Scenarios) },
  { path: '/incy', element: page(Incy) },
  { path: '/exitlag', element: page(ExitLag) },
  { path: '/optimizer', element: page(Optimizer) },
  { path: '/prematch', element: page(Prematch) },
  { path: '/tweaks', element: page(Tweaks) },
  { path: '/streamer', element: page(Streamer) },
  { path: '/lan', element: page(Lan) },
  { path: '/diagnostics', element: page(Diagnostics) },
  { path: '/logs', element: page(Logs) },
  { path: '/settings', element: page(Settings) },
  { path: '/appearance', element: page(Appearance) },
  { path: '/about', element: page(About) },
  { path: '/support', element: page(Support) }
]

export default platform === 'linux'
  ? routes.map((route) => linuxUnavailableRoutes.has(route.path) ? { ...route, element: <Navigate to="/home" replace /> } : route)
  : routes
