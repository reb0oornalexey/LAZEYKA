import https from 'node:https'
import { getAppConfig, getAppConfigSync, patchAppConfig } from '../config'
import { getZapretStatus, restartZapret, listStrategies } from './zapret'
import { showSystemNotification } from '../utils/notifications'

export interface AutopilotStatus {
  enabled: boolean
  intervalMinutes: number
  lastCheckAt: number | null
  lastStatus: 'healthy' | 'degraded' | 'switching' | 'idle'
  currentStrategy: string
  lastSwitchedStrategy: string | null
  log: string[]
}

let autopilotTimer: NodeJS.Timeout | null = null
let isChecking = false
const autopilotLog: string[] = []
let lastCheckTime: number | null = null
let lastStatus: 'healthy' | 'degraded' | 'switching' | 'idle' = 'idle'
let lastSwitched: string | null = null
/** Live interval; mirrored into config so the toggle survives a restart. */
let currentIntervalMinutes = 30
const DEFAULT_INTERVAL_MINUTES = 30
const MIN_INTERVAL_MINUTES = 5

function appendLog(msg: string): void {
  const time = new Date().toLocaleTimeString('ru-RU')
  autopilotLog.unshift(`[${time}] ${msg}`)
  if (autopilotLog.length > 50) autopilotLog.pop()
}

function probeEndpoint(url: string, timeoutMs = 4000): Promise<boolean> {
  return new Promise((resolve) => {
    const req = https.get(url, { timeout: timeoutMs, headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      resolve(res.statusCode !== undefined && res.statusCode < 500)
    })
    req.on('error', () => resolve(false))
    req.on('timeout', () => {
      req.destroy()
      resolve(false)
    })
  })
}

export async function checkNetworkHealth(): Promise<{ healthy: boolean; youtubeOk: boolean; discordOk: boolean }> {
  const [youtubeOk, discordOk] = await Promise.all([
    probeEndpoint('https://www.youtube.com/generate_204'),
    probeEndpoint('https://discord.com/api/v9/gateway')
  ])
  return {
    healthy: youtubeOk || discordOk,
    youtubeOk,
    discordOk
  }
}

export async function runAutopilotCycle(force = false): Promise<AutopilotStatus> {
  if (isChecking) return getAutopilotStatus()
  isChecking = true
  lastCheckTime = Date.now()

  const cfg = await getAppConfig()
  const activeStrategy = cfg.zapret?.activeStrategy || 'general (ALT).bat'

  // The live timer IS the enabled state. This used to read
  // `cfg.zapret.autopilotEnabled`, a field that was never declared in the
  // config type and never written by anything — so the scheduled cycle always
  // bailed out here and the autopilot silently did nothing while the UI
  // reported it as enabled.
  if (!autopilotTimer && !force) {
    isChecking = false
    lastStatus = 'idle'
    return getAutopilotStatus()
  }

  const zapretRunning = getZapretStatus().state === 'running'
  if (!zapretRunning && !force) {
    isChecking = false
    lastStatus = 'idle'
    return getAutopilotStatus()
  }

  appendLog(`Проверка качества связи (текущая: ${activeStrategy})…`)

  try {
    const health = await checkNetworkHealth()

    if (health.healthy) {
      lastStatus = 'healthy'
      appendLog(`Связь в норме (YouTube: ${health.youtubeOk ? 'OK' : 'FAIL'}, Discord: ${health.discordOk ? 'OK' : 'FAIL'})`)
    } else {
      lastStatus = 'degraded'
      appendLog('Обнаружена деградация соединения. Поиск лучшей стратегии…')

      const available = listStrategies()
      const candidates = available.filter((s) => s.file !== activeStrategy)

      let bestStrategy: string | null = null

      // Test up to 3 candidate strategies
      for (const cand of candidates.slice(0, 3)) {
        appendLog(`Тестирование: ${cand.title}…`)
        // Re-read the config on every iteration: `cfg` was captured before the
        // loop, so reusing it would roll back any zapret setting the user (or
        // another module) changed while the autopilot was probing.
        const fresh = await getAppConfig()
        await patchAppConfig({
          zapret: { ...(fresh.zapret as ZapretConfig), activeStrategy: cand.file }
        })
        try {
          await restartZapret()
          await new Promise((r) => setTimeout(r, 2000))
          const candHealth = await checkNetworkHealth()
          if (candHealth.healthy) {
            bestStrategy = cand.file
            break
          }
        } catch { /* try next */ }
      }

      if (bestStrategy) {
        lastStatus = 'healthy'
        lastSwitched = bestStrategy
        appendLog(`Успешное автопереключение на стратегию: ${bestStrategy}`)
        showSystemNotification('Автопилот Zapret', `Переключено на более стабильную стратегию: ${bestStrategy}`)
      } else {
        // Revert to original
        appendLog('Альтернативные стратегии не помогли, возврат к исходной.')
        const fresh = await getAppConfig()
        await patchAppConfig({
          zapret: { ...(fresh.zapret as ZapretConfig), activeStrategy }
        })
        try { await restartZapret() } catch { /* ignore */ }
      }
    }
  } catch (e: any) {
    appendLog(`Ошибка автопилота: ${e?.message || String(e)}`)
  } finally {
    isChecking = false
  }

  return getAutopilotStatus()
}

