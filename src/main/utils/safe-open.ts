/**
 * Открытие внешних ссылок и защита окон программы от перехода на чужие адреса.
 *
 * Правила — в url-policy.ts (чистая логика, проверяется отдельно).
 *  - safeOpenExternal: только http/https (и tg:// для кнопок Telegram),
 *    остальное — отказ с записью в лог;
 *  - hardenAppWindow: setWindowOpenHandler (ссылки target=_blank и
 *    window.open уходят в браузер через тот же фильтр), запрет will-navigate
 *    и will-redirect на всё, кроме адреса самого приложения.
 */
import { shell, type BrowserWindow, type WebContents } from 'electron'
import { appLog } from './app-logger'
import { checkExternalUrl, isAllowedAppNavigation, type ExternalUrlKind } from './url-policy'

function short(url: unknown): string {
  return String(url).slice(0, 160)
}

/** Открыть ссылку в системе, если её схема разрешена. Иначе — ошибка и строка в логе. */
export async function safeOpenExternal(raw: unknown, kind: ExternalUrlKind = 'web'): Promise<void> {
  const url = checkExternalUrl(raw, kind)
  if (!url) {
    appLog('warn', `[security] ссылка не открыта (схема не разрешена): ${short(raw)}`)
    throw new Error('Такую ссылку программа не открывает: разрешены только адреса http и https')
  }
  await shell.openExternal(url)
}

/** Адрес, с которого окно загрузило приложение (dev-сервер или file://…/index.html). */
function appUrlOf(wc: WebContents): string | null {
  try {
    return wc.getURL() || null
  } catch {
    return null
  }
}

/**
 * Защитить окно программы. Вызывать сразу после создания окна (до loadURL/
 * loadFile): адрес приложения запоминается при первой загрузке.
 */
export function hardenAppWindow(win: BrowserWindow): void {
  const wc = win.webContents
  let appUrl: string | null = null
  wc.once('did-finish-load', () => {
    appUrl = appUrlOf(wc)
  })

  wc.setWindowOpenHandler((details) => {
    // Кнопки Telegram (tg://proxy) тоже открываются здесь — их пускаем.
    void safeOpenExternal(details.url, 'telegram').catch(() => void 0)
    return { action: 'deny' }
  })

  const guard = (e: Electron.Event, url: string): void => {
    const base = appUrl ?? appUrlOf(wc)
    // До первой загрузки адреса ещё нет: это и есть загрузка приложения.
    if (!base) return
    if (isAllowedAppNavigation(url, base)) return
    e.preventDefault()
    appLog('warn', `[security] переход окна на чужой адрес отменён: ${short(url)}`)
    // Обычная ссылка без target=_blank — открываем в браузере, если адрес допустим.
    void safeOpenExternal(url).catch(() => void 0)
  }
  wc.on('will-navigate', guard)
  wc.on('will-redirect', guard)
}
