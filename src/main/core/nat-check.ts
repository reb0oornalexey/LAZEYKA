/**
 * Проверка NAT по STUN (RFC 5389, Binding Request).
 *
 * С ОДНОГО локального UDP-сокета (привязанного к адресу физического адаптера,
 * чтобы запрос шёл мимо VPN) отправляем запрос нескольким STUN-серверам и
 * сравниваем, какой внешний адрес и порт каждый из них увидел:
 *  - один и тот же адрес и порт, равные локальным — NAT нет, «Открытый»;
 *  - один и тот же внешний адрес и порт у разных серверов — «Умеренный»
 *    (роутер использует одно соответствие для любых собеседников);
 *  - разные порты у разных серверов — «Строгий» (симметричный NAT);
 *  - нет ответов — UDP закрыт или STUN недоступен.
 *
 * Различить подтипы «умеренного» (full cone / restricted / port restricted)
 * по одному Binding Request нельзя, этого и не делаем.
 */
import dgram from 'node:dgram'
import dns from 'node:dns'
import net from 'node:net'
import { randomBytes } from 'node:crypto'

export const STUN_SERVERS: { host: string; port: number }[] = [
  { host: 'stun.l.google.com', port: 19302 },
  { host: 'stun1.l.google.com', port: 19302 },
  { host: 'stun.cloudflare.com', port: 3478 }
]

const MAGIC_COOKIE = 0x2112a442
const BINDING_REQUEST = 0x0001
const BINDING_SUCCESS = 0x0101
const ATTR_MAPPED_ADDRESS = 0x0001
const ATTR_XOR_MAPPED_ADDRESS = 0x0020
const ATTR_XOR_MAPPED_ADDRESS_OLD = 0x8020

/** Повторы запроса (UDP теряется): сразу, через 400 мс и через 1 с; всего ждём 2,5 с. */
const RETRY_AT_MS = [0, 400, 1000]
const TOTAL_WAIT_MS = 2500

export interface StunMapping {
  ip: string
  port: number
}

export function buildBindingRequest(txid: Buffer = randomBytes(12)): { packet: Buffer; txid: Buffer } {
  const packet = Buffer.alloc(20)
  packet.writeUInt16BE(BINDING_REQUEST, 0)
  packet.writeUInt16BE(0, 2)
  packet.writeUInt32BE(MAGIC_COOKIE, 4)
  txid.copy(packet, 8)
  return { packet, txid }
}

/** Разобрать ответ Binding Success; null — не наш ответ или мусор. */
export function parseBindingResponse(msg: Buffer, txid: Buffer): StunMapping | null {
  if (msg.length < 20) return null
  if (msg.readUInt16BE(0) !== BINDING_SUCCESS) return null
  if (msg.readUInt32BE(4) !== MAGIC_COOKIE) return null
  if (!msg.subarray(8, 20).equals(txid)) return null
  const bodyLen = msg.readUInt16BE(2)
  const end = Math.min(msg.length, 20 + bodyLen)
  let off = 20
  let plain: StunMapping | null = null
  while (off + 4 <= end) {
    const type = msg.readUInt16BE(off)
    const len = msg.readUInt16BE(off + 2)
    const valStart = off + 4
    if (valStart + len > end) break
    if (type === ATTR_XOR_MAPPED_ADDRESS || type === ATTR_XOR_MAPPED_ADDRESS_OLD || type === ATTR_MAPPED_ADDRESS) {
      const xor = type !== ATTR_MAPPED_ADDRESS
      const family = msg[valStart + 1]
      if (family === 0x01 && len >= 8) {
        let port = msg.readUInt16BE(valStart + 2)
        const a = [msg[valStart + 4], msg[valStart + 5], msg[valStart + 6], msg[valStart + 7]]
        if (xor) {
          port ^= MAGIC_COOKIE >>> 16
          const cookie = [(MAGIC_COOKIE >>> 24) & 255, (MAGIC_COOKIE >>> 16) & 255, (MAGIC_COOKIE >>> 8) & 255, MAGIC_COOKIE & 255]
          for (let i = 0; i < 4; i++) a[i] ^= cookie[i]
        }
        const found = { ip: a.join('.'), port }
        if (xor) return found
        plain = found
      }
      // IPv6 не разбираем: сокет IPv4, сервер ответит IPv4-адресом.
    }
    off = valStart + len + ((4 - (len % 4)) % 4)
  }
  return plain
}

