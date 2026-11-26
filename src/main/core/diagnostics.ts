/**
 * Блок «Диагностика» и панель сервисов: регистрация IPC-каналов diag:*.
 *
 *   diag:services (force?: boolean) — плитки сервисов (кэш 10 минут, force — заново);
 *                                     свежий итог также рассылается событием diag:servicesUpdated
 *   diag:aiDns                      — нейросети по DNS; события diag:aiDnsCell
 *   diag:leaks                      — проверка утечек
 *   diag:wifi                       — Wi-Fi и соседние сети
 *   diag:whitelist                  — определение белых списков
 *
 * Ни один канал ничего не делает сам по себе: проверки запускает только вызов.
 */
import { ipcMain } from 'electron'
import { getServicesReport } from './service-status'
import { runAiDnsCheck } from './ai-dns-check'
import { runLeakCheck } from './leak-check'
import { runWifiScan } from './wifi-scan'
import { runWhitelistCheck } from './whitelist-detect'

/** Конверт { ok, value } / { ok: false, message } — как функция h в utils/ipc.ts. */
function h<T>(fn: (...args: unknown[]) => Promise<T> | T) {
  return async (_event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => {
    try {
      const value = await fn(...args)
      return { ok: true, value }
    } catch (e: unknown) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) }
    }
  }
}

export function registerDiagIpc(): void {
  ipcMain.handle('diag:services', h((force) => getServicesReport(force === true)))
  ipcMain.handle('diag:aiDns', h(() => runAiDnsCheck()))
  ipcMain.handle('diag:leaks', h(() => runLeakCheck()))
  ipcMain.handle('diag:wifi', h(() => runWifiScan()))
  ipcMain.handle('diag:whitelist', h(() => runWhitelistCheck()))
}
