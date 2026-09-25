/**
 * Регионы Valve (CS2, Dota 2): пинг до ретрансляторов Steam Datagram Relay.
 *
 * Матчмейкинг Valve выбирает сервер по пингу до этих точек, поэтому их пинг —
 * то, что видит сама игра. Список точек берётся у Steam
 * (ISteamApps/GetSDRConfig), с запасной копией на диске.
 *
 * Напрямую — настоящий ICMP-пинг с физического адаптера (мимо VPN).
 * Через узел VPN — оценка: задержка до узла + расчёт по расстоянию от узла до
 * точки Valve. Ретрансляторы не отвечают ни на TCP, ни на простой UDP, так что
 * «честно» померить их через прокси нельзя; оценка честно подписана.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { BrowserWindow } from 'electron'
import { dataDir } from '../utils/dirs'
import { icmpRtt, physicalSourceIp, tcpRtt } from './core-probe'
import { calculateFiberRtt, resolveGameServerGeo } from './game-ping'
import { isNodeAllowedForAuto, loadIncyNodes, loadIncySettings, type IncyNode } from './incy-engine'

export interface ValveRegionResult {
  code: string
  name: string
  directMs: number | null
  best?: { nodeId: string; nodeName: string; estimateMs: number }
}

export interface ValveRegionsReport {
  regions: ValveRegionResult[]
  nodesMeasured: number
  /** Сколько узлов не удалось привязать к месту (нет геоданных). */
  nodesWithoutGeo: number
  fetchedAt: number
}

interface Pop {
  code: string
  desc: string
  lat: number
  lon: number
  ip: string
}

const RU_NAMES: Record<string, string> = {
  sto: 'Стокгольм',
  sto2: 'Стокгольм 2',
  hel: 'Хельсинки',
  waw: 'Варшава',
  vie: 'Вена',
  fra: 'Франкфурт',
  ams: 'Амстердам',
  lhr: 'Лондон',
  par: 'Париж',
  mad: 'Мадрид',
  lux: 'Люксембург',
  dxb: 'Дубай',
  ist: 'Стамбул',
  iad: 'Вашингтон',
  atl: 'Атланта',
  ord: 'Чикаго',
  dfw: 'Даллас',
  lax: 'Лос-Анджелес',
  sea: 'Сиэтл',
  gru: 'Сан-Паулу',
  scl: 'Сантьяго',
  lim: 'Лима',
  eze: 'Буэнос-Айрес',
  bom: 'Мумбаи',
  maa: 'Ченнаи',
  sgp: 'Сингапур',
  hkg: 'Гонконг',
  tyo: 'Токио',
  seo: 'Сеул',
  syd: 'Сидней',
  jnb: 'Йоханнесбург'
}

/** Примерные координаты (столица или главный узел связи) по коду страны. */
const COUNTRY_COORDS: Record<string, [number, number]> = {
  NL: [52.37, 4.9], DE: [50.11, 8.68], SE: [59.33, 18.06], FI: [60.17, 24.94], PL: [52.23, 21.01],
  FR: [48.86, 2.35], GB: [51.51, -0.13], US: [39.0, -77.5], TR: [41.01, 28.98], KZ: [43.24, 76.89],
  LV: [56.95, 24.1], LT: [54.69, 25.28], EE: [59.44, 24.75], AT: [48.21, 16.37], CH: [47.37, 8.54],
  IT: [45.46, 9.19], ES: [40.42, -3.7], JP: [35.68, 139.69], SG: [1.35, 103.82], AE: [25.2, 55.27],
  RU: [55.75, 37.62], UA: [50.45, 30.52], CZ: [50.08, 14.44], RO: [44.43, 26.1], BG: [42.7, 23.32],
  HU: [47.5, 19.04], NO: [59.91, 10.75], DK: [55.68, 12.57], IE: [53.35, -6.26], AM: [40.18, 44.51],
  GE: [41.72, 44.78], HK: [22.32, 114.17], CA: [43.65, -79.38], BR: [-23.55, -46.63], MD: [47.01, 28.86],
  RS: [44.79, 20.45], BY: [53.9, 27.56], UZ: [41.3, 69.24], IL: [32.08, 34.78], PT: [38.72, -9.14]
}

