/**
 * Вставка из буфера обмена «мышкой»: кнопка «Вставить» в полях и правая
 * кнопка мыши, как в консоли Windows.
 *
 * Текст вставляется через execCommand('insertText'): так браузер сам
 * генерирует событие input, и React-обработчики onChange срабатывают как при
 * обычном вводе с клавиатуры (работает и для управляемых полей).
 */
import { writeClipboard } from '@renderer/utils/ipc'

export async function readClipboardText(): Promise<string> {
  try {
    const t = await navigator.clipboard.readText()
    if (typeof t === 'string') return t
  } catch {
    /* запасной путь ниже */
  }
  try {
    const t = (await window.electron.ipcRenderer.invoke('clipboard:readText')) as unknown
    // Обработчики main возвращают { invokeError } при ошибке.
    return typeof t === 'string' ? t : ''
  } catch {
    return ''
  }
}

export function isEditableField(el: EventTarget | null): el is HTMLInputElement | HTMLTextAreaElement {
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled
  if (el instanceof HTMLInputElement) {
    const t = (el.type || 'text').toLowerCase()
    return ['text', 'search', 'url', 'email', 'password', 'tel', 'number', ''].includes(t) && !el.readOnly && !el.disabled
  }
  return false
}

/**
 * Вставить текст в поле.
 *  - replace — заменить всё содержимое (однострочные поля: ссылка, домен);
 *  - insert  — вставить в позицию курсора (многострочные списки).
 */
export function insertIntoField(
  el: HTMLInputElement | HTMLTextAreaElement,
  text: string,
  mode: 'replace' | 'insert' = 'insert'
): void {
  const value = el instanceof HTMLInputElement ? text.replace(/\r?\n/g, ' ').trim() : text.replace(/\r\n/g, '\n')
  el.focus()
  if (mode === 'replace') el.select()
  let ok = false
  try {
    ok = document.execCommand('insertText', false, value)
  } catch {
    ok = false
  }
  if (!ok) {
    // Запасной путь: нативный сеттер + событие input — React его увидит.
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
    const start = el.selectionStart ?? el.value.length
    const end = el.selectionEnd ?? el.value.length
    const next = mode === 'replace' ? value : el.value.slice(0, start) + value + el.value.slice(end)
    setter?.call(el, next)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
}

export async function copyText(text: string): Promise<boolean> {
  if (!text) return false
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      await writeClipboard(text)
      return true
    } catch {
      return false
    }
  }
}
