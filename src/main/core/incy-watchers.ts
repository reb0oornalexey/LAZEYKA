/**
 * Background behaviours for the INCY tunnel that had switches in the UI but no
 * code behind them.
 *
 *  - "Отключать при сне"      → suspend/resume via Electron's powerMonitor
 *  - "Уведомление об истечении" → a real notification N days before expiry
 *  - "Монитор памяти"          → the cores' actual RSS, polled for the header
 *  - "Обновлять при старте" / "Интервал автообновления" → подписки сами
 *    обновляются при запуске и по расписанию (раньше не делали ничего)
 *
 * Each one is opt-in and re-reads its setting on every tick, so toggling a
 * switch takes effect immediately without a restart.
 */
import { powerMonitor, BrowserWindow } from 'electron'
import { exec } from 'node:child_process'
import {
  connectIncyNode,
  disconnectIncy,
  getIncyStatus,
  loadIncySettings,
  loadIncySubscriptions,
  refreshIncySubscription
} from './incy-engine'
import { showSystemNotification } from '../utils/notifications'
import { appLog } from '../utils/app-logger'

// ---- Sleep / wake ---------------------------------------------------------

/**
 * The node that was active when the machine went to sleep, so it can be
 * brought back on resume. Null when we did not disconnect it ourselves — we
 * must never "restore" a tunnel the user had deliberately switched off.
 */
let nodeBeforeSuspend: string | null = null

export function installSleepWatcher(): void {
  powerMonitor.on('suspend', () => {
    if (!loadIncySettings().disconnectOnSleep) return
    const status = getIncyStatus()
    if (status.state !== 'running') return
    nodeBeforeSuspend = status.activeNodeId
    appLog('info', 'Система уходит в сон — отключаем INCY')
    void disconnectIncy().catch((e) => appLog('warn', `Отключение перед сном не удалось: ${e}`))
  })

  powerMonitor.on('resume', () => {
    const nodeId = nodeBeforeSuspend
    nodeBeforeSuspend = null
    if (!nodeId) return
    if (!loadIncySettings().disconnectOnSleep) return
    // Give the network stack a moment to come back; connecting into a
    // half-initialised adapter fails in a way that looks like a bad server.
    setTimeout(() => {
      appLog('info', 'Система проснулась — восстанавливаем INCY')
      void connectIncyNode(nodeId).catch((e) =>
        appLog('warn', `Восстановление после сна не удалось: ${e}`)
      )
    }, 3000)
  })
}

// ---- Subscription expiry --------------------------------------------------

/**
 * Day of the last warning, so the notification fires at most once per calendar
 * day instead of on every check.
 */
let lastExpiryNoticeDay = ''

function todayKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

/**
 * Предупредить об истекающих подписках.
 *
 * Проверяются ВСЕ подписки, а не только активная: с несколькими провайдерами
 * молчание про вторую означало бы, что человек узнаёт об окончании, только
 * когда её серверы перестают работать.
 *
 * Уведомление не чаще раза в сутки — но выбирается самая срочная подписка,
 * чтобы предупреждение про истёкшую не заслонялось той, у которой ещё неделя.
 */
export function checkSubscriptionExpiry(): void {
  const settings = loadIncySettings()
  const days = Number(settings.expireNotifyDays) || 0
  if (days <= 0) return

  const expiring = loadIncySubscriptions()
    .filter((s) => typeof s.expireAt === 'number' && s.expireAt !== null)
    .map((s) => ({ sub: s, msLeft: (s.expireAt as number) - Date.now() }))
    .filter((x) => Math.ceil(x.msLeft / 86_400_000) <= days)
    .sort((a, b) => a.msLeft - b.msLeft)

  if (expiring.length === 0) return
  if (lastExpiryNoticeDay === todayKey()) return
  lastExpiryNoticeDay = todayKey()

  const { sub, msLeft } = expiring[0]
  // Про остальные — одной строкой, чтобы не сыпать уведомлениями подряд.
  const alsoNote = expiring.length > 1 ? ` И ещё ${expiring.length - 1} на подходе.` : ''

  if (msLeft <= 0) {
    showSystemNotification(
      'LAZEYKA — подписка истекла',
      `Срок действия «${sub.title}» закончился ${sub.expireDate ?? ''}. Продлите её, чтобы серверы снова заработали.${alsoNote}`
    )
    return
  }

  const daysLeft = Math.ceil(msLeft / 86_400_000)
  const plural = daysLeft === 1 ? 'день' : daysLeft < 5 ? 'дня' : 'дней'
  showSystemNotification(
    'LAZEYKA — подписка скоро истечёт',
    `«${sub.title}» действует ещё ${daysLeft} ${plural} (до ${sub.expireDate ?? '—'}).${alsoNote}`
  )
}

/** Check once at startup, then a few times a day. */
export function installExpiryWatcher(): void {
  // Not immediately: at launch the subscription on disk may be stale, and a
  // refresh is usually already in flight.
  setTimeout(checkSubscriptionExpiry, 30_000).unref?.()
  const timer = setInterval(checkSubscriptionExpiry, 6 * 60 * 60 * 1000)
  timer.unref?.()
}