// ---- вывод ----------------------------------------------------------------------

export type NatType = 'open' | 'moderate' | 'strict' | 'blocked' | 'unknown'

export interface NatMapping extends StunMapping {
  server: string
}

export interface NatResult {
  type: NatType
  title: string
  /** Одна фраза: что это. */
  summary: string
  /** Что это значит для игр. */
  forGames: string
  /** Что это значит для голосового чата. */
  forVoice: string
  /** Что можно сделать. */
  advice: string[]
  externalIp: string | null
  mappings: NatMapping[]
  queried: number
  replied: number
  /** Запрос ушёл с адреса физического адаптера (мимо VPN). */
  viaPhysical: boolean
}

export function classifyNat(mappings: NatMapping[], local: { ip: string | null; port: number }): NatType {
  if (mappings.length === 0) return 'blocked'
  if (mappings.length < 2) return 'unknown'
  const first = mappings[0]
  const same = mappings.every((m) => m.ip === first.ip && m.port === first.port)
  if (!same) return 'strict'
  if (local.ip && first.ip === local.ip && first.port === local.port) return 'open'
  return 'moderate'
}

const TEXTS: Record<NatType, Omit<NatResult, 'type' | 'externalIp' | 'mappings' | 'queried' | 'replied' | 'viaPhysical'>> = {
  open: {
    title: 'Открытый',
    summary: 'Ваш компьютер напрямую виден в интернете, между ним и сетью нет NAT.',
    forGames: 'Лучший вариант: к вам смогут подключиться напрямую, лобби и матчи собираются без ограничений.',
    forVoice: 'Голосовой чат работает без помех.',
    advice: ['Ничего делать не нужно. Убедитесь только, что включён брандмауэр: открытый компьютер доступен снаружи.']
  },
  moderate: {
    title: 'Умеренный (обычный для домашнего роутера)',
    summary: 'Роутер использует одно и то же внешнее соответствие для всех собеседников. Так работает большинство домашних сетей.',
    forGames: 'Игры подключаются к серверам без проблем. С другими игроками напрямую (P2P, лобби друзей) в редких случаях бывают сложности.',
    forVoice: 'Голосовой чат в играх и Discord обычно работает нормально.',
    advice: [
      'Если в какой-то игре не получается подключиться к друзьям, включите UPnP в настройках роутера.',
      'Можно пробросить порт игры на ваш компьютер в роутере (раздел «Port forwarding», порты указаны в описании игры).'
    ]
  },
  strict: {
    title: 'Строгий (симметричный)',
    summary: 'Роутер выдаёт для каждого собеседника новый внешний порт. Прямые соединения между игроками устанавливаются плохо.',
    forGames: 'К игровым серверам вы подключитесь, но лобби с друзьями, P2P-матчи и некоторые консольные игры могут не находить вас или соединяться через медленные ретрансляторы.',
    forVoice: 'Голосовой чат в игре может не соединяться или идти через ретранслятор с задержкой. В Discord обычно работает.',
    advice: [
      'Включите UPnP в настройках роутера.',
      'Пробросьте порт игры на ваш компьютер в роутере или включите режим DMZ для компьютера на время игры.',
      'Если провайдер раздаёт адрес через общий NAT (CGNAT), попросите у него белый (выделенный) IP-адрес, иначе поменять тип нельзя.'
    ]
  },
  blocked: {
    title: 'UDP заблокирован или STUN недоступен',
    summary: 'Ответов от STUN-серверов нет. Либо UDP-трафик блокируется, либо серверы недоступны отсюда.',
    forGames: 'Большинство онлайн-игр работает по UDP. Если блокировка настоящая, подключиться к матчу не получится.',
    forVoice: 'Голосовой чат, скорее всего, не заработает.',
    advice: [
      'Проверьте, не блокирует ли UDP брандмауэр или антивирус.',
      'Если вы в офисе, общежитии или на мобильной сети, UDP может быть закрыт провайдером.',
      'Повторите проверку позже: иногда STUN-серверы просто недоступны из вашей сети.'
    ]
  },
  unknown: {
    title: 'Не удалось определить точно',
    summary: 'Ответил только один STUN-сервер, сравнивать не с чем.',
    forGames: 'Тип NAT неизвестен. Сам факт ответа говорит о том, что UDP наружу проходит.',
    forVoice: 'Скорее всего, работает.',
    advice: ['Повторите проверку: нужны ответы минимум от двух серверов.']
  }
}

