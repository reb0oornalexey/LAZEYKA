/**
 * Внутренний сигнал «изменилось состояние службы» (Zapret, INCY, Telegram-прокси, пинг узла).
 * Нужен модулям главного процесса, которые показывают сводный статус (например, Discord),
 * чтобы узнавать о смене без опроса. Отдельный модуль без зависимостей — без круговых импортов.
 */
type Listener = () => void

const listeners = new Set<Listener>()

export function emitServiceStatusChanged(): void {
  for (const l of listeners) {
    try {
      l()
    } catch {
      /* слушатель не должен ломать отправителя */
    }
  }
}

export function onServiceStatusChanged(l: Listener): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}