/** Страна выхода из флага в названии узла (🇳🇱 → NL). */
function nameCountry(name: string): string | null {
  const m = name.match(/\p{Regional_Indicator}{2}/u)
  if (!m) return null
  return String.fromCharCode(...[...m[0]].map((c) => (c.codePointAt(0) ?? 0) - 0x1f1e6 + 65))
}

function sdrCacheFile(): string {
  return path.join(dataDir(), 'valve-sdr.json')
}

let running = false

function progress(done: number, total: number, stage: string): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('optimizer:valveProgress', { done, total, stage })
  }
}

/** Игры Valve, у которых свой список ретрансляторов: CS2 и Dota 2 отличаются. */
const VALVE_APPS = [730, 570] as const

function sdrCacheFileFor(appid: number): string {
  return path.join(dataDir(), `valve-sdr-${appid}.json`)
}

/** Конфиг ретрансляторов Steam для игры (с кэшем на случай, если Steam недоступен). */
async function loadSdrRaw(appid: number): Promise<any> {
  let raw: any = null
  try {
    const res = await fetch(`https://api.steampowered.com/ISteamApps/GetSDRConfig/v1/?appid=${appid}`, {
      signal: AbortSignal.timeout(8000)
    })
    if (res.ok) {
      raw = await res.json()
      try {
        mkdirSync(dataDir(), { recursive: true })
        writeFileSync(sdrCacheFileFor(appid), JSON.stringify(raw), 'utf-8')
      } catch { /* кэш — не главное */ }
    }
  } catch { /* ниже — кэш */ }
  if (!raw) {
    for (const f of [sdrCacheFileFor(appid), sdrCacheFile()]) {
      if (!existsSync(f)) continue
      try {
        raw = JSON.parse(readFileSync(f, 'utf-8'))
        break
      } catch {
        raw = null
      }
    }
  }
  return raw
}

/**
 * Вся сеть Valve (автономная система AS32590): все её IPv4-подсети, включая
 * ретрансляторы, игровые серверы и Steam. Берётся из RIPEstat, а если он
 * недоступен — из кэша или из списка ниже (снят 26.09.2026).
 */
const VALVE_AS_FALLBACK = [
  '103.10.124.0/24', '103.10.125.0/24', '103.28.54.0/24', '146.66.152.0/24', '146.66.155.0/24',
  '155.133.224.0/24', '155.133.225.0/24', '155.133.226.0/24', '155.133.227.0/24', '155.133.228.0/24',
  '155.133.229.0/24', '155.133.230.0/24', '155.133.231.0/24', '155.133.236.0/23', '155.133.238.0/24',
  '155.133.239.0/24', '155.133.240.0/23', '155.133.244.0/24', '155.133.246.0/24', '155.133.248.0/24',
  '155.133.249.0/24', '155.133.250.0/24', '155.133.251.0/24', '155.133.252.0/24', '155.133.254.0/24',
  '155.133.255.0/24', '162.254.192.0/24', '162.254.193.0/24', '162.254.194.0/24', '162.254.195.0/24',
  '162.254.196.0/24', '162.254.197.0/24', '162.254.198.0/24', '162.254.199.0/24', '185.25.180.0/24',
  '185.25.182.0/24', '185.25.183.0/24', '192.69.96.0/22', '205.196.6.0/24', '208.64.200.0/24',
  '208.64.201.0/24', '208.64.202.0/24', '208.64.203.0/24', '208.78.164.0/22', '45.121.184.0/24'
]

