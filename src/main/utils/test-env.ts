import { app } from 'electron'

/**
 * Запуск в тестовой среде без настоящего пользователя: несобранная программа на Linux
 * (автоматические проверки в песочнице) или явный флаг LAZEYKA_NO_REMOTE=1.
 * В такой среде программа не отмечается в счётчике онлайна и не опрашивает Hub —
 * иначе каждый тестовый прогон с чистым профилем считался бы новой установкой
 * в настоящей статистике автора.
 */
export function isTestEnvironment(): boolean {
  if (process.env.LAZEYKA_NO_REMOTE === '1') return true
  return process.platform === 'linux' && !app.isPackaged
}

/**
 * Hub для проверок: в несобранной программе с LAZEYKA_DEV_HUB_URL=http://127.0.0.1:порт запросы к Hub
 * идут на локальный miniflare, хотя остальная сеть отключена как в тестовой среде.
 */
export function hubDisabled(): boolean {
  if (!app.isPackaged && /^http:\/\/127\.0\.0\.1:\d{2,5}$/.test(process.env.LAZEYKA_DEV_HUB_URL ?? '')) return false
  return isTestEnvironment()
}
