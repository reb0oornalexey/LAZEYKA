/**
 * Подключение общего менеджера «Проверить пинг» / «Обновить подписки» (incy-ops.ts) к программе.
 *
 * Один экземпляр на приложение: им пользуются и окно (каналы ниже), и пульт с телефона (lan-hub.ts).
 *
 * Каналы (ответ `{ ok, value }` / `{ ok: false, message }`):
 *   incy:opsGet()                         → OpSnapshot
 *   incy:opsStart(kind, scope)            → OpStartResult (kind: 'ping' | 'refresh'; scope — см. OpScope)
 *   incy:opsStop()                        → { ok, view }
 * Событие в окна: `incy:opsUpdate` (OpSnapshot) — при запуске, каждом результате (не чаще ~5 раз в секунду),
 * нажатии «Остановить» и в конце. Таймеров нет: рассылка идёт только пока действие что-то делает.
 */
import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import {
  appendLog,
  getIncyStatus,
  loadIncyNodes,
  loadIncySettings,
  loadIncySubscriptions,
  pingIncyNode,
  refreshIncySubscription,
  saveIncyLatencies,
  type IncyNode
} from './incy-engine'
import { onServiceStatusChanged } from '../utils/status-bus'
import { IncyOpsManager, parseScope, type OpKind, type OpSnapshot, type OpView } from './incy-ops'

const THROTTLE_MS = 200
let lastSent = 0
let pendingTimer: NodeJS.Timeout | null = null
let lastRunning = false
let finishListeners: ((v: OpView) => void)[] = []

function send(snap: OpSnapshot): void {
  lastSent = Date.now()
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) {
      try {
        w.webContents.send('incy:opsUpdate', snap)
      } catch {
        /* окно закрывается */
      }
    }
  }
}

/** Начало, конец и «Остановить» уходят сразу; промежуточный прогресс — не чаще раза в THROTTLE_MS. */
function broadcast(snap: OpSnapshot): void {
  const running = Boolean(snap.view?.running)
  const edge = running !== lastRunning || Boolean(snap.view?.stopping)
  lastRunning = running
  if (pendingTimer) {
    clearTimeout(pendingTimer)
    pendingTimer = null
  }
  const wait = THROTTLE_MS - (Date.now() - lastSent)
  if (edge || wait <= 0) {
    send(snap)
    return
  }
  // Последний снимок всё равно дойдёт: таймер живёт не дольше THROTTLE_MS и только во время действия.
  pendingTimer = setTimeout(() => {
    pendingTimer = null
    send(incyOps.snapshot())
  }, wait)
}

export const incyOps = new IncyOpsManager<IncyNode>({
  nodes: () => loadIncyNodes(),
  subscriptions: () => loadIncySubscriptions().map((s) => ({ id: s.id, title: s.title })),
  // Те же настройки, что у обработчика incy:pingNode: «Настройки пинга» действуют на любой замер.
  pingNode: (node, signal) => {
    const s = loadIncySettings()
    return pingIncyNode(node, (s.pingTimeoutSec || 3) * 1000, { protocol: s.pingProtocol, testUrl: s.pingTestUrl, signal })
  },
  saveLatencies: (results) => void saveIncyLatencies(results),
  refreshOne: async (id) => {
    try {
      return await refreshIncySubscription(id)
    } catch (e) {
      const title = loadIncySubscriptions().find((s) => s.id === id)?.title ?? id
      appendLog(`Подписка «${title}» не обновилась: ${e instanceof Error ? e.message : String(e)}`)
      throw e
    }
  },
  pingAfterRefresh: () => Boolean(loadIncySettings().pingOnUpdateSubscription),
  onChange: broadcast,
  onFinish: (v) => {
    for (const fn of finishListeners) {
      try {
        fn(v)
      } catch {
        /* слушатель не должен ломать остальных */
      }
    }
  }
})

/** Итог действия для пульта (плашка на телефоне) и лога. Возвращает отписку. */
export function onIncyOpFinish(fn: (v: OpView) => void): () => void {
  finishListeners.push(fn)
  return () => {
    finishListeners = finishListeners.filter((f) => f !== fn)
  }
}

function hx<T>(fn: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<T> | T) {
  return async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    try {
      return { ok: true, value: await fn(event, ...args) }
    } catch (e: unknown) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) }
    }
  }
}

function parseKind(k: unknown): OpKind {
  if (k === 'ping' || k === 'refresh') return k
  throw new Error('Неизвестное действие')
}

export function registerIncyOpsIpc(): void {
  const routeKey = (): string => {
    const s = getIncyStatus()
    return JSON.stringify([s.state, s.activeNodeId, s.connectedAt, s.connectionMode, s.routingMode])
  }
  let route = routeKey()
  onServiceStatusChanged(() => {
    const next = routeKey()
    if (next === route) return
    route = next
    if (incyOps.view()?.kind === 'ping') incyOps.stop('маршрут INCY изменился. Запустите замер снова')
  })
  ipcMain.handle('incy:opsGet', hx(() => incyOps.snapshot()))
  ipcMain.handle(
    'incy:opsStart',
    hx((_e, kind, scope) => {
      const sc = parseScope(scope)
      if (!sc) throw new Error('Неверный объём проверки')
      return incyOps.start(parseKind(kind), sc, 'app')
    })
  )
  ipcMain.handle('incy:opsStop', hx(() => incyOps.stop()))
}
