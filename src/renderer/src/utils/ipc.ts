interface IpcResult<T> {
  ok: boolean
  value?: T
  message?: string
}

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const res = (await window.electron.ipcRenderer.invoke(channel, ...args)) as IpcResult<T>
  if (!res || !res.ok) {
    throw new Error(res?.message ?? `IPC ${channel} failed`)
  }
  return res.value as T
}

// ---- App config -------------------------------------------------------------
export const getAppConfig = (): Promise<AppConfig> => invoke('app:getConfig')
export const patchAppConfig = (patch: Partial<AppConfig>): Promise<void> =>
  invoke('app:patchConfig', patch)
export const getAppVersion = (): Promise<string> => invoke('app:version')

// ---- Theme ------------------------------------------------------------------
export const setNativeTheme = (theme: AppTheme | 'system'): Promise<void> =>
  invoke('theme:setNative', theme)
export const applyTheme = (file: string): Promise<void> => invoke('theme:apply', file)
export const readThemeCss = (file: string): Promise<string> => invoke('theme:read', file)
export const appearanceListBackgrounds = (): Promise<string[]> => invoke('appearance:listBackgrounds')
export const appearanceRemoveBackground = (name: string): Promise<void> => invoke('appearance:removeBackground', name)
export const appearanceSave = (value: AppearanceConfig): Promise<void> => invoke('appearance:save', value)
export const appearancePickBackground = (): Promise<string | null> => invoke('appearance:pickBackground')
export const appearanceExportTheme = (json: string, name: string): Promise<boolean> =>
  invoke('appearance:exportTheme', json, name)
export const appearanceGetSystem = (): Promise<{ dark: boolean; accent: string | null }> =>
  invoke('appearance:getSystem')
export const appearanceImportTheme = (): Promise<string | null> => invoke('appearance:importTheme')

// ---- Utility ----------------------------------------------------------------
export const openTelegramLink = (url: string): Promise<void> => invoke('shell:openTelegramLink', url)
export const openExternalUrl = (url: string): Promise<void> => invoke('shell:openExternal', url)
export const writeClipboard = (text: string): Promise<void> =>
  invoke('clipboard:writeText', text)

// ---- TG WS Proxy ------------------------------------------------------------
export const tgwsStatus = (): Promise<CoreStatus> => invoke('tgws:status')
export const tgwsStart = (): Promise<void> => invoke('tgws:start')
export const tgwsStop = (): Promise<void> => invoke('tgws:stop')
export const tgwsRestart = (): Promise<void> => invoke('tgws:restart')
export const tgwsGetLink = (): Promise<string> => invoke('tgws:getLink')

export interface TgwsUpdateInfo {
  installed?: string
  latest?: string
  hasUpdate: boolean
  assetName?: string
  assetUrl?: string
  assetSize?: number
  releaseUrl?: string
  publishedAt?: string
  dismissed?: boolean
}
export const tgwsCheckUpdate = (force = false): Promise<TgwsUpdateInfo> =>
  invoke('tgws:checkUpdate', force)
export const tgwsInstallUpdate = (
  url: string,
  expectedVersion?: string
): Promise<{ installedVersion?: string; sizeBytes: number }> =>
  invoke('tgws:installUpdate', url, expectedVersion)
export const tgwsDismissUpdate = (tag: string): Promise<void> =>
  invoke('tgws:dismissUpdate', tag)

export interface TgwsWorkerCheck {
  domain: string
  ok: boolean
  ms: number | null
  detail: string
}
/** Проверить свои Cloudflare Worker'ы WebSocket-рукопожатием, как это делает Flowseal. */
export const tgwsCheckWorkers = (): Promise<TgwsWorkerCheck[]> => invoke('tgws:checkWorkers')

export type UpdatableComponent = 'zapret' | 'tgws'
export interface ComponentReleaseNote {
  tag: string
  version: string
  title: string
  /** Заметки автора к релизу (markdown). */
  body: string
  publishedAt?: string
  url?: string
  /** Архив для установки именно этой версии. */
  assetUrl?: string
  installed: boolean
}
/** История релизов Zapret / TgWsProxy с GitHub автора. */
export const componentReleaseHistory = (
  component: UpdatableComponent,
  page = 1,
  perPage = 6
): Promise<ComponentReleaseNote[]> => invoke('component:releaseHistory', component, page, perPage)

// ---- Zapret -----------------------------------------------------------------
export const zapretStatus = (): Promise<CoreStatus> => invoke('zapret:status')
export const zapretListStrategies = (): Promise<{ file: string; title: string; description: string }[]> =>
  invoke('zapret:listStrategies')
export const zapretStart = (): Promise<void> => invoke('zapret:start')
export const zapretStop = (): Promise<void> => invoke('zapret:stop')
export const zapretRestart = (): Promise<void> => invoke('zapret:restart')
export const zapretInstallBundle = (bytes: Uint8Array): Promise<{ strategies: number }> =>
  invoke('zapret:installBundle', bytes)

export interface ZapretUpdateInfo {
  installed?: string
  latest?: string
  hasUpdate: boolean
  assetName?: string
  assetUrl?: string
  assetSize?: number
  releaseUrl?: string
  publishedAt?: string
  dismissed?: boolean
}
export const zapretCheckUpdate = (force = false): Promise<ZapretUpdateInfo> =>
  invoke('zapret:checkUpdate', force)
export const zapretInstallUpdate = (
  url: string,
  expectedVersion?: string
): Promise<{ strategies: number; installedVersion?: string }> =>
  invoke('zapret:installUpdate', url, expectedVersion)
export const zapretDismissUpdate = (tag: string): Promise<void> =>
  invoke('zapret:dismissUpdate', tag)

// ---- Zapret strategy tester -------------------------------------------------
export interface StrategyTestResult {
  passed: boolean
  okCount: number
  totalCount: number
  score: number
  tested: true
}
export interface StrategyTestReport {
  ranAt: number
  durationMs: number
  bundleVersion?: string
  results: Record<string, StrategyTestResult>
  bestStrategy?: string
  partial?: boolean
  totalStrategies?: number
}
export interface StrategyTestProgress {
  phase: 'starting' | 'testing' | 'completed' | 'error' | 'idle' | 'stopped'
  current?: number
  total?: number
  strategy?: string
  report?: StrategyTestReport
  message?: string
}
export const zapretRunStrategyTest = (opts: { resume?: boolean } = {}): Promise<StrategyTestReport> =>
  invoke('zapret:runStrategyTest', opts)
