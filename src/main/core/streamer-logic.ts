/**
 * Чистая логика блока «Стример»: без Electron и без сети, чтобы её можно было проверить отдельно.
 *  - медиана и разброс замеров;
 *  - разбор списка ingest-серверов Twitch и адреса «rtmp://host:port/…»;
 *  - кадры Discord IPC (opcode + длина + JSON);
 *  - поиск программы для стримов среди запущенных процессов.
 */

// ---- Замеры -----------------------------------------------------------------------

export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 1 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2)
}

/** Разброс: разница между самым долгим и самым быстрым соединением. */
export function spread(values: number[]): number {
  if (values.length < 2) return 0
  return Math.max(...values) - Math.min(...values)
}

// ---- Ingest-серверы ------------------------------------------------------------------

export type IngestPlatform = 'twitch' | 'youtube' | 'kick' | 'custom'

export interface IngestServer {
  id: string
  platform: IngestPlatform
  name: string
  host: string
  port: number
}

const HOST_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i

export function isValidHost(host: string): boolean {
  return HOST_RE.test(host)
}

/** «rtmp://host[:port]/путь», «rtmps://…» или «host[:port]». Порт по умолчанию: 1935 (rtmp) и 443 (rtmps). */
export function parseTarget(input: string): { host: string; port: number } | null {
  let s = String(input ?? '').trim()
  if (!s) return null
  let defPort = 1935
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(s)
  if (scheme) {
    const sch = scheme[1].toLowerCase()
    if (sch === 'rtmps' || sch === 'https') defPort = 443
    else if (sch !== 'rtmp' && sch !== 'http') return null
    s = s.slice(scheme[0].length)
  }
  s = s.split(/[/?#]/)[0]
  const at = s.lastIndexOf('@')
  if (at >= 0) s = s.slice(at + 1)
  const m = /^([^:]+)(?::(\d{1,5}))?$/.exec(s)
  if (!m) return null
  const host = m[1].toLowerCase()
  const port = m[2] ? Number(m[2]) : defPort
  if (!isValidHost(host) || port < 1 || port > 65535) return null
  return { host, port }
}

/** Ответ https://ingest.twitch.tv/ingests: серверы Европы и Азии. */
export function parseTwitchIngests(json: unknown): IngestServer[] {
  const list = (json as { ingests?: unknown })?.ingests
  if (!Array.isArray(list)) return []
  const out: IngestServer[] = []
  const seen = new Set<string>()
  for (const it of list) {
    const rec = it as { name?: unknown; url_template?: unknown }
    const name = typeof rec?.name === 'string' ? rec.name.trim() : ''
    const tpl = typeof rec?.url_template === 'string' ? rec.url_template : ''
    if (!name || !/^rtmps?:\/\//i.test(tpl)) continue
    if (!/^(EU|Europe|Asia)\b/i.test(name)) continue
    const t = parseTarget(tpl.replace('{stream_key}', ''))
    if (!t) continue
    const key = `${t.host}:${t.port}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ id: `twitch:${key}`, platform: 'twitch', name: name.replace(/\s*\(\d+\)\s*$/, ''), host: t.host, port: t.port })
  }
  return out
}

/** Запасной короткий список, если запрос к Twitch не прошёл. */
export const TWITCH_FALLBACK: IngestServer[] = [
  ['Европа: Стокгольм', 'live-arn.twitch.tv'],
  ['Европа: Франкфурт', 'live-fra.twitch.tv'],
  ['Европа: Амстердам', 'live-ams.twitch.tv'],
  ['Европа: Варшава', 'live-waw.twitch.tv'],
  ['Европа: Хельсинки', 'live-hel.twitch.tv'],
  ['Европа: Лондон', 'live-lhr.twitch.tv'],
  ['Азия: Токио', 'live-tyo.twitch.tv'],
  ['Азия: Сингапур', 'live-sin.twitch.tv']
].map(([name, host]) => ({ id: `twitch:${host}:1935`, platform: 'twitch' as const, name, host, port: 1935 }))

export const YOUTUBE_SERVERS: IngestServer[] = ['a', 'b'].flatMap((l) =>
  [
    [1935, 'rtmp'],
    [443, 'rtmps']
  ].map(([port, proto]) => ({
    id: `youtube:${l}:${port}`,
    platform: 'youtube' as const,
    name: `Основной ${l.toUpperCase()}, ${proto}`,
    host: `${l}.rtmp.youtube.com`,
    port: port as number
  }))
)

// ---- Discord IPC ----------------------------------------------------------------------------

export const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 } as const

export function encodeFrame(op: number, payload: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  const buf = Buffer.alloc(8 + body.length)
  buf.writeInt32LE(op, 0)
  buf.writeInt32LE(body.length, 4)
  body.copy(buf, 8)
  return buf
}

export interface DiscordFrame {
  op: number
  data: unknown
}

/** Накапливает байты из сокета и отдаёт целые кадры. Битый кадр — исключение. */
export class FrameParser {
  private buf: Buffer = Buffer.alloc(0)

  push(chunk: Buffer): DiscordFrame[] {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk
    const out: DiscordFrame[] = []
    while (this.buf.length >= 8) {
      const op = this.buf.readInt32LE(0)
      const len = this.buf.readInt32LE(4)
      if (len < 0 || len > 1_000_000) throw new Error('Некорректный кадр Discord')
      if (this.buf.length < 8 + len) break
      const text = this.buf.subarray(8, 8 + len).toString('utf8')
      this.buf = this.buf.subarray(8 + len)
      let data: unknown = null
      if (text) {
        try {
          data = JSON.parse(text)
        } catch {
          throw new Error('Некорректный JSON в кадре Discord')
        }
      }
      out.push({ op, data })
    }
    return out
  }
}

export interface DiscordActivity {
  details: string
  state?: string
  startTimestamp: number
}

/** Команда SET_ACTIVITY. Без activity — очистка. Названий серверов и адресов здесь быть не может: только готовые строки. */
export function buildSetActivity(pid: number, nonce: string, activity: DiscordActivity | null): unknown {
  return {
    cmd: 'SET_ACTIVITY',
    args: {
      pid,
      ...(activity
        ? {
            activity: {
              details: activity.details.slice(0, 128),
              ...(activity.state ? { state: activity.state.slice(0, 128) } : {}),
              timestamps: { start: activity.startTimestamp },
              assets: { large_image: 'logo', large_text: 'LAZEYKA' }
            }
          }
        : {})
    },
    nonce
  }
}

// ---- Программы для стримов ---------------------------------------------------------------------

const WIN_PROGRAMS: [string, string][] = [
  ['obs64.exe', 'OBS'],
  ['obs32.exe', 'OBS'],
  ['streamlabs obs.exe', 'Streamlabs'],
  ['streamlabs desktop.exe', 'Streamlabs'],
  ['tiktok live studio.exe', 'TikTok LIVE Studio'],
  ['xsplit.core.exe', 'XSplit'],
  ['twitchstudio.exe', 'Twitch Studio'],
  ['vmix64.exe', 'vMix']
]
const MAC_PROGRAMS: [string, string][] = [
  ['obs', 'OBS'],
  ['streamlabs desktop', 'Streamlabs'],
  ['ecamm live', 'Ecamm Live']
]

/**
 * Первая найденная программа для стримов. tasklist укорачивает длинные имена,
 * поэтому на Windows принимаем и обрезанное имя (не короче 12 знаков).
 */
export function findStreamProgram(runningLower: string[], platform: NodeJS.Platform): string | null {
  const table = platform === 'darwin' ? MAC_PROGRAMS : WIN_PROGRAMS
  for (const [name, label] of table) {
    for (const got of runningLower) {
      if (got === name) return label
      if (platform !== 'darwin' && got.length >= 12 && got.length < name.length && name.startsWith(got)) return label
    }
  }
  return null
}
