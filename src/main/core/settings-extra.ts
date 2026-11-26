/**
 * Е6: IPC новых строк «Настроек»: сброс размера окна, очистка кэша, копии
 * профиля перед обновлением, путь проверки обновлений.
 */
import { ipcMain } from 'electron'
import { DEFAULT_WIN_H, DEFAULT_WIN_W } from '..'
import { resetMainWindowBounds } from './window-prefs'
import { cacheInfo, clearCache } from './cache-cleaner'
import { listProfileBackups, restoreProfileBackup } from './profile-backups'
import { updateProxyPort } from './update-route'

type Envelope<T> = { ok: true; value: T } | { ok: false; message: string }

function h<T>(fn: (...args: unknown[]) => Promise<T> | T) {
  return async (_e: Electron.IpcMainInvokeEvent, ...args: unknown[]): Promise<Envelope<T>> => {
    try {
      return { ok: true, value: await fn(...args) }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) }
    }
  }
}

export function registerSettingsExtraIpc(): void {
  ipcMain.handle('settingsx:resetWindow', h(() => resetMainWindowBounds(DEFAULT_WIN_W, DEFAULT_WIN_H)))
  ipcMain.handle('settingsx:cacheInfo', h(() => cacheInfo()))
  ipcMain.handle('settingsx:clearCache', h(() => clearCache()))
  ipcMain.handle('settingsx:backups', h(() => listProfileBackups()))
  ipcMain.handle('settingsx:restoreBackup', h((id) => restoreProfileBackup(String(id ?? ''))))
  // Пойдёт ли проверка обновлений через VPN INCY прямо сейчас.
  ipcMain.handle('settingsx:updateRoute', h(async () => ({ viaIncy: (await updateProxyPort()) !== null })))
}