export const zapretStopStrategyTest = (): Promise<boolean> => invoke('zapret:stopStrategyTest')
export const zapretClearStrategyTestResults = (): Promise<void> => invoke('zapret:clearStrategyTestResults')
export const zapretGetStrategyTestResults = (): Promise<StrategyTestReport | null> =>
  invoke('zapret:getStrategyTestResults')
export const zapretIsStrategyTestRunning = (): Promise<boolean> =>
  invoke('zapret:isStrategyTestRunning')

// ---- Zapret hostlist (list-general.txt) ------------------------------------
export interface CuratedIpSet {
  id: string
  name: string
  description: string
  cidrs: string[]
  /**
   * Сколько записей добавит набор. У авторского пака `cidrs` пустой —
   * содержимое читается в main-процессе из файла, чтобы не гонять
   * 125 тысяч строк через IPC.
   */
  entryCount?: number
  /** Набор от автора приложения: выделяется и идёт первым. */
  recommended?: boolean
  /** Содержимое лежит в файле, а не в `cidrs`. */
  fileBacked?: boolean
  /** Файл набора найден. false — пак отсутствует в этой сборке. */
  available?: boolean
}
export interface IpListSnapshot {
  total: number
  preview: string[]
  hasBackup: boolean
  filePath: string
}
export interface IpListPatch {
  setIds?: string[]
  customCidrs?: string[]
  replace?: boolean
}
/** Итог применения набора. Зеркалит IpListApplyResult в main-процессе. */
export interface IpListApplyResult extends IpListSnapshot {
  /** Сколько записей реально появилось в файле. */
  added: number
  /** Сколько из выбранного уже было в списке и не записалось повторно. */
  skipped: number
  /** true, если список был перезаписан, а не дополнен. */
  replaced: boolean
}
export const zapretGetCuratedIpSets = (): Promise<CuratedIpSet[]> =>
  invoke('zapret:getCuratedIpSets')
export const zapretGetIpList = (): Promise<IpListSnapshot> => invoke('zapret:getIpList')
export interface GameServerIpResult {
  /** Только IP сервера (без connect и порта) или null, если его не нашлось. */
  ip: string | null
  /** true — IP дописан в список; false — он там уже был. */
  added: boolean
  /** Сколько всего записей в списке Zapret. */
  total: number
  restarted: boolean
  running: boolean
}
export const zapretAddGameServerIp = (target: string): Promise<GameServerIpResult> =>
  invoke('zapret:addGameServerIp', target)
export const zapretApplyIpListPatch = (patch: IpListPatch): Promise<IpListApplyResult> =>
  invoke('zapret:applyIpListPatch', patch)
export const zapretClearIpList = (): Promise<IpListSnapshot> => invoke('zapret:clearIpList')
export const zapretRestoreIpListBackup = (): Promise<IpListSnapshot> =>
  invoke('zapret:restoreIpListBackup')

// ---- Zapret service.bat settings (Game Filter / IPset Filter) --------------
export type GameFilterMode = 'off' | 'all' | 'tcp' | 'udp'
export type IpsetFilterMode = 'none' | 'loaded' | 'any'
export interface IpsetFilterSnapshot {
  mode: IpsetFilterMode
  lines: number
  hasBackup: boolean
}
export const zapretGetGameFilter = (): Promise<GameFilterMode> => invoke('zapret:getGameFilter')
export const zapretSetGameFilter = (mode: GameFilterMode): Promise<GameFilterMode> =>
  invoke('zapret:setGameFilter', mode)
export interface GameFilterSettings {
  mode: GameFilterMode
  tcp: string
  udp: string
  rangesSupported: boolean
  bundleVersion?: string
}
export const zapretGetGameFilterSettings = (): Promise<GameFilterSettings> => invoke('zapret:getGameFilterSettings')
export const zapretSetGameFilterSettings = (next: { mode?: GameFilterMode; tcp?: string; udp?: string }): Promise<GameFilterSettings> =>
  invoke('zapret:setGameFilterSettings', next)
export const zapretGetIpsetFilter = (): Promise<IpsetFilterSnapshot> =>
  invoke('zapret:getIpsetFilter')
export const zapretSetIpsetFilter = (mode: IpsetFilterMode): Promise<IpsetFilterSnapshot> =>
  invoke('zapret:setIpsetFilter', mode)
export const zapretUpdateIpsetList = (): Promise<IpsetFilterSnapshot> =>
  invoke('zapret:updateIpsetList')

// ---- Zapret Active Fakes ----------------------------------------------------
export interface FakeFileInfo {
  name: string
  filename: string
  size: number
  hash: string
}

export interface ActiveFakesState {
  discordActive: string | null
  gameActive: string | null
  available: FakeFileInfo[]
}

export const zapretGetActiveFakes = (): Promise<ActiveFakesState> =>
  invoke('zapret:getActiveFakes')
export const zapretSetActiveFake = (
  target: 'discord' | 'game',
  fakeName: string
): Promise<ActiveFakesState> => invoke('zapret:setActiveFake', target, fakeName)

// ---- Zapret Diagnostics & Quick Fixes ---------------------------------------
export interface DiagnosticItem {
  id: string
  category: 'system' | 'network' | 'conflicts' | 'discord' | 'telegram'
  title: string
  status: 'ok' | 'warn' | 'error'
  message: string
  fixAction?: 'enable_tcp_timestamps' | 'remove_conflicts' | 'clear_discord_cache' | 'update_hosts' | 'disable_proxy' | 'start_bfe' | 'start_wmi'
  fixLabel?: string
}

export interface DiagnosticReport {
  timestamp: number
  items: DiagnosticItem[]
  hasIssues: boolean
}