/**
 * Start or stop the autopilot. `persist = false` is used when restoring the
 * saved state at boot, so the restore doesn't immediately rewrite the config
 * it just read.
 */
export function setAutopilotEnabled(
  enabled: boolean,
  intervalMinutes = DEFAULT_INTERVAL_MINUTES,
  persist = true
): void {
  if (autopilotTimer) {
    clearInterval(autopilotTimer)
    autopilotTimer = null
  }

  currentIntervalMinutes = Math.max(
    MIN_INTERVAL_MINUTES,
    Number(intervalMinutes) || DEFAULT_INTERVAL_MINUTES
  )

  if (enabled) {
    appendLog(`Автопилот включен (интервал: ${currentIntervalMinutes} мин)`)
    autopilotTimer = setInterval(() => {
      void runAutopilotCycle(false)
    }, currentIntervalMinutes * 60 * 1000)
    // Run an initial quick check
    setTimeout(() => { void runAutopilotCycle(false) }, 5000)
  } else {
    appendLog('Автопилот выключен')
    lastStatus = 'idle'
  }

  if (!persist) return
  // Fire-and-forget: the toggle must not block on disk I/O, and a failed
  // write only costs the user the setting after a restart.
  void (async () => {
    try {
      const cfg = await getAppConfig()
      await patchAppConfig({
        zapret: {
          ...(cfg.zapret as ZapretConfig),
          autopilotEnabled: enabled,
          autopilotIntervalMinutes: currentIntervalMinutes
        }
      })
    } catch { /* noop */ }
  })()
}

/**
 * Re-arm the autopilot at startup if the user left it on. Called from
 * main/index.ts once the config is loaded.
 */
export function restoreAutopilotFromConfig(cfg: AppConfig): void {
  if (!cfg.zapret?.autopilotEnabled) return
  setAutopilotEnabled(
    true,
    cfg.zapret.autopilotIntervalMinutes ?? DEFAULT_INTERVAL_MINUTES,
    false
  )
}

export function getAutopilotStatus(): AutopilotStatus {
  let currentStrategy = ''
  try {
    currentStrategy = getAppConfigSync().zapret?.activeStrategy ?? ''
  } catch { /* config unreadable — report an empty strategy */ }
  return {
    enabled: Boolean(autopilotTimer),
    intervalMinutes: currentIntervalMinutes,
    lastCheckAt: lastCheckTime,
    lastStatus,
    currentStrategy,
    lastSwitchedStrategy: lastSwitched,
    log: autopilotLog
  }
}
