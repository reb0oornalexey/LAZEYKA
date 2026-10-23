import https from 'node:https'
import crypto from 'node:crypto'
import { loadIncyNodes, saveIncyNodes, loadIncySettings, saveIncySettings, broadcastStatus, appendLog, type IncyNode } from './incy-engine'
import { isAwgNode, isCloudflareWarpPeer, WARP_PUBLIC_KEY } from './incy-awg'
import { fetchViaCore } from './core-probe'
import { singBoxVersion, isLxVersion } from './incy-core-updater'

/**
 * Clean Cloudflare WARP endpoints for reliable connectivity.
 * Default official IP and alternative fast IPs.
 */
export const WARP_ENDPOINTS = [
  { ip: '162.159.192.1', port: 2408 },
  { ip: '162.159.192.1', port: 500 },
  { ip: '162.159.192.1', port: 4500 },
  { ip: '162.159.193.10', port: 2408 },
  { ip: '162.159.193.10', port: 500 },
  { ip: '188.114.96.1', port: 2408 },
  { ip: '188.114.97.1', port: 2408 },
  { ip: 'engage.cloudflareclient.com', port: 2408 }
]

interface CloudflareRegResponse {
  id: string
  account: {
    id: string
    account_type: string
  }
  config: {
    /** 3 байта в base64 — поле `reserved` протокола WARP. */
    client_id?: string
    peers: Array<{
      public_key: string
      endpoint: {
        v4: string
        v6: string
        host: string
        ports: number[]
      }
    }>
    interface: {
      addresses: {
        v4: string
        v6: string
      }
    }
  }
}

/**
 * Register a free Cloudflare WARP account and generate a sing-box WireGuard node.
 */