export const zapretRunDiagnostics = (): Promise<DiagnosticReport> =>
  invoke('zapret:runDiagnostics')
export const zapretFixDiagnostic = (
  action: string
): Promise<{ success: boolean; message: string }> =>
  invoke('zapret:fixDiagnostic', action)

// ---- Zapret Windows Service Manager -----------------------------------------
export interface ZapretServiceStatus {
  installed: boolean
  running: boolean
  strategyName: string | null
  windivertRunning: boolean
}

export const zapretGetWindowsServiceStatus = (): Promise<ZapretServiceStatus> =>
  invoke('zapret:getWindowsServiceStatus')
export const zapretInstallWindowsService = (
  strategy?: string
): Promise<ZapretServiceStatus> => invoke('zapret:installWindowsService', strategy)
export const zapretRemoveWindowsService = (): Promise<ZapretServiceStatus> =>
  invoke('zapret:removeWindowsService')

// ---- Zapret Hosts File & Tests ----------------------------------------------
export interface HostsCheckResult {
  needsUpdate: boolean
  firstLineFound: boolean
  lastLineFound: boolean
  hasYoutubeEntries: boolean
  hostsPath: string
}

export const zapretCheckHostsFile = (): Promise<HostsCheckResult> =>
  invoke('zapret:checkHostsFile')
export const zapretUpdateHostsFile = (): Promise<{ success: boolean; message: string }> =>
  invoke('zapret:updateHostsFile')
export const zapretLaunchTestsScript = (): Promise<void> =>
  invoke('zapret:launchTestsScript')
export const zapretSetCheckUpdatesFlag = (enabled: boolean): Promise<void> =>
  invoke('zapret:setCheckUpdatesFlag', enabled)

// ---- LAZEYKA self-update ---------------------------------------------------
export interface AppUpdateInfo {
  installed: string
  latest?: string
  hasUpdate: boolean
  tag?: string
  assetName?: string
  assetUrl?: string
  assetSize?: number
  releaseUrl?: string
  releaseNotes?: string
  publishedAt?: string
  /** Скрывать ли окно обновления сейчас (снуз ещё идёт или версия пропущена). */
  dismissed?: boolean
  /** До какого момента отложено кнопкой «Позже» (epoch ms). */
  snoozedUntil?: number
  /** Версия пропущена насовсем — напомнит только следующий релиз. */
  skipped?: boolean
}
export const appCheckUpdate = (force = false): Promise<AppUpdateInfo> =>
  invoke('app:checkUpdate', force)

/**
 * Проверка по кнопке в настройках: мимо кэша, с открытием окна обновления и
 * без проглатывания ошибки. Фоновый опрос должен звать `appCheckUpdate`.
 */
export const appCheckUpdateNow = (): Promise<AppUpdateInfo> => invoke('app:checkUpdateNow')
export const appInstallUpdate = (
  url: string,
  expectedVersion?: string
): Promise<{ scheduled: true }> =>
  invoke('app:installUpdate', url, expectedVersion)

/** Ход загрузки обновления. Приходит событием `app:updateProgress`. */
export interface AppUpdateProgress {
  state: 'downloading' | 'installing' | 'error' | 'cancelled'
  receivedBytes: number
  totalBytes: number | null
  percent: number | null
  bytesPerSecond: number
  etaSeconds: number | null
  message?: string
}

/** Прервать загрузку установщика. Скачанный кусок удаляется. */
export const appCancelUpdateDownload = (): Promise<void> =>
  invoke('app:cancelUpdateDownload')
/**
 * Отложить обновление. `forever` — «Пропустить эту версию»: спросим только
 * когда выйдет следующий релиз. Без него — тишина на сутки.
 */
export const appDismissUpdate = (tag: string, forever = false): Promise<void> =>
  invoke('app:dismissUpdate', tag, forever)

/** Одна версия в истории изменений (окно обновления). */
export interface AppReleaseNote {
  tag: string
  version: string
  title: string
  /** Заметки к релизу в markdown. */
  body: string
  publishedAt?: string
  url?: string
  /** Эта версия сейчас установлена. */
  installed: boolean
}
/** История версий страницами: page 1 — самые свежие. */
export const appGetReleaseHistory = (page = 1, perPage = 4): Promise<AppReleaseNote[]> =>
  invoke('app:getReleaseHistory', page, perPage)
/** Закрыть отдельное окно обновления. */
export const updateWindowClose = (): Promise<void> => invoke('updateWindow:close')
/** Открыть главное окно LAZEYKA из окна обновления. */
export const updateWindowOpenMain = (): Promise<void> => invoke('updateWindow:openMain')

// ---- App control ------------------------------------------------------------
export const appQuit = (): Promise<void> => invoke('app:quit')
export const appRelaunch = (): Promise<void> => invoke('app:relaunch')

// ---- Tgws Sharing & Data Centers --------------------------------------------
export interface TgwsShareInfo {
  localLink: string
  lanLink: string | null
  lanIp: string | null
  host: string
  port: number
  secret: string
  httpLink: string
  httpLanLink: string | null
}

export interface TelegramDCPing {
  dc: number
  name: string
  location: string
  ip: string
  port: number
  latencyMs: number | null
  status: 'online' | 'slow' | 'offline'
}

export const tgwsGetShareLinks = (): Promise<TgwsShareInfo> =>
  invoke('tgws:getShareLinks')
export const tgwsPingDataCenters = (): Promise<TelegramDCPing[]> =>
  invoke('tgws:pingDataCenters')

// ---- Profile Export / Import ------------------------------------------------
export const profileExport = (): Promise<{ success: boolean; filePath?: string; message?: string }> =>
  invoke('profile:export')
export const profileImport = (): Promise<{ success: boolean; message: string }> =>
  invoke('profile:import')

// ---- System Notifications ----------------------------------------------------
export const appShowNotification = (title: string, body: string): Promise<void> =>
  invoke('app:showNotification', title, body)

// ---- Autopilot ---------------------------------------------------------------
export interface AutopilotStatus {
  enabled: boolean
  intervalMinutes: number
  lastCheckAt: number | null
  lastStatus: 'healthy' | 'degraded' | 'switching' | 'idle'
  currentStrategy: string
  lastSwitchedStrategy: string | null
  log: string[]
}

