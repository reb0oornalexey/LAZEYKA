import { Notification, app } from 'electron'
import path from 'node:path'
import { existsSync } from 'node:fs'

export function showSystemNotification(title: string, body: string): void {
  if (!Notification.isSupported()) return

  try {
    const iconPath = path.join(app.getAppPath(), 'resources', 'icon.png')
    const notification = new Notification({
      title: title || 'LAZEYKA',
      body,
      icon: existsSync(iconPath) ? iconPath : undefined,
      silent: false
    })

    notification.show()
  } catch { /* ignore notification errors */ }
}
