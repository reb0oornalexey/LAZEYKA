import https from 'node:https'
import crypto from 'node:crypto'
import { loadIncyNodes, saveIncyNodes, loadIncySettings, saveIncySettings, broadcastStatus, appendLog, type IncyNode } from './incy-engine'

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

  const addressList = [`${v4}/32`]
  if (v6) {
    addressList.push(`${v6}/128`)
  }

  // 3. Construct IncyNode
  const warpNode: IncyNode = {
    id: `node-warp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: '⚡ Cloudflare WARP (Бесплатный)',
    description: `Официальный бесплатный туннель Cloudflare • IP: ${v4}`,
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
          allowed_ips: ['0.0.0.0/0', '::/0']
        }
      ],
      mtu: 1280
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