async function loadValveAsPrefixes(): Promise<string[]> {
  const cache = path.join(dataDir(), 'valve-as32590.json')
  try {
    const res = await fetch('https://stat.ripe.net/data/announced-prefixes/data.json?resource=AS32590', {
      signal: AbortSignal.timeout(8000)
    })
    if (res.ok) {
      const d = (await res.json()) as { data?: { prefixes?: { prefix?: string }[] } }
      const list = (d.data?.prefixes ?? [])
        .map((p) => String(p.prefix ?? ''))
        .filter((p) => /^\d+\.\d+\.\d+\.\d+\/\d+$/.test(p))
      // Защита от пустого или урезанного ответа: меньше половины известного — не верим.
      if (list.length >= VALVE_AS_FALLBACK.length / 2) {
        try {
          writeFileSync(cache, JSON.stringify(list), 'utf-8')
        } catch { /* кэш — не главное */ }
        return list
      }
    }
  } catch { /* ниже — кэш */ }
  try {
    const cached = JSON.parse(readFileSync(cache, 'utf-8'))
    if (Array.isArray(cached) && cached.length > 0) return cached.map(String)
  } catch { /* нет кэша */ }
  return VALVE_AS_FALLBACK
}

function ipToInt(ip: string): number {
  return ip.split('.').reduce((a, b) => (a << 8) + (Number(b) & 255), 0) >>> 0
}

/** Входит ли подсеть `inner` целиком в подсеть `outer`. */
function cidrInside(inner: string, outer: string): boolean {
  const [ia, ib] = inner.split('/')
  const [oa, ob] = outer.split('/')
  const ibits = Number(ib)
  const obits = Number(ob)
  if (ibits < obits) return false
  const mask = obits === 0 ? 0 : (0xffffffff << (32 - obits)) >>> 0
  return ((ipToInt(ia) & mask) >>> 0) === ((ipToInt(oa) & mask) >>> 0)
}

/**
 * Все адреса серверов Valve для списков Zapret:
 *  - вся сеть Valve (AS32590) — ретрансляторы, игровые серверы, Steam;
 *  - ретрансляторы партнёров (Китай и др.), которых нет в сети Valve, — из
 *    конфигов CS2 и Dota 2 (у игр списки разные).
 * Ретранслятор, уже покрытый подсетью Valve, отдельно не добавляется.
 */
export async function valveRelaySubnets(): Promise<string[]> {
  const asPrefixes = await loadValveAsPrefixes()
  const extra = new Set<string>()
  for (const appid of VALVE_APPS) {
    const raw = await loadSdrRaw(appid)
    const pops = raw?.pops && typeof raw.pops === 'object' ? raw.pops : {}
    for (const v of Object.values<any>(pops)) {
      for (const r of Array.isArray(v?.relays) ? v.relays : []) {
        const m = /^(\d+\.\d+\.\d+)\.\d+$/.exec(String(r?.ipv4 ?? ''))
        if (!m) continue
        const net24 = `${m[1]}.0/24`
        if (!asPrefixes.some((p) => cidrInside(net24, p))) extra.add(net24)
      }
    }
  }
  return [...new Set([...asPrefixes, ...extra])].sort()
}

/** Регионы для таблицы: объединение регионов CS2 и Dota 2. */
async function loadPops(): Promise<Pop[]> {
  const byCode = new Map<string, Pop>()
  for (const appid of VALVE_APPS) {
    const raw = await loadSdrRaw(appid)
    const pops = raw?.pops && typeof raw.pops === 'object' ? raw.pops : {}
    for (const [code, v] of Object.entries<any>(pops)) {
      if (byCode.has(code)) continue
      const relay = Array.isArray(v?.relays) ? v.relays.find((r: any) => typeof r?.ipv4 === 'string') : null
      const geo = Array.isArray(v?.geo) ? v.geo : null
      if (!relay || !geo || geo.length < 2) continue
      byCode.set(code, { code, desc: String(v.desc ?? code), lon: Number(geo[0]), lat: Number(geo[1]), ip: relay.ipv4 })
    }
  }
  if (byCode.size === 0) throw new Error('Не удалось получить список регионов Valve (нет связи со Steam).')
  return [...byCode.values()]
}

