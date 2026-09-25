import { ipcMain, app, shell, clipboard, BrowserWindow, dialog, desktopCapturer, screen } from 'electron'
import { generateCloudflareWarpNode } from '../core/incy-warp'
import { optimizeRoute } from '../core/route-optimizer'
import { runIncySpeedTest } from '../core/incy-speedtest'
import { scanInstalledGames } from '../core/game-scan'
import { measureValveRegions, valveRelaySubnets } from '../core/valve-regions'
import { fetchAppActivity } from '../core/incy-stats'
import { extractServerIp, extractServerHost } from './server-ip'
import { listRunningProcesses } from './process-helper'
import { getAppConfig, patchAppConfig } from '../config'
import { applyTheme, setNativeTheme } from '../resolve/theme'
import {
  getTgwsStatus,
  startTgws,
  stopTgws,
  restartTgws,
  getTgwsLink,
  getTgwsShareLinks,
  pingTelegramDataCenters
} from '../core/tgws'
import { exportLazeykaProfile, importLazeykaProfile } from '../core/profile-manager'
import { showSystemNotification } from './notifications'
import {
  getAutopilotStatus,
  setAutopilotEnabled,
  runAutopilotCycle
} from '../core/zapret-autopilot'
import { getDohProvidersWithPing, applySystemDns, getSystemDnsState } from '../core/dns-doh'
import { getRealNetworkSpeed } from './network-stats'
import { getGameModeStatus, setGameModeWatcher } from '../core/game-mode'
import { pingDiscordVoiceRegions } from '../core/discord-ping'
import {
  loadIncyNodes,
  saveIncyNodes,
  saveIncyLatencies,
  removeIncyNode,
  clearManualIncyNodes,
  loadIncySubscription,
  saveIncySubscription,
  loadIncySettings,
  saveIncySettings,
  patchIncySettings,
  reapplyIncyTunnelIfRunning,
  importIncyInput,
  fetchIncySubscription,
  refreshIncySubscription,
  loadIncySubscriptions,
  refreshAllIncySubscriptions,
  removeIncySubscription,
  parseIncyUri,
  getIncyStatus,
  connectIncyNode,
  disconnectIncy,
  setIncyRoutingMode,
  pingIncyNode,
  getIncyLogs,
  clearIncyLogs,
  getIncyStats,
  resetIncyStats,
  selectIncyNode,
  setIncyConnectionMode,
  listIncyRoutingProfiles,
  applyIncyRoutingProfile,
  saveIncyRoutingProfile,
  deleteIncyRoutingProfile,
  captureIncyRoutingProfile
} from '../core/incy-engine'
import {
  checkGeoUpdate,
  installGeoUpdate,
  areGeoDatabasesReady
} from '../core/incy-geo-updater'
import { checkCoreUpdates, installCoreUpdate } from '../core/incy-core-updater'
import { GEO_CATEGORY_CATALOG } from '../core/incy-xray'
import {
  exportIncyBackup,
  pickIncyBackup,
  applyIncyBackup,
  buildIncyBackupLink
} from '../core/incy-backup'
import { generateCustomStrategyBat } from '../core/zapret-builder'
import {
  loadSplitTunnelingConfig,
  saveSplitTunnelingConfig
} from '../core/split-tunneling'
import {
  getZapretStatus,
  startZapret,
  stopZapret,
  restartZapret,
  listStrategies,
  installZapretBundle
} from '../core/zapret'
import {
  checkZapretUpdate,
  installZapretUpdate,
  dismissZapretUpdate
} from '../core/zapret-updater'
import {
  runStrategyTests,
  getStrategyTestResults,
  isStrategyTestRunning
} from '../core/zapret-tester'
import {
  getCuratedIpSets,
  getIpListSnapshot,
  applyIpListPatch,
  addIpsToIpsetAll,
  clearIpList,
  restoreIpListBackup,
  type IpListPatch
} from '../core/zapret-iplist'
import {
  getGameFilterMode,
  setGameFilterMode,
  getIpsetFilterSnapshot,
  setIpsetFilterMode,
  updateIpsetList,
  getActiveFakesState,
  setActiveFake,
  runZapretDiagnostics,
  fixDiagnosticIssue,
  getZapretWindowsServiceStatus,
  installZapretWindowsService,
  removeZapretWindowsService,
  checkZapretHostsFile,
  updateZapretHostsFile,
  launchZapretTestsScript,
  setCheckUpdatesFlag,
  type GameFilterMode,
  type IpsetFilterMode
} from '../core/zapret-service-settings'
import {
  checkTgwsUpdate,
  installTgwsUpdate,
  dismissTgwsUpdate
} from '../core/tgws-updater'
import {
  checkAppUpdate,
  installAppUpdate,
  cancelAppUpdateDownload,
  dismissAppUpdate,
  getReleaseHistory
} from '../core/app-updater'
import { closeUpdateSplash } from '../core/update-window'
import { checkAppUpdateFromUi } from '../core/app-update-watcher'
import { getHwidHeaders } from '../core/incy-hwid'
import { execFile } from 'node:child_process'
import { writeFileSync, unlinkSync, readFileSync } from 'node:fs'
import path from 'node:path'

