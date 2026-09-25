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
 * При ЗАПУСКЕ программы (в том числе автозапуске вместе с Windows) вышедшее
 * обновление показывается отдельным окном (update-window.ts) — не главным
 * окном и не модалкой в нём. Пока программа уже работает, окно само не
 * всплывает (не перебиваем игру или звонок): только уведомление и трей.
 */
import { powerMonitor, BrowserWindow } from 'electron'
import { openUpdateSplash } from './update-window'
import { checkAppUpdate, type AppUpdateInfo } from './app-updater'
import { getAppConfig } from '../config'
import { showSystemNotification } from '../utils/notifications'
import { appLog } from '../utils/app-logger'

/**
 * Проверка при запуске: первая попытка почти сразу, а если сеть ещё не
 * поднялась (автозапуск вместе с Windows) — повторы, пока не получится.
 */
const STARTUP_ATTEMPTS_MS = [8_000, 30_000, 120_000, 300_000]
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

/** Открыть отдельное окно обновления (уведомление, трей, кнопки проверки). */
export async function openUpdateWindow(): Promise<void> {
  openUpdateSplash()
  broadcast(true)
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
 * Проверка по кнопке «Проверить обновления» в настройках.
 *
 * Отличается от фоновой двумя вещами. Ошибку не проглатывает — человек нажал
 * сам и должен увидеть причину, а не молчание. И показывает окно обновления
 * даже если версия была отложена: раз спросили руками, значит хотят видеть.
 */
export async function checkAppUpdateFromUi(): Promise<AppUpdateInfo> {
  const info = await checkAppUpdate(true)
  pending = info.hasUpdate && info.assetUrl ? info : null
  if (pending) void openUpdateWindow()
  return info
}

/**
 * Проверка при запуске программы. Если вышла новая версия — сразу отдельное
 * окно обновления. «Позже» здесь не действует (оно глушит только фоновые
 * напоминания на сутки): при каждом запуске человек видит, что есть новая
 * версия. Молчим только для версии, пропущенной кнопкой «Пропустить».
 */
async function startupCheck(attempt = 0): Promise<void> {
  let cfg: Awaited<ReturnType<typeof getAppConfig>>
  try {
    cfg = await getAppConfig()
  } catch {
    return
  }
  if (cfg.autoCheckUpdate === false) return
  let info: AppUpdateInfo
  try {
    info = await checkAppUpdate(true)
  } catch (e) {
    const next = STARTUP_ATTEMPTS_MS[attempt + 1]
    appLog('warn', `[update] проверка при запуске не удалась${next ? ', повторю позже' : ''}: ${String(e)}`)
    if (next) setTimeout(() => { void startupCheck(attempt + 1) }, next - STARTUP_ATTEMPTS_MS[attempt]).unref?.()
    return
  }
  if (!info.hasUpdate || !info.assetUrl) {
    pending = null
    return
  }
  pending = info
  // Трей и фоновое напоминание знают, что про эту версию уже сказали.
  notifiedTag = info.tag ?? null
  notifiedAt = Date.now()
  if (info.skipped) return
  appLog('info', `[update] при запуске: доступна версия ${info.latest ?? '?'} (установлена ${info.installed})`)
  openUpdateSplash()
}

/** Забыть, что уведомление уже показывали. */
export function resetUpdateNotice(): void {
  notifiedTag = null
  notifiedAt = 0
}

export function installAppUpdateWatcher(): void {
  if (timer) return
  setTimeout(() => { void startupCheck(0) }, STARTUP_ATTEMPTS_MS[0]).unref?.()
  timer = setInterval(() => { void runCheck(true) }, CHECK_INTERVAL_MS)
  timer.unref?.()

  // Машина могла простоять в спящем режиме неделю — тогда интервал не
  // отработал ни разу, а релиз за это время вышел.
  powerMonitor.on('resume', () => {
    setTimeout(() => { void runCheck(true) }, RESUME_DELAY_MS).unref?.()
  })
}
