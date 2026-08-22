/**
 * Фоновая проверка обновлений LAZEYKA.
 *
 * Раньше проверка жила целиком в рендерере (`AppUpdateOverlay`): раз в час
 * дёргала `app:checkUpdate` и рисовала модалку. Для человека, который держит
 * LAZEYKA в трее (автозапуск + скрытие из панели задач), это не работало
 * вообще: окно при `silentStart` создаётся с `show: false` и не показывается
 * никогда, так что модалка честно рисовалась в невидимом окне. Вдобавок
 * Chromium душит таймеры в скрытых окнах, поэтому и сам опрос шёл как попало.
 *
 * Поэтому проверка перенесена сюда, в главный процесс, а её результат
 * доносится до человека тремя способами, которые видны из фона:
 *   - системное уведомление (клик разворачивает окно);
 *   - постоянный пункт в меню трея;
 *   - событие в рендерер, чтобы открытое окно показало окно обновления сразу.
 *
 * Окно само по себе не всплывает: перебивать полноэкранную игру или звонок
 * ради «вышла новая версия» — не то поведение, за которое скажут спасибо.
 */
import { powerMonitor, BrowserWindow } from 'electron'
import { mainWindow, showMainWindow } from '..'
import { checkAppUpdate, type AppUpdateInfo } from './app-updater'
import { getAppConfig } from '../config'
import { showSystemNotification } from '../utils/notifications'
import { appLog } from '../utils/app-logger'

/** Первая проверка — не сразу: на старте сеть ещё может подниматься. */
const FIRST_CHECK_DELAY_MS = 40_000
/** Совпадает с кэшем релизов GitHub — чаще ходить незачем. */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
/** После пробуждения сети нужно время, иначе запрос упадёт впустую. */
const RESUME_DELAY_MS = 15_000

/**
 * Последнее известное обновление, за которое ещё не нажали «Установить».
 * Меню трея читает его напрямую — свой запрос к GitHub ему не нужен.
 */
let pending: AppUpdateInfo | null = null

/** Тег и время последнего показанного уведомления. */
let notifiedTag: string | null = null
let notifiedAt = 0
/** Не напоминать про одну и ту же версию чаще раза в сутки. */
const RENOTIFY_MS = 24 * 60 * 60 * 1000

let timer: NodeJS.Timeout | null = null

export function getPendingAppUpdate(): AppUpdateInfo | null {
  return pending
}

/**
 * Развернуть окно и открыть в нём окно обновления.
 *
 * Импорт из `..` замыкает цикл с `src/main/index.ts`, который импортирует этот
 * модуль. Это допустимо и уже используется в `resolve/tray.ts`: обращение к
 * `showMainWindow` происходит внутри колбэка, когда оба модуля давно готовы.
 */
export async function openUpdateWindow(): Promise<void> {
  try {
    await showMainWindow()

    // Поднять окно поверх остальных. На Windows `show()` из фонового процесса
    // часто лишь мигает кнопкой в панели задач — окно остаётся под чужими.
    // Короткий «всегда сверху» заставляет его действительно выйти вперёд и
    // тут же снимается, чтобы не мешать дальше.
    const win = mainWindow
    if (win && !win.isDestroyed()) {
      win.setAlwaysOnTop(true)
      win.show()
      win.setAlwaysOnTop(false)
      win.focus()
    }
    broadcast(true)
  } catch (e) {
    appLog('warn', `[update] не удалось показать окно: ${String(e)}`)
  }
}

/**
 * Сообщить открытому окну, что обновление найдено.
 *
 * `force` снимает отметку «отложено» — это ручное действие человека (клик по
 * уведомлению или по пункту трея). Без него окно, открытое во время снуза,
 * не показало бы ничего, и клик выглядел бы как «ничего не произошло».
 */
function broadcast(force = false): void {
  if (!pending) return
  const payload = force ? { ...pending, dismissed: false } : pending
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('app:updateAvailable', payload)
  }
}

async function runCheck(force: boolean): Promise<void> {
  let cfg: Awaited<ReturnType<typeof getAppConfig>>
  try {
    cfg = await getAppConfig()
  } catch {
    return
  }
  // Тот же выключатель, что и у окна обновления (Настройки → Запуск).
  if (cfg.autoCheckUpdate === false) {
    pending = null
    return
  }

  let info: AppUpdateInfo
  try {
    info = await checkAppUpdate(force)
  } catch (e) {
    // Сеть у людей падает регулярно; в лог — да, на экран — нет.
    appLog('warn', `[update] проверка не удалась: ${String(e)}`)
    return
  }

  if (!info.hasUpdate || !info.assetUrl) {
    pending = null
    return
  }

  pending = info

  // Отложенное или пропущенное обновление остаётся в трее, но молчит.
  if (info.dismissed) return

  // Не чаще раза в сутки на одну и ту же версию. Повтор каждые 6 часов
  // превратил бы напоминание в раздражитель, а пункт в трее никуда не денется.
  // Сутки, а не «один раз за запуск», потому что у тех же людей приложение
  // работает неделями: иначе истёкший снуз никак бы себя не проявил.
  if (notifiedTag === info.tag && Date.now() - notifiedAt < RENOTIFY_MS) {
    broadcast()
    return
  }
  notifiedTag = info.tag ?? null
  notifiedAt = Date.now()

  appLog('info', `[update] доступна версия ${info.latest ?? '?'} (установлена ${info.installed})`)
  showSystemNotification(
    `LAZEYKA ${info.latest ?? ''} уже вышла`,
    'Нажмите, чтобы открыть окно обновления. Установка занимает 5–10 секунд, настройки сохраняются.',
    () => { void openUpdateWindow() }
  )
  broadcast()
}

/**
 * Проверить прямо сейчас — например, когда человек нажал «Проверить
 * обновления» или после того, как снуз истёк.
 */
export async function recheckAppUpdate(): Promise<AppUpdateInfo | null> {
  await runCheck(true)
  return pending
}

/** Забыть, что уведомление уже показывали. */
export function resetUpdateNotice(): void {
  notifiedTag = null
  notifiedAt = 0
}

export function installAppUpdateWatcher(): void {
  if (timer) return
  setTimeout(() => { void runCheck(false) }, FIRST_CHECK_DELAY_MS).unref?.()
  timer = setInterval(() => { void runCheck(true) }, CHECK_INTERVAL_MS)
  timer.unref?.()

  // Машина могла простоять в спящем режиме неделю — тогда интервал не
  // отработал ни разу, а релиз за это время вышел.
  powerMonitor.on('resume', () => {
    setTimeout(() => { void runCheck(true) }, RESUME_DELAY_MS).unref?.()
  })
}
