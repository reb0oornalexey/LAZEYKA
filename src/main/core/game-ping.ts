import net from 'net'
import dgram from 'dgram'
import dns from 'dns'
import { execFile } from 'child_process'
import { loadIncyNodes, pingIncyNode, type IncyNode } from './incy-engine'

export interface GameServerGeoInfo {
  ip: string
  host: string
  port: number
  country?: string
  countryCode?: string
  city?: string
  regionName?: string
  isp?: string
  org?: string
  lat?: number
  lon?: number
}

export interface NodeGamePingInfo {
  nodeId: string
  nodeName: string
  protocol: string
  server: string
  userToNodePing: number | null
  nodeToGamePing: number
  totalPing: number | null
  savingMs: number | null
  isBest: boolean
}

export interface GamePingResult {
  targetHost: string
  targetPort: number
  targetIp: string
  geo: GameServerGeoInfo
  directPing: number | null
  directPingEstimated: boolean
  nodes: NodeGamePingInfo[]
}

// In-memory cache for GeoIP to avoid redundant API hits
const geoCache = new Map<string, GameServerGeoInfo>()

// Known major datacenters coordinates (latitude, longitude)
const CITY_COORDINATES: Record<string, [number, number]> = {
  frankfurt: [50.1109, 8.6821],
  limburg: [50.3986, 8.07958],
  berlin: [52.52, 13.405],
  helsinki: [60.1699, 24.9384],
  stockholm: [59.3293, 18.0686],
  amsterdam: [52.3676, 4.9041],
  warsaw: [52.2297, 21.0122],
  london: [51.5074, -0.1278],
  paris: [48.8566, 2.3522],
  vienna: [48.2082, 16.3738],
  prague: [50.0755, 14.4378],
  madrid: [40.4168, -3.7038],
  zurich: [47.3769, 8.5417],
  moscow: [55.7558, 37.6173],
  stpetersburg: [59.9343, 30.3351],
  almaty: [43.2389, 76.8897],
  astana: [51.1694, 71.4491],
  tokyo: [35.6762, 139.6503],
  singapore: [1.3521, 103.8198],
  newyork: [40.7128, -74.006],
  losangeles: [34.0522, -118.2437],
  istanbul: [41.0082, 28.9784]
}

export const COUNTRY_COORDINATES: Record<string, [number, number]> = {
  de: [50.1109, 8.6821],
  fi: [60.1699, 24.9384],
  se: [59.3293, 18.0686],
  nl: [52.3676, 4.9041],
  pl: [52.2297, 21.0122],
  gb: [51.5074, -0.1278],
  uk: [51.5074, -0.1278],
  fr: [48.8566, 2.3522],
  kz: [43.2389, 76.8897],
  ru: [55.7558, 37.6173],
  at: [48.2082, 16.3738],
  cz: [50.0755, 14.4378],
  us: [40.7128, -74.006],
  tr: [41.0082, 28.9784],
  jp: [35.6762, 139.6503],
  sg: [1.3521, 103.8198]
}

/**
 * Extracts host (IP or domain) and port from user input.
 * Handles:
 * - "connect 162.19.141.22:27015; password abc"
 * - "connect 162.19.141.22:27015"
 * - "162.19.141.22:27015"
 * - "162.19.141.22" (defaults to 27015)
 * - "fra.faceit.com:27015"
 */
export function parseGameServerAddress(input: string): { host: string; port: number } | null {
  if (!input || typeof input !== 'string') return null
  const cleaned = input.trim()
  if (!cleaned) return null

  // Check for "connect <address>" pattern
  const connectMatch = cleaned.match(/connect\s+([^\s;]+)/i)
  const targetStr = connectMatch ? connectMatch[1] : cleaned.split(';')[0].trim().split(/\s+/)[0]

  const portMatch = targetStr.match(/:(\d+)$/)
  let host = targetStr
  let port = 27015

  if (portMatch) {
    port = parseInt(portMatch[1], 10)
    host = targetStr.slice(0, portMatch.index)
  }

  // Strip brackets if IPv6
  host = host.replace(/^\[|\]$/g, '')

  if (!host) return null
  return { host, port: Number.isFinite(port) && port > 0 ? port : 27015 }
}

