import { lazy, Suspense } from 'react'
import { Navigate } from 'react-router-dom'
import Home from '@renderer/pages/home'
import Telegram from '@renderer/pages/telegram'
import Zapret from '@renderer/pages/zapret'
import Incy from '@renderer/pages/incy'
import ExitLag from '@renderer/pages/exitlag'
import Optimizer from '@renderer/pages/optimizer'
import Logs from '@renderer/pages/logs'
import Settings from '@renderer/pages/settings'
import About from '@renderer/pages/about'
import Support from '@renderer/pages/support'
import MacSoon from '@renderer/components/mac-soon'

const Appearance = lazy(() => import('@renderer/pages/appearance'))

const routes = [
  { path: '/', element: <Navigate to="/home" replace /> },
  { path: '/home', element: <Home /> },
  { path: '/telegram', element: <Telegram /> },
  { path: '/zapret', element: (
      <MacSoon title="Zapret">
        <Zapret />
      </MacSoon>
    ) },
  { path: '/incy', element: <Incy /> },
  { path: '/exitlag', element: <ExitLag /> },
  { path: '/optimizer', element: <Optimizer /> },
  { path: '/logs', element: <Logs /> },
  { path: '/settings', element: <Settings /> },
  {
    path: '/appearance',
    element: (
      <Suspense fallback={null}>
        <Appearance />
      </Suspense>
    )
  },
  { path: '/about', element: <About /> },
  { path: '/support', element: <Support /> }
]

export default routes
