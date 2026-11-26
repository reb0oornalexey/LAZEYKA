/**
 * Кто сейчас занимает winws.exe для проверок: тест всех стратегий, автоподбор
 * или проверка одной стратегии из конструктора. Одновременно — только одно:
 * все они останавливают Zapret и по очереди запускают свои winws.
 * (Сама очередь запусков — withZapretLock в zapret.ts; это — понятное сообщение
 * пользователю вместо молчаливого ожидания в очереди.)
 */

export type ZapretBusyKind = 'test' | 'autopick' | 'check'

let busy: ZapretBusyKind | null = null

const TEXT: Record<ZapretBusyKind, string> = {
  test: 'Идёт проверка всех стратегий — дождитесь окончания или остановите её',
  autopick: 'Идёт автоподбор стратегии — дождитесь окончания или остановите его',
  check: 'Идёт проверка стратегии из конструктора — дождитесь окончания'
}

export function zapretBusy(): ZapretBusyKind | null {
  return busy
}

/** Занять или бросить ошибку с понятным текстом. */
export function claimZapretBusy(kind: ZapretBusyKind): void {
  if (busy) throw new Error(TEXT[busy])
  busy = kind
}

export function releaseZapretBusy(kind: ZapretBusyKind): void {
  if (busy === kind) busy = null
}
