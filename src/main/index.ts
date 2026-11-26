import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { app, BrowserWindow, dialog, Menu, screen } from 'electron'
import windowStateKeeper from 'electron-window-state'
import { join } from 'path'
import icon from '../../resources/icon.png?asset'
import { registerIpcMainHandlers } from './utils/ipc'
import { stopPrematchOnQuit } from './core/prematch'
import { closeMiniWindowOnQuit } from './core/mini-window'
import { stopStreamerOnQuit } from './core/streamer'
import { startLanIfAutostart, stopLanOnQuit } from './core/lan-hub'
import { startHubPolling, stopHubOnQuit } from './core/hub-client'
import { applyRouteMemoryOnStart } from './core/incy-connections'
import { startOnlineCounter } from './core/online-counter'
import { init } from './utils/init'
import { getAppConfig, getAppConfigSync } from './config'
import { createTray, isTrayActive, refreshTray } from './resolve/tray'
import { createApplicationMenu } from './resolve/menu'
import { initShortcut } from './resolve/shortcut'
import { startTgws, stopTgws } from './core/tgws'
import { stopZapret, adoptRunningZapret, autoStartZapret } from './core/zapret'
import { stopZapretMacSync } from './core/zapret-mac'
import { disconnectIncy, loadIncySettings, connectIncyNode } from './core/incy-engine'
import { restoreAutopilotFromConfig } from './core/zapret-autopilot'
import { restoreGameModeFromConfig } from './core/game-mode'
import { clearSystemProxy, clearSystemProxySync } from './utils/system-proxy'
import { appLog } from './utils/app-logger'
import { killRegisteredChildrenSync } from './utils/child-registry'
import { reapOrphanDaemonCore, stopCoreViaDaemonSync } from './core/incy-mac-service'
import { enableAutoRun, disableAutoRun } from './sys/autoRun'
import { isRunningAsAdmin, relaunchElevated, ELEVATED_FLAG } from './utils/elevation'
import { pruneOldLogs, flushLogsNow, currentLogFilePath } from './utils/file-logger'
import { flushStats } from './core/incy-stats'
import { registerDeepLinkScheme, findDeepLinkInArgv, handleDeepLink, setDeepLinkFocusHandler } from './core/deeplink'
import { hardenAppWindow } from './utils/safe-open'
import { installIncyWatchers } from './core/incy-watchers'
import { installAppUpdateWatcher } from './core/app-update-watcher'
import { registerBackgroundScheme, registerBackgroundProtocol, initSystemAppearanceEvents } from './resolve/appearance'
import { captureInstallState } from './core/install-state'
import { attachMainWindowPrefs, mainZoomSeed } from './core/window-prefs'

// Lock the userData / cache / log folder names.
app.setName(is.dev ? 'lazeyka-dev' : 'lazeyka')
// Новая установка или обновление — до init(), который создаёт config.yaml.
captureInstallState()
// Звук подтверждения горячих клавиш играет скрытое окно (трей, игра) — без жеста пользователя.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

export let mainWindow: BrowserWindow | null = null

/** Legacy re-export, kept minimal. */
export function showError(title: string, message: string): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('showError', title, message)
  } else {
    dialog.showErrorBox(title, message)
  }
}

/* Single-instance lock */
if (!app.requestSingleInstanceLock()) {
  app.quit()
}

// Surface unexpected errors to the Logs page instead of silent console spam.
process.on('uncaughtException', (err) => {
  appLog('error', `uncaughtException: ${err.stack || err.message}`)
})
process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? (reason.stack || reason.message) : String(reason)
  appLog('error', `unhandledRejection: ${msg}`)
})

// A `lazeyka://…` link launched while LAZEYKA is already running arrives here,
// as an argv entry of the second (immediately-exiting) instance.
// Пока идёт запуск (проверка прав, init, автозапуск), главного окна ещё нет.
// Раньше клик по ярлыку в этот момент создавал второе главное окно, и первое
// оставалось «сиротой», которым трей не управлял.
let markStartupReady: () => void = () => void 0
const startupReady = new Promise<void>((resolve) => {
  markStartupReady = resolve
})

