import { Notification, app } from 'electron'
import path from 'node:path'
import { existsSync } from 'node:fs'

/**
 * Показать системное уведомление.
 *
 * `onClick` нужен уведомлениям, которые зовут человека обратно в приложение:
 * без него клик по всплывашке не делает ничего, и единственный способ дойти
 * до окна — вспомнить про значок в трее.
 */
export function showSystemNotification(title: string, body: string, onClick?: () => void): void {
  if (!Notification.isSupported()) return

  try {
    const iconPath = path.join(app.getAppPath(), 'resources', 'icon.png')
    const notification = new Notification({
      title: title || 'LAZEYKA',
      body,
      icon: existsSync(iconPath) ? iconPath : undefined,
      silent: false
    })

    if (onClick) notification.on('click', onClick)
    notification.show()
  } catch { /* ignore notification errors */ }
}
