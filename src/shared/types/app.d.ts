interface AppVersion {
  version: string
  changelog: string
}

interface AppConfig {
  // ---- Migration marker
  configVersion?: number
  // BUILD_ID baked into the main bundle that last wrote this config. When a
  // freshly-installed build sees a different value here it regenerates the
  // TG WS secret + URL so two installs never share credentials.
  lastBuildId?: string

  // ---- Appearance & locale
  appTheme: AppTheme
  customTheme?: string
  disableTray?: boolean
  hideTaskbarIcon?: boolean
  autoLaunch?: boolean
  silentStart?: boolean
  // After LAZEYKA starts and proxies are warmed up, launch these apps.
  // Lets the user disable Telegram/Discord native autostart and let
  // LAZEYKA orchestrate the order: proxy first, app second.
  launchTelegram?: boolean
  launchDiscord?: boolean
  language?: 'en-US' | 'ru-RU' | 'zh-CN'

  // ---- Updates
  autoCheckUpdate: boolean
  // Тег релиза, про который пользователь сказал «не сейчас».
  //
  // Раньше одного этого поля хватало, и кнопка «Позже» глушила окно навсегда:
  // спрашивали снова только когда на GitHub выходил уже следующий релиз. Для
  // человека, который держит LAZEYKA в трее, это означало «никогда».
  dismissedAppUpdateTag?: string
  // До какого момента (epoch ms) молчать про `dismissedAppUpdateTag`.
  //   число  — снуз, после этого времени спросим снова («Позже» = +24 ч);
  //   0      — версия пропущена насовсем («Пропустить эту версию»);
  //   пусто  — конфиг от старой сборки, читается как «пропущена насовсем»,
  //            чтобы обновление приложения не всплыло сразу после установки.
  dismissedAppUpdateUntil?: number

  // Запасное зерно для идентификатора устройства (заголовок x-hwid), когда
  // системный MachineGuid прочитать не удалось. См. core/incy-hwid.ts.
  deviceHwidSeed?: string

  // ---- Logs
  maxLogDays: number

  // ---- Shortcuts
  showWindowShortcut?: string
  restartAppShortcut?: string
  tgwsToggleShortcut?: string
  zapretToggleShortcut?: string

  // ---- GPU / low-level
  disableGPU: boolean

  // ---- Smart Game Mode
  // Watches for known game/Discord processes and flips Zapret's Game Filter
  // to "all" while one is running, restoring the previous mode afterwards.
  // Persisted so the watcher can be restored on the next launch.
  smartGameModeEnabled?: boolean

  // ---- Feature-specific sub-configs
  tgws?: TgwsConfig
  zapret?: ZapretConfig
}

interface TgwsConfig {
  enabled: boolean
  autoStart?: boolean
  host: string            // default 127.0.0.1
  port: number            // default 1443
  secret: string          // 32-hex MTProto secret
  dcIp?: string[]         // e.g. ['2:149.154.167.220']
  bufKb?: number          // default 256
  poolSize?: number       // default 4
  verbose?: boolean
  cfproxy?: boolean
  cfproxyPriority?: boolean
  cfproxyUserDomain?: string
  fakeTlsDomain?: string
  binaryPath?: string     // override path to TgWsProxy_windows.exe
  // Version of the TgWsProxy_windows.exe currently installed in
  // runtime/tgws/. Set by the auto-updater. Used to decide whether a
  // newer Flowseal/tg-ws-proxy release is available.
  installedVersion?: string
  // Tag the user explicitly dismissed via "Later"; updater stays quiet
  // for that exact tag until upstream ships a fresher one.
  dismissedUpdateTag?: string
}

interface ZapretConfig {
  enabled: boolean
  autoStart?: boolean
  activeStrategy?: string          // file name of the .bat strategy
  gameFilterMode?: 'off' | 'all' | 'tcp' | 'udp'   // mirrors service.bat's Game Filter menu
  ipsetMode?: 'none' | 'loaded' | 'any'
  bundlePath?: string              // override path to unpacked zapret folder
  useService?: boolean             // installed as Windows service
  // LAZEYKA's own background check for new Zapret bundle releases (the
  // "Доступно обновление Zapret" banner). Distinct from service.bat's own
  // legacy update checker, which LAZEYKA always skips via NO_UPDATE_CHECK.
  autoUpdateCheck?: boolean
  // Version of the unpacked Flowseal/zapret-discord-youtube bundle in
  // runtime/zapret. Set when the user installs/updates from the auto-
  // updater. Used to decide whether a newer GitHub release exists.
  installedVersion?: string
  // ISO timestamp + tag the user explicitly dismissed via "Later". The
  // updater will stay quiet for that exact tag until a newer one ships.
  dismissedUpdateTag?: string
  // Background strategy autopilot: periodically probes YouTube/Discord and
  // switches to a working strategy when the current one degrades. Persisted
  // so the toggle survives a restart (restored in main/index.ts on boot).
  autopilotEnabled?: boolean
  autopilotIntervalMinutes?: number
}

type CoreStatusState = 'stopped' | 'starting' | 'running' | 'stopping' | 'error'

interface CoreStatus {
  state: CoreStatusState
  pid?: number
  startedAt?: number
  lastError?: string
}
