import { useEffect } from 'react'
import { useRoutes } from 'react-router-dom'
import { toast } from 'sonner'
import { useTheme } from 'next-themes'
import './i18n'
import routes from '@renderer/routes'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { applyTheme, setNativeTheme } from '@renderer/utils/ipc'
import AppSidebar from '@renderer/components/app-sidebar'
import WindowControls from '@renderer/components/window-controls'
import { platform } from '@renderer/utils/init'
import { attachLogsStore } from '@renderer/store/logs-store'
import { attachTgwsStore } from '@renderer/store/tgws-store'
import { attachZapretStore } from '@renderer/store/zapret-store'
import { attachZapretTestStore } from '@renderer/store/zapret-test-store'
import { attachIncyStore } from '@renderer/store/incy-store'

const App: React.FC = () => {
  const { appConfig } = useAppConfig()
  const { appTheme = 'dark', customTheme } = appConfig || {}
  const { setTheme } = useTheme()
  const page = useRoutes(routes)

  useEffect(() => {
    const d1 = attachLogsStore()
    const d2 = attachTgwsStore()
    const d3 = attachZapretStore()
    const d4 = attachZapretTestStore()
    const d5 = attachIncyStore()
    return () => {
      d1()
      d2()
      d3()
      d4()
      d5()
    }
  }, [])

  useEffect(() => {
    setNativeTheme(appTheme)
    setTheme(appTheme)
  }, [appTheme, setTheme])

  useEffect(() => {
    applyTheme(customTheme || 'default.css').catch(() => {
      /* noop */
    })
  }, [customTheme])

  useEffect(() => {
    const handleShowError = (_e: unknown, title: string, message: string): void => {
      toast.error(title, { description: message })
    }
    window.electron.ipcRenderer.on('showError', handleShowError)
    return () => {
      window.electron.ipcRenderer.removeAllListeners('showError')
    }
  }, [])

  // Fix the classic Electron "sticky hover/focus" bug.
  useEffect(() => {
    let resetTimer: ReturnType<typeof setTimeout> | null = null

    const clearStuckState = (): void => {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur()
      }
      const body = document.body
      body.classList.add('hover-reset')
      if (resetTimer) clearTimeout(resetTimer)
      // 120 ms is empirically reliable across 60/120/144 Hz displays. The
      resetTimer = setTimeout(() => body.classList.remove('hover-reset'), 120)
    }

    window.addEventListener('blur', clearStuckState)
    window.addEventListener('focus', clearStuckState)
    const handleVisibilityIpc = (): void => clearStuckState()
    window.electron.ipcRenderer.on('window:visibility', handleVisibilityIpc)

    return () => {
      window.removeEventListener('blur', clearStuckState)
      window.removeEventListener('focus', clearStuckState)
      window.electron.ipcRenderer.removeAllListeners('window:visibility')
      if (resetTimer) clearTimeout(resetTimer)
    }
  }, [])

  return (
    // Меню + страница. Без фоновой картинки и размытия: сплошной фон темы
    // ничего не стоит видеокарте.
    <div className="relative flex w-full h-screen overflow-hidden bg-background text-foreground">
      {platform === 'darwin' && (
        <div className="fixed top-0.5 -left-1 h-14.25 flex items-center pl-3 z-100 app-drag">
          <WindowControls />
        </div>
      )}
      <AppSidebar />
      <div className="relative z-10 main min-w-0 grow h-full overflow-y-auto">{page}</div>
    </div>
  )
}

export default App