export const autopilotGetStatus = (): Promise<AutopilotStatus> =>
  invoke('autopilot:getStatus')
export const autopilotSetEnabled = (enabled: boolean, interval?: number): Promise<AutopilotStatus> =>
  invoke('autopilot:setEnabled', enabled, interval)
export const autopilotRunCycle = (force?: boolean): Promise<AutopilotStatus> =>
  invoke('autopilot:runCycle', force)

// ---- Encrypted DNS (DoH) -----------------------------------------------------
export interface DohProvider {
  id: string
  name: string
  url: string
  ip: string
  secondaryIp?: string
  ipv6?: string[]
  description: string
  latencyMs: number | null
  /** Только шифрованно, без возврата к обычному DNS. */
  strict?: boolean
  custom?: boolean
  site?: string
}
export interface CustomDnsInput {
  name: string
  ipv4: string[]
  ipv6?: string[]
  doh?: string
  allowFallback?: boolean
}
/** Добавить свой DNS-сервер. Возвращает список своих серверов. */
export const dnsAddCustom = (input: CustomDnsInput): Promise<DohProvider[]> => invoke('dns:addCustom', input)
export const dnsRemoveCustom = (id: string): Promise<DohProvider[]> => invoke('dns:removeCustom', id)

export const dnsGetProviders = (): Promise<DohProvider[]> =>
  invoke('dns:getProviders')
export const dnsApplySystem = (ip: string | 'dhcp'): Promise<{ success: boolean; message: string }> =>
  invoke('dns:applySystemDns', ip)
/** DNS-серверы, которые сейчас стоят на рабочих адаптерах Windows. */
export const dnsGetSystemState = (): Promise<{ servers: string[]; changedByApp: boolean }> =>
  invoke('dns:getSystemState')

// ---- Smart Game Mode ---------------------------------------------------------
export interface GameModeStatus {
  enabled: boolean
  activeGameDetected: string | null
  originalFilterMode: string
}

export const gameModeGetStatus = (): Promise<GameModeStatus> =>
  invoke('gameMode:getStatus')
export const gameModeSetEnabled = (enabled: boolean): Promise<GameModeStatus> =>
  invoke('gameMode:setEnabled', enabled)

// ---- Discord RTC -------------------------------------------------------------
export interface DiscordRegionPing {
  id: string
  name: string
  location: string
  endpoint: string
  latencyMs: number | null
  status: 'optimal' | 'good' | 'poor' | 'unreachable'
}

export const discordPingRegions = (): Promise<DiscordRegionPing[]> =>
  invoke('discord:pingRegions')

// ---- INCY Proxy / VPN --------------------------------------------------------
export interface IncyNode {
  id: string
  name: string
  description?: string
  protocol: 'vless' | 'vmess' | 'trojan' | 'shadowsocks' | 'hysteria2' | 'wireguard'
  server: string
  port: number
  uuid?: string
  password?: string
  method?: string
  security?: 'tls' | 'reality' | 'none'
  sni?: string
  publicKey?: string
  shortId?: string
  flow?: string
  fingerprint?: string
  rawUri?: string
  rawJson?: any
  latencyMs: number | null
  /**
   * When the latency was measured. Absent means "never measured in this
   * session" — which must render differently from "measured and unreachable",
   * since `latencyMs` is null in both cases.
   */
  latencyAt?: number
  /**
   * Какой подписке принадлежит узел. Пусто — узел добавлен вручную ссылкой;
   * такие переживают обновление любой подписки и удаляются только вручную.
   */
  subscriptionId?: string
}

export interface IncySubscription {
  /** Постоянный идентификатор; по нему узлы привязаны к своему провайдеру. */
  id: string
  url: string
  title: string
  usedBytes: number | null
  totalBytes: number | null
  expireDate: string | null
  /** Same moment as `expireDate`, in epoch milliseconds (comparable to now). */
  expireAt?: number | null
  lastUpdated: number
  nodeCount: number
  webPageUrl?: string
  supportUrl?: string
  premiumUrl?: string
  keyNumber?: string
  requestedAt?: string
  updateIntervalHours?: number
  announcements?: string[]
  /** У провайдера включено ограничение по числу устройств (заголовок x-hwid-active). */
  hwidRequired?: boolean
  /** Лимит устройств исчерпан. */
  hwidLimitReached?: boolean
}

/** One calendar day of traffic. Mirrors IncyDayStat in the main process. */
export interface IncyDayStat {
  date: string
  bytesSent: number
  bytesReceived: number
  durationSec: number
  connections: number
}

export interface IncyStats {
  sessionBytesSent: number
  sessionBytesReceived: number
  totalBytesSent: number
  totalBytesReceived: number
  connectedDurationSec: number
  connectionCount: number
  lastConnectedTime?: number
  /** Wall-clock seconds spent connected across every session, ever. */
  totalDurationSec: number
  /** Oldest first, up to 14 entries. */
  history: IncyDayStat[]
  /**
   * False when the running topology cannot report byte counters (Xray-only, or
   * a sing-box build without the Clash API). The UI says so rather than
   * drawing an empty chart as if there were no traffic.
   */
  trafficAvailable: boolean
}

/** One user-defined routing rule. Mirrors IncyRoutingRule in the main process. */
export interface IncyRoutingRule {
  id: string
  value: string
  action: 'direct' | 'proxy' | 'block'
  enabled: boolean
  comment?: string
}

/** A named bundle of routing choices. Mirrors IncyRoutingProfile in main. */
export interface IncyRoutingProfile {
  id: string
  name: string
  description?: string
  /** Shipped with the app: cannot be deleted, and edits fork a copy. */
  builtin?: boolean
  mode: 'bypass-ru' | 'global' | 'direct'
  geoRouting: boolean
  rules: IncyRoutingRule[]
}

