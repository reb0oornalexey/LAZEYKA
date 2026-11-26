/**
 * `lazeyka://` deep links.
 *
 * The INCY tab shipped a "URL-схемы" page listing `incy://connect` and
 * friends, complete with copy buttons — none of which did anything. LAZEYKA
 * never registered a protocol handler, and `incy://` is not even its scheme,
 * so every command on that page was decoration.
 *
 * This module makes them real. Windows hands a launch URL to the *first*
 * instance through `second-instance` (or as an argv entry on a cold start), so
 * both paths funnel into `handleDeepLink`.
 *
 * Supported:
 *   lazeyka://connect            lazeyka://open
 *   lazeyka://disconnect         lazeyka://close
 *   lazeyka://toggle
 *   lazeyka://import/<base64>    subscription URL or config, auto-detected
 *   lazeyka://add/<url>          same, but a plain (url-encoded) address
 *   lazeyka://routing/add/<base64>   append routing rules
 *   lazeyka://restore/<base64>       subscription + settings from a backup link
 *
 * Простые команды для кнопок Stream Deck и ярлыков:
 *   lazeyka://zapret/on|off|toggle
 *   lazeyka://telegram/on|off|toggle     Telegram-прокси
 *   lazeyka://exitlag/on|off|toggle      VPN только для игр из списка
 *   lazeyka://scenario/<id>              применить сценарий
 *   lazeyka://mini                       показать / скрыть мини-окно
 * VPN уже управляется командами connect / disconnect / toggle выше.
 * Разбор этих команд — в deeplink-parse.ts.
 *
 * Подпись (deeplink-sign.ts): ссылки, которые программа выдаёт для пультов,
 * несут `?k=<код>` — HMAC секрета установки по конкретному действию. Такая
 * ссылка выполняется сразу и главное окно не открывает. Без кода или с
 * неверным кодом программа выходит на передний план и спрашивает
 * «Внешняя ссылка просит: … Выполнить?». Без подтверждения и без подписи
 * выполняется только lazeyka://mini (показывает окно, ничего не выключает).
 * import / routing / restore спрашивают подтверждение всегда.
 */
import { app, BrowserWindow, dialog } from 'electron'
import {
  connectIncyNode,
  disconnectIncy,
  getIncyStatus,
  importIncyInput,
  loadIncySettings,
  saveIncySettings,
  type IncyRoutingRule
} from './incy-engine'
import { appLog } from '../utils/app-logger'
import { showSystemNotification } from '../utils/notifications'
import { parseSimpleCommand, wantedState, type SimpleCommand } from './deeplink-parse'
import { startZapret, stopZapret, getZapretStatus } from './zapret'
import { startTgws, stopTgws, getTgwsStatus } from './tgws'
import { applyScenario, listScenarios } from './scenarios'
import { toggleMiniWindow } from './mini-window'
import { canonicalAction, describeAction, isWindowOnlyAction, verifyAction, SIGN_PARAM } from './deeplink-sign'
import { getDeeplinkKey } from './deeplink-key'

/**
 * Вывести программу на передний план (главное окно). Задаётся из index.ts:
 * прямой импорт index.ts отсюда дал бы цикл модулей.
 */
let bringToFront: () => Promise<void> = async () => void 0
export function setDeepLinkFocusHandler(fn: () => Promise<void>): void {
  bringToFront = fn
}

export const DEEPLINK_SCHEME = 'lazeyka'

/**
 * Register the scheme with the OS.
 *
 * In development Electron runs through `electron.exe`, which needs the project
 * path passed explicitly or Windows records the wrong command line.
 */
export function registerDeepLinkScheme(): void {
  try {
    if (process.defaultApp && process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(DEEPLINK_SCHEME, process.execPath, [process.argv[1]])
    } else {
      app.setAsDefaultProtocolClient(DEEPLINK_SCHEME)
    }
  } catch (e) {
    appLog('warn', `Не удалось зарегистрировать схему ${DEEPLINK_SCHEME}://: ${String(e)}`)
  }
}

/** Pull the first `lazeyka://…` argument out of a process argv list. */
export function findDeepLinkInArgv(argv: string[]): string | null {
  // Схема без учёта регистра: Windows может передать «LAZEYKA://…».
  return argv.find((a) => a.toLowerCase().startsWith(`${DEEPLINK_SCHEME}://`)) ?? null
}

