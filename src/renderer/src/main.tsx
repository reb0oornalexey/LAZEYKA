import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { ThemeProvider as NextThemesProvider } from 'next-themes'
import { init, platform } from '@renderer/utils/init'
import '@renderer/assets/main.css'
import App from '@renderer/App'
import UpdateWindow from '@renderer/components/update-window'
import BaseErrorBoundary from './components/base/base-error-boundary'
import { Toaster } from './components/ui/sonner'
import { appQuit } from './utils/ipc'
import { AppConfigProvider } from './hooks/use-app-config'

init().then(() => {
  document.addEventListener('keydown', (e) => {
    if (platform !== 'darwin' && e.ctrlKey && e.key === 'q') {
      e.preventDefault()
      appQuit()
    }
    if (platform === 'darwin' && e.metaKey && e.key === 'q') {
      e.preventDefault()
      appQuit()
    }
  })
})

// Отдельное окно обновления открывается на том же index.html с маршрутом
// #/update-window — для него рисуем только окно обновления, без сайдбара,
// сторов и подписок главного окна.
const isUpdateWindow = window.location.hash.startsWith('#/update-window')

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  isUpdateWindow ? (
    <React.StrictMode>
      <NextThemesProvider attribute="class" enableSystem defaultTheme="dark">
        <BaseErrorBoundary>
          <AppConfigProvider>
            <UpdateWindow />
          </AppConfigProvider>
        </BaseErrorBoundary>
      </NextThemesProvider>
    </React.StrictMode>
  ) : (
  <React.StrictMode>
    <NextThemesProvider attribute="class" enableSystem defaultTheme="dark">
      <BaseErrorBoundary>
        <HashRouter>
          <AppConfigProvider>
            <App />
            <Toaster richColors position="bottom-right" />
          </AppConfigProvider>
        </HashRouter>
      </BaseErrorBoundary>
    </NextThemesProvider>
  </React.StrictMode>
  )
)