app.on('second-instance', (_e, argv) => {
  void startupReady.then(() => {
    const link = findDeepLinkInArgv(argv)
    // Подписанная команда с пульта выполняется без главного окна; окно
    // показывает сам handleDeepLink, когда нужно подтверждение.
    if (link) void handleDeepLink(link)
    else void showMainWindow()
  })
})

// macOS delivers the same thing through `open-url` instead of argv. Harmless
// on Windows, and keeps the handler in one place if the app is ever ported.
app.on('open-url', (event, url) => {
  event.preventDefault()
  void startupReady.then(() => {
    if (url.toLowerCase().startsWith('lazeyka://')) void handleDeepLink(url)
    else void showMainWindow()
  })
})
setDeepLinkFocusHandler(() => showMainWindow())

const syncConfig = getAppConfigSync()
if (syncConfig.disableGPU) app.disableHardwareAcceleration()

const initPromise = init()

// Схема lazeyka-bg:// для картинки фона должна быть объявлена до готовности приложения.
registerBackgroundScheme()

app.whenReady().then(async () => {
  registerBackgroundProtocol()
  initSystemAppearanceEvents()
  electronApp.setAppUserModelId('com.lazeyka.app')
  appLog('info', `LAZEYKA запущен (v${app.getVersion()}, ${process.platform}-${process.arch})`)

  // Claim `lazeyka://` so the commands on the URL-схемы page actually resolve
  // to this app. Cheap and idempotent — Windows just rewrites the registry
  // entry if it already points here.
  registerDeepLinkScheme()

  if (process.platform === 'win32' && !is.dev && !(await isRunningAsAdmin())) {
    // Автоматически перезапускаемся с правами администратора (UAC). Флаг защищает от
    // цикла: если повышенная копия всё равно не админ — показываем пояснение.
    if (!process.argv.includes(ELEVATED_FLAG)) {
      appLog('info', 'Нужны права администратора — перезапуск через UAC')
      if (await relaunchElevated()) {
        app.quit()
        return
      }
      appLog('warn', 'Перезапуск с правами администратора не удался или отклонён')
    }
    dialog.showErrorBox(
      'LAZEYKA — нужны права администратора',
      'LAZEYKA должен быть запущен с правами администратора, иначе Zapret\n' +
        '(WinDivert) и автозапуск через Task Scheduler не будут работать.\n\n' +
        'Закройте приложение и запустите его через «Запустить от имени администратора».'
    )
    app.quit()
    return
  }

  try {
    await initPromise
    appLog('info', 'Инициализация завершена')
    // Сироты прошлой сессии (краш, «Снять задачу»): осиротевший sing-box
    // держит TUN и порты, и новый туннель не поднимается.
    const reaped = killRegisteredChildrenSync()
    if (reaped > 0) appLog('warn', `Завершено процессов, оставшихся от прошлого запуска: ${reaped}`)
    // macOS: ядро TUN живёт в службе и переживает краш приложения — без остановки
    // оно держало бы маршруты и DNS, а его Xray-мост уже мёртв.
    if (process.platform === 'darwin') {
      await Promise.race([reapOrphanDaemonCore().catch(() => false), new Promise((r) => setTimeout(r, 5000))])
    }
  } catch (e) {
    appLog('error', `Ошибка инициализации: ${e}`)
    dialog.showErrorBox('LAZEYKA init failed', `${e}`)
    app.quit()
    return
  }

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerIpcMainHandlers()
  const appConfig = await getAppConfig()
  startOnlineCounter()
  // Объявления и ответы автора: один лёгкий запрос через минуту и далее раз в полчаса.
  startHubPolling()
  // Запомненные решения для сайтов возвращаются в правила до подключения VPN.
  try {
    applyRouteMemoryOnStart()
  } catch (e) {
    appLog('warn', `route memory: ${e}`)
  }

  // Log files are new — `maxLogDays` finally has files to rotate. Pruning runs
  // once per launch, which is precise enough for day-granular filenames.
  void pruneOldLogs(appConfig.maxLogDays ?? 7)
  appLog('info', `Логи пишутся в ${currentLogFilePath()}`)

  if (appConfig.tgws?.autoStart) {
    appLog('info', 'Автозапуск Telegram WS — старт')
    startTgws().catch((e) => {
      appLog('error', `Автозапуск Telegram WS упал: ${e}`)
      showError('TG WS start failed', `${e}`)
    })
  }
  if (process.platform !== 'linux' && appConfig.zapret?.autoStart) {
    appLog('info', 'Автозапуск Zapret — старт')
    // Windows: ждёт готовности BFE и сети, затем запускает с самопроверкой и повторами (5/15/30 с).
    // macOS: внутри обычный startZapret().
    autoStartZapret().catch((e) => {
      appLog('error', `Автозапуск Zapret упал: ${e}`)
      // macOS без службы: окно «Нужна служба Zapret» уже показано, второй ошибки не нужно.
      if (e instanceof Error && e.name === 'ZapretMacServiceRequiredError') return
      showError('Zapret start failed', `${e}`)
    })
  } else if (process.platform !== 'win32') {
    // Системная служба Zapret может работать до запуска приложения.
    adoptRunningZapret().catch(() => void 0)
  }

  // INCY autoStart or ensure stale proxy from previous crash/reboot is cleared
  const incySettings = loadIncySettings()
  if (incySettings.autoConnect) {
    appLog('info', 'Автозапуск INCY Proxy — старт')
    connectIncyNode().catch((e) => {
      appLog('warn', `Автозапуск INCY не удался: ${e}`)
    })
  } else {
    // If not running INCY, ensure Windows system proxy is disabled so internet is never blocked
    clearSystemProxy().catch(() => void 0)
  }

  // Synchronise Windows auto-launch with the saved config — keeps the toggle
  // in settings honest if the user manually edited startup outside the app.
  try {
    if (appConfig.autoLaunch) await enableAutoRun()
    else await disableAutoRun()
  } catch (e) {
    appLog('warn', `autoLaunch sync failed: ${e}`)
  }

  // Keep the proxy cores current — but only where it is safe to do so
  // unattended. Patch releases install themselves; a minor/major bump is
  // reported and left alone, because sing-box changes its config schema
  // between minor versions and an unattended jump can break the tunnel.
  // Every candidate binary is validated against our own generated config
  // before it replaces the working one (see incy-core-updater.ts).
  if (appConfig.autoCheckUpdate !== false) {
    void (async () => {
      try {
        const { autoUpdateCores } = await import('./core/incy-core-updater')
        const { installed, pending } = await autoUpdateCores()
        for (const r of installed) {
          appLog(r.success ? 'info' : 'warn', `Ядро ${r.id}: ${r.message}`)
        }
        for (const p of pending) {
          appLog(
            'info',
            `Ядро ${p.id}: доступна версия ${p.latest} (установлена ${p.installed ?? '?'}). ` +
              `${p.note ?? ''}`
          )
        }
      } catch (e) {
        appLog('warn', `Проверка обновлений ядер не удалась: ${e}`)
      }
    })()
  }

  // Refresh the RoscomVPN geo databases in the background.
  //
  // These drive INCY's routing (`geoip:direct`, `geosite:category-ru` …) and
  // upstream rebuilds them daily, so a stale copy quietly degrades routing —
  // newly blocked ranges keep going direct. Runs detached: a slow or blocked
  // GitHub must never hold up the window appearing, and any failure just
  // leaves the previous databases in place.
  if (appConfig.autoCheckUpdate !== false) {
    void (async () => {
      try {
        const { checkGeoUpdate, installGeoUpdate } = await import('./core/incy-geo-updater')
        const info = await checkGeoUpdate()
        if (!info.hasUpdate) return
        appLog('info', 'Обновление гео-баз INCY (RoscomVPN)…')
        const res = await installGeoUpdate()
        for (const f of res.failed) {
          appLog('warn', `Гео-база ${f.fileName} не обновлена: ${f.error}`)
        }
        if (res.updated.length > 0) {
          const summary = res.updated
            .map((u) => `${u.fileName} ${(u.sizeBytes / 1024 / 1024).toFixed(1)} МБ`)
            .join(', ')
          appLog('info', `Гео-базы обновлены: ${summary}`)
        }
      } catch (e) {
        appLog('warn', `Проверка гео-баз не удалась: ${e}`)
      }
    })()
  }

  // Re-arm the background watchers the user left enabled. Both are no-ops
  // unless explicitly switched on, and neither is allowed to abort startup.
  try {
    restoreAutopilotFromConfig(appConfig)
  } catch (e) {
    appLog('warn', `restore autopilot failed: ${e}`)
  }
  // Sleep handling, subscription-expiry notices and the memory monitor. Each
  // reads its own INCY switch on every tick, so nothing runs unless asked.
  try {
    installIncyWatchers()
  } catch (e) {
    appLog('warn', `install INCY watchers failed: ${e}`)
  }
  try {
    restoreGameModeFromConfig(appConfig)
  } catch (e) {
    appLog('warn', `restore game mode failed: ${e}`)
  }

  await createWindow(appConfig)
  markStartupReady()
  // «Локальная сеть» поднимается сама, только если пользователь поставил «включать при запуске».
  void startLanIfAutostart()

  const uiTasks: Promise<unknown>[] = [initShortcut()]
  if (!appConfig.disableTray) uiTasks.push(createTray())
  await Promise.all(uiTasks)

  // Проверка обновлений живёт здесь, а не в окне: при автозапуске со скрытым
  // окном рендерер никому ничего показать не может — см. app-update-watcher.
  try {
    installAppUpdateWatcher()
  } catch (e) {
    appLog('warn', `install update watcher failed: ${e}`)
  }

  app.on('activate', () => {
    showMainWindow()
  })

  // Cold start from a link: Windows launched the app *with* the URL in argv.
  // Runs last, after the window exists, so the command can broadcast a refresh
  // to a renderer that is actually listening.
  const launchLink = findDeepLinkInArgv(process.argv)
  if (launchLink) void handleDeepLink(launchLink)
})