export interface IncySettings {
  // Routing
  routingMode: 'bypass-ru' | 'global' | 'direct'
  /** Master switch for the curated geo databases. */
  geoRoutingEnabled: boolean
  customRoutingRules: IncyRoutingRule[]
  /** `category id → enabled`. Absent means enabled. */
  geoCategoryOverrides: Record<string, boolean>
  routingProfileList: IncyRoutingProfile[]
  /** Which profile the live settings came from, '' if hand-edited. */
  activeRoutingProfileId: string

  // Appearance
  connectionStyle: 'classic' | 'compact'
  disableFontSmoothing: boolean
  uiScale: number

  // Connection
  autoConnect: boolean
  killSwitch: boolean
  hijackDns: boolean
  allowLan: boolean
  lanViaProxy: boolean
  showOnlyProxyBtn: boolean
  extraBypassAddresses: string
  mixedPort: number
  socksAuth: boolean
  socksUser: string
  socksPass: string
  blockUdp: boolean
  httpAuth: boolean

  // Tunnel
  routingProfiles: boolean
  fragmentation: boolean
  fragmentationPackets: string
  fragmentationLength: string
  fragmentationInterval: string
  noises: boolean
  noisesType: string
  noisesPacket: string
  noisesDelay: string
  multiplexing: boolean
  muxConcurrency: number
  xudpConcurrency: number
  xudpProxy443: 'reject' | 'allow'
  sniffing: boolean
  perAppProxy: boolean
  perAppMode?: 'proxy_only' | 'bypass_only'
  perAppProcesses?: string[]
  /** Оптимизатор маршрута: подключаться к лучшему узлу сразу после замера. */
  routeAutoConnectBest?: boolean
  /** Автопереключение при сбое узла. */
  autoFailover?: boolean
  /** Оптимизатор: добавлять IP игрового сервера в список Zapret (по умолчанию — да). */
  optimizerAddToZapret?: boolean
  /** Узлы, запрещённые для автовыбора (ключ «имя|сервер:порт»). */
  autoSelectExcludedKeys?: string[]
  /** Слова в названии, исключающие узел из автовыбора (через запятую). */
  autoSelectExcludeKeywords?: string
  preferredIp: 'AUTO' | 'IPV4' | 'IPV6'
  vpnDns: 'Cloudflare + Google' | 'Google DNS' | 'Cloudflare DNS' | 'Quad9' | 'Xbox DNS' | 'Custom'
  customDns?: string
  remoteDns: string
  localDns: string
  fakeDns: boolean

  // Subscriptions
  autoUpdateIntervalHours: number
  notifyOnUpdate: boolean
  updateOnLaunch: boolean
  pingOnLaunch: boolean
  pingOnUpdateSubscription: boolean
  sendHwid: boolean
  sortServersBy: 'default' | 'ping' | 'name'
  expireNotifyDays: number

  // Ping
  pingProtocol: 'incy' | 'tcp' | 'http_get' | 'http_head'
  pingDisplay: 'numbers' | 'bar' | 'both' | 'dots'
  pingTestUrl: string
  pingTimeoutSec: number

  // Performance
  /** Тайм-аут простоя UDP, с (0 или < 120 — стандарт ядра, 5 мин). */
  idleTimeoutSec: number
  maxTcpConnections: number
  maxUdpConnections: number
  /** Переподключаться, если ядро VPN неожиданно завершилось. */
  reconnectOnDrop?: boolean
  /** Сетевой стек TUN. */
  tunStack?: 'mixed' | 'system' | 'gvisor'
  /** MTU адаптера TUN (0 — авто). */
  tunMtu?: number
  disconnectOnSleep: boolean
  memoryMonitor: boolean
}

export interface IncyStatus {
  state: 'stopped' | 'running' | 'connecting' | 'error'
  activeNodeId: string | null
  selectedNodeId: string | null
  connectionMode: 'tun' | 'system_proxy' | 'only_proxy'
  routingMode: 'bypass-ru' | 'global' | 'direct'
  connectedAt?: number
  lastError?: string
  /** Сессия поднята в режиме ExitLag (через VPN только приложения из списка). */
  exitLagActive?: boolean
  exitLagApps?: string[]
  /** VPN оборвался, Kill Switch закрыл трафик мимо VPN. */
  killSwitchActive?: boolean
  /** Идёт автоматическое переподключение после обрыва. */
  recovering?: boolean
}

export const incyGetNodes = (): Promise<IncyNode[]> => invoke('incy:getNodes')
export const incySaveNodes = (nodes: IncyNode[]): Promise<void> => invoke('incy:saveNodes', nodes)

export interface IncySpeedTestProgress {
  nodeId: string
  phase: 'connect' | 'ping' | 'download' | 'upload' | 'done' | 'error'
  mbps?: number
  pingMs?: number | null
  downloadMbps?: number | null
}
export interface IncySpeedTestResult {
  nodeId: string
  nodeName: string
  pingMs: number | null
  downloadMbps: number | null
  uploadMbps: number | null
  downloadedMB: number
  error?: string
}
/** Тест скорости через сервер; ход замера приходит событием `incy:speedTestProgress`. */
export const incySpeedTest = (nodeId: string): Promise<IncySpeedTestResult> => invoke('incy:speedTest', nodeId)
/** Записать результаты замера пинга в текущий список узлов (слияние по id). */
export const incySaveLatencies = (results: { id: string; latencyMs: number | null }[]): Promise<IncyNode[]> =>
  invoke('incy:saveLatencies', results)
export const incyRemoveNode = (nodeId: string): Promise<IncyNode[]> => invoke('incy:removeNode', nodeId)
export const incyClearManualNodes = (): Promise<IncyNode[]> => invoke('incy:clearManualNodes')
export const incyGetSubscription = (): Promise<IncySubscription | null> => invoke('incy:getSubscription')
export const incyGetSettings = (): Promise<IncySettings> => invoke('incy:getSettings')
export const incySaveSettings = (settings: IncySettings): Promise<void> => invoke('incy:saveSettings', settings)
/** Переподключить туннель INCY, если он поднят (true — переподключение запущено). */
export const incyReapplyTunnel = (): Promise<boolean> => invoke('incy:reapplyTunnel')
/** Частичное обновление; туннель сам переподключится, если изменение его касается. */
export const incyPatchSettings = (
  patch: Partial<IncySettings>
): Promise<{ settings: IncySettings; reapplied: boolean; hotApplied?: boolean }> =>
  invoke('incy:patchSettings', patch)