export async function generateCloudflareWarpNode(): Promise<{ node: IncyNode; allNodes: IncyNode[] }> {
  appendLog('Генерация бесплатного ключа Cloudflare WARP...')

  // 1. Generate X25519 WireGuard keypair
  const { privateKey, publicKey } = crypto.generateKeyPairSync('x25519')
  const privDer = privateKey.export({ type: 'pkcs8', format: 'der' })
  const pubDer = publicKey.export({ type: 'spki', format: 'der' })

  const privateKeyBase64 = privDer.subarray(privDer.length - 32).toString('base64')
  const publicKeyBase64 = pubDer.subarray(pubDer.length - 32).toString('base64')

  // 2. Register account via Cloudflare Client API
  const regPayload = JSON.stringify({
    key: publicKeyBase64,
    install_id: '',
    fcm_token: '',
    tos: new Date().toISOString(),
    model: 'PC',
    type: 'Android',
    locale: 'en_US'
  })

  const regResponse = await new Promise<CloudflareRegResponse>((resolve, reject) => {
    const req = https.request(
      'https://api.cloudflareclient.com/v0a2158/reg',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
          'User-Agent': 'okhttp/3.12.1',
          Accept: 'application/json'
        },
        timeout: 10000
      },
      (res) => {
        let raw = ''
        res.on('data', (chunk) => { raw += chunk })
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(raw) as CloudflareRegResponse)
            } catch (err) {
              reject(new Error(`Не удалось разобрать ответ Cloudflare: ${String(err)}`))
            }
          } else {
            reject(new Error(`Ошибка API Cloudflare (${res.statusCode}): ${raw}`))
          }
        })
      }
    )

    req.on('error', (e) => reject(new Error(`Ошибка соединения с Cloudflare: ${e.message}`)))
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('Таймаут соединения с API Cloudflare'))
    })

    req.write(regPayload)
    req.end()
  })

  const config = regResponse.config
  const v4 = config.interface?.addresses?.v4 || '172.16.0.2'
  const v6 = config.interface?.addresses?.v6
  const peerPublicKey =
    config.peers?.[0]?.public_key || 'bmXOC+F1FxEMF9dyiK2H5/1SUtzH0JuVo51h2wPfgyo='

  const endpoint = WARP_ENDPOINTS[0]

  // `reserved` — три байта client_id. Сервер WARP опознаёт по ним клиента;
  // без них часть узлов принимает рукопожатие, но не передаёт трафик.
  let reserved: number[] | undefined
  try {
    const bytes = Buffer.from(config.client_id ?? '', 'base64')
    if (bytes.length === 3) reserved = [bytes[0], bytes[1], bytes[2]]
  } catch {
    /* поле необязательное */
  }

  const addressList = [`${v4}/32`]
  if (v6) {
    addressList.push(`${v6}/128`)
  }

  // 3. Construct IncyNode
  const warpNode: IncyNode = {
    id: `node-warp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: '⚡ Cloudflare WARP (Бесплатный)',
    description: `Официальный бесплатный туннель Cloudflare + AmneziaWG (обход DPI, нужно ядро sing-box-lx) • IP: ${v4}`,
    protocol: 'wireguard',
    server: endpoint.ip,
    port: endpoint.port,
    latencyMs: null,
    rawOutboundDialect: 'sing-box',
    rawOutbound: {
      type: 'wireguard',
      tag: 'proxy',
      address: addressList,
      private_key: privateKeyBase64,
      peers: [
        {
          address: endpoint.ip,
          port: endpoint.port,
          public_key: peerPublicKey,
          allowed_ips: ['0.0.0.0/0', '::/0'],
          ...(reserved ? { reserved } : {}),
          persistent_keepalive_interval: 25
        }
      ],
      mtu: 1280,
      // AmneziaWG: мусорные пакеты перед хендшейком + имитация QUIC (проверенный рецепт для WARP).
      // Сервер Cloudflare — обычный WireGuard, поэтому s1-s4/h1-h4/i1 НЕ задаём.
      // dns/stun режутся DPI на WARP — только quic. Нужно ядро sing-box-lx.
      jc: 4,
      jmin: 40,
      jmax: 70,
      id: 'www.google.com',
      ip: 'quic',
      ib: 'chrome'
    }
  }

  // 4. Save to nodes list
  const existingNodes = loadIncyNodes()
  // If an old WARP node exists, we can keep or replace it
  const updatedNodes = [warpNode, ...existingNodes.filter((n) => !n.id.startsWith('node-warp-'))]
  saveIncyNodes(updatedNodes)

  const settings = loadIncySettings()
  if (!settings.selectedNodeId) {
    settings.selectedNodeId = warpNode.id
    saveIncySettings(settings)
    broadcastStatus({ selectedNodeId: warpNode.id })
  }

  appendLog(`Узел «${warpNode.name}» успешно создан и добавлен в список серверов`)
  return { node: warpNode, allNodes: updatedNodes }
}

// ---------------------------------------------------------------------------
// Подбор рабочего адреса и проверка WARP
// ---------------------------------------------------------------------------

const TRACE_URL = 'https://www.cloudflare.com/cdn-cgi/trace'
const CANDIDATE_TIMEOUT_MS = 8000
const MAX_SUCCESSES = 2

/** Дополнительные порты WARP — пробуем только на 162.159.192.1. */
const EXTRA_PORTS = [
  854, 859, 864, 878, 880, 890, 891, 894, 903, 908, 928, 934, 939, 942, 943, 945, 946, 955, 968, 987, 988,
  1002, 1010, 1014, 1018, 1070, 1074, 1180, 1387, 1843, 2371, 2506, 3138, 3476, 3581, 3854, 4177, 4198,
  4233, 5279, 5956, 7103, 7152, 7156, 7281, 7559, 8319, 8742, 8854, 8886
]

/** 9 основных адресов + 15 портов из списка (равномерно по всему диапазону). */
export function warpCandidates(): Array<{ ip: string; port: number }> {
  const base = [
    { ip: '162.159.192.1', port: 2408 },
    { ip: '162.159.192.1', port: 500 },
    { ip: '162.159.192.1', port: 1701 },
    { ip: '162.159.192.1', port: 4500 },
    { ip: '162.159.193.10', port: 2408 },
    { ip: '162.159.195.1', port: 2408 },
    { ip: '188.114.96.1', port: 2408 },
    { ip: '188.114.97.1', port: 2408 },
    { ip: 'engage.cloudflareclient.com', port: 2408 }
  ]
  const step = EXTRA_PORTS.length / 15
  const extra = Array.from({ length: 15 }, (_, i) => ({
    ip: '162.159.192.1',
    port: EXTRA_PORTS[Math.floor(i * step)]
  }))
  return [...base, ...extra]
}

/** Узел — Cloudflare WARP (по публичному ключу пира, id или адресу). */
export function isWarpNodeLike(node: IncyNode): boolean {
  if (node.id.startsWith('node-warp-')) return true
  const raw: any = node.rawOutbound ?? {}
  const p0: any = (Array.isArray(raw.peers) ? raw.peers : raw.settings?.peers)?.[0] ?? {}
  const key = String(p0.public_key ?? p0.publicKey ?? '')
  if (key === WARP_PUBLIC_KEY) return true
  if (node.protocol !== 'wireguard' && raw.type !== 'wireguard') return false
  return !key && isCloudflareWarpPeer(String(p0.address ?? node.server ?? ''), key)
}

/** Копия узла с другим адресом/портом пира. */
export function withWarpEndpoint(node: IncyNode, ip: string, port: number): IncyNode {
  const raw: any = JSON.parse(JSON.stringify(node.rawOutbound ?? {}))
  const peers: any[] = Array.isArray(raw.peers) ? raw.peers : Array.isArray(raw.settings?.peers) ? raw.settings.peers : []
  if (peers[0]) {
    if (typeof peers[0].endpoint === 'string') {
      peers[0].endpoint = ip.includes(':') ? `[${ip}]:${port}` : `${ip}:${port}`
    } else {
      peers[0].address = ip
      peers[0].port = port
      delete peers[0].server
      delete peers[0].server_port
    }
  }
  return { ...node, server: ip, port, rawOutbound: raw }
}

export interface WarpPickResult {
  ok: boolean
  /** Выбранный адрес `ip:port` */
  endpoint?: string
  latencyMs?: number
  tested: number
  working: number
  /** Причина неудачи или пояснение. */
  message: string
  /** Установленное ядро не sing-box-lx. */
  needsLx?: boolean
  allNodes: IncyNode[]
}

async function lxProblem(node: IncyNode): Promise<string | null> {
  if (!isAwgNode(node)) return null
  const v = await singBoxVersion()
  if (isLxVersion(v)) return null
  return `Установлено ядро sing-box ${v ?? '(версия не определена)'} — оно не поддерживает AmneziaWG. Нужна сборка sing-box-lx: автообновление ядра скачает её само, затем повторите подбор.`
}

function parseTrace(body: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of body.split(/\r?\n/)) {
    const i = line.indexOf('=')
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return out
}

/**
 * Подбор рабочего адреса WARP. Для каждого кандидата поднимается временное ядро
 * и через него запрашивается cdn-cgi/trace: успех = в ответе `warp=on|plus`
 * (то есть пакеты реально прошли WireGuard-туннель до Cloudflare).
 * Останавливаемся после двух успехов, выбираем самый быстрый.
 */
export async function pickWarpEndpoint(nodeId: string): Promise<WarpPickResult> {
  const nodes = loadIncyNodes()
  const node = nodes.find((n) => n.id === nodeId)
  if (!node || !isWarpNodeLike(node)) {
    return { ok: false, tested: 0, working: 0, message: 'Это не узел Cloudflare WARP', allNodes: nodes }
  }
  const lx = await lxProblem(node)
  if (lx) {
    appendLog(`WARP: ${lx}`)
    return { ok: false, tested: 0, working: 0, needsLx: true, message: lx, allNodes: nodes }
  }

  const cands = warpCandidates()
  appendLog(`WARP: подбор адреса, кандидатов: ${cands.length}`)
  const good: Array<{ ip: string; port: number; ms: number }> = []
  let tested = 0
  let next = 0

  const worker = async (): Promise<void> => {
    while (good.length < MAX_SUCCESSES && next < cands.length) {
      const c = cands[next++]
      tested++
      const r = await fetchViaCore(withWarpEndpoint(node, c.ip, c.port), TRACE_URL, CANDIDATE_TIMEOUT_MS)
      const t = r.ok ? parseTrace(r.body) : {}
      if (r.ok && /^(on|plus)$/i.test(t.warp ?? '')) {
        good.push({ ...c, ms: r.ms })
        appendLog(`WARP: ${c.ip}:${c.port} — работает (${r.ms} мс, warp=${t.warp})`)
      } else {
        appendLog(`WARP: ${c.ip}:${c.port} — нет ответа${r.error ? ` (${r.error})` : ''}`)
      }
    }
  }
  // До трёх параллельных проверок (ограничивает и withCoreSlot).
  await Promise.all([worker(), worker(), worker()])

  if (good.length === 0) {
    const message =
      'Ни один адрес WARP не ответил — вероятно, провайдер режет WireGuard. Попробуйте вариант «WARP из бота» (@warp_generator_bot, AmneziaWG).'
    appendLog(`WARP: ${message}`)
    return { ok: false, tested, working: 0, message, allNodes: loadIncyNodes() }
  }
  good.sort((a, b) => a.ms - b.ms)
  const best = good[0]
  const updated = withWarpEndpoint(node, best.ip, best.port)
  updated.latencyMs = best.ms
  const all = loadIncyNodes().map((n) => (n.id === node.id ? updated : n))
  saveIncyNodes(all)
  const endpoint = `${best.ip}:${best.port}`
  appendLog(`WARP: выбран адрес ${endpoint} (${best.ms} мс)`)
  return { ok: true, endpoint, latencyMs: best.ms, tested, working: good.length, message: `Выбран адрес ${endpoint}`, allNodes: all }
}

export interface WarpCheckResult {
  ok: boolean
  ip?: string
  loc?: string
  warp?: string
  latencyMs?: number
  message: string
}

/** Проверка узла WARP: трафик через временное ядро → cdn-cgi/trace. */
export async function checkWarpNode(nodeId: string): Promise<WarpCheckResult> {
  const node = loadIncyNodes().find((n) => n.id === nodeId)
  if (!node || !isWarpNodeLike(node)) return { ok: false, message: 'Это не узел Cloudflare WARP' }
  const lx = await lxProblem(node)
  if (lx) return { ok: false, message: lx }
  const r = await fetchViaCore(node, TRACE_URL, 10_000)
  if (!r.ok) {
    appendLog(`WARP: проверка не прошла (${r.error ?? 'нет ответа'})`)
    return { ok: false, message: 'Узел не отвечает. Нажмите «Подобрать адрес» или импортируйте конфиг из бота.' }
  }
  const t = parseTrace(r.body)
  const on = /^(on|plus)$/i.test(t.warp ?? '')
  appendLog(`WARP: проверка — ip=${t.ip ?? '?'} loc=${t.loc ?? '?'} warp=${t.warp ?? '?'} ${r.ms} мс`)
  return {
    ok: on,
    ip: t.ip,
    loc: t.loc,
    warp: t.warp,
    latencyMs: r.ms,
    message: on ? 'WARP работает' : 'Трафик идёт, но не через WARP (warp=off)'
  }
}

/** Генерация + автоподбор адреса. Сбой подбора не отменяет созданный узел. */
export async function generateWarpAndPick(): Promise<{ node: IncyNode; allNodes: IncyNode[]; pick: WarpPickResult }> {
  const gen = await generateCloudflareWarpNode()
  let pick: WarpPickResult
  try {
    pick = await pickWarpEndpoint(gen.node.id)
  } catch (e) {
    pick = { ok: false, tested: 0, working: 0, message: e instanceof Error ? e.message : String(e), allNodes: gen.allNodes }
  }
  const allNodes = loadIncyNodes()
  return { node: allNodes.find((n) => n.id === gen.node.id) ?? gen.node, allNodes, pick }
}
