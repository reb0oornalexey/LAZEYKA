/**
 * Системный DNS на macOS через `networksetup`.
 *
 * Работает со всеми включёнными сетевыми службами (Wi-Fi, Ethernet, USB…):
 * macOS выбирает маршрут сама, и менять DNS только у одной службы значило бы
 * остаться без эффекта после переключения сети. Прежние DNS каждой службы
 * запоминаются в файле резервной копии (один раз — до первой смены из
 * LAZEYKA) и возвращаются при сбросе.
 *
 * Шифрованного DNS (DoH/DoT) без профиля конфигурации `networksetup` не
 * умеет — выставляются обычные адреса провайдера.
 */
import { execFile } from 'node:child_process'
import { buildAdminScript, isOsascriptCancel, readableOsascriptError, shQuote } from './incy-mac-lxd'

const NETWORKSETUP = '/usr/sbin/networksetup'

export interface MacDnsBackup {
  platform: 'darwin'
  /** Служба → её прежние вручную заданные DNS (пусто — стояли от DHCP). */
  services: Record<string, string[]>
}

interface RunResult {
  code: number
  out: string
}

function run(file: string, args: string[], timeout = 15_000): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout, maxBuffer: 2 * 1024 * 1024 }, (err, stdout, stderr) => {
      const out = `${String(stdout ?? '')}${String(stderr ?? '')}`.trim()
      if (!err) return resolve({ code: 0, out })
      const code = typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : 1
      resolve({ code, out: out || String(err.message || err) })
    })
  })
}

/** Вывод `-listallnetworkservices` → включённые службы (без заголовка и `*`-отключённых). */
export function parseNetworkServices(out: string): string[] {
  const lines = out.split(/\r?\n/)
  const res: string[] = []
  for (const raw of lines) {
    const line = raw.trimEnd()
    if (!line.trim()) continue
    if (/^an asterisk/i.test(line.trim())) continue
    if (line.startsWith('*')) continue
    res.push(line.trim())
  }
  return res
}

/** Вывод `-getdnsservers`: адреса по строке или «There aren't any DNS Servers set on …». */
export function parseDnsServers(out: string): string[] {
  const res: string[] = []
  for (const raw of out.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || /aren'?t any dns servers/i.test(line)) continue
    // Адрес — единственное слово без пробелов, содержащее цифры/двоеточия/точки.
    if (/^[0-9a-fA-F:.%\w-]+$/.test(line) && /[.:]/.test(line)) res.push(line)
  }
  return res
}

/** `scutil --dns`: серверы первого (основного) резолвера. */
export function parseScutilDns(out: string): string[] {
  const res: string[] = []
  let inFirst = false
  for (const raw of out.split(/\r?\n/)) {
    const line = raw.trim()
    if (/^resolver #\d+/.test(line)) {
      if (inFirst) break
      inFirst = line === 'resolver #1'
      continue
    }
    if (!inFirst) continue
    const m = /^nameserver\[\d+\]\s*:\s*(\S+)/.exec(line)
    if (m) res.push(m[1])
  }
  return res
}

export async function listEnabledServices(): Promise<string[]> {
  const r = await run(NETWORKSETUP, ['-listallnetworkservices'])
  if (r.code !== 0) return []
  return parseNetworkServices(r.out)
}

export async function readServiceDns(service: string): Promise<string[]> {
  const r = await run(NETWORKSETUP, ['-getdnsservers', service])
  return r.code === 0 ? parseDnsServers(r.out) : []
}

/** Ручные DNS всех служб (а если их нет — действующие из `scutil --dns`). */
export async function readMacDnsState(): Promise<string[]> {
  const services = await listEnabledServices()
  const manual = (await Promise.all(services.map((s) => readServiceDns(s)))).flat()
  if (manual.length > 0) return [...new Set(manual)]
  const r = await run('/usr/sbin/scutil', ['--dns'])
  return r.code === 0 ? [...new Set(parseScutilDns(r.out))] : []
}

export async function snapshotMacDns(): Promise<MacDnsBackup> {
  const services = await listEnabledServices()
  const entries = await Promise.all(services.map(async (s) => [s, await readServiceDns(s)] as const))
  return { platform: 'darwin', services: Object.fromEntries(entries) }
}

/** Файл копии нашей формы? (Файл Windows устроен иначе.) */
export function isMacBackup(v: unknown): v is MacDnsBackup {
  const o = v as MacDnsBackup | null
  return Boolean(o && o.platform === 'darwin' && o.services && typeof o.services === 'object')
}

/** Ошибка `networksetup` из-за нехватки прав (а не неверных аргументов). */
export function isAuthError(text: string): boolean {
  return /admin|authoriz|permission|privilege|not allowed|denied|root|requires/i.test(text)
}

/** Одна команда — одна служба: пустой список = `Empty` (вернуть DHCP). */
function nsArgs(service: string, servers: string[]): string[] {
  return ['-setdnsservers', service, ...(servers.length > 0 ? servers : ['Empty'])]
}

export type MacDnsWriteResult = { ok: true; elevated: boolean } | { ok: false; cancelled?: boolean; message: string }

/**
 * Записать DNS служб. Сначала от пользователя; если какая-то служба отказала
 * из-за прав, один раз повторяем всё недостающее через окно пароля
 * администратора (osascript). Закрытое окно (-128) — отмена.
 */
export async function writeMacDns(changes: Record<string, string[]>): Promise<MacDnsWriteResult> {
  const failed: { service: string; text: string }[] = []
  for (const [service, servers] of Object.entries(changes)) {
    const r = await run(NETWORKSETUP, nsArgs(service, servers))
    // networksetup иногда печатает ошибку при коде 0.
    if (r.code !== 0 || /^\*\* Error/m.test(r.out)) failed.push({ service, text: r.out })
  }
  if (failed.length === 0) {
    await run('/usr/bin/dscacheutil', ['-flushcache'])
    return { ok: true, elevated: false }
  }
  if (!failed.some((f) => isAuthError(f.text))) {
    return { ok: false, message: `networksetup: ${failed[0].text || 'не удалось изменить DNS'}` }
  }

  const cmd = [
    ...failed.map((f) => [shQuote(NETWORKSETUP), ...nsArgs(f.service, changes[f.service]).map(shQuote)].join(' ')),
    '/usr/bin/dscacheutil -flushcache',
    '/usr/bin/killall -HUP mDNSResponder || true'
  ].join(' && ')
  const r = await run('/usr/bin/osascript', ['-e', buildAdminScript(cmd)], 120_000)
  if (r.code === 0) return { ok: true, elevated: true }
  if (isOsascriptCancel(r.out)) return { ok: false, cancelled: true, message: 'Смена DNS отменена: окно пароля закрыто' }
  return { ok: false, message: readableOsascriptError(r.out) || 'Не удалось изменить DNS с правами администратора' }
}