/**
 * Calculates fiber optic round-trip latency in ms between two geographical points.
 * Uses great-circle distance with a 1.35x terrestrial cable detour factor and 200,000 km/s speed of light.
 */
export function calculateFiberRtt(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371 // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  const distKm = R * c
  const fiberCableKm = distKm * 1.35
  const rttMs = Math.round(fiberCableKm / 100)
  return Math.max(1, rttMs)
}

/**
 * Resolves geolocation of target game server.
 */
export async function resolveGameServerGeo(host: string, port = 27015): Promise<GameServerGeoInfo> {
  let ip = host
  if (!net.isIP(host)) {
    try {
      const resolved = await dns.promises.lookup(host)
      ip = resolved.address
    } catch {
      // Keep host if lookup fails
      ip = host
    }
  }

  if (geoCache.has(ip)) {
    return { ...geoCache.get(ip)!, host, port }
  }

  // Query ip-api.com
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 2500)
    const resp = await fetch(`http://ip-api.com/json/${ip}?fields=status,country,countryCode,regionName,city,isp,org,as,lat,lon,query`, {
      signal: controller.signal
    })
    clearTimeout(timer)

    if (resp.ok) {
      const data: any = await resp.json()
      if (data && data.status === 'success') {
        const info: GameServerGeoInfo = {
          ip,
          host,
          port,
          country: data.country,
          countryCode: data.countryCode,
          city: data.city,
          regionName: data.regionName,
          isp: data.isp,
          org: data.org,
          lat: data.lat,
          lon: data.lon
        }
        geoCache.set(ip, info)
        return info
      }
    }
  } catch {
    // Ignore fetch error, fallback below
  }

  // Fallback heuristic: check if host/IP matches common regions
  const lowerHost = host.toLowerCase()
  let fallbackLat = 50.1109
  let fallbackLon = 8.6821
  let country = 'Germany'
  let countryCode = 'DE'
  let city = 'Frankfurt'

  if (lowerHost.includes('hel') || lowerHost.includes('fin')) {
    ;[fallbackLat, fallbackLon] = CITY_COORDINATES.helsinki
    country = 'Finland'
    countryCode = 'FI'
    city = 'Helsinki'
  } else if (lowerHost.includes('sto') || lowerHost.includes('swe')) {
    ;[fallbackLat, fallbackLon] = CITY_COORDINATES.stockholm
    country = 'Sweden'
    countryCode = 'SE'
    city = 'Stockholm'
  } else if (lowerHost.includes('waw') || lowerHost.includes('pol')) {
    ;[fallbackLat, fallbackLon] = CITY_COORDINATES.warsaw
    country = 'Poland'
    countryCode = 'PL'
    city = 'Warsaw'
  } else if (lowerHost.includes('lon') || lowerHost.includes('uk')) {
    ;[fallbackLat, fallbackLon] = CITY_COORDINATES.london
    country = 'United Kingdom'
    countryCode = 'GB'
    city = 'London'
  } else if (lowerHost.includes('kz') || lowerHost.includes('kaz')) {
    ;[fallbackLat, fallbackLon] = CITY_COORDINATES.almaty
    country = 'Kazakhstan'
    countryCode = 'KZ'
    city = 'Almaty'
  }

  const fallbackInfo: GameServerGeoInfo = {
    ip,
    host,
    port,
    country,
    countryCode,
    city,
    lat: fallbackLat,
    lon: fallbackLon
  }
  return fallbackInfo
}

/**
 * Attempts a UDP Valve A2S_INFO query (Source engine standard) to measure real UDP roundtrip.
 */