app.on('window-all-closed', () => {
  app.quit()
})

let cleanupRan = false
let isQuitting = false

/**
 * Synchronous, fire-and-forget cleanup that runs when the app quits. Kills
 * every child process LAZEYKA ever spawned and unloads the WinDivert kernel
 * driver from memory so its `.sys` file is no longer locked on disk.
 *
 * IMPORTANT: we deliberately do NOT `sc delete` the WinDivert service. After
 * a reboot the LogonTrigger task fires LAZEYKA during winlogon (before most
 * system services finish initialising); at that moment the SCM is busy and
 * `CreateService` from a freshly-spawned winws.exe races against it. The
 * race manifests as `WinDivertOpen()` failing silently — winws.exe stays
 * alive in the process list (so the UI shows "running") but no packets are
 * intercepted, so Discord/YouTube/etc. don't work even though LAZEYKA
 * claims everything is fine. Keeping the service registered across quits
 * means winws.exe only has to call `StartService` on next boot, which is
 * synchronous and immune to the SCM race.
 *
 * `sc stop` alone is enough to make the install folder deletable: stopping
 * the service unloads the driver, releasing the kernel handle on the .sys
 * file. The leftover registry entry is just a few bytes pointing at the .sys
 * path; if the user moves LAZEYKA to a new folder, `verifyWinDivertService`
 * (called on every Zapret start) detects the path mismatch and forces
 * re-registration.
 *
 * Belt-and-braces: safe to call repeatedly, every step swallows its own
 * errors (services that aren't loaded, processes that no longer exist, etc.).
 */
