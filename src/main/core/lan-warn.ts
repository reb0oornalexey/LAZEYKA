/**
 * Предупреждения раздела «Локальная сеть» без повторов: одно сообщение на событие.
 * Чистая логика без Electron (проверяется обычным node).
 */

/** Пишет сообщение, только если для этого ключа оно новое. clear() — событие закончилось, следующее снова будет записано. */
export class WarnOnce {
  private readonly last = new Map<string, string>()
  constructor(private readonly log: (message: string) => void) {}

  warn(key: string, message: string): boolean {
    if (this.last.get(key) === message) return false
    this.last.set(key, message)
    this.log(message)
    return true
  }

  clear(key: string): void {
    this.last.delete(key)
  }

  reset(): void {
    this.last.clear()
  }
}

/**
 * Что делать с ошибкой «адрес недоступен» (EADDRNOTAVAIL) при попытке слушать адрес раздаваемой сети Wi-Fi.
 *
 * Windows показывает адрес 192.168.137.1 в списке адаптеров чуть раньше, чем на нём можно открыть порт
 * (адрес ещё проверяется системой). Поэтому первые секунды после появления адреса такая ошибка — норма:
 * пробуем снова молча. Предупреждаем, только если адрес так и не заработал за graceMs.
 */
export function hotspotBindVerdict(o: { code?: string; firstSeenAt: number; now: number; graceMs?: number }): 'retry' | 'warn' {
  if (o.code !== 'EADDRNOTAVAIL') return 'warn'
  return o.now - o.firstSeenAt < (o.graceMs ?? 20_000) ? 'retry' : 'warn'
}
