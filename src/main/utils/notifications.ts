import { Notification, app } from 'electron'
import { streamerHidesNotifications } from '../core/streamer'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { getAppConfigSync } from '../config'

/**
 * Вид уведомления (Е6, «Настройки → Уведомления»):
 *  - actions — горячие клавиши, сценарии, включение и выключение служб;
 *  - updates — новая версия LAZEYKA;
 *  - errors  — сбои служб и автоматические переключения (узел заменён, автопилот);
 *  - author  — ответы, объявления и предупреждения автора;
 *  - always  — отключается своим переключателем (напоминание о подписке) или не отключается.
 */
export type NotifyKind = 'actions' | 'updates' | 'errors' | 'author' | 'always'

/** Показывать ли уведомления этого вида (по умолчанию — да). */
export function notifyKindEnabled(kind: NotifyKind): boolean {
  if (kind === 'always') return true
  try {
    return getAppConfigSync().notifyKinds?.[kind] !== false
  } catch {
    return true
  }
}

/**
 * Показать системное уведомление.
 *
 * `onClick` нужен уведомлениям, которые зовут человека обратно в приложение:
 * без него клик по всплывашке не делает ничего, и единственный способ дойти
 * до окна — вспомнить про значок в трее.
 */
/**
 * Держим ссылки на показанные уведомления: без них сборщик мусора удалял
 * объект, и клик по всплывашке (например, «Открыть окно обновления») не
 * срабатывал.
 */
const alive = new Set<Notification>()

export function showSystemNotification(title: string, body: string, onClick?: () => void, kind: NotifyKind = 'always'): void {
  if (!Notification.isSupported()) return
  if (!notifyKindEnabled(kind)) return
  // Режим стримера: текст уведомления не показываем, чтобы зрители не увидели IP и названия серверов.
  if (streamerHidesNotifications()) {
    title = 'LAZEYKA'
    body = 'Новое уведомление. Текст скрыт режимом стримера.'
  }

  try {
    const iconPath = path.join(app.getAppPath(), 'resources', 'icon.png')
    const notification = new Notification({
      title: title || 'LAZEYKA',
      body,
      icon: existsSync(iconPath) ? iconPath : undefined,
      silent: false
    })

    if (onClick) notification.on('click', onClick)
    alive.add(notification)
    const release = (): void => {
      alive.delete(notification)
    }
    notification.on('close', release)
    notification.on('click', release)
    notification.on('failed', release)
    // Страховка: даже если Windows не прислала «close», держим не дольше часа.
    setTimeout(release, 3_600_000).unref?.()
    notification.show()
  } catch { /* ignore notification errors */ }
}
