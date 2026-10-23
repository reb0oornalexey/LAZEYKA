/**
 * Готовые наборы портов для Game Filter Zapret. Значения — из официальных
 * страниц поддержки (Steam, Riot, Epic, EA, Blizzard, Activision, Rockstar,
 * Mojang, Roblox, TeamSpeak). 80/443 тут не нужны — Zapret их уже обрабатывает.
 * Формат как у Flowseal: «N» или «N-M» через запятую.
 */
export interface GamePortPreset {
  id: string
  name: string
  tcp?: string
  udp?: string
  hint?: string
}

export const GAME_PORT_PRESETS: GamePortPreset[] = [
  { id: 'steam', name: 'CS2 / Dota 2 / Deadlock', udp: '3478,4379-4380,27000-27100', tcp: '27015-27050', hint: 'Игры Valve и Steam (матчмейкинг, SDR-релеи, голос)' },
  { id: 'faceit', name: 'FACEIT', udp: '27000-28999', tcp: '27015-27050', hint: 'Серверы FACEIT для CS2 (диапазон с запасом)' },
  { id: 'valorant', name: 'Valorant', udp: '7000-8000,8180-8181', tcp: '2099,5222-5223,8088,8393-8400', hint: 'Riot: игра + чат/клиент' },
  { id: 'lol', name: 'League of Legends', udp: '5000-5500', tcp: '2099,5222-5223,8088,8393-8400', hint: 'Riot: игра + чат/клиент' },
  { id: 'fortnite', name: 'Fortnite', udp: '3478-3479,5060,5062,6250,12000-65000', tcp: '5222,6250', hint: 'Epic Games' },
  { id: 'apex', name: 'Apex Legends', udp: '1024-1124,18000,29900,37000-40000', tcp: '1024-1124,9960-9969,18000,18060,18120,27900,28910,29900', hint: 'EA' },
  { id: 'overwatch', name: 'Overwatch 2', udp: '3478-3479,5060,5062,6250,12000-64000', tcp: '1119,3724,6113', hint: 'Blizzard / Battle.net' },
  { id: 'pubg', name: 'PUBG', udp: '7000-8999,27000-27100', tcp: '27015-27050', hint: 'Игровые серверы + Steam' },
  { id: 'cod', name: 'Call of Duty / Warzone', udp: '3074-3079,3478-3479,27000-27100', tcp: '3074,27014-27050', hint: 'Activision' },
  { id: 'rust', name: 'Rust', udp: '28015-28017', tcp: '28015-28017,28082', hint: 'Сервер + Rust+ (app port)' },
  { id: 'minecraft', name: 'Minecraft', udp: '19132-19133,25565', tcp: '25565', hint: 'Java 25565, Bedrock 19132' },
  { id: 'roblox', name: 'Roblox', udp: '49152-65535', hint: 'Игровой трафик Roblox' },
  { id: 'gta', name: 'GTA Online', udp: '6672,61455-61458', hint: 'Rockstar' },
  { id: 'teamspeak', name: 'TeamSpeak', udp: '9987', tcp: '10011,30033', hint: 'Голос + передача файлов' }
]

export const DEFAULT_GAME_PORTS = '1024-65535'

type Range = [number, number]

export function parsePorts(value: string): Range[] | null {
  const cleaned = value.replace(/\s+/g, '')
  if (!cleaned) return null
  const out: Range[] = []
  for (const item of cleaned.split(',')) {
    if (!item) continue
    const m = /^([1-9][0-9]{0,4})(?:-([1-9][0-9]{0,4}))?$/.exec(item)
    if (!m) return null
    const a = Number(m[1])
    const b = m[2] ? Number(m[2]) : a
    if (a > 65535 || b > 65535 || a > b) return null
    out.push([a, b])
  }
  return out.length ? out : null
}

function merge(ranges: Range[]): Range[] {
  const sorted = [...ranges].sort((x, y) => x[0] - y[0] || x[1] - y[1])
  const res: Range[] = []
  for (const r of sorted) {
    const last = res[res.length - 1]
    if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1])
    else res.push([r[0], r[1]])
  }
  return res
}

export function formatPorts(ranges: Range[]): string {
  return merge(ranges).map(([a, b]) => (a === b ? String(a) : `${a}-${b}`)).join(',')
}

/** Объединяет порты нескольких пресетов (пересечения склеиваются). */
export function combinePresets(presets: GamePortPreset[]): { tcp: string; udp: string } {
  const tcp: Range[] = []
  const udp: Range[] = []
  for (const p of presets) {
    if (p.tcp) tcp.push(...(parsePorts(p.tcp) ?? []))
    if (p.udp) udp.push(...(parsePorts(p.udp) ?? []))
  }
  return { tcp: tcp.length ? formatPorts(tcp) : '', udp: udp.length ? formatPorts(udp) : '' }
}

/** Все ли порты `inner` входят в `outer`. */
export function portsCovered(inner: string | undefined, outer: string): boolean {
  if (!inner) return true
  const a = parsePorts(inner)
  const b = parsePorts(outer)
  if (!a || !b) return false
  const mb = merge(b)
  return a.every(([x, y]) => mb.some(([p, q]) => p <= x && y <= q))
}
