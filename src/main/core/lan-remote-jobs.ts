/**
 * Пульт с телефона: «Обновить подписки» и «Проверить пинг» на листе «Сервер VPN».
 *
 * Своего менеджера здесь больше нет: действие идёт через общий IncyOpsManager (incy-ops.ts) — тот же, что у кнопок
 * на странице INCY. Поэтому замер, запущенный в программе, виден на телефоне (и наоборот), его можно остановить
 * с любой стороны, а повторный запуск не дублирует идущий.
 *
 * Здесь только разбор запроса телефона и ответ в его формате. Не зависит от Electron — проверяется обычным node.
 */
import type { IncyOpsManager, OpScope, OpsNode } from './incy-ops'

export { pingSummary, pluralRu, refreshSummary, serversWord } from './incy-ops'

export interface RemoteOpResult {
  ok: boolean
  message?: string
  code?: string
}

/**
 * Тело запроса телефона → объём.
 *   {}                         — все серверы / все подписки;
 *   { scope: 'group', gid }    — одна группа: id подписки, '' — «Добавлены вручную».
 */
export function parseRemoteOp(body: Record<string, unknown> | undefined): OpScope {
  if (body && body.scope === 'group' && typeof body.gid === 'string' && body.gid.length <= 200) {
    return { type: 'sub', subId: body.gid === '' ? null : body.gid }
  }
  return { type: 'all' }
}

export function remoteOpStart<N extends OpsNode>(ops: IncyOpsManager<N>, kind: 'ping' | 'refresh', scope: OpScope): RemoteOpResult {
  if (kind === 'refresh' && scope.type === 'sub' && scope.subId === null) {
    return { ok: false, code: 'manual', message: 'Серверы, добавленные вручную, не обновляются: у них нет подписки.' }
  }
  const r = ops.start(kind, scope, 'remote')
  if (r.joined) {
    const v = r.view
    const what = v?.kind === 'refresh' ? 'Подписки уже обновляются' : 'Пинг уже проверяется'
    const where = v?.source === 'app' ? ' (запущено на компьютере)' : ''
    return { ok: true, code: 'joined', message: `${what}${where}. Показываю ход.` }
  }
  return r.ok ? { ok: true } : { ok: false, code: r.code, message: r.message }
}