export function describeNat(
  type: NatType,
  mappings: NatMapping[],
  extra: { queried: number; viaPhysical: boolean }
): NatResult {
  return {
    type,
    ...TEXTS[type],
    externalIp: mappings[0]?.ip ?? null,
    mappings,
    queried: extra.queried,
    replied: mappings.length,
    viaPhysical: extra.viaPhysical
  }
}

// ---- сеть -----------------------------------------------------------------------

async function lookup4(host: string): Promise<string | null> {
  if (net.isIPv4(host)) return host
  try {
    let timer: NodeJS.Timeout | undefined
    const r = await Promise.race([
      dns.promises.lookup(host, { family: 4 }).then((x) => x.address),
      new Promise<null>((res) => {
        timer = setTimeout(() => res(null), 3000)
      })
    ])
    clearTimeout(timer)
    return r
  } catch {
    return null
  }
}

/**
 * Опросить STUN-серверы с одного сокета. localAddress — адрес физического адаптера
 * (null — привязка к любому адресу, тогда запрос может уйти в VPN).
 */
export async function checkNat(localAddress: string | null): Promise<NatResult> {
  const resolved = (
    await Promise.all(
      STUN_SERVERS.map(async (s) => {
        const ip = await lookup4(s.host)
        return ip ? { name: `${s.host}:${s.port}`, ip, port: s.port } : null
      })
    )
  ).filter((x): x is { name: string; ip: string; port: number } => x !== null)

  const viaPhysical = Boolean(localAddress)
  if (!resolved.length) return describeNat('blocked', [], { queried: STUN_SERVERS.length, viaPhysical })

  const sock = dgram.createSocket('udp4')
  try {
    await new Promise<void>((resolve, reject) => {
      sock.once('error', reject)
      sock.bind(0, localAddress ?? undefined, () => {
        sock.off('error', reject)
        resolve()
      })
    })
  } catch {
    try { sock.close() } catch { /* noop */ }
    return describeNat('blocked', [], { queried: STUN_SERVERS.length, viaPhysical })
  }
  const local = sock.address()
  const localIp = localAddress && local.address !== '0.0.0.0' ? local.address : null

  const pending = new Map<string, { name: string; ip: string; port: number; txid: Buffer }>()
  const got = new Map<string, NatMapping>()
  for (const r of resolved) {
    const { txid } = buildBindingRequest()
    pending.set(txid.toString('hex'), { ...r, txid })
  }
  sock.on('error', () => void 0)
  sock.on('message', (msg, rinfo) => {
    if (msg.length < 20) return
    const key = msg.subarray(8, 20).toString('hex')
    const p = pending.get(key)
    if (!p || got.has(key) || rinfo.address !== p.ip) return
    const m = parseBindingResponse(msg, p.txid)
    if (m) got.set(key, { server: p.name, ip: m.ip, port: m.port })
  })

  const sendAll = (): void => {
    for (const [key, p] of pending) {
      if (got.has(key)) continue
      try {
        sock.send(buildBindingRequest(p.txid).packet, p.port, p.ip)
      } catch { /* сокет закрыт — игнорируем */ }
    }
  }
  const timers = RETRY_AT_MS.map((ms) => setTimeout(sendAll, ms))
  await new Promise<void>((resolve) => {
    const done = setTimeout(resolve, TOTAL_WAIT_MS)
    const poll = setInterval(() => {
      if (got.size === pending.size) {
        clearTimeout(done)
        clearInterval(poll)
        resolve()
      }
    }, 50)
    setTimeout(() => clearInterval(poll), TOTAL_WAIT_MS + 100)
  })
  timers.forEach(clearTimeout)
  const localPort = local.port
  try { sock.close() } catch { /* noop */ }

  const mappings = [...got.values()]
  const type = classifyNat(mappings, { ip: localIp, port: localPort })
  return describeNat(type, mappings, { queried: STUN_SERVERS.length, viaPhysical })
}