export const incyImportInput = (
  input: string,
  fileName?: string
): Promise<{ addedCount: number; subscription: IncySubscription | null; nodes: IncyNode[] }> =>
  invoke('incy:importInput', input, fileName)
export const incyRefreshSubscription = (
  subscriptionId?: string
): Promise<{ subscription: IncySubscription; nodes: IncyNode[] }> =>
  invoke('incy:refreshSubscription', subscriptionId)

/** Все подписки пользователя, в порядке добавления. */
export const incyGetSubscriptions = (): Promise<IncySubscription[]> => invoke('incy:getSubscriptions')

/** Заголовки с идентификатором устройства — ровно то, что уйдёт провайдеру. */
export interface IncyHwidHeaders {
  'x-hwid': string
  'x-device-os': string
  'x-ver-os': string
  'x-device-model': string
}
export const incyGetHwidHeaders = (): Promise<IncyHwidHeaders> => invoke('incy:getHwidHeaders')

/**
 * Обновить все подписки подряд. Возвращает и ошибки тоже: если один провайдер
 * лежит, остальные должны обновиться, а про упавший надо сказать.
 */
export const incyRefreshAllSubscriptions = (): Promise<{
  subscriptions: IncySubscription[]
  nodes: IncyNode[]
  failed: { title: string; error: string }[]
}> => invoke('incy:refreshAllSubscriptions')

/** Удалить подписку вместе с её серверами. Ручные узлы не трогает. */
export const incyRemoveSubscription = (
  subscriptionId: string
): Promise<{ subscriptions: IncySubscription[]; nodes: IncyNode[] }> =>
  invoke('incy:removeSubscription', subscriptionId)
export const incyParseUri = (uri: string): Promise<IncyNode | null> => invoke('incy:parseUri', uri)
export const incyGetStatus = (): Promise<IncyStatus> => invoke('incy:getStatus')
export const incyConnect = (id?: string): Promise<IncyStatus> => invoke('incy:connect', id)
export const incyDisconnect = (): Promise<IncyStatus> => invoke('incy:disconnect')
export const incySelectNode = (id: string): Promise<IncyStatus> => invoke('incy:selectNode', id)
export const incySetConnectionMode = (mode: 'tun' | 'system_proxy' | 'only_proxy'): Promise<IncyStatus> =>
  invoke('incy:setConnectionMode', mode)
export const incySetRoutingMode = (mode: 'bypass-ru' | 'global' | 'direct'): Promise<IncyStatus> =>
  invoke('incy:setRoutingMode', mode)
export const incyPingNode = (node: IncyNode, timeout?: number): Promise<number | null> =>
  invoke('incy:pingNode', node, timeout)
export const incyGetLogs = (): Promise<string[]> => invoke('incy:getLogs')
export const incyClearLogs = (): Promise<void> => invoke('incy:clearLogs')
export const incyGetStats = (): Promise<IncyStats> => invoke('incy:getStats')
export const incyResetStats = (scope: 'all' | 'today' = 'all'): Promise<IncyStats> =>
  invoke('incy:resetStats', scope)

// ---- INCY geo categories -----------------------------------------------------
/** One switchable geo-database category. Mirrors GeoCategoryInfo in main. */
export interface GeoCategoryInfo {
  id: string
  label: string
  hint: string
  target: 'direct' | 'proxy' | 'block'
  essential?: boolean
}

export const incyGeoCategories = (): Promise<GeoCategoryInfo[]> => invoke('incy:geoCategories')

/** State of one geo database file. Mirrors GeoDbState in the main process. */
export interface GeoDbState {
  id: 'geoip' | 'geosite'
  fileName: string
  installedTag?: string
  latestTag?: string
  hasUpdate: boolean
  present: boolean
  sizeBytes?: number
  checkedAt?: number
}

export interface GeoUpdateInfo {
  databases: GeoDbState[]
  hasUpdate: boolean
  /** True when neither file exists anywhere — routing rules would be inert. */
  missing: boolean
}

export const incyCheckGeoUpdate = (): Promise<GeoUpdateInfo> => invoke('incy:checkGeoUpdate')

// ---- INCY routing profiles ---------------------------------------------------
export const incyListRoutingProfiles = (): Promise<IncyRoutingProfile[]> =>
  invoke('incy:listRoutingProfiles')
export const incyApplyRoutingProfile = (id: string): Promise<IncyStatus> =>
  invoke('incy:applyRoutingProfile', id)
export const incySaveRoutingProfile = (p: IncyRoutingProfile): Promise<IncyRoutingProfile[]> =>
  invoke('incy:saveRoutingProfile', p)
export const incyDeleteRoutingProfile = (id: string): Promise<IncyRoutingProfile[]> =>
  invoke('incy:deleteRoutingProfile', id)
export const incyCaptureRoutingProfile = (name: string): Promise<IncyRoutingProfile[]> =>
  invoke('incy:captureRoutingProfile', name)

// ---- INCY backup / restore ---------------------------------------------------
/** What a picked backup file contains, shown before anything is applied. */
export interface IncyBackupPreview {
  ok: boolean
  message?: string
  filePath?: string
  exportedAt?: number
  /** Первая подписка из копии — поле осталось ради копий старого формата. */
  subscriptionTitle?: string | null
  /** Названия всех подписок в копии. */
  subscriptionTitles?: string[]
  nodeCount?: number
  routingRuleCount?: number
  hasSettings?: boolean
}

export interface IncyBackupParts {
  subscription: boolean
  nodes: boolean
  settings: boolean
  routingRules: boolean
}

export const incyExportBackup = (): Promise<{ ok: boolean; filePath?: string; message?: string }> =>
  invoke('incy:exportBackup')
export const incyPickBackup = (): Promise<IncyBackupPreview> => invoke('incy:pickBackup')
export const incyApplyBackup = (
  filePath: string,
  parts: IncyBackupParts
): Promise<{ ok: boolean; message?: string; applied: string[] }> =>
  invoke('incy:applyBackup', filePath, parts)
