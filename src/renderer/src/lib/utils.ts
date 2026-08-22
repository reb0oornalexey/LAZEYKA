import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { CSSProperties } from 'react'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

/**
 * Telegram-канал поддержки: жалобы, предложения, вопросы.
 *
 * Одна константа на всё приложение — ссылка встречается и на главной, и на
 * странице «Информация», и разъехавшиеся копии рано или поздно уведут людей
 * не туда.
 */
export const SUPPORT_TELEGRAM_URL = 'https://t.me/LAZEYKA_feedback'

export const POWER_ON_BANNER_STYLE: CSSProperties = {
  background:
    'radial-gradient(at 30% 45%, color-mix(in oklab, var(--gradient-start-power-on) 60%, transparent), color-mix(in oklab, var(--gradient-end-power-on) 60%, transparent))',
  backdropFilter: 'blur(24px)',
  WebkitBackdropFilter: 'blur(24px)',
  borderColor: 'var(--stroke-power-on)',
  color: 'var(--foreground)'
}

export const POWER_OFF_BANNER_STYLE: CSSProperties = {
  background:
    'radial-gradient(at 30% 45%, color-mix(in oklab, var(--gradient-start-power-off) 60%, transparent), color-mix(in oklab, var(--gradient-end-power-off) 60%, transparent))',
  backdropFilter: 'blur(24px)',
  WebkitBackdropFilter: 'blur(24px)',
  borderColor: 'var(--stroke-power-off)',
  color: 'var(--foreground)'
}

/**
 * Label shown in place of a version number when the user is still running the
 * binaries that shipped with the installer and has never installed an update.
 *
 * Deliberately NOT a hard-coded version string: the old BUNDLED_*_VERSION
 * constants drifted out of sync with what main/ actually shipped (renderer
 * said 1.6.6 / 1.9.8c while main said 1.10.0 / 1.10.1), so the UI displayed a
 * number that was simply wrong. The real installed version now comes from
 * `installedVersion` in the config, and until an update is installed we say
 * so honestly instead of inventing a number.
 */
export const BUNDLED_VERSION_LABEL = 'встроенная сборка'

/** Formats an update banner's "current version" line without faking a number. */
export function formatInstalledVersion(installed?: string): string {
  return installed ? `Текущая версия: v${installed}` : `Сейчас используется ${BUNDLED_VERSION_LABEL}`
}
