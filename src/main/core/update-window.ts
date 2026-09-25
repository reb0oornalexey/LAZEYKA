/**
 * Отдельное окно «Доступно обновление».
 *
 * Раньше окно обновления было модалкой внутри главного окна. При автозапуске
 * (silentStart) главное окно скрыто в трее, и модалку не видел никто. Теперь
 * это самостоятельное небольшое окно: при старте программы, если вышла новая
 * версия, открывается оно — а не главное окно. В нём заметки к новой версии,
 * три предыдущие и кнопка догрузки более ранних.
 *
 * Рендерер тот же (index.html), маршрут — `#/update-window`: main.tsx
 * рисует для него только окно обновления, без сайдбара и сторов.
 */
import { BrowserWindow, nativeTheme, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import icon from '../../../resources/icon.png?asset'
import { appLog } from '../utils/app-logger'

const ROUTE = '/update-window'
let win: BrowserWindow | null = null

export function isUpdateWindowOpen(): boolean {
  return !!win && !win.isDestroyed()
}

function bringToFront(w: BrowserWindow): void {
  if (w.isMinimized()) w.restore()
  // На Windows show() из фона часто лишь мигает кнопкой в панели задач.
  // Короткий «поверх всех» действительно выводит окно вперёд.
  w.setAlwaysOnTop(true)
  w.show()
  w.focus()
  setTimeout(() => {
    if (!w.isDestroyed()) w.setAlwaysOnTop(false)
  }, 1500)
}

export function openUpdateSplash(): void {
  try {
    if (win && !win.isDestroyed()) {
      bringToFront(win)
      win.webContents.send('app:updateWindowRefresh')
      return
    }
    win = new BrowserWindow({
      width: 620,
      height: 720,
      minWidth: 520,
      minHeight: 560,
      show: false,
      center: true,
      frame: false,
      titleBarStyle: 'hidden',
      title: 'Обновление LAZEYKA',
      icon,
      fullscreenable: false,
      maximizable: false,
      autoHideMenuBar: true,
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#0b0d10' : '#eef1f4',
      backgroundMaterial: process.platform === 'win32' ? 'mica' : undefined,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        spellcheck: false,
        sandbox: false
      }
    })
    const w = win
    w.once('ready-to-show', () => bringToFront(w))
    w.on('closed', () => {
      if (win === w) win = null
    })
    w.webContents.setWindowOpenHandler((details) => {
      void shell.openExternal(details.url)
      return { action: 'deny' }
    })
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      void w.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#${ROUTE}`)
    } else {
      void w.loadFile(join(__dirname, '../renderer/index.html'), { hash: ROUTE })
    }
    appLog('info', '[update] открыто окно обновления')
  } catch (e) {
    appLog('warn', `[update] не удалось открыть окно обновления: ${String(e)}`)
  }
}

export function closeUpdateSplash(): void {
  if (win && !win.isDestroyed()) win.close()
}
