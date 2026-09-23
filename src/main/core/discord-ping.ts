import net from 'node:net'
import { performance } from 'node:perf_hooks'

export interface DiscordRegionPing {
  id: string
  name: string
  location: string
  endpoint: string
  host: string
  port: number
  latencyMs: number | null
  status: 'optimal' | 'good' | 'poor' | 'unreachable'
}

/**
 * Точки доступности Discord.
 *
 * Все они стоят за anycast Cloudflare: пинг показывает задержку до
 * ближайшего узла Cloudflare, а не до голосового сервера. Голосовые серверы
 * (`*.discord.media`, UDP 50000–65535) выдаются на конкретный звонок, заранее
 * их не узнать. Прежние подписи «Stockholm», «Rotterdam (Voice Media)»
 * создавали ложное впечатление, что меряются голосовые регионы.
 *
 * Важно: TCP-соединение проходит и там, где DPI режет TLS, поэтому «доступен»
 * здесь значит «адрес отвечает», а не «Discord работает».
 */
export const DISCORD_REGIONS: DiscordRegionPing[] = [
  { id: 'gateway', name: 'Gateway (чат, статусы)', location: 'Cloudflare, ближайший узел', endpoint: 'https://gateway.discord.gg', host: 'gateway.discord.gg', port: 443, latencyMs: null, status: 'optimal' },
  { id: 'api', name: 'API (discord.com)', location: 'Cloudflare, ближайший узел', endpoint: 'https://discord.com', host: 'discord.com', port: 443, latencyMs: null, status: 'optimal' },
  { id: 'media', name: 'Media proxy (картинки)', location: 'Cloudflare, ближайший узел', endpoint: 'https://media.discordapp.net', host: 'media.discordapp.net', port: 443, latencyMs: null, status: 'optimal' },
  { id: 'cdn', name: 'CDN (файлы, аватары)', location: 'Cloudflare, ближайший узел', endpoint: 'https://cdn.discordapp.com', host: 'cdn.discordapp.com', port: 443, latencyMs: null, status: 'optimal' },
  { id: 'status', name: 'Status page', location: 'Cloudflare, ближайший узел', endpoint: 'https://status.discord.com', host: 'status.discord.com', port: 443, latencyMs: null, status: 'optimal' }
]

function probeRegionTcp(host: string, port = 443, timeoutMs = 2500): Promise<number | null> {
  return new Promise((resolve) => {
    const start = performance.now()
    const sock = new net.Socket()
    let settled = false

    sock.setTimeout(timeoutMs)
    sock.once('connect', () => {
      if (!settled) {
        settled = true
        const elapsed = Math.max(5, Math.round(performance.now() - start))
        sock.destroy()
        resolve(elapsed)
      }
    })
    sock.once('error', () => {
      if (!settled) {
        settled = true
        sock.destroy()
        resolve(null)
      }
    })
    sock.once('timeout', () => {
      if (!settled) {
        settled = true
        sock.destroy()
        resolve(null)
      }
    })
    sock.connect(port, host)
  })
}

export async function pingDiscordVoiceRegions(): Promise<DiscordRegionPing[]> {
  const results = await Promise.all(
    DISCORD_REGIONS.map(async (r) => {
      const latencyMs = await probeRegionTcp(r.host, r.port)
      let status: 'optimal' | 'good' | 'poor' | 'unreachable' = 'unreachable'
      if (latencyMs !== null) {
        if (latencyMs < 65) status = 'optimal'
        else if (latencyMs < 130) status = 'good'
        else status = 'poor'
      }
      return {
        ...r,
        latencyMs,
        status
      }
    })
  )
  return results
}