function syncKillChildren(): void {
  if (process.platform === 'linux') {
    try {
      clearSystemProxySync()
      killRegisteredChildrenSync()
    } catch { /* noop */ }
    return
  }
  if (process.platform === 'darwin') {
    // macOS: свои дочерние процессы по PID из реестра + возврат системного прокси.
    try {
      killRegisteredChildrenSync()
      clearSystemProxySync()
      // Zapret в root-службе: выход из LAZEYKA выключает его, как и на Windows (без пароля).
      stopZapretMacSync()
      // Ядро TUN в службе: синхронно «постучаться» в неё запросом stop (best effort).
      stopCoreViaDaemonSync()
    } catch { /* noop */ }
    return
  }
  if (process.platform !== 'win32') return
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { spawnSync } = require('child_process') as typeof import('child_process')
    const opts = { windowsHide: true, timeout: 2000 } as const

    // 1) Kill known LAZEYKA child binaries by image name. /T tears down the
    //    whole process tree, so cfproxy worker pools spawned by TgWsProxy
    //    and winws.exe sub-children are caught too.
    //    sing-box, xray и TgWsProxy — строго по своим PID из реестра: раньше
    //    здесь был `taskkill /IM sing-box.exe`, который заодно убивал ядра
    //    Hiddify / v2rayN / NekoBox и отдельно запущенный Flowseal.
    killRegisteredChildrenSync()
    // Выход из LAZEYKA выключает Zapret целиком — так задумано.
    spawnSync('taskkill.exe', ['/F', '/IM', 'winws.exe', '/T'], opts)

    // 2) Stop the WinDivert kernel driver — unloads it from memory so the
    //    `.sys` file is no longer locked on disk. We DO NOT delete the
    //    service registration (see function-level comment for the rationale).
    for (const svc of ['WinDivert', 'windivert', 'WinDivert64', 'windivert64']) {
      spawnSync('sc.exe', ['stop', svc], opts)
    }

    // 3) Системный прокси, который включала LAZEYKA, возвращаем как было
    //    (чужой прокси пользователя больше не выключается).
    clearSystemProxySync()
  } catch { /* noop */ }
}

