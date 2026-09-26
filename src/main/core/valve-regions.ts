/**
 * Регионы Valve (CS2, Dota 2): пинг до ретрансляторов Steam Datagram Relay.
 *
 * Матчмейкинг Valve выбирает сервер по пингу до этих точек, поэтому их пинг —
 * то, что видит сама игра. Список точек берётся у Steam
 * (ISteamApps/GetSDRConfig), с запасной копией на диске.
 *
 * Напрямую — настоящий ICMP-пинг с физического адаптера (мимо VPN).
 *
 * Через узел VPN — настоящий замер: сами ретрансляторы не отвечают ни на TCP,
 * ни на простой UDP, но в каждом датацентре Valve рядом с ними стоят серверы
 * Steam (cmp1-sto1.steamserver.net и т. п.). Через временное ядро узла
 * открываем к такому серверу TLS и шлём несколько запросов по одному
 * соединению: время ответа — задержка ПК → узел → датацентр Valve. Для точек
 * партнёров Valve (Китай, Datapacket), где серверов Steam нет, — оценка от
 * ближайшего датацентра Valve, помеченная «~».
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import tls from 'node:tls'
import dns from 'node:dns/promises'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { BrowserWindow } from 'electron'
import { dataDir } from '../utils/dirs'
import { icmpRtt, physicalSourceIp, socksConnect, startTempCore, withCoreSlot, type TempCore } from './core-probe'
import { calculateFiberRtt } from './game-ping'
import { isNodeAllowedForAuto, loadIncyNodes, loadIncySettings, type IncyNode } from './incy-engine'

export interface ValveRegionResult {
  code: string
  name: string
  directMs: number | null
  /** Лучший узел: ms — задержка ПК → узел → регион; measured=false — оценка «~». */
  best?: { nodeId: string; nodeName: string; ms: number; measured: boolean }
}

export interface ValveRegionsReport {
  regions: ValveRegionResult[]
  /** Узлы, через которые замер прошёл. */
  nodesMeasured: number
  /** Узлы, через которые не прошёл ни один запрос (не отвечают). */
  nodesFailed: number
  /** Узлы, исключённые из автовыбора в INCY: их не проверяем. */
  nodesExcluded: number
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
  const pops = [...byCode.values()]
  // У части точек партнёров (Datapacket) Steam отдаёт координаты наоборот:
  // [широта, долгота] вместо [долгота, широта]. Если перевёрнутая точка
  // совпадает с другим датацентром (до ~300 км), а «как есть» — далеко от всех,
  // переворачиваем. Для обычной точки перевёрнутые координаты случайно рядом с
  // другим датацентром не окажутся.
  const nearest = (p: Pop, lat: number, lon: number): number =>
    Math.min(...pops.filter((q) => q !== p).map((q) => calculateFiberRtt(lat, lon, q.lat, q.lon)))
  const swap = pops.filter((p) => Math.abs(p.lon) <= 90 && nearest(p, p.lon, p.lat) <= 4 && nearest(p, p.lat, p.lon) > 8)
  for (const p of swap) {
    const lat = p.lon
    p.lon = p.lat
    p.lat = lat
  }
  return pops
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

// ---- серверы Steam в датацентрах Valve --------------------------------------

interface Endpoint {
  host: string
  ip: string
}

/** Кандидаты: sto → sto1/sto2, sto2 → sto2, dfw → dfw1/dfw2; сначала cmp, потом ext. */
function endpointHosts(code: string): string[] {
  const m = /^([a-z]+)(\d*)$/.exec(code)
  if (!m) return []
  const dcs = m[2] ? [code] : [`${m[1]}1`, `${m[1]}2`]
  const out: string[] = []
  for (const dc of dcs) for (const pre of ['cmp1', 'cmp2', 'ext1', 'ext2']) out.push(`${pre}-${dc}.steamserver.net`)
  return out
}

async function resolveEndpoints(code: string): Promise<Endpoint[]> {
  const hosts = endpointHosts(code)
  const ips = await Promise.all(
    hosts.map((h) =>
      Promise.race([
        dns.resolve4(h).then((a) => a[0] ?? null),
        new Promise<null>((r) => setTimeout(() => r(null), 3000))
      ]).catch(() => null)
    )
  )
  return hosts.map((host, i) => ({ host, ip: ips[i] })).filter((e): e is Endpoint => !!e.ip)
}

/** TLS к серверу Steam: через готовый сокет (SOCKS узла) или напрямую с физического адаптера. */
function openTls(raw: net.Socket | null, ep: Endpoint, timeoutMs: number, localAddress?: string): Promise<tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    const t = raw
      ? tls.connect({ socket: raw, servername: ep.host, ALPNProtocols: ['http/1.1'] })
      : tls.connect({ host: ep.ip, port: 443, servername: ep.host, ALPNProtocols: ['http/1.1'], ...(localAddress ? { localAddress } : {}) })
    const fail = (e: Error): void => {
      t.destroy()
      reject(e)
    }
    t.setTimeout(timeoutMs, () => fail(new Error('timeout')))
    t.once('error', fail)
    t.once('close', () => fail(new Error('closed')))
    t.once('secureConnect', () => {
      t.setTimeout(0)
      resolve(t)
    })
  })
}

