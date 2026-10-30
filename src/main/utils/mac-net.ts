/**
 * macOS: ping и traceroute для замеров (оптимизатор маршрута, трассировка,
 * «пинг под нагрузкой», регионы Valve). На Windows всё это делает ping.exe;
 * на Mac — системные /sbin/ping и /usr/sbin/traceroute, вывод которых
 * разбирается здесь (формат один и тот же во всех локалях macOS).
 */
import { execFile } from 'node:child_process'

export const MAC_PING = '/sbin/ping'
export const MAC_TRACEROUTE = '/usr/sbin/traceroute'

/**
 * Аргументы `ping`: `-c` — число пакетов, `-W` — ожидание ответа, мс (на macOS
 * в миллисекундах), `-m` — TTL, `-S` — адрес источника.
 */
export function macPingArgs(opts: { count: number; waitMs: number; ttl?: number; src?: string }, ip: string): string[] {
  return [
    '-c', String(opts.count),
    '-W', String(opts.waitMs),
    ...(opts.ttl != null ? ['-m', String(opts.ttl)] : []),
    ...(opts.src ? ['-S', opts.src] : []),
    ip
  ]
}

/** Запустить команду и вернуть stdout даже при ненулевом коде (100% потерь — не ошибка для нас). */
export function runMac(file: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024 }, (_e, stdout) => resolve(String(stdout ?? '')))
  })
}

export const runMacPing = (args: string[], timeoutMs: number): Promise<string> => runMac(MAC_PING, args, timeoutMs)

/** Время ответов: `64 bytes from 1.1.1.1: icmp_seq=0 ttl=57 time=12.345 ms` → [12] (целые мс, не меньше 1, как на Windows). */
export function parseMacPingRtts(out: string): number[] {
  return [...out.matchAll(/icmp_seq=\d+\s+ttl=\d+\s+time[=<]\s*([\d.]+)\s*ms/gi)].map((m) =>
    Math.max(1, Math.round(Number(m[1])))
  )
}

/**
 * Узел, ответивший на пакет с ограниченным TTL: `36 bytes from 10.0.0.1: Time to
 * live exceeded` (промежуточный) или обычная строка ответа (дошло до цели).
 * Дальше в выводе идёт дамп заголовка IP с теми же адресами — берём только
 * первую строку ответа.
 */
export function parseMacTtlHop(out: string): string | null {
  for (const line of out.split(/\r?\n/)) {
    const m = /bytes from\s+(\d{1,3}(?:\.\d{1,3}){3}):?\s+(?:Time to live exceeded|icmp_seq=)/i.exec(line)
    if (m) return m[1]
  }
  return null
}

/**
 * `traceroute -n -q 1`: ` 1  192.168.1.1  2.345 ms` / ` 2  *` → адрес узла по
 * номеру (null — не ответил). Строки с флагом (`!H`) тоже содержат адрес.
 */
export function parseTraceroute(out: string): (string | null)[] {
  const hops: (string | null)[] = []
  for (const line of out.split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(line)
    if (!m) continue
    const n = Number(m[1])
    if (!Number.isFinite(n) || n < 1 || n > 255) continue
    const ip = /(\d{1,3}(?:\.\d{1,3}){3})/.exec(m[2])
    while (hops.length < n - 1) hops.push(null)
    hops[n - 1] = ip ? ip[1] : null
  }
  return hops
}

/** Трассировка `traceroute` (запасной вариант, если ping с ограниченным TTL ничего не нашёл). */
export async function macTraceroute(ip: string, maxHops: number, src?: string): Promise<(string | null)[]> {
  const out = await runMac(
    MAC_TRACEROUTE,
    ['-n', '-q', '1', '-w', '1', '-m', String(maxHops), ...(src ? ['-s', src] : []), ip],
    maxHops * 1500 + 5000
  )
  return parseTraceroute(out)
}