async function cleanupServices(): Promise<void> {
  if (cleanupRan) return
  cleanupRan = true
  await Promise.race([
    Promise.all([stopTgws(), disconnectIncy(), ...(process.platform === 'linux' ? [] : [stopZapret()])]).catch(() => void 0),
    new Promise<void>((r) => setTimeout(r, 3000))
  ])
  // Write out whatever is still queued — the last lines before a shutdown are
  // usually the interesting ones.
  await flushLogsNow().catch(() => void 0)
  // Same for traffic counters: they are batched to disk every 5 s, so a quit
  // in between would drop the tail of the session.
  try {
    flushStats()
  } catch { /* noop */ }
  syncKillChildren()
}

app.on('before-quit', async (e) => {
  e.preventDefault()
  if (isQuitting) return
  isQuitting = true
  saveWindowState()
  appLog('info', 'Выход из приложения, остановка всех сервисов…')
  // Игровая сессия «Перед каткой»: сохранить отчёт до остановки служб.
  try {
    stopPrematchOnQuit()
  } catch {
    /* отчёт не критичен для выхода */
  }
  // Новые службы 1.3.0: каждая останавливается отдельно, сбой одной не мешает выходу.
  for (const stop of [closeMiniWindowOnQuit, stopStreamerOnQuit, stopHubOnQuit]) {
    try {
      stop()
    } catch {
      /* noop */
    }
  }
  // Drain the local network checks before Chromium shuts down.
  await Promise.allSettled([
    cleanupServices(),
    Promise.race([
      stopLanOnQuit(),
      new Promise<void>((resolve) => setTimeout(resolve, 1500))
    ])
  ])
  app.exit(0)
})

// Explicit exit and console signals delivered to Electron share the same cleanup.
process.on('exit', () => syncKillChildren())
process.on('SIGINT', () => app.quit())
process.on('SIGTERM', () => app.quit())