/** Один HTTP-запрос по открытому соединению: время до полного ответа. */
function requestRtt(s: tls.TLSSocket, host: string, timeoutMs: number): Promise<number> {
  return new Promise((resolve, reject) => {
    let buf = ''
    const t0 = performance.now()
    const done = (e: Error | null): void => {
      clearTimeout(timer)
      s.off('data', onData)
      s.off('close', onClose)
      if (e) reject(e)
      else resolve(performance.now() - t0)
    }
    const onData = (d: Buffer): void => {
      buf += d.toString('latin1')
      const end = buf.indexOf('\r\n\r\n')
      if (end < 0) return
      // Ждём и тело ответа, иначе его хвост попадёт в следующий замер.
      const head = buf.slice(0, end).toLowerCase()
      const len = /content-length:\s*(\d+)/.exec(head)
      if (len && buf.length < end + 4 + Number(len[1])) return
      if (!len && head.includes('transfer-encoding: chunked') && !buf.endsWith('0\r\n\r\n')) return
      done(null)
    }
    const onClose = (): void => done(new Error('closed'))
    const timer = setTimeout(() => done(new Error('timeout')), timeoutMs)
    s.on('data', onData)
    s.once('close', onClose)
    s.write(`GET / HTTP/1.1\r\nHost: ${host}\r\nUser-Agent: LAZEYKA\r\nConnection: keep-alive\r\n\r\n`)
  })
}

/**
 * Задержка до датацентра: TLS-рукопожатие, затем три запроса по тому же
 * соединению. Берём минимум из запросов — в нём нет ни рукопожатий, ни
 * установки соединения узлом, только путь туда и обратно.
 */
async function endpointRtt(raw: net.Socket | null, ep: Endpoint, timeoutMs: number, localAddress?: string): Promise<number> {
  const s = await openTls(raw, ep, timeoutMs, localAddress)
  const got: number[] = []
  try {
    for (let i = 0; i < 3; i++) got.push(await requestRtt(s, ep.host, timeoutMs))
  } catch (e) {
    if (got.length === 0) throw e
  } finally {
    s.destroy()
  }
  return Math.max(1, Math.round(Math.min(...got)))
}

interface PopTarget extends Pop {
  eps: Endpoint[]
}

/** Через узлы замеряем регионы не дальше этого (напрямую): дальние в матчмейкинг всё равно не попадают. */
const NODE_MEASURE_MAX_MS = 200

