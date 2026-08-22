import { app, Menu, nativeImage, Tray } from 'electron'
import { resolve, join } from 'path'
import { existsSync } from 'fs'
import { mainWindow, triggerMainWindow, showMainWindow } from '..'
import { startTgws, stopTgws, getTgwsStatus } from '../core/tgws'
import { startZapret, stopZapret, getZapretStatus, listStrategies, restartZapret } from '../core/zapret'
import { getIncyStatus, connectIncyNode, disconnectIncy } from '../core/incy-engine'
import { getAppConfigSync, patchAppConfig } from '../config'
import { appLog } from '../utils/app-logger'

let tray: Tray | null = null
let rebuildInterval: NodeJS.Timeout | null = null
let rebuildTrayMenu: (() => Promise<void>) | null = null
let currentIconOn: boolean | null = null

/**
 * Load a tray-ready nativeImage for the given on/off state. Tries .ico first
 * (preferred on Windows because the system can pick the right size frame),
 * falls back to .png if the .ico is missing or rejected by the OS.
 */
function loadTrayImage(on: boolean): Electron.NativeImage {
  const ico = iconPath(on)
  let image = nativeImage.createFromPath(ico)
  if (image.isEmpty()) {
    appLog('warn', `Tray image empty for ${ico}, using PNG fallback`)
    image = nativeImage.createFromPath(ico.replace(/\.ico$/i, '.png'))
  }
  return image.isEmpty() ? nativeImage.createEmpty() : image
}

/**
 * Trigger an immediate tray-menu rebuild from outside this module. Used by
 * `mainWindow.on('show'/'hide'/'minimize'/'restore')` in src/main/index.ts
 * so the «Показать/Скрыть окно» label always reflects reality without
 * waiting for the 2-second background rebuildInterval. No-op if tray is
 * disabled / destroyed.
 */
export async function refreshTray(): Promise<void> {
  if (rebuildTrayMenu) await rebuildTrayMenu()
}

/**
 * Resolve the tray icon file path. We try multiple known locations because
 * `app.getAppPath()` and `process.resourcesPath` mean different things in
 * dev vs packaged builds:
 *   - dev:        app.getAppPath() = <project root>; resources at /resources
 *   - packaged:   app.getAppPath() = <install>/resources/app.asar (no FS);
 *                 process.resourcesPath = <install>/resources (icons live here)
 * If none of the candidates exist we log a warning so the silent
 * "tray icon doesn't appear" failure mode is at least diagnosable.
 */
function iconPath(on: boolean): string {
  const ico = on ? 'icon_on.ico' : 'icon_off.ico'
  const png = on ? 'icon_on.png' : 'icon_off.png'
  const candidates: string[] = []
  if (process.resourcesPath) {
    candidates.push(join(process.resourcesPath, ico))
    candidates.push(join(process.resourcesPath, png))
  }
  candidates.push(resolve(app.getAppPath(), 'resources', ico))
  candidates.push(resolve(app.getAppPath(), 'resources', png))
  candidates.push(resolve(__dirname, '../../resources', ico))
  candidates.push(resolve(__dirname, '../../resources', png))

  for (const c of candidates) {
    if (existsSync(c)) {
      appLog('info', `Tray icon resolved: ${c}`)
      return c
    }
  }
  appLog('warn', `Tray icon NOT FOUND. Tried:\n  ${candidates.join('\n  ')}`)
  return candidates[0] ?? ''
}

export async function createTray(): Promise<void> {
  if (tray) destroyTray()

  try {
    tray = new Tray(loadTrayImage(false))
    currentIconOn = false
  } catch (e) {
    appLog('error', `Tray creation failed: ${e}`)
    return
  }
  tray.setToolTip('LAZEYKA')

  const rebuild = async (): Promise<void> => {
    if (!tray) return
    const tgws = getTgwsStatus()
    const zapret = getZapretStatus()
    const incy = getIncyStatus()
    const cfg = getAppConfigSync()
    const activeStrategy = cfg.zapret?.activeStrategy

    const anyRunning = tgws.state === 'running' || zapret.state === 'running' || incy.state === 'running'
    if (anyRunning !== currentIconOn) {
      tray.setImage(loadTrayImage(anyRunning))
      currentIconOn = anyRunning
    }

    const availableStrategies = listStrategies()
    const strategyMenuItems = availableStrategies.slice(0, 10).map((s) => ({
      label: s.title,
      type: 'radio' as const,
      checked: s.file === activeStrategy,
      click: async () => {
        await patchAppConfig({ zapret: { ...cfg.zapret, activeStrategy: s.file } as any })
        if (zapret.state === 'running') {
          await restartZapret()
        }
        await refreshTray()
      }
    }))

    const menu = Menu.buildFromTemplate([
      {
        label: mainWindow?.isVisible() ? 'Скрыть окно' : 'Показать окно',
        click: () => triggerMainWindow()
      },
      { type: 'separator' },
      {
        label: `INCY VPN: ${incy.state === 'running' ? 'Подключен' : incy.state === 'connecting' ? 'Подключение...' : 'Отключен'}`,
        submenu: [
          { label: 'Подключить', enabled: incy.state !== 'running' && incy.state !== 'connecting', click: () => { connectIncyNode().catch(() => void 0) } },
          { label: 'Отключить', enabled: incy.state === 'running', click: () => { disconnectIncy().catch(() => void 0) } }
        ]
      },
      {
        label: `Zapret: ${zapret.state === 'running' ? 'Запущен' : zapret.state === 'starting' ? 'Запуск...' : 'Остановлен'}`,
        submenu: [
          { label: 'Запустить', enabled: zapret.state !== 'running' && zapret.state !== 'starting', click: () => { startZapret().catch(() => void 0) } },
          { label: 'Остановить', enabled: zapret.state === 'running', click: () => { stopZapret().catch(() => void 0) } }
        ]
      },
      {
        label: `Telegram: ${tgws.state === 'running' ? 'Запущен' : tgws.state === 'starting' ? 'Запуск...' : 'Остановлен'}`,
        submenu: [
          { label: 'Запустить', enabled: tgws.state !== 'running' && tgws.state !== 'starting', click: () => { startTgws().catch(() => void 0) } },
          { label: 'Остановить', enabled: tgws.state === 'running', click: () => { stopTgws().catch(() => void 0) } }
        ]
      },
      ...(strategyMenuItems.length > 0
        ? [
            {
              label: 'Быстрое переключение стратегии',
              submenu: strategyMenuItems
            }
          ]
        : []),
      { type: 'separator' },
      { label: 'Выйти из LAZEYKA', click: () => { app.quit() } }
    ])
    tray.setContextMenu(menu)
  }

  tray.on('click', () => showMainWindow())
  tray.on('double-click', () => triggerMainWindow())

  // Expose rebuild() so external triggers (window show/hide/minimize) can
  // refresh the «Показать/Скрыть окно» label instantly via refreshTray().
  rebuildTrayMenu = rebuild
  await rebuild()
  // Refresh menu on a lazy interval; event-driven refreshTray() handles immediate updates
  rebuildInterval = setInterval(rebuild, 10000)
}

export function destroyTray(): void {
  if (rebuildInterval) {
    clearInterval(rebuildInterval)
    rebuildInterval = null
  }
  rebuildTrayMenu = null
  currentIconOn = null
  tray?.destroy()
  tray = null
}

/** Used by the close handler to verify the tray is actually alive before
 * hiding the window into it — otherwise the user would be stranded with a
 * hidden window and no way to restore it. */
export function isTrayActive(): boolean {
  return tray !== null && !tray.isDestroyed()
}