/** Ссылка без параметров (код подписи в лог не попадает). */
function forLog(url: string): string {
  const i = url.search(/[?#]/)
  return (i >= 0 ? url.slice(0, i) : url).slice(0, 200)
}

function decodePayload(raw: string): string {
  const value = decodeURIComponent(raw)
  // Accept both a raw URL and a base64/base64url blob — the copy buttons hand
  // out the base64 form, but a user pasting a plain address should also work.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value

  // Only try base64 when the string is *entirely* base64 alphabet. Node's
  // decoder silently discards anything outside it, so plain text such as
  // "youtube.com proxy" would come back as binary noise rather than failing.
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) return value

  try {
    const normalised = value.replace(/-/g, '+').replace(/_/g, '/')
    const decoded = Buffer.from(normalised, 'base64').toString('utf-8')
    // Reject binary garbage: if it does not look like text, the input was
    // probably not base64 at all.
    // eslint-disable-next-line no-control-regex
    if (decoded && !/[\u0000-\u0008\u000e-\u001f]/.test(decoded)) return decoded
  } catch { /* not base64 */ }
  return value
}

function notify(title: string, body: string): void {
  showSystemNotification(title, body, undefined, 'actions')
  appLog('info', `[deeplink] ${title}: ${body}`)
}

/** Tell the renderer to reload INCY data after a link changed something. */
/**
 * Подтверждение перед командой, которая меняет настройки или список серверов.
 *
 * Ссылку `lazeyka://` может открыть любая веб-страница. Раньше импорт,
 * правила маршрутизации и восстановление настроек применялись молча — так
 * можно было подсунуть чужую подписку или открыть локальный прокси в сеть.
 */
async function confirmDeeplink(
  message: string,
  detail: string,
  buttons: [string, string] = ['Применить', 'Отмена']
): Promise<boolean> {
  // Программа выходит на передний план: окно подтверждения не должно
  // прятаться за браузером, который открыл ссылку.
  await bringToFront().catch(() => void 0)
  const win =
    BrowserWindow.getFocusedWindow() ??
    BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.isVisible()) ??
    null
  const opts = {
    type: 'question' as const,
    buttons,
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    title: 'LAZEYKA — ссылка lazeyka://',
    message,
    detail: `${detail}\n\nЕсли вы не открывали эту ссылку сами, нажмите «Отмена».`
  }
  const res = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts)
  if (res.response !== 0) appLog('info', '[deeplink] Пользователь отменил команду')
  return res.response === 0
}

/** Ключи настроек, которые ссылка восстановления не меняет никогда. */
const RESTORE_BLOCKED_KEYS = new Set([
  'socksUser',
  'socksPass',
  'socksAuth',
  'selectedNodeId',
  'allowLan',
  'mixedPort'
])

function describePayloadHost(payload: string): string {
  const m = /https?:\/\/[^\s/?#]+/i.exec(payload)
  return m ? m[0] : payload.slice(0, 80)
}

function broadcastRefresh(): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('incy:dataChanged')
  }
}

