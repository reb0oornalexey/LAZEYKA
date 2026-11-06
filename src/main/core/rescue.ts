/**
 * Мастер «Ничего не открывается».
 *
 * Проверяет по шагам: интернет вообще → DNS → популярные сайты → VPN-узел →
 * системные причины (права, службы, hosts, прокси). У каждой найденной
 * проблемы — кнопка «Исправить»; там, где исправление что-то меняет, ответ
 * несёт действие «Откатить». Без нажатия ничего не меняется, записи Flowseal
 * в hosts не трогаются как «чужие».
 */
import net from 'node:net'
import dns from 'node:dns'
import { getZapretStatus, restartZapret, startZapret } from './zapret'
import { getIncyStatus, incyTunnelAlive, forceIncyFailover } from './incy-engine'
import { applySystemDns, readDnsActive } from './dns-doh'

export interface RescueAction {
  action: string
  label: string
  arg?: string
}

export interface RescueItem {
  id: string
  title: string
  status: 'ok' | 'warn' | 'fail'
  message: string
  fix?: RescueAction
}

export interface RescueFixResult {
  success: boolean
  message: string
  undo?: RescueAction
}

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      () => {
        clearTimeout(t)
        resolve(fallback)
      }
    )
  })
}

function tcpOk(host: string, port: number, ms = 4000): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.createConnection({ host, port })
    const done = (v: boolean): void => {
      s.destroy()
      resolve(v)
    }
    s.setTimeout(ms, () => done(false))
    s.once('connect', () => done(true))
    s.once('error', () => done(false))
  })
}

async function siteOk(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(8000) })
    return res.status > 0 && res.status < 500
  } catch {
    return false
  }
}

export async function runRescue(): Promise<RescueItem[]> {
  const items: RescueItem[] = []

  // 1. Интернет вообще (по IP, без DNS).
  const inet = (await Promise.all([tcpOk('1.1.1.1', 443), tcpOk('8.8.8.8', 443), tcpOk('77.88.8.8', 53)])).some(Boolean)
  items.push(
    inet
      ? { id: 'internet', title: 'Подключение к интернету', status: 'ok', message: 'Интернет есть.' }
      : {
          id: 'internet',
          title: 'Подключение к интернету',
          status: 'fail',
          message: 'Нет соединения даже по IP-адресу. Проверьте кабель/Wi-Fi и роутер — дело не в блокировках.'
        }
  )
  if (!inet) return items

  // 2. DNS.
  const lookup = (h: string): Promise<boolean> =>
    withTimeout(dns.promises.lookup(h).then(() => true), 5000, false)
  const [ya, yt] = await Promise.all([lookup('ya.ru'), lookup('youtube.com')])
  const active = readDnsActive()
  if (ya && yt) {
    items.push({ id: 'dns', title: 'DNS', status: 'ok', message: 'Имена сайтов определяются.' })
  } else {
    items.push({
      id: 'dns',
      title: 'DNS',
      status: 'fail',
      message: active
        ? 'DNS не отвечает. Возможно, выбранный в LAZEYKA сервер сейчас недоступен — вернём стандартный DNS провайдера.'
        : 'DNS не отвечает. Проверьте DNS в настройках сети или выберите сервер на вкладке «DNS».',
      fix: active ? { action: 'dns_reset', label: 'Вернуть стандартный DNS', arg: active.providerId } : undefined
    })
  }

  // 3. VPN.
  const incy = getIncyStatus()
  if (incy.state === 'running') {
    const alive = await withTimeout(incyTunnelAlive(), 10_000, false)
    if (alive === false) {
      items.push({
        id: 'vpn',
        title: 'VPN-узел',
        status: 'fail',
        message: 'Через подключённый узел трафик не проходит.',
        fix: { action: 'incy_failover', label: 'Переключить на рабочий узел' }
      })
    } else {
      items.push({ id: 'vpn', title: 'VPN-узел', status: 'ok', message: alive ? 'Трафик через узел проходит.' : 'Подключён.' })
    }
  }

  // 4. Популярные сайты.
  const sites: [string, string][] = [
    ['YouTube', 'https://www.youtube.com/generate_204'],
    ['Discord', 'https://discord.com/'],
    ['Telegram (веб)', 'https://web.telegram.org/']
  ]
  const results = await Promise.all(sites.map(async ([name, url]) => [name, await siteOk(url)] as const))
  const failed = results.filter(([, ok]) => !ok).map(([n]) => n)
  const zapretOn = getZapretStatus().state === 'running'
  if (failed.length === 0) {
    items.push({ id: 'sites', title: 'Популярные сайты', status: 'ok', message: 'YouTube, Discord и Telegram отвечают.' })
  } else {
    items.push({
      id: 'sites',
      title: 'Популярные сайты',
      status: 'warn',
      message: `Не открываются: ${failed.join(', ')}.${
        zapretOn
          ? ' Zapret включён — перезапустите его; если не поможет, подберите стратегию на вкладке Zapret («Тест стратегий»).'
          : incy.state === 'running'
            ? ''
            : ' Ни Zapret, ни VPN не включены.'
      }`,
      fix: zapretOn
        ? { action: 'zapret_restart', label: 'Перезапустить Zapret' }
        : incy.state === 'running'
          ? undefined
          : { action: 'zapret_start', label: 'Включить Zapret' }
    })
  }

  // 5. Системные причины (Windows): права, службы, hosts, прокси, конфликты.
  if (process.platform === 'win32') {
    try {
      const { runZapretDiagnostics } = await import('./zapret-service-settings')
      const rep = await runZapretDiagnostics()
      for (const d of rep.items) {
        if (d.status === 'ok') continue
        items.push({
          id: `diag-${d.id}`,
          title: d.title,
          status: d.status === 'error' ? 'fail' : 'warn',
          message: d.message,
          fix: d.fixAction ? { action: `diag:${d.fixAction}`, label: d.fixLabel || 'Исправить' } : undefined
        })
      }
    } catch {
      /* диагностика недоступна — не мешаем остальному */
    }
  }

  return items
}

export async function rescueFix(action: string, arg?: string): Promise<RescueFixResult> {
  if (action === 'dns_reset') {
    const r = await applySystemDns('dhcp')
    if (!r.success) throw new Error(r.message)
    return {
      success: true,
      message: r.message,
      undo: arg ? { action: 'dns_apply', label: 'Вернуть прежний DNS', arg } : undefined
    }
  }
  if (action === 'dns_apply' && arg) {
    const r = await applySystemDns(arg)
    if (!r.success) throw new Error(r.message)
    return { success: true, message: r.message }
  }
  if (action === 'incy_failover') {
    return { success: true, message: await forceIncyFailover() }
  }
  if (action === 'zapret_restart') {
    await restartZapret()
    return { success: true, message: 'Zapret перезапущен' }
  }
  if (action === 'zapret_start') {
    await startZapret()
    return { success: true, message: 'Zapret включён', undo: { action: 'zapret_stop', label: 'Выключить Zapret' } }
  }
  if (action === 'zapret_stop') {
    const { stopZapret } = await import('./zapret')
    await stopZapret()
    return { success: true, message: 'Zapret выключен' }
  }
  if (action.startsWith('diag:')) {
    const { fixDiagnosticIssue } = await import('./zapret-service-settings')
    const what = action.slice(5)
    const r = await fixDiagnosticIssue(what)
    return {
      success: r.success,
      message: r.message,
      undo: what === 'update_hosts' ? { action: 'diag:restore_hosts', label: 'Вернуть прежний hosts' } : undefined
    }
  }
  throw new Error(`Неизвестное действие: ${action}`)
}
