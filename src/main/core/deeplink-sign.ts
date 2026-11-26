/**
 * Подпись ссылок `lazeyka://` секретом установки.
 *
 * Чистая логика без Electron (только node:crypto) — проверяется node-скриптом.
 *
 * Ссылку `lazeyka://disconnect` может открыть любая веб-страница. Поэтому
 * ссылки, которые программа выдаёт для пультов и ярлыков, несут код:
 *
 *   lazeyka://zapret/off?k=<код>
 *   код = base64url(HMAC-SHA256(секрет, «zapret/off»)), первые 16 символов
 *
 * Подписывается конкретное действие, а не общий ключ: утёкшая ссылка
 * «включить VPN» не даёт права «выключить». Ссылка с верным кодом
 * выполняется сразу, без кода или с неверным — только после подтверждения.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { parseSimpleCommand, type SimpleCommand } from './deeplink-parse'

export const SIGN_CODE_LENGTH = 16
export const SIGN_PARAM = 'k'

/** Команды VPN (и их старые синонимы). */
const VPN_ALIASES: Record<string, 'connect' | 'disconnect' | 'toggle'> = {
  connect: 'connect',
  open: 'connect',
  disconnect: 'disconnect',
  close: 'disconnect',
  toggle: 'toggle'
}

/**
 * Каноническая строка действия по сегментам ссылки (host + части пути), или
 * null, если команду подписывать нельзя (импорт, правила, восстановление —
 * они всегда спрашивают подтверждение, и ошибочные команды).
 */
export function canonicalAction(segments: readonly string[]): string | null {
  const name = (segments[0] ?? '').trim().toLowerCase()
  if (name in VPN_ALIASES) {
    return segments.slice(1).some((s) => s.trim()) ? null : VPN_ALIASES[name]
  }
  const cmd = parseSimpleCommand(segments)
  return cmd ? canonicalForSimple(cmd) : null
}

export function canonicalForSimple(cmd: SimpleCommand): string | null {
  switch (cmd.kind) {
    case 'service':
      return `${cmd.service}/${cmd.action}`
    case 'scenario':
      return `scenario/${cmd.id}`
    case 'mini':
      return 'mini'
    default:
      return null
  }
}

/** Код для действия: HMAC-SHA256 в base64url, первые 16 символов (96 бит). */
export function signAction(secret: Buffer, action: string): string {
  return createHmac('sha256', secret).update(action, 'utf8').digest('base64url').slice(0, SIGN_CODE_LENGTH)
}

/** Проверка кода без утечки по времени сравнения. */
export function verifyAction(secret: Buffer, action: string, code: string | null | undefined): boolean {
  if (typeof code !== 'string' || code.length !== SIGN_CODE_LENGTH || !/^[A-Za-z0-9_-]+$/.test(code)) return false
  const want = Buffer.from(signAction(secret, action), 'utf8')
  const got = Buffer.from(code, 'utf8')
  return want.length === got.length && timingSafeEqual(want, got)
}

/** Полная подписанная ссылка. Действие — каноническое (`zapret/off`, `scenario/sc-1`). */
export function buildSignedUrl(secret: Buffer, action: string): string {
  return `lazeyka://${action}?${SIGN_PARAM}=${signAction(secret, action)}`
}

/**
 * Действия, которые можно выполнять без подтверждения даже без подписи:
 * они только показывают окно и ничего не включают и не выключают.
 */
export function isWindowOnlyAction(action: string | null): boolean {
  return action === 'mini'
}

/** Какие действия программа подписывает для пультов (без сценариев). */
export const FIXED_ACTIONS: readonly string[] = [
  'connect',
  'disconnect',
  'toggle',
  ...['zapret', 'telegram', 'exitlag'].flatMap((s) => ['on', 'off', 'toggle'].map((a) => `${s}/${a}`)),
  'mini'
]

/** Действие, допустимое для подписи по запросу окна (только простые команды). */
export function isSignableAction(action: string): boolean {
  if (FIXED_ACTIONS.includes(action)) return true
  return /^scenario\/[\w.-]{1,80}$/.test(action)
}

/** Понятное человеку описание действия — для окна подтверждения. */
export function describeAction(action: string): string {
  const [head, tail] = action.split('/')
  const verb = (on: string, off: string, sw: string): string => (tail === 'on' ? on : tail === 'off' ? off : sw)
  switch (head) {
    case 'connect':
      return 'подключить VPN'
    case 'disconnect':
      return 'отключить VPN'
    case 'toggle':
      return 'переключить VPN (включить или выключить)'
    case 'zapret':
      return verb('включить Zapret', 'выключить Zapret', 'переключить Zapret')
    case 'telegram':
      return verb('включить Telegram-прокси', 'выключить Telegram-прокси', 'переключить Telegram-прокси')
    case 'exitlag':
      return verb('включить ExitLag', 'выключить ExitLag', 'переключить ExitLag')
    case 'scenario':
      return `применить сценарий «${tail ?? ''}»`
    case 'mini':
      return 'показать или скрыть мини-окно'
    default:
      return action
  }
}

/** Содержимое plugin/codes.js для плагина Stream Deck: коды по действиям. */
export function pluginCodesScript(secret: Buffer, actions: readonly string[]): string {
  const map: Record<string, string> = {}
  for (const a of actions) if (isSignableAction(a)) map[a] = signAction(secret, a)
  return (
    '/* eslint-disable -- создано программой LAZEYKA при установке плагина */\n' +
    '/* Коды подписи ссылок lazeyka:// этой установки. Кнопка «Обновить ссылки» в программе делает их недействительными. */\n' +
    `var LazeykaCodes = ${JSON.stringify(map)}\n`
  )
}
