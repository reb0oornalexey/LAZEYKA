/**
 * Отчёт для поддержки: ТЕКСТОВЫЙ файл с версией, системой, состоянием служб и
 * хвостом лога. Всё, что попадает в файл, проходит маскировку (hub-pure.ts):
 * адреса, ссылки подписок, ключи, секреты, имя пользователя. Название и адрес
 * сервера INCY в отчёт не попадают. Отправляет отчёт только сама кнопка
 * «Отправить» в окне предпросмотра.
 */
import { app } from 'electron'
import os from 'node:os'
import path from 'node:path'
import { open, readdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { getAppConfig } from '../config'
import { isXrayAvailable, logDir } from '../utils/dirs'
import { flushLogsNow } from '../utils/file-logger'
import { getZapretStatus } from './zapret'
import { getIncyStatus } from './incy-engine'
import { singBoxVersion } from './incy-core-updater'
import { getTgwsStatus } from './tgws'
import { describeSystemDns } from './dns-doh'
import { lastLines, maskLogLine, maskText, type MaskOptions } from './hub-pure'
import type { SiteCheckResult } from './site-check'

export interface BuiltReport {
  text: string
  bytes: number
}

const LOG_TAIL_LINES = 400
const MAX_REPORT_BYTES = 1_500_000

// ---- То, что страницы могут сообщить отчёту (новых запросов в сеть отчёт не делает) ----

let lastSite: { at: number; result: SiteCheckResult } | null = null
let ispName = ''

/** Вызывать после каждой «Проверки сайта»: результат попадёт в отчёт (хранится только в памяти). */
export function noteSiteCheck(result: SiteCheckResult): void {
  lastSite = { at: Date.now(), result }
}

/** Вызывать, когда проект уже узнал провайдера (например, после проверки ExitLag: outside.isp). */
export function noteIsp(isp: string | undefined | null): void {
  const v = String(isp ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, 80)
  if (v) ispName = v
}

export function getIspNote(): string {
  return ispName
}

// ---- Маскировка с именем пользователя и компьютера ------------------------------------

function maskOptions(): MaskOptions {
  const literals: string[] = []
  try {
    literals.push(os.userInfo().username)
  } catch {
    /* нет доступа к имени пользователя */
  }
  try {
    literals.push(os.hostname())
  } catch {
    /* noop */
  }
  return { literals }
}

/** Маскировка текста с учётом имени пользователя и компьютера этой машины. */
export function maskForReport(text: string): string {
  return maskText(text, maskOptions())
}

// ---- Система -----------------------------------------------------------------------------

export function osLabel(): string {
  if (process.platform === 'win32') return `Windows ${os.release()} ${process.arch}`
  if (process.platform === 'darwin') return `macOS (Darwin ${os.release()}) ${process.arch}`
  return `${process.platform} ${os.release()} ${process.arch}`
}

const yn = (v: boolean | undefined): string => (v ? 'да' : 'нет')

const STATE_RU: Record<string, string> = {
  stopped: 'выключен',
  starting: 'запускается',
  running: 'работает',
  stopping: 'останавливается',
  error: 'ошибка',
  connecting: 'подключается'
}
const stateRu = (s: string): string => STATE_RU[s] ?? s

const CONN_RU: Record<string, string> = { tun: 'TUN', system_proxy: 'системный прокси', only_proxy: 'только прокси' }
const ROUTE_RU: Record<string, string> = { 'bypass-ru': 'обход для РФ', global: 'всё через VPN', direct: 'напрямую' }

async function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return await Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))])
}