async function pool<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i])
      }
    })
  )
  return out
}

export async function measureValveRegions(): Promise<ValveRegionsReport> {
  if (running) throw new Error('Замер регионов уже идёт')
  running = true
  try {
    progress(0, 1, 'Список регионов Valve')
    const pops = await loadPops()
    const src = await physicalSourceIp().catch(() => null)

    // 1) Прямой пинг до каждого региона.
    let done = 0
    progress(0, pops.length, 'Пинг до регионов')
    const direct = await pool(pops, 8, async (p) => {
      const ms = await icmpRtt(p.ip, 1500, src).catch(() => null)
      progress(++done, pops.length, 'Пинг до регионов')
      return ms
    })

    // 2) Узлы: задержка до узла и где он находится.
    const settings = loadIncySettings()
    const nodes = loadIncyNodes().filter((n) => n.server && n.port && isNodeAllowedForAuto(n, settings))
    progress(0, nodes.length, 'Задержка до узлов')
    const rtts = await pool(nodes, 12, async (n: IncyNode) => {
      const udp = n.protocol === 'hysteria2' || n.protocol === 'wireguard'
      return udp ? icmpRtt(n.server, 1500, src).catch(() => null) : tcpRtt(n.server, n.port, 1500, src ?? undefined).catch(() => null)
    })
    const ranked = nodes
      .map((n, i) => ({ n, rtt: rtts[i] }))
      .filter((x): x is { n: IncyNode; rtt: number } => typeof x.rtt === 'number')
      .sort((a, b) => a.rtt - b.rtt)
      .slice(0, 15)
    progress(0, ranked.length, 'Где находятся узлы')
    let geoDone = 0
    const geos = await pool(ranked, 3, async (x) => {
      const g = await resolveGameServerGeo(x.n.server, x.n.port).catch(() => null)
      progress(++geoDone, ranked.length, 'Где находятся узлы')
      if (!g || typeof g.lat !== 'number' || typeof g.lon !== 'number') return null
      // Узел-мост: адрес в одной стране (часто в России), а выход — в другой,
      // указанной флагом в названии. Тогда трафик идёт ПК → мост → выход →
      // Valve, и оценка считается от страны выхода плюс плечо мост → выход.
      const exit = nameCountry(x.n.name)
      const exitCoords = exit ? COUNTRY_COORDS[exit] : undefined
      if (exit && exitCoords && g.countryCode && exit !== g.countryCode) {
        const hop = calculateFiberRtt(g.lat, g.lon, exitCoords[0], exitCoords[1])
        return { lat: exitCoords[0], lon: exitCoords[1], extra: hop }
      }
      return { lat: g.lat, lon: g.lon, extra: 0 }
    })
    const located = ranked.map((x, i) => ({ ...x, geo: geos[i] })).filter((x) => x.geo)

    const regions: ValveRegionResult[] = pops.map((p, i) => {
      let best: ValveRegionResult['best']
      for (const x of located) {
        const est = Math.round(x.rtt + x.geo!.extra + calculateFiberRtt(x.geo!.lat, x.geo!.lon, p.lat, p.lon))
        if (!best || est < best.estimateMs) best = { nodeId: x.n.id, nodeName: x.n.name, estimateMs: est }
      }
      return {
        code: p.code,
        name: RU_NAMES[p.code] ?? p.desc.replace(/\s*\(.*\)\s*$/, ''),
        directMs: direct[i],
        ...(best ? { best } : {})
      }
    })
    regions.sort((a, b) => (a.directMs ?? 1e9) - (b.directMs ?? 1e9))
    return {
      regions,
      nodesMeasured: located.length,
      nodesWithoutGeo: ranked.length - located.length,
      fetchedAt: Date.now()
    }
  } finally {
    running = false
  }
}
