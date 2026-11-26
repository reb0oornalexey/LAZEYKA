/**
 * Какие ссылки программа отдаёт системе (shell.openExternal) и куда может
 * переходить её окно. Чистая логика без Electron — проверяется node-скриптом.
 *
 * Ссылки приходят и из удалённого содержимого (заметки к релизам, сообщения
 * автора в Hub, страницы подписок), а программа работает с правами
 * администратора. `file:`, `ms-msdt:`, `search-ms:`, `ms-officecmd:` и
 * подобные схемы через openExternal запускают код — поэтому белый список.
 */

export type ExternalUrlKind = 'web' | 'telegram'

const TG_HOSTS = new Set(['proxy', 'socks', 'resolve', 'join', 'addstickers', 'msg_url'])

/**
 * Разобрать ссылку для открытия во внешней программе. Возвращает
 * нормализованную строку или null, если ссылка не разрешена.
 *  - web: только http: и https: с именем хоста, без логина/пароля в адресе;
 *  - telegram: ещё tg://proxy|socks|resolve|… (кнопки прокси Telegram).
 */
export function checkExternalUrl(raw: unknown, kind: ExternalUrlKind = 'web'): string | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim()
  if (!s || s.length > 4096) return null
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(s)) return null
  let u: URL
  try {
    u = new URL(s)
  } catch {
    return null
  }
  if (u.protocol === 'http:' || u.protocol === 'https:') {
    if (!u.hostname) return null
    if (u.username || u.password) return null
    return u.toString()
  }
  if (kind === 'telegram' && u.protocol === 'tg:') {
    return TG_HOSTS.has(u.hostname.toLowerCase()) ? u.toString() : null
  }
  return null
}

/** Ссылка для «Открыть в Telegram»: tg://… или https://t.me/…, больше ничего. */
export function checkTelegramUrl(raw: unknown): string | null {
  const ok = checkExternalUrl(raw, 'telegram')
  if (!ok) return null
  const u = new URL(ok)
  if (u.protocol === 'tg:') return ok
  if (u.protocol === 'https:' && (u.hostname === 't.me' || u.hostname === 'telegram.me')) return ok
  return null
}

/**
 * Разрешён ли переход окна программы на адрес `target`.
 * В сборке окно открывает файл index.html из своей папки, в разработке —
 * dev-сервер Vite. Любой другой адрес (в том числе другой file://) — отказ.
 */
export function isAllowedAppNavigation(target: string, appUrl: string): boolean {
  let t: URL
  let a: URL
  try {
    t = new URL(target)
    a = new URL(appUrl)
  } catch {
    return false
  }
  if (a.protocol === 'file:') {
    // Тот же файл (маршрутизация по #hash не меняет путь).
    return t.protocol === 'file:' && t.host === a.host && decodeURIComponent(t.pathname) === decodeURIComponent(a.pathname)
  }
  if (a.protocol === 'http:' || a.protocol === 'https:') {
    return t.origin === a.origin
  }
  return false
}
