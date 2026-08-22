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
 */
import { app, BrowserWindow } from 'electron'
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
  return argv.find((a) => a.startsWith(`${DEEPLINK_SCHEME}://`)) ?? null
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
  showSystemNotification(title, body)
  appLog('info', `[deeplink] ${title}: ${body}`)
}

/** Tell the renderer to reload INCY data after a link changed something. */
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
    appLog('warn', `[deeplink] Не удалось разобрать ссылку: ${url}`)
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

  appLog('info', `[deeplink] Команда: ${command}`)

  try {
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
        const payload = decodePayload(segments.slice(1).join('/'))
        if (!payload) {
          notify('LAZEYKA', 'Ссылка не содержит подписку или конфигурацию')
          break
        }
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
        // routing/add/<base64> — append; routing/oneadd/<base64> — replace.
        const mode = (segments[1] || '').toLowerCase()
        const payload = decodePayload(segments.slice(2).join('/'))
        const rules = parseRoutingPayload(payload)
        if (rules.length === 0) {
          notify('LAZEYKA — маршрутизация', 'В ссылке нет корректных правил')
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
        const payload = decodePayload(segments.slice(1).join('/'))
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
        appLog('warn', `[deeplink] Неизвестная команда: ${command}`)
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    appLog('error', `[deeplink] ${command} завершилась ошибкой: ${message}`)
    notify('LAZEYKA', `Команда ${command} не выполнена: ${message}`)
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
        if (key === 'socksUser' || key === 'socksPass' || key === 'selectedNodeId') continue
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
