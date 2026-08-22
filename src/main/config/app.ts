import { readFile, writeFile, rename, copyFile, unlink } from 'fs/promises'
import { appConfigPath } from '../utils/dirs'
import { parseYaml, stringifyYaml } from '../utils/yaml'
import { deepMerge } from '../utils/merge'
import { defaultConfig, CONFIG_VERSION } from '../utils/template'
import { readFileSync, existsSync } from 'fs'
import { enableAutoRun, disableAutoRun } from '../sys/autoRun'

let appConfig: AppConfig | undefined
let writePromise: Promise<void> = Promise.resolve()

function isValidConfig(c: unknown): c is AppConfig {
  return !!c && typeof c === 'object' && 'appTheme' in (c as object)
}

async function safeWriteConfig(content: string): Promise<void> {
  const configPath = appConfigPath()
  const tmpPath = `${configPath}.tmp`
  const backupPath = `${configPath}.backup`
  try {
    await writeFile(tmpPath, content, 'utf-8')
    if (existsSync(configPath)) {
      await copyFile(configPath, backupPath)
      if (process.platform === 'win32') {
        await unlink(configPath)
      }
    }
    if (existsSync(tmpPath)) {
      await rename(tmpPath, configPath)
    }
  } catch (e) {
    if (existsSync(tmpPath)) {
      try { await unlink(tmpPath) } catch { /* noop */ }
    }
    throw e
  }
}

export async function getAppConfig(force = false): Promise<AppConfig> {
  if (force || !appConfig) {
    try {
      const data = await readFile(appConfigPath(), 'utf-8')
      const parsed = parseYaml<AppConfig>(data)
      if (!parsed || !isValidConfig(parsed)) {
        const backup = await readFile(`${appConfigPath()}.backup`, 'utf-8')
        appConfig = parseYaml<AppConfig>(backup)
      } else {
        appConfig = parsed
      }
    } catch {
      appConfig = defaultConfig
    }
  }
  if (!appConfig || typeof appConfig !== 'object') appConfig = defaultConfig

  const persistedVersion: number = typeof appConfig.configVersion === 'number'
    ? appConfig.configVersion
    : 0

  const persistedBuildId = typeof appConfig.lastBuildId === 'string'
    ? appConfig.lastBuildId
    : ''

  // Backfill any missing fields (e.g. tgws/zapret sections from older configs)
  // by merging persisted values *over* the default template.
  appConfig = deepMerge(defaultConfig, appConfig) as AppConfig

  if ((appConfig.appTheme as string) !== 'light' && (appConfig.appTheme as string) !== 'dark') {
    appConfig = { ...appConfig, appTheme: 'dark' }
  }

  // Update lastBuildId and configVersion without wiping user customizations
  let needsSave = false
  if (persistedBuildId !== __BUILD_ID__) {
    appConfig.lastBuildId = __BUILD_ID__
    needsSave = true
  }
  if (persistedVersion < CONFIG_VERSION) {
    appConfig.configVersion = CONFIG_VERSION
    needsSave = true
  }
  if (needsSave) {
    try {
      await safeWriteConfig(stringifyYaml(appConfig))
    } catch { /* noop */ }
  }

  return appConfig
}

/**
 * Tell every open window the config changed.
 *
 * The renderer's AppConfigProvider has always listened for `appConfigUpdated`,
 * but nothing ever emitted it — so a config change made by the main process
 * itself (a regenerated TG secret, `installedVersion` written by an updater,
 * an autopilot strategy switch) never reached the UI. The screen kept showing
 * the old value until the user navigated away and back.
 */
function notifyConfigChanged(): void {
  try {
    // Imported lazily: this module is loaded before `app.whenReady`, and
    // pulling in electron's BrowserWindow at module scope is avoidable here.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { BrowserWindow } = require('electron') as typeof import('electron')
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send('appConfigUpdated')
    }
  } catch {
    /* no windows yet, or electron not ready — nothing to notify */
  }
}

export async function patchAppConfig(patch: Partial<AppConfig>): Promise<void> {
  const previous = writePromise
  const prevAutoLaunch = appConfig?.autoLaunch
  const prevDisableTray = appConfig?.disableTray
  const prevHideTaskbarIcon = appConfig?.hideTaskbarIcon
  writePromise = (async () => {
    await previous
    appConfig = deepMerge(appConfig ?? defaultConfig, patch)
    await safeWriteConfig(stringifyYaml(appConfig))
  })()
  await writePromise
  notifyConfigChanged()
  if (patch.autoLaunch !== undefined && patch.autoLaunch !== prevAutoLaunch) {
    try {
      if (patch.autoLaunch) await enableAutoRun()
      else await disableAutoRun()
    } catch { /* noop */ }
  }
  // React to tray toggle: create or destroy tray on the fly so the user
  // doesn't have to relaunch the app for the change to take effect.
  if (patch.disableTray !== undefined && patch.disableTray !== prevDisableTray) {
    try {
      const tray = await import('../resolve/tray')
      if (patch.disableTray) tray.destroyTray()
      else await tray.createTray()
    } catch { /* noop */ }
  }
  const disableTrayChanged =
    patch.disableTray !== undefined && patch.disableTray !== prevDisableTray
  const hideChanged =
    patch.hideTaskbarIcon !== undefined && patch.hideTaskbarIcon !== prevHideTaskbarIcon
  if (hideChanged || disableTrayChanged) {
    try {
      const { applySkipTaskbar } = await import('../resolve/windowVisibility')
      applySkipTaskbar()
    } catch { /* noop */ }
  }
}

/**
 * Synchronous config read, for the few call sites that cannot await — the GPU
 * flag before `app.whenReady`, the window `close` handler, the tray rebuild.
 *
 * Cached for a second. The tray rebuilds every 10 s and each rebuild called
 * this, so the YAML file was being read and re-parsed on a timer for the whole
 * life of the app. The in-memory `appConfig` is preferred when it exists,
 * since `patchAppConfig` keeps it authoritative.
 */
let syncCache: { at: number; value: AppConfig } | null = null
const SYNC_CACHE_MS = 1000

export function getAppConfigSync(): AppConfig {
  if (appConfig) return appConfig
  const now = Date.now()
  if (syncCache && now - syncCache.at < SYNC_CACHE_MS) return syncCache.value
  try {
    const raw = readFileSync(appConfigPath(), 'utf-8')
    const data = parseYaml<AppConfig>(raw)
    const value =
      data && typeof data === 'object'
        ? (deepMerge(defaultConfig, data) as AppConfig)
        : defaultConfig
    syncCache = { at: now, value }
    return value
  } catch {
    return defaultConfig
  }
}