/**
 * «Белые списки»: определение режима, когда мобильная сеть пускает только на
 * разрешённые сайты. Запросы идут мимо VPN, с адреса физического адаптера:
 * несколько заведомо разрешённых российских адресов и несколько нейтральных
 * зарубежных, которые обычно не блокируются. Запускается только по кнопке.
 */
import { directSource, httpsGet } from './diag-net'
import { classifyWhitelist, runPool, type WhitelistVerdict } from './diag-logic'

/** Российские сайты, которые пускают и в режиме белых списков. */
export const WHITELIST_RU_HOSTS = ['ya.ru', 'vk.com', 'www.gosuslugi.ru']
/** Нейтральные зарубежные сайты, которые обычно не блокируются. */
export const WHITELIST_FOREIGN_HOSTS = ['example.com', 'www.wikipedia.org', 'www.cloudflare.com', 'www.apple.com']

const TIMEOUT_MS = 5000

export interface WhitelistProbe {
  host: string
  group: 'ru' | 'foreign'
  ok: boolean
  ms: number | null
  error?: string
}

export interface WhitelistResult {
  checkedAt: number
  /** false — проверку сделать нельзя (причина в message). */
  available: boolean
  message?: string
  probes: WhitelistProbe[]
  verdict: WhitelistVerdict | null
}

export async function runWhitelistCheck(): Promise<WhitelistResult> {
  const ds = await directSource()
  if (!ds.measurable) {
    return {
      checkedAt: Date.now(),
      available: false,
      message: `Проверку нужно делать мимо VPN, а здесь это невозможно: ${ds.reason ?? 'причина неизвестна'}. Отключите VPN и повторите.`,
      probes: [],
      verdict: null
    }
  }
  const targets: { host: string; group: 'ru' | 'foreign' }[] = [
    ...WHITELIST_RU_HOSTS.map((host) => ({ host, group: 'ru' as const })),
    ...WHITELIST_FOREIGN_HOSTS.map((host) => ({ host, group: 'foreign' as const }))
  ]
  const probes = await runPool(
    targets.map((t) => async (): Promise<WhitelistProbe> => {
      try {
        // Сертификат не проверяем: российские сайты используют корневой центр, которого нет в Node.
        // Нам важно лишь, что сервер ответил по HTTPS.
        const r = await httpsGet(`https://${t.host}/`, { timeoutMs: TIMEOUT_MS, localAddress: ds.ip ?? undefined, insecure: true, maxBytes: 256 })
        return { ...t, ok: r.status > 0, ms: r.ms }
      } catch (e) {
        return { ...t, ok: false, ms: null, error: e instanceof Error ? e.message : String(e) }
      }
    }),
    7
  )
  const verdict = classifyWhitelist(
    probes.filter((p) => p.group === 'ru').map((p) => p.ok),
    probes.filter((p) => p.group === 'foreign').map((p) => p.ok)
  )
  return { checkedAt: Date.now(), available: true, probes, verdict }
}
