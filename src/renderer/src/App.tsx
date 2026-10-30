import { useEffect } from 'react'
import { useRoutes } from 'react-router-dom'
import { toast } from 'sonner'
import './i18n'
import routes from '@renderer/routes'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { readThemeCss } from '@renderer/utils/ipc'
import { setCustomThemeCss } from '@renderer/lib/appearance/apply'
import { useAppearanceSync } from '@renderer/hooks/use-appearance-sync'
import { AppBackground } from '@renderer/components/appearance/background-layer'
import AppSidebar from '@renderer/components/app-sidebar'
import MacServiceDialog from '@renderer/components/mac-service-dialog'
import { attachLogsStore } from '@renderer/store/logs-store'
import { attachTgwsStore } from '@renderer/store/tgws-store'
import { attachZapretStore } from '@renderer/store/zapret-store'
import { attachZapretTestStore } from '@renderer/store/zapret-test-store'
import { attachIncyStore } from '@renderer/store/incy-store'
import { attachOnlineStore } from '@renderer/store/online-store'
import { copyText, insertIntoField, isEditableField, readClipboardText } from '@renderer/utils/clipboard-field'

const App: React.FC = () => {
  const { appConfig } = useAppConfig()
  const { customTheme } = appConfig || {}
  useAppearanceSync()
  const page = useRoutes(routes)

  useEffect(() => {
    const d1 = attachLogsStore()
    const d2 = attachTgwsStore()
    const d3 = attachZapretStore()
    const d4 = attachZapretTestStore()
    const d5 = attachIncyStore()
    const d6 = attachOnlineStore()
    return () => {
      d1()
      d2()
      d3()
      d4()
      d5()
      d6()
    }
  }, [])

  // Правая кнопка мыши — как в консоли Windows: в поле ввода вставляет текст
  // из буфера, а если что-то выделено (в поле или на странице) — копирует.
  useEffect(() => {
    const onContextMenu = (e: MouseEvent): void => {
      // Своё контекстное меню у компонента важнее.
      if (e.defaultPrevented) return
      const target = e.target
      if (isEditableField(target)) {
        e.preventDefault()
        const start = target.selectionStart ?? 0
        const end = target.selectionEnd ?? 0
        if (end > start && !(target instanceof HTMLInputElement && target.type === 'password')) {
          void copyText(target.value.slice(start, end)).then((ok) => ok && toast.success('Скопировано', { duration: 1200 }))
          return
        }
        void readClipboardText().then((text) => {
          if (text) insertIntoField(target, text, 'insert')
        })
        return
      }
      const sel = window.getSelection()?.toString() ?? ''
      if (sel.trim()) {
        e.preventDefault()
        void copyText(sel).then((ok) => ok && toast.success('Скопировано', { duration: 1200 }))
      }
    }
    document.addEventListener('contextmenu', onContextMenu)
    return () => document.removeEventListener('contextmenu', onContextMenu)
  }, [])

  useEffect(() => {
    // Пользовательский CSS кладём в <head> после оформления — так он может его переопределить.
    let alive = true
    readThemeCss(customTheme || 'default.css')
      .then((css) => alive && setCustomThemeCss(css))
      .catch(() => undefined)
    return () => {
      alive = false
    }
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
    // Меню + страница. Фон — сплошной цвет темы; картинка/градиент (если выбраны)
    // — один статичный слой под содержимым.
    <div className="relative isolate flex w-full h-screen overflow-hidden bg-[color:var(--app-canvas,var(--background))] text-foreground">
      <AppBackground />
      {/* macOS: кнопки окна — родные «светофоры» системы (titleBarStyle: 'hidden'),
          свои поверх них не рисуем — иначе две пары наезжают на логотип. */}
      <AppSidebar />
      <div className="relative z-10 main min-w-0 grow h-full overflow-y-auto">{page}</div>
      <MacServiceDialog />
    </div>
  )
}

export default App
