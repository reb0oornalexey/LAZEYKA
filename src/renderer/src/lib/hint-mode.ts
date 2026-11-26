import { useSyncExternalStore } from 'react'

/*
 * Е6: «Подсказки: подробные / короткие» (Настройки → Запуск и окно → Интерфейс).
 *
 * В коротком режиме значки «i» (Hint, InfoTip) показывают только первую фразу
 * пояснения: суть остаётся, разбор деталей — нет. Значок не прячется, чтобы
 * у настройки всегда было хоть какое-то объяснение.
 *
 * Значение берётся из конфига (hintMode) и обновляется по событию
 * appConfigUpdated — один запрос при запуске окна, без опроса.
 */

export type HintMode = 'full' | 'short'

let mode: HintMode = 'full'
let started = false
const listeners = new Set<() => void>()

function set(next: HintMode): void {
  if (next === mode) return
  mode = next
  listeners.forEach((f) => f())
}

async function load(): Promise<void> {
  try {
    const r = (await window.electron.ipcRenderer.invoke('app:getConfig')) as { ok?: boolean; value?: { hintMode?: string } } | undefined
    if (r?.ok) set(r.value?.hintMode === 'short' ? 'short' : 'full')
  } catch {
    /* нет моста (тесты) — остаются подробные */
  }
}

function start(): void {
  if (started) return
  started = true
  void load()
  try {
    window.electron.ipcRenderer.on('appConfigUpdated', () => void load())
  } catch {
    /* noop */
  }
}

function subscribe(fn: () => void): () => void {
  start()
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function useHintMode(): HintMode {
  return useSyncExternalStore(subscribe, () => mode)
}

/** Сразу применить выбор (до ответа main), чтобы предпросмотр не ждал. */
export function setHintModeLocal(next: HintMode): void {
  set(next)
}

/**
 * Первая фраза текста. Конец фразы — «.», «!», «?» или «…», за которыми пробел
 * и заглавная буква, цифра или кавычка: «т. е.» и «5 мин. назад» не режутся.
 * Одна фраза — текст целиком.
 */
export function firstSentence(text: string): string {
  const t = text.trim()
  const m = /[.!?…](?=\s+[«"(A-ZА-ЯЁ0-9])/u.exec(t)
  if (!m) return t
  return t.slice(0, m.index + 1)
}

/** Текст подсказки с учётом режима. */
export function hintText(text: string, m: HintMode): string {
  return m === 'short' ? firstSentence(text) : text
}