export const incyBackupLink = (): Promise<string> => invoke('incy:backupLink')

// ---- Strategy Builder --------------------------------------------------------
export interface CustomStrategyConfig {
  name: string
  description: string
  desyncMode: 'fake' | 'diso' | 'fakeddiso' | 'multisplit' | 'split2'
  splitPos: string
  ttl: number
  fooling: 'md5sig' | 'badseq' | 'datanoack' | 'badsum' | 'none'
  fakePayload: string
  includeUdp: boolean
}

export const builderGenerateStrategy = (
  config: CustomStrategyConfig
): Promise<{ file: string; content: string }> => invoke('builder:generateStrategy', config)

// ---- Domain-based Split Tunneling --------------------------------------------
export interface DomainCategory {
  id: string
  name: string
  description: string
  domains: string[]
  enabled: boolean
}

export interface CustomDomainExclusion {
  id: string
  domain: string
  comment?: string
  enabled: boolean
}

export interface SplitTunnelingConfig {
  bypassAllRu: boolean
  categories: DomainCategory[]
  customDomains: CustomDomainExclusion[]
}

export const splitTunnelingGetConfig = (): Promise<SplitTunnelingConfig> =>
  invoke('splitTunneling:getConfig')
export const splitTunnelingSaveConfig = (cfg: SplitTunnelingConfig): Promise<void> =>
  invoke('splitTunneling:saveConfig', cfg)

export const systemGetNetworkSpeed = (): Promise<{ rxKbps: number; txKbps: number }> =>
  invoke('system:getNetworkSpeed')

// ---- WARP, Running Processes, Pickers & QR ----------------------------------
export interface WarpPickResult {
  ok: boolean
  endpoint?: string
  latencyMs?: number
  tested: number
  working: number
  message: string
  needsLx?: boolean
  allNodes: IncyNode[]
}
export interface WarpCheckResult {
  ok: boolean
  ip?: string
  loc?: string
  warp?: string
  latencyMs?: number
  message: string
}
export const incyGenerateWarpNode = (): Promise<{ node: IncyNode; allNodes: IncyNode[]; pick: WarpPickResult }> =>
  invoke('incy:generateWarpNode')
export const incyPickWarpEndpoint = (nodeId: string): Promise<WarpPickResult> => invoke('incy:pickWarpEndpoint', nodeId)
export const incyCheckWarp = (nodeId: string): Promise<WarpCheckResult> => invoke('incy:checkWarp', nodeId)

export interface RunningProcessInfo {
  name: string
  title?: string
}
export interface InstalledGame {
  name: string
  source: 'Steam' | 'Epic'
  dir: string
  exes: string[]
}
/** Игры из библиотек Steam и Epic (главный процесс — первым). */
export const systemScanInstalledGames = (): Promise<InstalledGame[]> => invoke('system:scanInstalledGames')

export interface AppActivity {
  name: string
  viaVpn: number
  direct: number
  upload: number
  download: number
}
/** Какие приложения сейчас держат соединения и через что (null — туннель не поднят). */
export interface HostTraffic {
  host: string
  connections: number
  download: number
  upload: number
  route: string
  lastSeen: number
}
export interface AppTraffic {
  name: string
  download: number
  upload: number
  downSpeed: number
  upSpeed: number
  open: number
  lastSeen: number
  firstSeen: number
  route: string
  hostCount: number
  hosts?: HostTraffic[]
}
export interface LiveConnection {
  id: string
  process: string
  host: string
  port: number
  network: string
  route: string
  rule: string
  upload: number
  download: number
  start: number
}
/** Трафик по приложениям за сессию туннеля; hosts — только для приложения `withHostsOf`. */
export const incyGetAppTraffic = (withHostsOf?: string): Promise<{ active: boolean; apps: AppTraffic[] }> =>
  invoke('incy:getAppTraffic', withHostsOf)
/** Живые соединения ядра (null — туннель не поднят). */
export const incyGetConnections = (): Promise<LiveConnection[] | null> => invoke('incy:getConnections')
export const incyCloseConnection = (id: string): Promise<boolean> => invoke('incy:closeConnection', id)
export const incyGetAppActivity = (): Promise<AppActivity[] | null> => invoke('incy:appActivity')

export interface ExitIp {
  ip: string | null
  country?: string
  countryCode?: string
  isp?: string
  error?: string
}
export interface ExitLagCheckResult {
  exitLagActive: boolean
  mode: 'proxy_only' | 'bypass_only'
  outside: ExitIp
  listed: ExitIp
  selfListed: boolean
  verdict: 'ok' | 'leak' | 'unknown'
  message: string
}
export interface TraceHop {
  hop: number
  ip: string | null
  avgMs: number | null
  minMs: number | null
  maxMs: number | null
  lossPct: number | null
  deltaMs: number | null
  isPrivate: boolean
}
export interface TraceResult {
  target: string
  targetIp: string
  reached: boolean
  hops: TraceHop[]
  biggestJump: { hop: number; ip: string | null; deltaMs: number } | null
  verdict: string[]
  viaPhysical: boolean
}
/** Трассировка до сервера мимо VPN (как WinMTR). */
export const optimizerTrace = (target: string): Promise<TraceResult> => invoke('optimizer:trace', target)
export interface BufferbloatResult {
  target: string
  idle: { avgMs: number | null; maxMs: number | null; lossPct: number }
  loaded: { avgMs: number | null; maxMs: number | null; lossPct: number }
  downloadMbps: number | null
  increaseMs: number | null
  grade: 'A' | 'B' | 'C' | 'D' | 'unknown'
  verdict: string
}
/** Пинг в покое и под нагрузкой (bufferbloat). */
export const optimizerBufferbloat = (ip?: string): Promise<BufferbloatResult> => invoke('optimizer:bufferbloat', ip)

