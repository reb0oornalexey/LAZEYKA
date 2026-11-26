/**
 * Разбор простых команд `lazeyka://` (службы, сценарий, мини-окно).
 *
 * Чистая функция без Electron: её проверяют отдельным скриптом. Принимает
 * сегменты ссылки в том виде, как их собирает deeplink.ts: сначала «хост»,
 * потом части пути (`lazeyka://zapret/on` → ['zapret', 'on']).
 *
 * Команды импорта, восстановления и маршрутизации здесь не разбираются —
 * они требуют подтверждения и живут в deeplink.ts.
 */

export type ServiceName = 'zapret' | 'telegram' | 'exitlag'
export type ServiceAction = 'on' | 'off' | 'toggle'

export type SimpleCommand =
  | { kind: 'service'; service: ServiceName; action: ServiceAction }
  | { kind: 'scenario'; id: string }
  | { kind: 'mini' }
  | { kind: 'invalid'; reason: string }

const SERVICES: readonly string[] = ['zapret', 'telegram', 'exitlag']
const ACTIONS: readonly string[] = ['on', 'off', 'toggle']

/** Имена, которые разбирает эта функция (остальные — не её дело). */
export function isSimpleCommandName(name: string): boolean {
  const n = name.toLowerCase()
  return SERVICES.includes(n) || n === 'scenario' || n === 'mini'
}

/** null — команда не из этого набора. */
export function parseSimpleCommand(segments: readonly string[]): SimpleCommand | null {
  const name = (segments[0] ?? '').trim().toLowerCase()
  if (!isSimpleCommandName(name)) return null
  const rest = segments.slice(1).map((s) => s.trim()).filter(Boolean)

  if (name === 'mini') {
    return rest.length === 0 ? { kind: 'mini' } : { kind: 'invalid', reason: 'у команды mini нет параметров' }
  }

  if (name === 'scenario') {
    if (rest.length !== 1) return { kind: 'invalid', reason: 'нужна ссылка вида lazeyka://scenario/<id>' }
    let id: string
    try {
      id = decodeURIComponent(rest[0])
    } catch {
      return { kind: 'invalid', reason: 'идентификатор сценария записан неверно' }
    }
    if (!/^[\w.-]{1,80}$/.test(id)) return { kind: 'invalid', reason: 'идентификатор сценария записан неверно' }
    return { kind: 'scenario', id }
  }

  // Службы: lazeyka://zapret/on|off|toggle
  const action = (rest[0] ?? '').toLowerCase()
  if (rest.length !== 1 || !ACTIONS.includes(action)) {
    return { kind: 'invalid', reason: `после ${name} нужно on, off или toggle` }
  }
  return { kind: 'service', service: name as ServiceName, action: action as ServiceAction }
}

/** Итоговое состояние «включено» по действию и текущему состоянию. */
export function wantedState(action: ServiceAction, currentlyOn: boolean): boolean {
  if (action === 'on') return true
  if (action === 'off') return false
  return !currentlyOn
}