async function servicesSection(): Promise<string[]> {
  const out: string[] = ['== Службы ==']
  let cfg: AppConfig | null = null
  try {
    cfg = await getAppConfig()
  } catch {
    /* без настроек */
  }

  try {
    const z = getZapretStatus()
    const zc = cfg?.zapret
    out.push(
      `Zapret: ${z.state === 'running' ? 'включён' : stateRu(z.state)}` +
        (zc?.activeStrategy ? `; стратегия: ${zc.activeStrategy}` : '') +
        (zc?.gameFilterMode ? `; игровой фильтр: ${zc.gameFilterMode}` : '') +
        (zc?.ipsetMode ? `; IPset: ${zc.ipsetMode}` : '') +
        (zc?.useService ? '; как служба' : '') +
        (zc?.installedVersion ? `; сборка ${zc.installedVersion}` : '') +
        (z.lastError ? `; последняя ошибка: ${z.lastError.slice(0, 200)}` : '')
    )
  } catch {
    out.push('Zapret: не удалось получить состояние')
  }

  try {
    const i = getIncyStatus()
    const core = await withTimeout(singBoxVersion().catch(() => undefined), 6000, undefined)
    out.push(
      `INCY: ${stateRu(i.state)}; режим подключения: ${CONN_RU[i.connectionMode] ?? i.connectionMode}; маршрутизация: ${ROUTE_RU[i.routingMode] ?? i.routingMode}` +
        `; узел выбран: ${yn(Boolean(i.selectedNodeId))}` +
        (i.killSwitchActive ? '; Kill Switch держит трафик' : '') +
        (i.recovering ? '; идёт переподключение' : '') +
        // Текст ошибки может содержать адрес сервера — в отчёт идёт только факт.
        (i.lastError ? '; есть последняя ошибка (подробности в логе)' : '')
    )
    out.push(`Ядра INCY: sing-box ${core ?? 'версия не определена'}; Xray: ${isXrayAvailable() ? 'есть' : 'нет'}`)
    out.push(
      `ExitLag: ${i.exitLagActive ? `включён (приложений в списке: ${i.exitLagApps?.length ?? 0})` : 'выключен'}`
    )
  } catch {
    out.push('INCY: не удалось получить состояние')
  }

  try {
    const t = getTgwsStatus()
    const tc = cfg?.tgws
    out.push(
      `Telegram (TgWsProxy): ${stateRu(t.state)}` +
        (tc ? `; порт: ${tc.port}; маршрут: ${tc.routeMode ?? 'auto'}; через INCY: ${yn(tc.viaIncy)}; CF-прокси: ${yn(tc.cfproxy)}` : '') +
        (t.lastError ? `; последняя ошибка: ${t.lastError.slice(0, 200)}` : '')
    )
  } catch {
    out.push('Telegram (TgWsProxy): не удалось получить состояние')
  }

  try {
    const d = await withTimeout(describeSystemDns(), 8000, null)
    if (!d) out.push('DNS: не удалось прочитать за отведённое время')
    else if (d.providerName) out.push(`DNS: ${d.providerName}`)
    else out.push(`DNS: ${d.servers.length ? d.servers.join(', ') : 'адреса не определены'}`)
  } catch {
    out.push('DNS: не удалось прочитать')
  }
  return out
}

function siteSection(): string[] {
  const out: string[] = ['== Последняя «Проверка сайта» ==']
  if (!lastSite) {
    out.push('В этом запуске программы проверка сайта не выполнялась.')
    return out
  }
  const r = lastSite.result
  out.push(`Когда: ${new Date(lastSite.at).toLocaleString('ru-RU')}`)
  out.push(`Сайт: ${r.host}; загрузка: ${r.pageLoadMs != null ? `${r.pageLoadMs} мс` : r.pageTimedOut ? 'не завершилась' : 'нет данных'}${r.pageError ? `; ошибка: ${r.pageError}` : ''}`)
  out.push(`Через туннель: ${yn(r.viaTunnel)}; Zapret работал: ${yn(r.zapretRunning)}`)
  for (const v of r.verdict.slice(0, 8)) out.push(`Вывод: ${v}`)
  for (const p of r.probes.slice(0, 20)) {
    out.push(
      `  ${p.host}: ${p.verdict}${p.dnsSource ? ` (${p.dnsSource})` : ''}; DNS ${p.dnsMs ?? '-'} мс, TCP ${p.tcpMs ?? '-'} мс, TLS ${p.tlsMs ?? '-'} мс; Zapret: ${p.zapret}` +
        (p.error ? `; ${p.error}` : '')
    )
  }
  return out
}