// ---- Memory monitor -------------------------------------------------------

export interface CoreMemoryUsage {
  /** Resident set size in bytes, summed across every core process. */
  totalBytes: number
  perProcess: { name: string; bytes: number }[]
}

/**
 * Real memory usage of the running cores.
 *
 * Windows only, via `tasklist`. Returns zeroes rather than throwing when the
 * cores are not running — the caller renders "—" in that case.
 */
export function readCoreMemory(): Promise<CoreMemoryUsage> {
  return new Promise((resolve) => {
    const empty: CoreMemoryUsage = { totalBytes: 0, perProcess: [] }
    if (process.platform !== 'win32') return resolve(empty)

    exec(
      // Несколько /FI в tasklist объединяются через «И» — процесса с двумя
      // именами сразу не бывает, и монитор всегда показывал ноль.
      'tasklist /FO CSV /NH',
      { windowsHide: true, timeout: 4000 },
      (err, stdout) => {
        if (err || !stdout) return resolve(empty)
        const perProcess: { name: string; bytes: number }[] = []
        for (const line of stdout.split(/\r?\n/)) {
          // "sing-box.exe","1234","Console","1","52 340 КБ"
          const cols = line.match(/"([^"]*)"/g)
          if (!cols || cols.length < 5) continue
          const name = cols[0].replace(/"/g, '')
          if (!/^(sing-box|xray)\.exe$/i.test(name)) continue
          // The memory column is localised and space-grouped; keep the digits.
          const kb = Number(cols[4].replace(/"/g, '').replace(/[^\d]/g, ''))
          if (!name || !Number.isFinite(kb) || kb <= 0) continue
          perProcess.push({ name, bytes: kb * 1024 })
        }
        resolve({
          totalBytes: perProcess.reduce((sum, p) => sum + p.bytes, 0),
          perProcess
        })
      }
    )
  })
}

let memoryTimer: NodeJS.Timeout | null = null

/**
 * Push memory readings to the UI while the switch is on and a tunnel is up.
 *
 * Polling `tasklist` is not free, so the loop checks the setting each tick and
 * skips the shell-out entirely when nothing is listening.
 */
export function installMemoryMonitor(): void {
  if (memoryTimer) return
  memoryTimer = setInterval(() => {
    if (!loadIncySettings().memoryMonitor) return
    if (getIncyStatus().state !== 'running') return
    const windows = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && w.isVisible())
    if (windows.length === 0) return
    void readCoreMemory().then((usage) => {
      for (const w of windows) {
        if (!w.isDestroyed()) w.webContents.send('incy:memory', usage)
      }
    })
  }, 5000)
  memoryTimer.unref?.()
}

// ---- Автообновление подписок ------------------------------------------------

let subsUpdating = false

/**
 * Обновить подписки: при запуске — все (если включено «Обновлять при старте»),
 * по таймеру — только те, что не обновлялись дольше выбранного интервала.
 * Ошибка одной подписки не мешает остальным; открытая вкладка INCY получает
 * событие и перечитывает список серверов.
 */
async function autoUpdateSubscriptions(reason: 'launch' | 'interval'): Promise<void> {
  if (subsUpdating) return
  const settings = loadIncySettings()
  const subs = loadIncySubscriptions()
  if (subs.length === 0) return
  const hours = Number(settings.autoUpdateIntervalHours) || 0
  const due =
    reason === 'launch'
      ? settings.updateOnLaunch
        ? subs
        : []
      : hours > 0
        ? subs.filter((sub) => Date.now() - (sub.lastUpdated || 0) >= hours * 3_600_000)
        : []
  if (due.length === 0) return
  subsUpdating = true
  let updated = 0
  try {
    for (const sub of due) {
      try {
        await refreshIncySubscription(sub.id)
        updated++
      } catch (e) {
        appLog('warn', `[incy] автообновление «${sub.title}» не удалось: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  } finally {
    subsUpdating = false
  }
  if (updated > 0) {
    appLog('info', `[incy] подписки обновлены автоматически (${reason === 'launch' ? 'при запуске' : 'по расписанию'}): ${updated}`)
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send('incy:nodesChanged')
    }
  }
}

export function installSubscriptionUpdater(): void {
  // Не сразу: при автозапуске с Windows сеть поднимается не мгновенно.
  setTimeout(() => void autoUpdateSubscriptions('launch'), 20_000).unref?.()
  // Раз в 15 минут проверяем, не пора ли — сам запрос уходит только по интервалу.
  const timer = setInterval(() => void autoUpdateSubscriptions('interval'), 15 * 60_000)
  timer.unref?.()
}

export function installIncyWatchers(): void {
  installSleepWatcher()
  installExpiryWatcher()
  installMemoryMonitor()
  installSubscriptionUpdater()
}
