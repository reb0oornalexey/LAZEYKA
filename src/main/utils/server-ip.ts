/**
 * Достаёт из строки, которую вставили в оптимизатор, только IPv4-адрес
 * сервера — без `connect`, порта, двоеточия, пароля и прочего.
 *
 *   connect 162.19.141.22:27015; password abc  → 162.19.141.22
 *   162.19.141.22:27015                        → 162.19.141.22
 *   steam://connect/162.19.141.22:27015/abc    → 162.19.141.22
 *
 * Возвращает null, если IPv4 в строке нет или он локальный / служебный
 * (такой в список Zapret добавлять бессмысленно).
 */
const IPV4_IN_TEXT =
  /(?<![\d.])((?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d))(?![\d.])/

const NON_PUBLIC =
  /^(?:0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|2(?:2[4-9]|[3-5]\d)\.)/

export function extractServerIp(text: string): string | null {
  const ip = IPV4_IN_TEXT.exec(String(text ?? ''))?.[1] ?? null
  if (!ip || NON_PUBLIC.test(ip)) return null
  return ip
}

/** Имя хоста из строки (`connect host:port; ...`) — если IP в ней нет. */
export function extractServerHost(text: string): string | null {
  const host = String(text ?? '')
    .trim()
    .replace(/^connect\s+/i, '')
    .replace(/^[a-z]+:\/\/(?:connect\/)?/i, '')
    .split(/[;\s/]/)[0]
    .replace(/:\d+$/, '')
    .trim()
    .toLowerCase()
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/.test(host) ? host : null
}
