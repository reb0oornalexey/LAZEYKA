/**
 * Проверка значений настроек INCY: числа вне допустимого диапазона, неверные
 * перечисления, битые диапазоны фрагментации. Чистые функции без Electron.
 *
 * Применяется при чтении файла настроек и перед записью: правка файла вручную,
 * резервная копия от старой версии или ввод мусора в поле не должны ронять
 * запуск ядра (порт 99999, MTU 5, таймаут 9999 с).
 */

import type { IncySettings } from './incy-engine'
import { sanitizeFragmentPackets, sanitizeRange } from './incy-links'
import { checkExcludedRoutes } from './incy-routes'

export const MIXED_PORT_DEFAULT = 20808
/** Порт и три соседних (+1 SOCKS, +2 Clash API, +3 мост) должны уложиться в 65535. */
export const MIXED_PORT_MIN = 1024
export const MIXED_PORT_MAX = 65532

export const PING_TEST_URL_DEFAULT = 'https://www.gstatic.com/generate_204'

/** Целое число из значения произвольного типа в границах; иначе запасное. */
export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

/** Порт локального прокси: 1024–65532 (выше не помещаются соседние порты ядер). */
export function validMixedPort(value: unknown): boolean {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isInteger(n) && n >= MIXED_PORT_MIN && n <= MIXED_PORT_MAX
}

/** Адрес для проверки пинга: только http(s) и без пробелов. */
export function validPingUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const v = value.trim()
  if (!/^https?:\/\/[^\s/]+\S*$/i.test(v)) return false
  try {
    const u = new URL(v)
    return Boolean(u.hostname)
  } catch {
    return false
  }
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback
}

/** Одно поле: верное значение остаётся, неверное заменяется запасным. */
function rangeOr(value: unknown, fallback: string): string {
  return sanitizeRange(typeof value === 'string' ? value : String(value ?? '')) ?? fallback
}

/**
 * Вернуть копию настроек с приведёнными к допустимым значениями полями.
 * Объект целиком не пересобирается: неизвестные поля остаются как есть.
 */
export function sanitizeIncySettings(input: IncySettings): IncySettings {
  const s: IncySettings = { ...input }

  s.mixedPort = validMixedPort(s.mixedPort) ? Math.round(Number(s.mixedPort)) : MIXED_PORT_DEFAULT

  // MTU: 0 — «Авто»; иначе 1280–9000.
  const mtu = Number(s.tunMtu)
  s.tunMtu = Number.isFinite(mtu) && mtu >= 1280 && mtu <= 9000 ? Math.round(mtu) : 0

  s.pingTimeoutSec = clampInt(s.pingTimeoutSec, 1, 10, 3)
  if (!validPingUrl(s.pingTestUrl)) s.pingTestUrl = PING_TEST_URL_DEFAULT

  // Тайм-аут простоя UDP: меньше 120 с — это «стандартные 5 минут» (0).
  const idle = Number(s.idleTimeoutSec)
  s.idleTimeoutSec = Number.isFinite(idle) && idle >= 120 ? Math.min(3600, Math.round(idle)) : 0

  s.muxConcurrency = clampInt(s.muxConcurrency, 1, 32, 8)
  s.xudpConcurrency = clampInt(s.xudpConcurrency, 0, 64, 16)
  s.expireNotifyDays = clampInt(s.expireNotifyDays, 0, 30, 3)

  // Интервал автообновления подписок, часов: 0 — выключено, шаг 0,5 ч.
  const hours = Number(s.autoUpdateIntervalHours)
  s.autoUpdateIntervalHours = Number.isFinite(hours) && hours >= 0 ? Math.min(168, Math.round(hours * 2) / 2) : 2

  // Лимиты соединений в ядре нигде не применяются (см. ревизию), но значение
  // держим в разумных границах, чтобы файл не копил мусор.
  s.maxTcpConnections = clampInt(s.maxTcpConnections, 0, 65535, 256)
  s.maxUdpConnections = clampInt(s.maxUdpConnections, 0, 65535, 128)

  s.fragmentationPackets = sanitizeFragmentPackets(s.fragmentationPackets) ?? 'tlshello'
  s.fragmentationLength = rangeOr(s.fragmentationLength, '50-100')
  s.fragmentationInterval = rangeOr(s.fragmentationInterval, '10-20')
  s.noisesType = oneOf(s.noisesType, ['rand', 'str', 'hex'] as const, 'rand')
  // Для rand — диапазон длины; для str/hex — произвольные данные.
  s.noisesPacket =
    s.noisesType === 'rand'
      ? rangeOr(s.noisesPacket, '50-100')
      : typeof s.noisesPacket === 'string' && s.noisesPacket.trim()
        ? s.noisesPacket.trim()
        : '50-100'
  s.noisesDelay = rangeOr(s.noisesDelay, '10-16')

  s.connectionMode = oneOf(s.connectionMode, ['tun', 'system_proxy', 'only_proxy'] as const, 'tun')
  s.routingMode = oneOf(s.routingMode, ['bypass-ru', 'global', 'direct'] as const, 'bypass-ru')
  s.preferredIp = oneOf(s.preferredIp, ['AUTO', 'IPV4', 'IPV6'] as const, 'AUTO')
  s.vpnDns = oneOf(
    s.vpnDns,
    ['Cloudflare + Google', 'Google DNS', 'Cloudflare DNS', 'Quad9', 'Xbox DNS', 'Custom'] as const,
    'Cloudflare + Google'
  )
  s.pingProtocol = oneOf(s.pingProtocol, ['incy', 'tcp', 'http_get', 'http_head'] as const, 'incy')
  s.pingDisplay = oneOf(s.pingDisplay, ['numbers', 'bar', 'both', 'dots'] as const, 'numbers')
  s.sortServersBy = oneOf(s.sortServersBy, ['default', 'ping', 'name'] as const, 'default')
  s.tunStack = oneOf(s.tunStack, ['mixed', 'system', 'gvisor'] as const, 'mixed')
  s.xudpProxy443 = oneOf(s.xudpProxy443, ['reject', 'allow'] as const, 'reject')

  if (s.excludedRoutes !== undefined) {
    s.excludedRoutes = Array.isArray(s.excludedRoutes) ? checkExcludedRoutes(s.excludedRoutes).valid : []
  }
  return s
}