//
function logTgError(stage: string, err: Error | null, stderr?: string): void {
  if (!err && !stderr) return
  const msg = err?.message ?? stderr ?? 'unknown'
  console.error(`[openTelegramLink] ${stage}: ${msg.trim()}`)
}

function tryFallbackOpen(url: string): void {
  shell.openExternal(url).catch((e) => logTgError('shell.openExternal', e))
}

function openTgLinkViaScheduler(url: string, fellBack: { v: boolean }): boolean {
  try {
    const taskName = `Lazeyka_OpenTG_${Date.now()}_${Math.floor(Math.random() * 10000)}`
    const vbsPath = path.join(app.getPath('temp'), `${taskName}.vbs`)
    const vbsSafeUrl = url.replace(/"/g, '""')
    const vbsContent =
      'On Error Resume Next\r\n' +
      `CreateObject("Shell.Application").ShellExecute "${vbsSafeUrl}"\r\n`
    writeFileSync(vbsPath, vbsContent, 'utf8')

    // Wrap the wscript invocation in a single /TR string. //B = batch
    // mode (suppress all script-engine UI), //Nologo = suppress the
    // WSH banner. Path is double-quoted to survive spaces in %TEMP%.
    const trCommand = `wscript.exe //B //Nologo "${vbsPath}"`

    const cleanup = (): void => {
      execFile(
        'schtasks.exe',
        ['/Delete', '/F', '/TN', taskName],
        { windowsHide: true },
        () => {
          try { unlinkSync(vbsPath) } catch { /* noop */ }
        }
      )
    }

    // /SC ONCE wants a future-ish time. We use the far future so the
    // task never auto-fires; we always trigger via /Run.
    execFile(
      'schtasks.exe',
      [
        '/Create', '/F',
        '/TN', taskName,
        '/TR', trCommand,
        '/SC', 'ONCE',
        '/ST', '23:59',
        '/SD', '01/01/2099',
        '/IT',
        '/RL', 'LIMITED'
      ],
      { windowsHide: true },
      (createErr, _stdout, createStderr) => {
        if (createErr) {
          logTgError('schtasks /Create', createErr, createStderr)
          if (!fellBack.v) {
            fellBack.v = true
            tryFallbackOpen(url)
          }
          try { unlinkSync(vbsPath) } catch { /* noop */ }
          return
        }
        execFile(
          'schtasks.exe',
          ['/Run', '/TN', taskName],
          { windowsHide: true },
          (runErr, _so, runStderr) => {
            if (runErr) {
              logTgError('schtasks /Run', runErr, runStderr)
              if (!fellBack.v) {
                fellBack.v = true
                tryFallbackOpen(url)
              }
            }
            // Delete task + vbs 5 s later (after TG had time to launch).
            setTimeout(cleanup, 5000)
          }
        )
      }
    )
    return true
  } catch (e) {
    logTgError('openTgLinkViaScheduler sync', e as Error)
    return false
  }
}

const TG_INFLIGHT_LOCK_MS = 600
let tgInflightUntil = 0

function openTelegramLink(url: string): Promise<void> {
  const now = Date.now()
  if (now < tgInflightUntil) return Promise.resolve()
  tgInflightUntil = now + TG_INFLIGHT_LOCK_MS
  if (process.platform === 'win32') {
    const fellBack = { v: false }
    if (openTgLinkViaScheduler(url, fellBack)) return Promise.resolve()
    if (!fellBack.v) tryFallbackOpen(url)
    return Promise.resolve()
  }
  tryFallbackOpen(url)
  return Promise.resolve()
}

/**
 * Thin wrapper so any unhandled error in an IPC handler is serialised
 * back to the caller as `{ ok: false, message }` instead of crashing.
 */
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

export function registerIpcMainHandlers(): void {
  // ---- App config ---------------------------------------------------------
  ipcMain.handle('app:getConfig', h(() => getAppConfig()))
  ipcMain.handle('app:patchConfig', h((patch) => patchAppConfig(patch as Partial<AppConfig>)))
  ipcMain.handle('app:version', h(() => app.getVersion()))

  // ---- Theme --------------------------------------------------------------
  ipcMain.handle('theme:setNative', h((theme) => setNativeTheme(theme as AppTheme)))
  ipcMain.handle('theme:apply', h((file) => applyTheme(file as string)))

  // ---- Utility ------------------------------------------------------------
  ipcMain.handle('shell:openTelegramLink', h((url) => openTelegramLink(url as string)))
  ipcMain.handle('shell:openExternal', h((url) => shell.openExternal(url as string)))
  ipcMain.handle('clipboard:writeText', h((text) => { clipboard.writeText(text as string) }))

  // ---- TG WS Proxy --------------------------------------------------------
  ipcMain.handle('tgws:status', h(() => getTgwsStatus()))
  ipcMain.handle('tgws:start', h(() => startTgws()))
  ipcMain.handle('tgws:stop', h(() => stopTgws()))
  ipcMain.handle('tgws:restart', h(() => restartTgws()))
  ipcMain.handle('tgws:getLink', h(() => getTgwsLink()))
  ipcMain.handle('tgws:checkUpdate', h((force) => checkTgwsUpdate(Boolean(force))))
  ipcMain.handle('tgws:installUpdate', h((url, expectedVersion) =>
    installTgwsUpdate(url as string, expectedVersion as string | undefined)
  ))
  ipcMain.handle('tgws:dismissUpdate', h((tag) => dismissTgwsUpdate(tag as string)))

  // ---- Zapret -------------------------------------------------------------
  ipcMain.handle('zapret:status', h(() => getZapretStatus()))
  ipcMain.handle('zapret:listStrategies', h(() => listStrategies()))
  ipcMain.handle('zapret:start', h(() => startZapret()))
  ipcMain.handle('zapret:stop', h(() => stopZapret()))
  ipcMain.handle('zapret:restart', h(() => restartZapret()))
  ipcMain.handle('zapret:installBundle', h((bytes) =>
    installZapretBundle(bytes as Uint8Array)
  ))
  ipcMain.handle('zapret:checkUpdate', h((force) => checkZapretUpdate(Boolean(force))))
  ipcMain.handle('zapret:installUpdate', h((url, expectedVersion) =>
    installZapretUpdate(url as string, expectedVersion as string | undefined)
  ))
  ipcMain.handle('zapret:dismissUpdate', h((tag) => dismissZapretUpdate(tag as string)))

  // ---- Zapret strategy tester --------------------------------------------
  ipcMain.handle('zapret:runStrategyTest', h(() => runStrategyTests()))
  ipcMain.handle('zapret:getStrategyTestResults', h(() => getStrategyTestResults()))
  ipcMain.handle('zapret:isStrategyTestRunning', h(() => isStrategyTestRunning()))

  // ---- Zapret IP list (list-general.txt) -----------------------------------
  ipcMain.handle('zapret:getCuratedIpSets', h(() => getCuratedIpSets()))
  ipcMain.handle('zapret:getIpList', h(() => getIpListSnapshot()))
  ipcMain.handle('zapret:applyIpListPatch', h((patch) =>
    applyIpListPatch((patch ?? {}) as IpListPatch)
  ))
  ipcMain.handle('zapret:clearIpList', h(() => clearIpList()))
  ipcMain.handle('zapret:restoreIpListBackup', h(() => restoreIpListBackup()))

  // ---- Zapret service.bat settings (Game Filter / IPset Filter) ---------
  ipcMain.handle('zapret:getGameFilter', h(() => getGameFilterMode()))
  // GameFilter и IPset читаются при запуске winws — работающий Zapret
  // перезапускаем, иначе переключатель действовал только «когда-нибудь».
  ipcMain.handle('zapret:setGameFilter', h(async (mode) => {
    const next = await setGameFilterMode(mode as GameFilterMode)
    if (getZapretStatus().state === 'running') await restartZapret()
    return next
  }))
  ipcMain.handle('zapret:getIpsetFilter', h(() => getIpsetFilterSnapshot()))
  ipcMain.handle('zapret:setIpsetFilter', h(async (mode) => {
    const next = await setIpsetFilterMode(mode as IpsetFilterMode)
    if (getZapretStatus().state === 'running') await restartZapret()
    return next
  }))
  ipcMain.handle('zapret:updateIpsetList', h(() => updateIpsetList()))

  // ---- Zapret active fakes (Replace Active Fakes) -----------------------
  ipcMain.handle('zapret:getActiveFakes', h(() => getActiveFakesState()))
  ipcMain.handle('zapret:setActiveFake', h((target, fakeName) =>
    setActiveFake(target as 'discord' | 'game', fakeName as string)
  ))

  // ---- Zapret diagnostics & quick fixes ---------------------------------
  ipcMain.handle('zapret:runDiagnostics', h(() => runZapretDiagnostics()))
  ipcMain.handle('zapret:fixDiagnostic', h((action) =>
    fixDiagnosticIssue(action as string)
  ))

  // ---- Zapret Windows Service Manager -----------------------------------
  ipcMain.handle('zapret:getWindowsServiceStatus', h(() => getZapretWindowsServiceStatus()))
  ipcMain.handle('zapret:installWindowsService', h((strategy) =>
    installZapretWindowsService(strategy as string | undefined)
  ))
  ipcMain.handle('zapret:removeWindowsService', h(() => removeZapretWindowsService()))

  // ---- Zapret Hosts File & Tests ----------------------------------------
  ipcMain.handle('zapret:checkHostsFile', h(() => checkZapretHostsFile()))
  ipcMain.handle('zapret:updateHostsFile', h(() => updateZapretHostsFile()))
  ipcMain.handle('zapret:launchTestsScript', h(() => launchZapretTestsScript()))
  ipcMain.handle('zapret:setCheckUpdatesFlag', h((enabled) => {
    setCheckUpdatesFlag(Boolean(enabled))
  }))

  // ---- Tgws Sharing & Data Centers --------------------------------------
  ipcMain.handle('tgws:getShareLinks', h(() => getTgwsShareLinks()))
  ipcMain.handle('tgws:pingDataCenters', h(() => pingTelegramDataCenters()))

  // ---- Profiles Export / Import ------------------------------------------
  ipcMain.handle('profile:export', h(() => exportLazeykaProfile()))
  ipcMain.handle('profile:import', h(() => importLazeykaProfile()))

  // ---- System Notifications & Network Speed -----------------------------
  ipcMain.handle('app:showNotification', h((title, body) => {
    showSystemNotification(String(title), String(body))
  }))
  ipcMain.handle('system:getNetworkSpeed', h(() => getRealNetworkSpeed()))

  // ---- Autopilot ---------------------------------------------------------
  ipcMain.handle('autopilot:getStatus', h(() => getAutopilotStatus()))
  ipcMain.handle('autopilot:setEnabled', h((enabled, interval) => {
    setAutopilotEnabled(Boolean(enabled), Number(interval) || 30)
    return getAutopilotStatus()
  }))
  ipcMain.handle('autopilot:runCycle', h((force) => runAutopilotCycle(Boolean(force))))

  // ---- Encrypted DNS (DoH) -----------------------------------------------
  ipcMain.handle('dns:getProviders', h(() => getDohProvidersWithPing()))
  ipcMain.handle('dns:applySystemDns', h((ip) => applySystemDns(String(ip) as any)))
  ipcMain.handle('dns:getSystemState', h(() => getSystemDnsState()))

  // ---- Smart Game Mode ---------------------------------------------------
  ipcMain.handle('gameMode:getStatus', h(() => getGameModeStatus()))
  ipcMain.handle('gameMode:setEnabled', h((enabled) => {
    setGameModeWatcher(Boolean(enabled))
    return getGameModeStatus()
  }))

  // ---- Discord RTC -------------------------------------------------------
  ipcMain.handle('discord:pingRegions', h(() => pingDiscordVoiceRegions()))

  // ---- INCY Proxy / VPN --------------------------------------------------
  ipcMain.handle('incy:getNodes', h(() => loadIncyNodes()))
  ipcMain.handle('incy:saveNodes', h((nodes) => saveIncyNodes(nodes as any)))
  ipcMain.handle(
    'incy:saveLatencies',
    h((results) =>
      saveIncyLatencies(
        (Array.isArray(results) ? results : [])
          .filter((r: any) => r && typeof r.id === 'string')
          .map((r: any) => ({ id: r.id, latencyMs: typeof r.latencyMs === 'number' ? r.latencyMs : null }))
      )
    )
  )
  ipcMain.handle('incy:removeNode', h((nodeId) => removeIncyNode(String(nodeId))))
  ipcMain.handle('incy:clearManualNodes', h(() => clearManualIncyNodes()))
  ipcMain.handle('incy:getSubscription', h(() => loadIncySubscription()))
  ipcMain.handle('incy:saveSubscription', h((sub) => saveIncySubscription(sub as any)))
  ipcMain.handle('incy:fetchSubscription', h((url) => fetchIncySubscription(String(url))))
  // Re-fetches the saved subscription URL. Previously missing entirely, so the
  // "Обновить подписку" button on the INCY page always failed with
  // "No handler registered for 'incy:refreshSubscription'".
  ipcMain.handle(
    'incy:refreshSubscription',
    h((id) => refreshIncySubscription(id ? String(id) : undefined))
  )

  // ---- INCY: несколько подписок ------------------------------------------
  ipcMain.handle('incy:getSubscriptions', h(() => loadIncySubscriptions()))
  ipcMain.handle('incy:refreshAllSubscriptions', h(() => refreshAllIncySubscriptions()))
  ipcMain.handle('incy:removeSubscription', h((id) => removeIncySubscription(String(id))))

  // ---- INCY geo databases (RoscomVPN geoip.dat / geosite.dat) ------------
  ipcMain.handle('incy:checkGeoUpdate', h(() => checkGeoUpdate()))
  ipcMain.handle('incy:installGeoUpdate', h(() => installGeoUpdate()))
  ipcMain.handle('incy:geoReady', h(() => areGeoDatabasesReady()))
  // The catalogue of switchable categories lives next to the config builder
  // that consumes it, so the two can never drift apart.
  ipcMain.handle('incy:geoCategories', h(() => GEO_CATEGORY_CATALOG))

  // ---- INCY proxy cores (sing-box / Xray) --------------------------------
  ipcMain.handle('incy:checkCoreUpdates', h(() => checkCoreUpdates()))
  ipcMain.handle('incy:installCoreUpdate', h((id, url, version) =>
    installCoreUpdate(id as 'sing-box' | 'xray', String(url), version as string | undefined)
  ))
  ipcMain.handle('incy:importInput', h(async (input) => {
    const res = await importIncyInput(String(input))
    if (res.addedCount > 0) {
      const nodes = loadIncyNodes()
      if (nodes.length > 0) {
        selectIncyNode(nodes[0].id)
      }
    }
    return res
  }))
  ipcMain.handle('incy:parseUri', h((uri) => parseIncyUri(String(uri))))
  ipcMain.handle('incy:getStatus', h(() => getIncyStatus()))
  ipcMain.handle('incy:getSettings', h(() => loadIncySettings()))
  ipcMain.handle('incy:saveSettings', h((settings) => saveIncySettings(settings as any)))
  ipcMain.handle('incy:patchSettings', h((patch) => patchIncySettings((patch ?? {}) as any)))
  ipcMain.handle('incy:reapplyTunnel', h(() => reapplyIncyTunnelIfRunning()))
  ipcMain.handle('incy:connect', h((id) => connectIncyNode(id ? String(id) : undefined)))
  ipcMain.handle('incy:disconnect', h(() => disconnectIncy()))
  ipcMain.handle('incy:selectNode', h((id) => selectIncyNode(String(id))))
  ipcMain.handle('incy:setConnectionMode', h((mode) => setIncyConnectionMode(mode as any)))
  ipcMain.handle('incy:setRoutingMode', h((mode) => setIncyRoutingMode(mode as any)))
  // The probe method comes from the saved settings rather than the caller, so
  // "Настройки пинга" applies to every ping in the app — the list refresh, the
  // per-server button, the automatic ping on launch — without each call site
  // having to remember to pass it.
  ipcMain.handle(
    'incy:pingNode',
    h((node, timeout) => {
      const s = loadIncySettings()
      return pingIncyNode(node as any, typeof timeout === 'number' ? timeout : (s.pingTimeoutSec || 3) * 1000, {
        protocol: s.pingProtocol,
        testUrl: s.pingTestUrl
      })
    })
  )
  // Что именно уходит провайдеру подписки вместе с запросом. Показывается в
  // настройках рядом с выключателем: обещание «мы отправляем только это»
  // стоит ровно столько, сколько возможность в этом убедиться.
  ipcMain.handle('incy:getHwidHeaders', h(() => getHwidHeaders()))
  ipcMain.handle('incy:getLogs', h(() => getIncyLogs()))
  ipcMain.handle('incy:clearLogs', h(() => clearIncyLogs()))
  ipcMain.handle('incy:getStats', h(() => getIncyStats()))
  ipcMain.handle('incy:resetStats', h((scope) => resetIncyStats(scope === 'today' ? 'today' : 'all')))

  // ---- INCY routing profiles ---------------------------------------------
  ipcMain.handle('incy:listRoutingProfiles', h(() => listIncyRoutingProfiles()))
  ipcMain.handle('incy:applyRoutingProfile', h((id) => applyIncyRoutingProfile(String(id))))
  ipcMain.handle('incy:saveRoutingProfile', h((p) => saveIncyRoutingProfile(p as any)))
  ipcMain.handle('incy:deleteRoutingProfile', h((id) => deleteIncyRoutingProfile(String(id))))
  ipcMain.handle('incy:captureRoutingProfile', h((name) => captureIncyRoutingProfile(String(name))))

  // ---- INCY backup / restore ---------------------------------------------
  ipcMain.handle('incy:exportBackup', h(() => exportIncyBackup()))
  ipcMain.handle('incy:pickBackup', h(() => pickIncyBackup()))
  ipcMain.handle(
    'incy:applyBackup',
    h((filePath, parts) => applyIncyBackup(String(filePath), parts as any))
  )
  ipcMain.handle('incy:backupLink', h(() => buildIncyBackupLink()))

  // ---- Cloudflare WARP ---------------------------------------------------
  ipcMain.handle('incy:generateWarpNode', h(() => generateCloudflareWarpNode()))

  // ---- Game Server / Faceit CS2 Ping (ExitLag) ---------------------------
  // Оптимизатор маршрута: реальный замер пинга/джиттера/потерь до игрового
  // сервера через каждый узел (см. route-optimizer.ts).
  ipcMain.handle('incy:pingGameServer', h((target) => optimizeRoute(String(target))))
  // Тест скорости через выбранный сервер (временное ядро, VPN не рвётся).
  ipcMain.handle('incy:speedTest', h((nodeId) => runIncySpeedTest(String(nodeId))))
  // IP сервера из оптимизатора → наш список Zapret (тот же, что на вкладке
  // Zapret, list-general.txt). Только IP: без connect, порта и пароля.
  // Работающий Zapret перезапускается, чтобы winws перечитал список.
  ipcMain.handle('zapret:addGameServerIp', h(async (target) => {
    const text = String(target ?? '')
    let ip = extractServerIp(text)
    if (!ip) {
      const host = extractServerHost(text)
      if (host) {
        try {
          const { promises: dnsp } = await import('node:dns')
          ip = extractServerIp((await dnsp.lookup(host, { family: 4 })).address)
        } catch {
          ip = null
        }
      }
    }
    const running = getZapretStatus().state === 'running'
    if (!ip) return { ip: null, added: false, total: 0, restarted: false, running }
    const res = applyIpListPatch({ customCidrs: [ip] })
    // Для игрового (UDP) трафика winws смотрит в ipset, а не в hostlist.
    let ipsetAdded = 0
    try {
      ipsetAdded = addIpsToIpsetAll([ip])
    } catch { /* список может быть занят — не критично */ }
    let restarted = false
    if ((res.added > 0 || ipsetAdded > 0) && running) {
      await restartZapret()
      restarted = true
    }
    return { ip, added: res.added > 0, total: res.total, restarted, running }
  }))

  // ---- Process & Dialog Helpers (Per-App Routing & QR Import) ------------
  ipcMain.handle('system:getRunningProcesses', h(() => listRunningProcesses()))
  // ExitLag: игры из библиотек Steam и Epic; кто из приложений сейчас в сети.
  ipcMain.handle('system:scanInstalledGames', h(() => scanInstalledGames()))
  ipcMain.handle('incy:appActivity', h(() => fetchAppActivity()))
  // Оптимизатор: пинг до регионов Valve (CS2, Dota 2).
  ipcMain.handle('optimizer:valveRegions', h(() => measureValveRegions()))
  // Серверы Valve → списки Zapret: подсети ретрансляторов в list-general.txt
  // (как IP из оптимизатора) и в ipset-all.txt, если IPset в режиме «список».
  ipcMain.handle('zapret:addValveServers', h(async () => {
    const subnets = await valveRelaySubnets()
    const running = getZapretStatus().state === 'running'
    const res = applyIpListPatch({ customCidrs: subnets })
    let ipsetAdded = 0
    try {
      ipsetAdded = addIpsToIpsetAll(subnets)
    } catch { /* список занят — не критично */ }
    let restarted = false
    if ((res.added > 0 || ipsetAdded > 0) && running) {
      await restartZapret()
      restarted = true
    }
    // Чтобы это реально работало с игрой, winws должен обрабатывать UDP игр
    // (Game Filter c UDP) и сверять адреса по загруженному IPset.
    const gameFilter = getGameFilterMode()
    const ipsetMode = getIpsetFilterSnapshot().mode
    return {
      subnets: subnets.length,
      added: res.added,
      ipsetAdded,
      total: res.total,
      restarted,
      running,
      gameFilterUdp: gameFilter === 'all' || gameFilter === 'udp',
      ipsetMode
    }
  }))
  ipcMain.handle('dialog:pickExecutable', h(async () => {
    const res = await dialog.showOpenDialog({
      title: 'Выберите исполняемый файл приложения',
      filters: [{ name: 'Программы (.exe)', extensions: ['exe'] }],
      properties: ['openFile']
    })
    if (res.canceled || res.filePaths.length === 0) return null
    return path.basename(res.filePaths[0])
  }))
  ipcMain.handle('dialog:pickImageFile', h(async () => {
    const res = await dialog.showOpenDialog({
      title: 'Выберите изображение с QR-кодом',
      filters: [{ name: 'Изображения', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }],
      properties: ['openFile']
    })
    if (res.canceled || res.filePaths.length === 0) return null
    const filePath = res.filePaths[0]
    const ext = path.extname(filePath).replace('.', '').toLowerCase() || 'png'
    const buf = readFileSync(filePath)
    return `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${buf.toString('base64')}`
  }))
  ipcMain.handle('clipboard:readImage', h(() => {
    const img = clipboard.readImage()
    if (img.isEmpty()) return null
    return img.toDataURL()
  }))
  // Все мониторы в родном разрешении. Раньше снимался только первичный экран
  // миниатюрой 1920×1080: на 4K картинка сжималась вдвое, и мелкий QR-код не
  // распознавался, а QR на втором мониторе не находился вовсе.
  ipcMain.handle('system:captureScreens', h(async () => {
    const displays = screen.getAllDisplays()
    const maxW = Math.max(...displays.map((d) => Math.round(d.size.width * d.scaleFactor)), 1920)
    const maxH = Math.max(...displays.map((d) => Math.round(d.size.height * d.scaleFactor)), 1080)
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: maxW, height: maxH }
    })
    return sources.filter((s) => !s.thumbnail.isEmpty()).map((s) => s.thumbnail.toDataURL())
  }))
  ipcMain.handle('system:captureScreen', h(async () => {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1920, height: 1080 }
    })
    if (!sources || sources.length === 0) return null
    return sources[0].thumbnail.toDataURL()
  }))

  // ---- Strategy Builder --------------------------------------------------
  ipcMain.handle('builder:generateStrategy', h((config) => generateCustomStrategyBat(config as any)))

  // ---- Domain-based Split Tunneling --------------------------------------
  ipcMain.handle('splitTunneling:getConfig', h(() => loadSplitTunnelingConfig()))
  ipcMain.handle('splitTunneling:saveConfig', h((cfg) => saveSplitTunnelingConfig(cfg as any)))

  // ---- LAZEYKA self-update -----------------------------------------------
  ipcMain.handle('app:checkUpdate', h((force) => checkAppUpdate(Boolean(force))))
  // Отдельный канал для кнопки в настройках: он ещё и открывает окно
  // обновления. Обычный `checkUpdate` этого делать не должен — его дёргает
  // фоновый опрос, и отложенное обновление всплывало бы каждый час.
  ipcMain.handle('app:checkUpdateNow', h(() => checkAppUpdateFromUi()))
  ipcMain.handle('app:installUpdate', h((url, expectedVersion) =>
    installAppUpdate(url as string, expectedVersion as string | undefined)
  ))
  ipcMain.handle('app:cancelUpdateDownload', h(() => cancelAppUpdateDownload()))
  ipcMain.handle('app:dismissUpdate', h((tag, forever) =>
    dismissAppUpdate(tag as string, Boolean(forever))
  ))
  // Окно обновления: история версий (страницами), закрыть окно, открыть LAZEYKA.
  ipcMain.handle('app:getReleaseHistory', h((page, perPage) =>
    getReleaseHistory(Number(page) || 1, Math.min(10, Number(perPage) || 4))
  ))
  ipcMain.handle('updateWindow:close', h(() => closeUpdateSplash()))
  ipcMain.handle('updateWindow:openMain', h(async () => {
    const { showMainWindow } = await import('..')
    await showMainWindow()
  }))

  // ---- Quit / restart -----------------------------------------------------
  ipcMain.handle('app:quit', h(() => app.quit()))
  // quit(), а не exit(): иначе пропускалась штатная остановка служб и
  // сохранение последних строк лога и счётчиков трафика.
  ipcMain.handle('app:relaunch', h(() => {
    app.relaunch()
    app.quit()
  }))

  // ---- Window controls (called from window-controls.tsx & i18n.ts) -------
  // These were noisy "No handler registered" errors before; persisting the
  // language change is a no-op for now (renderer keeps its own localStorage).
  ipcMain.handle('setLanguage', async (_e, _lang: string) => undefined)
  ipcMain.handle('windowIsMaximized', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    return win?.isMaximized() ?? false
  })
  ipcMain.handle('windowMinimize', (e) => {
    BrowserWindow.fromWebContents(e.sender)?.minimize()
  })
  ipcMain.handle('windowMaximize', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipcMain.handle('windowClose', (e) => {
    BrowserWindow.fromWebContents(e.sender)?.close()
  })
}