export async function handleDeepLink(url: string): Promise<void> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    appLog('warn', `[deeplink] Не удалось разобрать ссылку: ${forLog(url)}`)
    return
  }
  if (parsed.protocol !== `${DEEPLINK_SCHEME}:`) return

  // `lazeyka://connect` parses with host="connect" and an empty path, while
  // `lazeyka://routing/add/xxx` gives host="routing", path="/add/xxx". Joining
  // them back together lets one parser handle both shapes.
  const segments = [parsed.host, ...parsed.pathname.split('/')]
    .map((s) => s.trim())
    .filter(Boolean)
  const command = (segments[0] || '').toLowerCase()

  // Подпись: код из ?k= сверяется с HMAC секрета установки по действию.
  const action = canonicalAction(segments)
  let signed = false
  if (action) {
    try {
      signed = verifyAction(getDeeplinkKey(), action, parsed.searchParams.get(SIGN_PARAM))
    } catch (e) {
      appLog('warn', `[deeplink] Секрет подписи недоступен: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  appLog('info', `[deeplink] Команда: ${command}${action ? (signed ? ' (подписана)' : ' (без подписи)') : ''}`)

  try {
    if (action && !signed && !isWindowOnlyAction(action)) {
      const ok = await confirmDeeplink(
        `Внешняя ссылка просит: ${describeForUser(action)}. Выполнить?`,
        'Ссылку lazeyka:// открыла другая программа или веб-страница. Ссылки из карточки «Кнопки для стрим-пульта» выполняются без этого вопроса.',
        ['Да', 'Нет']
      )
      if (!ok) return
    }
    const simple = parseSimpleCommand(segments)
    if (simple) {
      await runSimpleCommand(simple)
      return
    }
    switch (command) {
      case 'connect':
      case 'open': {
        await connectIncyNode()
        break
      }

      case 'disconnect':
      case 'close': {
        await disconnectIncy()
        break
      }

      case 'toggle': {
        const state = getIncyStatus().state
        if (state === 'running' || state === 'connecting') await disconnectIncy()
        else await connectIncyNode()
        break
      }

      case 'import':
      case 'add': {
        await bringToFront().catch(() => void 0)
        const payload = decodePayload(segments.slice(1).join('/'))
        if (!payload) {
          notify('LAZEYKA', 'Ссылка не содержит подписку или конфигурацию')
          break
        }
        if (!(await confirmDeeplink('Добавить серверы из ссылки?', `Источник: ${describePayloadHost(payload)}`))) break
        const res = await importIncyInput(payload)
        broadcastRefresh()
        notify(
          'LAZEYKA — импорт',
          res.addedCount > 0
            ? `Добавлено серверов: ${res.addedCount}`
            : 'Новых серверов не найдено'
        )
        break
      }

      case 'routing': {
        await bringToFront().catch(() => void 0)
        // routing/add/<base64> — append; routing/oneadd/<base64> — replace.
        const mode = (segments[1] || '').toLowerCase()
        const payload = decodePayload(segments.slice(2).join('/'))
        const rules = parseRoutingPayload(payload)
        if (rules.length === 0) {
          notify('LAZEYKA — маршрутизация', 'В ссылке нет корректных правил')
          break
        }
        const preview = rules
          .slice(0, 8)
          .map((r) => `${r.value} → ${r.action === 'proxy' ? 'VPN' : r.action === 'direct' ? 'напрямую' : 'блок'}`)
          .join('\n')
        if (
          !(await confirmDeeplink(
            mode === 'oneadd' ? 'Заменить все свои правила маршрутизации?' : 'Добавить правила маршрутизации?',
            `${preview}${rules.length > 8 ? `\n…и ещё ${rules.length - 8}` : ''}`
          ))
        ) {
          break
        }
        const settings = loadIncySettings()
        settings.customRoutingRules =
          mode === 'oneadd' ? rules : [...(settings.customRoutingRules ?? []), ...rules]
        saveIncySettings(settings)
        broadcastRefresh()
        notify(
          'LAZEYKA — маршрутизация',
          `${mode === 'oneadd' ? 'Заменено на' : 'Добавлено'} ${rules.length} правил`
        )
        break
      }

      case 'restore': {
        await bringToFront().catch(() => void 0)
        const payload = decodePayload(segments.slice(1).join('/'))
        let subsHint = ''
        try {
          const d = JSON.parse(payload)
          const list: string[] = Array.isArray(d?.subscriptions)
            ? d.subscriptions.map((s: { url?: unknown }) => String(s?.url ?? ''))
            : d?.subscription?.url
              ? [String(d.subscription.url)]
              : []
          subsHint = list.filter(Boolean).map(describePayloadHost).join('\n')
        } catch { /* не JSON — applyRestorePayload сам откажет */ }
        if (
          !(await confirmDeeplink(
            'Восстановить настройки INCY из ссылки?',
            `Настройки INCY будут заменены значениями из ссылки.${subsHint ? `\nПодписки:\n${subsHint}` : ''}`
          ))
        ) {
          break
        }
        const applied = applyRestorePayload(payload)
        if (applied) {
          broadcastRefresh()
          notify('LAZEYKA — восстановление', 'Настройки применены')
        } else {
          notify('LAZEYKA — восстановление', 'Ссылка не похожа на копию настроек')
        }
        break
      }

      default:
        // Неизвестная команда — просто показываем программу, как при обычном запуске.
        await bringToFront().catch(() => void 0)
        appLog('warn', `[deeplink] Неизвестная команда: ${command}`)
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    appLog('error', `[deeplink] ${command} завершилась ошибкой: ${message}`)
    notify('LAZEYKA', `Команда ${command} не выполнена: ${message}`)
  }
}

/** Описание для окна подтверждения; у сценария — его имя, а не идентификатор. */
function describeForUser(action: string): string {
  const m = /^scenario\/(.+)$/.exec(action)
  if (m) {
    const sc = listScenarios().find((x) => x.id === m[1])
    if (sc) return `применить сценарий «${sc.name}»`
  }
  return describeAction(action)
}

function tellWindows(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed() && !w.webContents.isDestroyed()) w.webContents.send(channel, payload)
  }
}

/** Простые команды: службы, сценарий, мини-окно (подпись уже проверена в handleDeepLink). */
async function runSimpleCommand(cmd: SimpleCommand): Promise<void> {
  switch (cmd.kind) {
    case 'invalid':
      notify('LAZEYKA', `Ссылка не выполнена: ${cmd.reason}`)
      return
    case 'mini':
      toggleMiniWindow()
      return
    case 'scenario': {
      const sc = listScenarios().find((x) => x.id === cmd.id)
      if (!sc) {
        notify('LAZEYKA', 'Сценарий из ссылки не найден')
        return
      }
      // Так же, как при нажатии горячей клавиши сценария: окно узнаёт о запуске.
      tellWindows('scenario:running', sc.id)
      try {
        const steps = await applyScenario(sc.id)
        const bad = steps.filter((x) => !x.ok)
        tellWindows('scenario:applied', { id: sc.id, name: sc.name, emoji: sc.emoji, ok: bad.length === 0, at: Date.now(), steps })
        notify(
          `LAZEYKA — ${sc.emoji} ${sc.name}`,
          bad.length ? `Не всё получилось: ${bad.map((b) => b.what).join(', ')}` : 'Сценарий выполнен'
        )
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        tellWindows('scenario:applied', {
          id: sc.id, name: sc.name, emoji: sc.emoji, ok: false, at: Date.now(),
          steps: [{ what: 'Сценарий', ok: false, message }]
        })
        throw e
      }
      return
    }
    case 'service': {
      if (cmd.service === 'zapret') {
        const on = wantedState(cmd.action, getZapretStatus().state === 'running')
        if (on) await startZapret()
        else await stopZapret()
      } else if (cmd.service === 'telegram') {
        const on = wantedState(cmd.action, getTgwsStatus().state === 'running')
        if (on) await startTgws()
        else await stopTgws()
      } else {
        const { loadIncySettings, patchIncySettings } = await import('./incy-engine')
        const on = wantedState(cmd.action, !!loadIncySettings().perAppProxy)
        patchIncySettings({ perAppProxy: on })
        notify('LAZEYKA — ExitLag', on ? 'Включён: VPN только для приложений из списка' : 'Выключен: весь трафик как обычно')
      }
    }
  }
}

/**
 * Routing rules from a link.
 *
 * Two shapes are accepted: a JSON array of rules, and a plain-text list of
 * `value action` lines (`youtube.com proxy`), which is what a person is
 * realistically going to type by hand.
 */
function parseRoutingPayload(payload: string): IncyRoutingRule[] {
  const mkId = (): string => `dl_${Math.random().toString(36).slice(2, 10)}`
  const validAction = (a: string): a is 'direct' | 'proxy' | 'block' =>
    a === 'direct' || a === 'proxy' || a === 'block'

  try {
    const data = JSON.parse(payload)
    const list = Array.isArray(data) ? data : Array.isArray(data?.rules) ? data.rules : null
    if (list) {
      return list
        .map((r: any) => ({
          id: typeof r?.id === 'string' ? r.id : mkId(),
          value: String(r?.value ?? '').trim(),
          action: validAction(String(r?.action)) ? (r.action as 'direct' | 'proxy' | 'block') : 'proxy',
          enabled: r?.enabled !== false,
          comment: typeof r?.comment === 'string' ? r.comment : undefined
        }))
        .filter((r: IncyRoutingRule) => r.value.length > 0)
    }
  } catch { /* not JSON — fall through to the line format */ }

  return payload
    .split(/[\r\n,;]+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [value, action = 'proxy'] = line.split(/\s+/)
      return {
        id: mkId(),
        value: value.trim(),
        action: validAction(action.toLowerCase()) ? (action.toLowerCase() as 'direct' | 'proxy' | 'block') : 'proxy',
        enabled: true
      }
    })
    .filter((r) => r.value.length > 0)
}

/**
 * Settings half of a backup link (`buildIncyBackupLink`).
 *
 * Only settings are applied here — the subscription URL is handed to the
 * normal import path so its servers are actually downloaded.
 */
function applyRestorePayload(payload: string): boolean {
  try {
    const data = JSON.parse(payload)
    if (!data || data.format !== 'lazeyka-incy') return false

    if (data.settings && typeof data.settings === 'object') {
      const current = loadIncySettings()
      const next = { ...current }
      for (const [key, value] of Object.entries(data.settings)) {
        // Local-proxy credentials stay machine-specific, and a selected node id
        // from another device points at a server this one does not have.
        // Плюс то, что открывает локальный прокси наружу: доступ из сети,
        // выключенный пароль и порт не меняются чужой ссылкой.
        if (RESTORE_BLOCKED_KEYS.has(key)) continue
        ;(next as any)[key] = value
      }
      saveIncySettings(next)
    }

    // Ссылка может нести несколько подписок; у старых — только поле
    // `subscription`. Импортируем последовательно, чтобы одновременные записи
    // в файл узлов не затирали друг друга.
    const urls: string[] = Array.isArray(data.subscriptions)
      ? data.subscriptions.map((s: { url?: unknown }) => String(s?.url ?? '')).filter(Boolean)
      : data.subscription?.url
        ? [String(data.subscription.url)]
        : []

    if (urls.length > 0) {
      void (async () => {
        for (const url of urls) {
          try {
            await importIncyInput(url)
          } catch (e) {
            appLog('warn', `[deeplink] Подписка из ссылки не загрузилась: ${String(e)}`)
          }
        }
        broadcastRefresh()
      })()
    }
    return true
  } catch {
    return false
  }
}
