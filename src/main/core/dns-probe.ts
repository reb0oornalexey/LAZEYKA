/**
 * Проверка DNS-сервера до сохранения (форма «Свой DNS-сервер» / «Изменить
 * адреса» на вкладке DNS). Один запрос по кнопке «Проверить»: каждому
 * введённому адресу — обычный DNS-запрос по UDP, шаблону DoH — запрос по
 * HTTP/2 (те же замеры, что у пинга в списке). Ничего не сохраняет и не
 * работает в фоне.
 *
 * IPC: dnsProbe:check
 */
import net from 'node:net'
import { ipcMain } from 'electron'
import { pingDohProvider, pingUdpDns, type DohProvider } from './dns-doh'

export interface DnsProbeInput {
  ipv4?: string[]
  ipv6?: string[]
  doh?: string
}

export interface DnsProbeItem {
  /** Адрес или шаблон DoH, который проверяли. */
  target: string
  kind: 'ipv4' | 'ipv6' | 'doh'
  /** Время ответа в мс; null — нет ответа. */
  ms: number | null
}

function h<T>(fn: (...args: unknown[]) => Promise<T> | T) {
  return async (_event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => {
    try {
      const value = await fn(...args)
      return { ok: true, value }
    } catch (e: unknown) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) }
    }
  }
}

const list = (v: unknown): string[] =>
  Array.isArray(v)
    ? v
        .map((x) => String(x).trim())
        .filter(Boolean)
        .slice(0, 2)
    : []

export async function probeDns(raw: unknown): Promise<DnsProbeItem[]> {
  const input = (raw && typeof raw === 'object' ? raw : {}) as DnsProbeInput
  const v4 = list(input.ipv4).filter((a) => net.isIPv4(a))
  const v6 = list(input.ipv6).filter((a) => net.isIPv6(a))
  let doh = ''
  const rawDoh = String(input.doh ?? '').trim()
  if (rawDoh) {
    try {
      const u = new URL(rawDoh)
      if (u.protocol === 'https:') doh = u.toString()
    } catch {
      /* неверный шаблон не проверяем */
    }
  }
  const jobs: Promise<DnsProbeItem>[] = [
    ...v4.map(async (a) => ({ target: a, kind: 'ipv4' as const, ms: await pingUdpDns(a) })),
    ...v6.map(async (a) => ({ target: a, kind: 'ipv6' as const, ms: await pingUdpDns(a) }))
  ]
  if (doh) {
    jobs.push(
      (async () => ({
        target: doh,
        kind: 'doh' as const,
        ms: await pingDohProvider({ url: doh } as DohProvider)
      }))()
    )
  }
  return Promise.all(jobs)
}

export function registerDnsProbeIpc(): void {
  ipcMain.handle(
    'dnsProbe:check',
    h((input) => probeDns(input))
  )
}
