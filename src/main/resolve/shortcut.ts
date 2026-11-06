import { app, globalShortcut, shell } from 'electron'
import { getAppConfig } from '../config'
import { triggerMainWindow, mainWindow } from '..'
import { startTgws, stopTgws, getTgwsStatus } from '../core/tgws'
import { startZapret, stopZapret, getZapretStatus } from '../core/zapret'

/**
 * Зарегистрировать горячие клавиши из настроек. Возвращает те, которые
 * система не дала занять (заняты другой программой), — их показываем в UI.
 */
export async function initShortcut(): Promise<string[]> {
  const cfg = await getAppConfig()
  globalShortcut.unregisterAll()
  const failed: string[] = []
  // globalShortcut (RegisterHotKey в Windows) срабатывает при любом активном
  // окне — в том числе в полноэкранной игре и когда LAZEYKA свёрнута в трей.
  // Уведомление в игре не видно, поэтому подтверждаем коротким звуком.
  const sound = cfg.hotkeySound !== false
  // Звук играет окно LAZEYKA (оно живёт и в трее, просто скрыто) — выбранным
  // в настройках звуком; если окна нет — системный сигнал.
  const cue = (ok = true): void => {
    if (!sound) return
    const w = mainWindow
    if (w && !w.isDestroyed() && !w.webContents.isDestroyed()) w.webContents.send('app:playSound', cfg.hotkeySoundId ?? 'chime', ok)
    else shell.beep()
  }
  const reg = (accel: string | undefined, fn: () => void, silent = false): void => {
    if (!accel) return
    const run = (): void => {
      if (!silent) cue()
      fn()
    }
    try {
      if (!globalShortcut.register(accel, run)) failed.push(accel)
    } catch {
      failed.push(accel)
    }
  }
  const notify = (title: string, body: string): void => {
    void import('../utils/notifications').then(({ showSystemNotification }) => showSystemNotification(title, body)).catch(() => void 0)
  }
  reg(cfg.exitlagToggleShortcut, () => {
    void import('../core/incy-engine').then(({ loadIncySettings, patchIncySettings }) => {
      const on = !loadIncySettings().perAppProxy
      patchIncySettings({ perAppProxy: on })
      notify('LAZEYKA — ExitLag', on ? 'Включён: VPN только для приложений из списка' : 'Выключен: весь трафик как обычно')
    })
  })
  reg(cfg.incyBestNodeShortcut, () => {
    void import('../core/incy-engine').then(async ({ getIncyStatus, forceIncyFailover, connectIncyNode }) => {
      try {
        if (getIncyStatus().state === 'running') notify('LAZEYKA — узел', await forceIncyFailover())
        else await connectIncyNode()
      } catch (e) {
        notify('LAZEYKA — узел не сменён', e instanceof Error ? e.message : String(e))
      }
    })
  })
  reg(cfg.zapretRestartShortcut, () => {
    void import('../core/zapret').then(({ restartZapret }) =>
      restartZapret().then(() => notify('LAZEYKA — Zapret', 'Перезапущен')).catch(() => void 0)
    )
  })
  // Сценарии со своей горячей клавишей.
  try {
    const { listScenarios, applyScenario } = await import('../core/scenarios')
    for (const s of listScenarios()) {
      if (!s.hotkey) continue
      reg(s.hotkey, () => {
        // Окно (даже скрытое) узнаёт о запуске — карточка сценария показывает
        // «Применяю…», а потом «Применён · время», как при нажатии кнопки.
        const tell = (channel: string, payload: unknown): void => {
          const w = mainWindow
          if (w && !w.isDestroyed() && !w.webContents.isDestroyed()) w.webContents.send(channel, payload)
        }
        tell('scenario:running', s.id)
        void applyScenario(s.id)
          .then((steps) => {
            const bad = steps.filter((x) => !x.ok)
            cue(bad.length === 0)
            tell('scenario:applied', { id: s.id, name: s.name, emoji: s.emoji, ok: bad.length === 0, at: Date.now(), steps })
            notify(`LAZEYKA — ${s.emoji} ${s.name}`, bad.length ? `Не всё получилось: ${bad.map((b) => b.what).join(', ')}` : 'Сценарий выполнен')
          })
          .catch((e) => {
            cue(false)
            tell('scenario:applied', { id: s.id, name: s.name, emoji: s.emoji, ok: false, at: Date.now(), steps: [{ what: 'Сценарий', ok: false, message: e instanceof Error ? e.message : String(e) }] })
          })
      }, true)
    }
  } catch {
    /* сценариев нет */
  }
  reg(cfg.incyToggleShortcut, () => {
    void import('../core/incy-engine').then(({ getIncyStatus, connectIncyNode, disconnectIncy }) => {
      const s = getIncyStatus().state
      if (s === 'running' || s === 'connecting') disconnectIncy().catch(() => void 0)
      else connectIncyNode().catch(() => void 0)
    })
  })

  reg(cfg.showWindowShortcut, () => triggerMainWindow())
  // `restartAppShortcut` was declared in AppConfig but never registered, so
  // setting it did nothing. Registered here for parity with the others.
  reg(cfg.restartAppShortcut, () => {
    app.relaunch()
    app.exit(0)
  })
  reg(cfg.tgwsToggleShortcut, () => {
    const s = getTgwsStatus().state
    if (s === 'running') stopTgws().catch(() => void 0)
    else startTgws().catch(() => void 0)
  })
  reg(cfg.zapretToggleShortcut, () => {
    const s = getZapretStatus().state
    if (s === 'running') stopZapret().catch(() => void 0)
    else startZapret().catch(() => void 0)
  })
  return failed
}