function probeUdpA2S(ip: string, port: number, timeoutMs = 700): Promise<number | null> {
  return new Promise((resolve) => {
    try {
      const socket = dgram.createSocket('udp4')
      let settled = false

      const cleanup = (): void => {
        if (!settled) {
          settled = true
          try {
            socket.close()
          } catch {
            // ignore
          }
        }
      }

      const timer = setTimeout(() => {
        cleanup()
        resolve(null)
      }, timeoutMs)

      const start = performance.now()

      socket.on('message', (msg) => {
        if (msg.length >= 4 && msg[0] === 0xff && msg[1] === 0xff && msg[2] === 0xff && msg[3] === 0xff) {
          clearTimeout(timer)
          const elapsed = Math.max(3, Math.round(performance.now() - start))
          cleanup()
          resolve(elapsed)
        }
      })

      socket.on('error', () => {
        clearTimeout(timer)
        cleanup()
        resolve(null)
      })

      // Valve A2S_INFO packet: FF FF FF FF 54 53 6F 75 72 63 65 20 45 6E 67 69 6E 65 20 51 75 65 72 79 00
      const query = Buffer.from([
        0xff, 0xff, 0xff, 0xff, 0x54, 0x53, 0x6f, 0x75, 0x72, 0x63, 0x65, 0x20, 0x45, 0x6e,
        0x67, 0x69, 0x6e, 0x65, 0x20, 0x51, 0x75, 0x65, 0x72, 0x79, 0x00
      ])

      socket.send(query, port, ip, (err) => {
        if (err) {
          clearTimeout(timer)
          cleanup()
          resolve(null)
        }
      })
    } catch {
      resolve(null)
    }
  })
}

/**
 * Attempts a fast TCP connect handshake.
 */
function probeTcp(ip: string, port: number, timeoutMs = 600): Promise<number | null> {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    let settled = false

    const cleanup = (): void => {
      if (!settled) {
        settled = true
        socket.destroy()
      }
    }

    const start = performance.now()
    socket.setTimeout(timeoutMs)

    socket.once('connect', () => {
      const elapsed = Math.max(3, Math.round(performance.now() - start))
      cleanup()
      resolve(elapsed)
    })

    socket.once('timeout', () => {
      cleanup()
      resolve(null)
    })

    socket.once('error', () => {
      cleanup()
      resolve(null)
    })

    socket.connect(port, ip)
  })
}

/**
 * Attempts direct ICMP ping via ping.exe.
 */
function probeIcmp(ip: string, timeoutMs = 700): Promise<number | null> {
  return new Promise((resolve) => {
    execFile('ping.exe', [ip, '-n', '1', '-w', String(timeoutMs)], (err, stdout) => {
      if (err || !stdout) return resolve(null)
      const match = stdout.match(/(?:time|время)[=<](\d+)ms/i)
      if (match) {
        return resolve(parseInt(match[1], 10))
      }
      resolve(null)
    })
  })
}

/**
 * Determines coordinates of a node based on its name, region, or server IP.
 */
function getNodeCoordinates(node: IncyNode): [number, number] {
  const name = (node.name + ' ' + (node.server || '')).toLowerCase()

  if (name.includes('германи') || name.includes('germany') || name.includes('de') || name.includes('frankfurt') || name.includes('fra')) {
    return CITY_COORDINATES.frankfurt
  }
  if (name.includes('финлянд') || name.includes('finland') || name.includes('fi') || name.includes('helsinki') || name.includes('hel')) {
    return CITY_COORDINATES.helsinki
  }
  if (name.includes('швеци') || name.includes('sweden') || name.includes('se') || name.includes('stockholm') || name.includes('sto')) {
    return CITY_COORDINATES.stockholm
  }
  if (name.includes('нидерланд') || name.includes('netherlands') || name.includes('nl') || name.includes('amsterdam') || name.includes('ams')) {
    return CITY_COORDINATES.amsterdam
  }
  if (name.includes('польш') || name.includes('poland') || name.includes('pl') || name.includes('warsaw') || name.includes('waw')) {
    return CITY_COORDINATES.warsaw
  }
  if (name.includes('великобритан') || name.includes('англия') || name.includes('uk') || name.includes('london') || name.includes('gb')) {
    return CITY_COORDINATES.london
  }
  if (name.includes('франци') || name.includes('france') || name.includes('fr') || name.includes('paris')) {
    return CITY_COORDINATES.paris
  }
  if (name.includes('казахстан') || name.includes('kazakhstan') || name.includes('kz') || name.includes('almaty') || name.includes('astana')) {
    return CITY_COORDINATES.almaty
  }
  if (name.includes('росси') || name.includes('russia') || name.includes('ru') || name.includes('москва') || name.includes('moscow')) {
    return CITY_COORDINATES.moscow
  }
  if (name.includes('турци') || name.includes('turkey') || name.includes('tr') || name.includes('istanbul')) {
    return CITY_COORDINATES.istanbul
  }
  if (name.includes('австри') || name.includes('austria') || name.includes('at') || name.includes('vienna')) {
    return CITY_COORDINATES.vienna
  }
  if (name.includes('чехи') || name.includes('czech') || name.includes('cz') || name.includes('prague')) {
    return CITY_COORDINATES.prague
  }
  if (name.includes('сша') || name.includes('usa') || name.includes('us')) {
    return CITY_COORDINATES.newyork
  }

  // Default to Frankfurt (largest European internet exchange hub)
  return CITY_COORDINATES.frankfurt
}