/** Размер окна по умолчанию (2.0): на 1280×860 Главная видна целиком. */
export const DEFAULT_WIN_W = 1280
export const DEFAULT_WIN_H = 860
let windowState: ReturnType<typeof windowStateKeeper> | null = null

/** Записать размер, место и монитор окна (перед выходом: app.exit не даёт окну закрыться обычным путём). */
function saveWindowState(): void {
  try {
    if (windowState && mainWindow && !mainWindow.isDestroyed() && !mainWindow.isMinimized()) windowState.saveState(mainWindow)
  } catch {
    /* не важно: при следующем изменении запишется снова */
  }
}

export async function createWindow(appConfig?: AppConfig): Promise<void> {
  const config = appConfig ?? (await getAppConfig())
  const { silentStart = false } = config

  // Размер по умолчанию 2.0: вся Главная видна без прокрутки. На маленьких экранах — сколько помещается.
  const work = screen.getPrimaryDisplay().workAreaSize
  const defW = Math.max(860, Math.min(DEFAULT_WIN_W, work.width - 40))
  const defH = Math.max(600, Math.min(DEFAULT_WIN_H, work.height - 40))
  const mainWindowState = windowStateKeeper({
    defaultWidth: defW,
    defaultHeight: defH,
    file: 'window-state.json'
  })
  windowState = mainWindowState
  // До 2.0 размер по умолчанию был 1000×720. Кто его не менял (ровно этот размер и окно не развёрнуто),
  // получает новый размер по центру экрана; кто подогнал окно сам — открывается как настроил.
  const legacyDefault = mainWindowState.width === 1000 && mainWindowState.height === 720 && !mainWindowState.isMaximized
  const startW = legacyDefault ? defW : mainWindowState.width
  const startH = legacyDefault ? defH : mainWindowState.height
  const startX = legacyDefault ? undefined : mainWindowState.x
  const startY = legacyDefault ? undefined : mainWindowState.y

  if (process.platform === 'darwin') {
    await createApplicationMenu()
  } else {
    Menu.setApplicationMenu(null)
  }

  // Compute initial skipTaskbar based on the user's hideTaskbarIcon +
  // tray-enabled combination. Hiding from the taskbar without a tray icon
  // is never allowed — the recovery path would vanish.
  const initialSkipTaskbar = !!config.hideTaskbarIcon && !config.disableTray

  mainWindow = new BrowserWindow({
    minWidth: 860,
    minHeight: 600,
    width: startW,
    height: startH,
    x: startX,
    y: startY,
    center: startX === undefined || startY === undefined,
    show: false,
    // LAZEYKA ships with a custom in-app titlebar (see WindowControls), so
    // the native OS frame is always disabled — there is no user-facing
    // option to re-enable it.
    frame: false,
    fullscreenable: false,
    titleBarStyle: 'hidden',
    // macOS: родные кнопки окна над шапкой меню (под них в app-sidebar есть отступ).
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 14, y: 12 } } : {}),
    autoHideMenuBar: true,
    backgroundMaterial: process.platform === 'win32' ? 'mica' : undefined,
    skipTaskbar: initialSkipTaskbar,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      spellcheck: false,
      sandbox: true,
      // Е6: масштаб из настроек и только у этого окна (см. core/window-prefs.ts).
      zoomFactor: mainZoomSeed(config)
    }
  })
  mainWindowState.manage(mainWindow)
  // Е6: «поверх всех окон» и масштаб окна из настроек.
  attachMainWindowPrefs(mainWindow, config)
  // Библиотека пишет файл только при настоящем закрытии окна, а LAZEYKA при закрытии уходит в трей
  // и выходит через app.exit — тогда размер и место не сохранялись. Пишем сами: после изменения
  // размера/положения (с задержкой) и перед выходом (см. before-quit).
  let saveTimer: NodeJS.Timeout | null = null
  const saveSoon = (): void => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isMinimized()) mainWindowState.saveState(mainWindow)
    }, 800)
  }
  for (const ev of ['resize', 'move', 'maximize', 'unmaximize'] as const) mainWindow.on(ev as 'resize', saveSoon)

  mainWindow.on('ready-to-show', () => {
    // Only honour silentStart when the tray icon is enabled — otherwise the
    // window would be invisible AND there'd be no tray icon to bring it back,
    // which is exactly the "app launches into nothing" bug we hit before.
    if (silentStart && !config.disableTray) return
    mainWindow?.show()
    mainWindow?.focus()
  })

  mainWindow.on('close', (e) => {
    if (isQuitting) return
    const cfg = getAppConfigSync()
    const trayOn = !cfg.disableTray
    const hideTaskbarOn = !!cfg.hideTaskbarIcon

    if (trayOn && isTrayActive()) {
      e.preventDefault()
      if (hideTaskbarOn) {
        appLog('info', 'Окно скрыто в трей (таскбар отключён)')
        mainWindow?.setSkipTaskbar(true)
        mainWindow?.hide()
      } else {
        appLog('info', 'Окно свёрнуто (доступно в панели задач и в трее)')
        mainWindow?.setSkipTaskbar(false)
        mainWindow?.minimize()
      }
      return
    }

    // Tray off (or tray creation failed) → real close → before-quit cleanup.
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  const onWindowVisibilityChange = (kind: string): void => {
    refreshTray().catch(() => void 0)
    try {
      mainWindow?.webContents.send('window:visibility', kind)
    } catch {
      /* noop */
    }
  }
  // The custom titlebar swaps its maximise/restore icon on these two events.
  // They were listened for in WindowControls but never emitted, so the icon
  // kept showing "maximise" even while the window was maximised.
  mainWindow.on('maximize', () => {
    try { mainWindow?.webContents.send('window-maximized') } catch { /* noop */ }
  })
  mainWindow.on('unmaximize', () => {
    try { mainWindow?.webContents.send('window-unmaximized') } catch { /* noop */ }
  })

  mainWindow.on('show', () => onWindowVisibilityChange('show'))
  mainWindow.on('hide', () => onWindowVisibilityChange('hide'))
  mainWindow.on('minimize', () => onWindowVisibilityChange('minimize'))
  mainWindow.on('restore', () => onWindowVisibilityChange('restore'))
  mainWindow.on('focus', () => onWindowVisibilityChange('focus'))
  mainWindow.on('blur', () => onWindowVisibilityChange('blur'))

  // Внешние ссылки — только http/https через фильтр; переход окна на чужой адрес запрещён.
  hardenAppWindow(mainWindow)

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

export async function showMainWindow(): Promise<void> {
  if (!mainWindow) await createWindow()
  const w = mainWindow as BrowserWindow | null
  if (!w) return
  if (w.isMinimized()) w.restore()
  // Restore skipTaskbar according to the CURRENT hideTaskbarIcon setting.
  const cfg = getAppConfigSync()
  const shouldSkip = !!cfg.hideTaskbarIcon && !cfg.disableTray
  w.setSkipTaskbar(shouldSkip)
  w.show()
  w.focus()
}

export function closeMainWindow(): void {
  mainWindow?.close()
}

export async function triggerMainWindow(): Promise<void> {
  await setMainWindowVisible('toggle')
}

/**
 * Показать / спрятать главное окно (горячая клавиша окна, сценарии, пульт).
 * 'toggle': окно на переднем плане — прячем в трей; свёрнуто, спрятано или закрыто другими окнами —
 * показываем поверх. Раньше окно, закрытое другими окнами, по клавише пряталось, а не поднималось.
 * Возвращает true, если окно теперь видно.
 */
export async function setMainWindowVisible(mode: 'show' | 'hide' | 'toggle'): Promise<boolean> {
  const w = mainWindow
  const inFront = Boolean(w && !w.isDestroyed() && w.isVisible() && !w.isMinimized() && w.isFocused())
  const hide = mode === 'hide' || (mode === 'toggle' && inFront)
  if (hide) {
    if (w && !w.isDestroyed() && w.isVisible()) w.hide()
    return false
  }
  await showMainWindow()
  return true
}
