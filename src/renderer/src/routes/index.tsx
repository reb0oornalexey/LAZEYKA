import { Navigate } from 'react-router-dom'
import Home from '@renderer/pages/home'
import Telegram from '@renderer/pages/telegram'
import Zapret from '@renderer/pages/zapret'
import Incy from '@renderer/pages/incy'
import Logs from '@renderer/pages/logs'
import Settings from '@renderer/pages/settings'
import About from '@renderer/pages/about'
import Support from '@renderer/pages/support'

const routes = [
  { path: '/', element: <Navigate to="/home" replace /> },
  { path: '/home', element: <Home /> },
  { path: '/telegram', element: <Telegram /> },
  { path: '/zapret', element: <Zapret /> },
  { path: '/incy', element: <Incy /> },
  { path: '/logs', element: <Logs /> },
  { path: '/settings', element: <Settings /> },
  { path: '/about', element: <About /> },
  { path: '/support', element: <Support /> }
]

export default routes