/**
 * Main engine: measures and calculates latency from all subscription nodes
 * to the specified Faceit / CS2 game server.
 */
export async function measureGameServerPing(input: string): Promise<GamePingResult> {
  const parsed = parseGameServerAddress(input)
  if (!parsed) {
    throw new Error('Не удалось распознать IP-адрес или строку подключения сервера игры.')
  }

  // 1. Resolve target IP and Geo
  const geo = await resolveGameServerGeo(parsed.host, parsed.port)
  const targetIp = geo.ip
  const targetLat = geo.lat ?? 50.1109
  const targetLon = geo.lon ?? 8.07958

  // 2. Direct ping from user PC to Game Server
  // First try UDP A2S, then TCP, then ICMP
  let directPing = await probeUdpA2S(targetIp, parsed.port, 650)
  if (directPing === null) {
    directPing = await probeTcp(targetIp, parsed.port, 500)
  }
  if (directPing === null) {
    directPing = await probeIcmp(targetIp, 600)
  }

  let directPingEstimated = false
  if (directPing === null) {
    // Faceit Anti-DDoS drops direct ICMP/UDP packets from unauthenticated IPs.
    // Calculate realistic baseline direct latency from user location (defaulting to Central RU) to target DC:
    // Distance from Moscow to Frankfurt is ~2000 km -> ~28ms fiber + ~25ms ISP last-mile & routing = ~55-65ms.
    const userBaselineLat = 55.7558
    const userBaselineLon = 37.6173
    const directFiber = calculateFiberRtt(userBaselineLat, userBaselineLon, targetLat, targetLon)
    directPing = Math.round(directFiber + 28) // add typical ISP routing overhead
    directPingEstimated = true
  }

  // 3. Evaluate each subscription node
  const allNodes = loadIncyNodes()

  // Check user-to-node pings if missing
  const pingPromises = allNodes.map(async (node) => {
    let userToNode = node.latencyMs

    // If node latency is missing or very stale, do a fast probe
    if (typeof userToNode !== 'number' || userToNode <= 0) {
      userToNode = await pingIncyNode(node, 800).catch(() => null)
      if (typeof userToNode !== 'number' || userToNode <= 0) {
        userToNode = await probeTcp(node.server, node.port, 500)
      }
    }

    const [nodeLat, nodeLon] = getNodeCoordinates(node)
    const nodeToGame = calculateFiberRtt(nodeLat, nodeLon, targetLat, targetLon)

    let totalPing: number | null = null
    let savingMs: number | null = null

    if (typeof userToNode === 'number' && userToNode > 0) {
      totalPing = userToNode + nodeToGame
      if (typeof directPing === 'number') {
        savingMs = directPing - totalPing
      }
    }

    return {
      nodeId: node.id,
      nodeName: node.name,
      protocol: node.protocol,
      server: node.server,
      userToNodePing: userToNode,
      nodeToGamePing: nodeToGame,
      totalPing,
      savingMs,
      isBest: false
    }
  })

  const results = await Promise.all(pingPromises)

  // Sort nodes by totalPing (ascending)
  results.sort((a, b) => {
    if (a.totalPing === null && b.totalPing === null) return 0
    if (a.totalPing === null) return 1
    if (b.totalPing === null) return -1
    return a.totalPing - b.totalPing
  })

  // Mark best node
  if (results.length > 0 && results[0].totalPing !== null) {
    results[0].isBest = true
  }

  return {
    targetHost: parsed.host,
    targetPort: parsed.port,
    targetIp,
    geo,
    directPing,
    directPingEstimated,
    nodes: results
  }
}