/** Сколько людей сейчас в LAZEYKA (null — выключено или ещё нет данных). */
export const appGetOnlineCount = (): Promise<OnlineStats | null> => invoke('app:getOnlineCount')
export const appGetOnlineNum = (): Promise<number | null> => invoke('app:getOnlineNum')
export const appOnlineCounterInfo = (): Promise<{ configured: boolean }> => invoke('app:onlineCounterInfo')
/** Сбросить настройки к умолчаниям (тема, INCY, списки Zapret и ключи сохраняются). */
export const appResetSettings = (): Promise<void> => invoke('app:resetSettings')
export const appRefreshOnlineCount = (): Promise<void> => invoke('app:refreshOnlineCount')

export interface SiteHostProbe {
  host: string
  ip: string | null
  dnsMs: number | null
  tcpMs: number | null
  tlsMs: number | null
  ttfbMs: number | null
  error?: string
  verdict:
    | 'ok'
    | 'dns-blocked'
    | 'dns-spoofed'
    | 'dns-failed'
    | 'tcp-blocked'
    | 'dpi-blocked'
    | 'tls-failed'
    | 'tcp16-blocked'
    | 'isp-stub'
    | 'slow'
    | 'server-error'
  dnsSource?: 'hosts' | 'filter' | 'isp'
  confidence?: 'high' | 'medium' | 'low'
  vpnMs?: number | null
  vpnError?: string
  zapret: 'listed' | 'excluded' | 'none'
  baseDomain: string
}
export interface SitePageHost {
  host: string
  requests: number
  failed: number
  hanging: number
  maxMs: number
  early: boolean
}
export interface SiteCheckResult {
  url: string
  host: string
  pageLoadMs: number | null
  pageTimedOut: boolean
  pageError?: string
  pageHosts: SitePageHost[]
  probes: SiteHostProbe[]
  zapretRunning: boolean
  vpnNode?: string
  viaTunnel: boolean
  verdict: string[]
}
/** Почему сайт грузится долго: загрузка в скрытом окне + пошаговая проверка доменов. */
export const optimizerCheckSite = (url: string): Promise<SiteCheckResult> => invoke('optimizer:checkSite', url)
export const optimizerAddSitesToZapret = (domains: string[]): Promise<{ added: number; restarted: boolean }> =>
  invoke('optimizer:addSitesToZapret', domains)

/** Живая проверка ExitLag: IP приложений не из списка и из списка. */
export const exitLagCheck = (): Promise<ExitLagCheckResult> => invoke('exitlag:check')

export interface ValveRegionsReport {
  regions: {
    code: string
    name: string
    directMs: number | null
    /** ms — задержка ПК → узел → регион; measured=false — оценка «~» (точка партнёра Valve). */
    best?: { nodeId: string; nodeName: string; ms: number; measured: boolean }
  }[]
  nodesMeasured: number
  nodesFailed: number
  nodesExcluded: number
  fetchedAt: number
}
export const optimizerValveRegions = (): Promise<ValveRegionsReport> => invoke('optimizer:valveRegions')
export interface ValveZapretResult {
  subnets: number
  added: number
  ipsetAdded: number
  total: number
  restarted: boolean
  running: boolean
  /** Game Filter обрабатывает UDP (режим «все» или «UDP»). */
  gameFilterUdp: boolean
  ipsetMode: 'loaded' | 'none' | 'any'
}
/** Подсети серверов Valve (CS2, Dota 2) → списки Zapret. */
export const zapretAddValveServers = (): Promise<ValveZapretResult> => invoke('zapret:addValveServers')

export const systemGetRunningProcesses = (): Promise<RunningProcessInfo[]> =>
  invoke('system:getRunningProcesses')
export const dialogPickExecutable = (): Promise<string | null> =>
  invoke('dialog:pickExecutable')
/** Выбор .conf WireGuard / AmneziaWG: имя файла без расширения и его текст (null — отмена). */
export const dialogPickWireGuardConf = (): Promise<{ name: string; text: string } | null> =>
  invoke('dialog:pickWireGuardConf')
export const dialogPickImageFile = (): Promise<string | null> =>
  invoke('dialog:pickImageFile')
export const clipboardReadImage = (): Promise<string | null> =>
  invoke('clipboard:readImage')
export const systemCaptureScreen = (): Promise<string | null> =>
  invoke('system:captureScreen')
/** Снимки всех мониторов в родном разрешении. */
export const systemCaptureScreens = (): Promise<string[]> => invoke('system:captureScreens')

// ---- Game Server / Faceit Ping (ExitLag) ------------------------------------
export interface GameServerGeoInfo {
  ip: string
  host: string
  port: number
  country?: string
  countryCode?: string
  city?: string
  regionName?: string
  isp?: string
  org?: string
  lat?: number
  lon?: number
}

/** Результат серии замеров одного пути (прямого или через узел). */
export interface RoutePathStats {
  /** a2s — игровые запросы по UDP; icmp — ping; estimate — расчёт; failed — нет ответа. */
  method: 'a2s' | 'icmp' | 'estimate' | 'failed'
  pingMs: number | null
  jitterMs: number | null
  lossPct: number | null
  sent: number
  received: number
}

export interface NodeGamePingInfo {
  nodeId: string
  nodeName: string
  protocol: string
  server: string
  core?: 'xray' | 'sing-box' | null
  userToNodePing: number | null
  path?: RoutePathStats
  score?: number | null
  autoAllowed?: boolean
  /** 'udp' — нативный UDP (Hysteria2/WireGuard), 'tcp' — UDP внутри TCP. */
  udpTransport?: 'udp' | 'tcp'
  error?: string
  nodeToGamePing: number
  totalPing: number | null
  savingMs: number | null
  isBest: boolean
}

export interface GamePingResult {
  targetHost: string
  targetPort: number
  targetIp: string
  geo: GameServerGeoInfo
  direct?: RoutePathStats
  directViaTunnel?: boolean
  a2sSupported?: boolean
  measuredNodes?: number
  totalNodes?: number
  warnings?: string[]
  autoConnectedNodeId?: string
  directPing: number | null
  directPingEstimated: boolean
  nodes: NodeGamePingInfo[]
}

export interface RouteOptimizerProgress {
  done: number
  total: number
  stage: string
}

export const incyPingGameServer = (target: string): Promise<GamePingResult> =>
  invoke('incy:pingGameServer', target)



