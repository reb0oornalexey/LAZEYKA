/**
 * Е6: состояние служб во всплывающей подсказке значка в трее.
 *
 * Текст собирается при каждой пересборке меню трея (она и так идёт по событиям
 * окна и раз в 10 с) и сразу при смене состояния служб — по сигналу
 * utils/status-bus (его шлют Zapret, Telegram-прокси и INCY). Своего опроса нет.
 * Настройка выключена — подсказка просто «LAZEYKA», как раньше.
 */
import { getAppConfigSync } from '../config'
import { onServiceStatusChanged } from '../utils/status-bus'
import { buildTrayTooltip } from './tray-tooltip-logic'

export { buildTrayTooltip }

let nodeCache: { id: string; at: number; name: string; ping: number | null } | null = null

/** Текст подсказки сейчас (вызывается из пересборки меню трея). */
export async function trayTooltipText(s: { zapret: string; tgws: string; incy: string; activeNodeId?: string | null }): Promise<string> {
  if (getAppConfigSync().trayStatusTooltip === false) return 'LAZEYKA'
  let node: string | null = null
  let ping: number | null = null
  if (s.incy === 'running' && s.activeNodeId) {
    // Узлы лежат в файле — читаем не чаще раза в 15 с.
    if (!nodeCache || nodeCache.id !== s.activeNodeId || Date.now() - nodeCache.at > 15_000) {
      try {
        const { loadIncyNodes } = await import('../core/incy-engine')
        const n = loadIncyNodes().find((x) => x.id === s.activeNodeId)
        nodeCache = { id: s.activeNodeId, at: Date.now(), name: n?.name ?? '', ping: n?.latencyMs ?? null }
      } catch {
        nodeCache = null
      }
    }
    node = nodeCache?.name ?? null
    ping = nodeCache?.ping ?? null
  }
  let hideNode = false
  try {
    hideNode = (await import('../core/streamer')).streamerHidesNotifications()
  } catch {
    /* режим стримера недоступен */
  }
  return buildTrayTooltip({ ...s, hasTgws: process.platform === 'win32', node, pingMs: ping, hideNode })
}

let offStatus: (() => void) | null = null
let pending: NodeJS.Timeout | null = null

/** Пересобирать меню и подсказку трея при смене состояния служб (одна подписка). */
export function watchServiceStatusForTray(refresh: () => Promise<void>): void {
  if (offStatus) return
  offStatus = onServiceStatusChanged(() => {
    // Несколько сигналов подряд (служба запускается) — одна пересборка.
    if (pending) return
    pending = setTimeout(() => {
      pending = null
      void refresh().catch(() => void 0)
    }, 300)
  })
}