/** Замер регионов через один узел. null — узел не пропустил ни одного запроса. */
async function measureViaNode(n: IncyNode, targets: PopTarget[], anchor: PopTarget): Promise<Map<string, number> | null> {
  return withCoreSlot(async () => {
    let tc: TempCore | null = null
    try {
      tc = await startTempCore(n)
      const port = tc.port
      const via = async (p: PopTarget, tries = 2): Promise<number | null> => {
        for (const ep of p.eps.slice(0, tries)) {
          try {
            const raw = await socksConnect(port, ep.ip, 443, 3000)
            return await endpointRtt(raw, ep, 3000)
          } catch { /* следующий сервер этого датацентра */ }
        }
        return null
      }
      // Сначала ближайший регион: не прошёл — узел не отвечает, остальное не тратим.
      const first = await via(anchor, 1)
      if (first == null) return null
      const out = new Map<string, number>([[anchor.code, first]])
      const rest = targets.filter((p) => p !== anchor)
      const vals = await pool(rest, 6, (p) => via(p))
      rest.forEach((p, i) => {
        const v = vals[i]
        if (v != null) out.set(p.code, v)
      })
      return out
    } catch {
      return null
    } finally {
      tc?.stop()
    }
  })
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
    const icmp = await pool(pops, 8, async (p) => {
      const ms = await icmpRtt(p.ip, 1500, src).catch(() => null)
      progress(++done, pops.length, 'Пинг до регионов')
      return ms
    })

    // 2) Серверы Steam в тех же датацентрах. Проверяем их напрямую (мимо VPN):
    //    ответившие идут первыми. Заодно это запасной прямой замер, если ICMP
    //    до ретранслятора закрыт.
    done = 0
    progress(0, pops.length, 'Серверы Steam в регионах')
    const checked = await pool(pops, 12, async (p) => {
      const eps = await resolveEndpoints(p.code)
      let tcpMs: number | null = null
      const ok: Endpoint[] = []
      for (const ep of eps.slice(0, 3)) {
        try {
          const ms = await endpointRtt(null, ep, 2000, src ?? undefined)
          tcpMs = ms
          ok.push(ep)
          break
        } catch { /* пробуем следующий */ }
      }
      progress(++done, pops.length, 'Серверы Steam в регионах')
      return { eps: [...ok, ...eps.filter((e) => !ok.includes(e))], tcpMs }
    })
    const direct = pops.map((_, i) => icmp[i] ?? checked[i].tcpMs)
    const directOf = (code: string): number => direct[pops.findIndex((p) => p.code === code)] ?? 1e9
    // Через узлы — ближние регионы (напрямую до 200 мс), но не меньше шести.
    const withEps = pops
      .map((p, i) => ({ ...p, eps: checked[i].eps }))
      .filter((p) => p.eps.length > 0)
      .sort((a, b) => directOf(a.code) - directOf(b.code))
    const near = withEps.filter((p) => directOf(p.code) <= NODE_MEASURE_MAX_MS)
    const targets: PopTarget[] = (near.length >= 6 ? near : withEps.slice(0, 6)).slice(0, 16)

    // 3) Замер через каждый узел, разрешённый для автовыбора.
    const settings = loadIncySettings()
    const all = loadIncyNodes().filter((n) => n.server && n.port)
    const nodes = all.filter((n) => isNodeAllowedForAuto(n, settings)).slice(0, 40)
    const byNode: { n: IncyNode; res: Map<string, number> }[] = []
    let failed = 0
    if (targets.length > 0 && nodes.length > 0) {
      const anchor = targets[0]
      done = 0
      progress(0, nodes.length, 'Замер через узлы')
      const results = await pool(nodes, 3, async (n) => {
        const r = await measureViaNode(n, targets, anchor)
        progress(++done, nodes.length, 'Замер через узлы')
        return r
      })
      results.forEach((res, i) => {
        if (res && res.size > 0) byNode.push({ n: nodes[i], res })
        else failed++
      })
    } else {
      failed = nodes.length
    }

    // 4) Лучший узел для каждого региона. Где замера нет (точки партнёров без
    //    серверов Steam, дальние регионы), — оценка от ближайшего замеренного
    //    датацентра Valve, если он рядом (до 40 мс по оптике).
    const regions: ValveRegionResult[] = pops.map((p, i) => {
      let best: ValveRegionResult['best']
      for (const { n, res } of byNode) {
        const ms = res.get(p.code)
        if (ms != null && (!best || ms < best.ms)) best = { nodeId: n.id, nodeName: n.name, ms, measured: true }
      }
      if (!best) {
        // Ближайший регион, до которого через узлы что-то замерилось.
        let near: { code: string; hop: number } | null = null
        for (const t of targets) {
          if (t.code === p.code || !byNode.some(({ res }) => res.has(t.code))) continue
          const hop = calculateFiberRtt(t.lat, t.lon, p.lat, p.lon)
          if (!near || hop < near.hop) near = { code: t.code, hop }
        }
        if (near && near.hop <= 40) {
          for (const { n, res } of byNode) {
            const ms = res.get(near.code)
            if (ms == null) continue
            const est = Math.round(ms + near.hop)
            if (!best || est < best.ms) best = { nodeId: n.id, nodeName: n.name, ms: est, measured: false }
          }
        }
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
      nodesMeasured: byNode.length,
      nodesFailed: failed,
      nodesExcluded: all.length - nodes.length,
      fetchedAt: Date.now()
    }
  } finally {
    running = false
  }
}