// ---- Хвост логов -------------------------------------------------------------------------------

/** Последние строки файла: читаем только конец, а не весь (файл за день бывает большим). */
async function tailOfFile(file: string, lines: number): Promise<string[]> {
  const size = (await stat(file)).size
  const want = Math.min(size, 512 * 1024)
  const fh = await open(file, 'r')
  try {
    const buf = Buffer.alloc(want)
    await fh.read(buf, 0, want, size - want)
    let text = buf.toString('utf-8')
    // Начало могло попасть в середину строки (и символа) — выбрасываем первую.
    if (size > want) text = text.slice(text.indexOf('\n') + 1)
    return lastLines(text, lines)
  } finally {
    await fh.close()
  }
}

async function logSection(): Promise<string[]> {
  const out: string[] = [`== Лог (последние ~${LOG_TAIL_LINES} строк) ==`]
  try {
    await flushLogsNow()
    const dir = logDir()
    if (!existsSync(dir)) return [...out, 'Папка логов не найдена.']
    const files = (await readdir(dir)).filter((f) => /^\d{4}-\d{2}-\d{2}\.log$/.test(f)).sort().reverse()
    if (!files.length) return [...out, 'Файлов лога нет.']
    const collected: string[] = []
    for (const f of files.slice(0, 3)) {
      const chunk = await tailOfFile(path.join(dir, f), LOG_TAIL_LINES - collected.length)
      collected.unshift(...chunk)
      if (collected.length >= LOG_TAIL_LINES) break
    }
    const opts = maskOptions()
    out.push(...collected.map((l) => maskLogLine(l, opts)))
  } catch (e) {
    out.push(`Не удалось прочитать лог: ${e instanceof Error ? e.message : String(e)}`)
  }
  return out
}

// ---- Сборка -----------------------------------------------------------------------------------------

/**
 * Собрать отчёт и замаскировать весь текст. Это ровно то, что увидит человек и что уйдёт.
 * full = false — человек выключил «Приложить логи и сведения о системе»: в файле только версия
 * и система (их сервер и так получает отдельными полями), без служб, проверки сайта и журнала.
 */
export async function buildReport(opts: { full?: boolean } = {}): Promise<BuiltReport> {
  if (opts.full === false) {
    const short = [
      'LAZEYKA — отчёт для поддержки',
      `Сформирован: ${new Date().toLocaleString('ru-RU')}`,
      `Версия программы: ${app.getVersion()}`,
      `Система: ${osLabel()}`,
      '',
      'Состояние служб и журнал не приложены: человек выключил этот переключатель.'
    ]
    const text = maskForReport(short.join('\n')) + '\n'
    return { text, bytes: Buffer.byteLength(text, 'utf-8') }
  }
  const head: string[] = [
    'LAZEYKA — отчёт для поддержки',
    `Сформирован: ${new Date().toLocaleString('ru-RU')}`,
    `Версия программы: ${app.getVersion()}`,
    `Система: ${osLabel()}`,
    `Язык системы: ${app.getLocale()}`,
    `Провайдер: ${ispName || 'не определён'}`,
    ''
  ]
  const services = await servicesSection()
  const site = siteSection()
  const logs = await logSection()
  // Службы и сайт маскируем целиком; строки лога уже прошли maskLogLine, повторная
  // маскировка безвредна (функция идемпотентна) и страхует от ошибок.
  let text = maskForReport([...head, ...services, '', ...site, '', ...logs].join('\n')) + '\n'
  if (Buffer.byteLength(text, 'utf-8') > MAX_REPORT_BYTES) {
    text = text.slice(0, MAX_REPORT_BYTES) + '\n--- отчёт обрезан ---\n'
  }
  return { text, bytes: Buffer.byteLength(text, 'utf-8') }
}
