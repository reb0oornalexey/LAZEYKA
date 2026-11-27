/**
 * Xray-core configuration builder — the second INCY core.
 *
 * Xray exists here for two reasons sing-box cannot cover:
 *
 *  1. **TCP fragmentation** and **noise packets**, а также параметры узлов из
 *     ссылок INCY (ECH, закрепление сертификата, finalmask, XHTTP…). В Xray 26
 *     фрагментация и шумы задаются масками `streamSettings.finalmask` на самом
 *     прокси-исходящем (см. `incy-finalmask.ts`); прежний отдельный
 *     `freedom`-исходящий с `dialerProxy` объявлен устаревшим и не строится.
 *  2. **VMess**, which sing-box supports but which LAZEYKA never parsed.
 *
 * Hysteria2 по умолчанию остаётся на sing-box. Через Xray (`protocol:
 * "hysteria"`) идут только узлы с параметрами, которых у sing-box нет
 * (`pinSHA256`, `fm`), и узлы JSON-подписки, записанные провайдером для Xray.
 * См. `incy-topology.ts` — выбор ядра.
 *
 * Schema note: Xray outbounds are keyed by `protocol` and nest their transport
 * under `streamSettings`; sing-box outbounds are keyed by `type` and inline
 * everything. That difference is what `rawOutboundDialect` records, letting a
 * provider's own JSON be replayed verbatim into whichever core speaks it.
 */

import type { IncyNode, IncySettings } from './incy-engine'
import type { IncyPorts } from './incy-topology'
import type { NodeFinalmask } from './incy-links'
import {
  applyFinalmask,
  resolveFragment,
  resolveNoise,
  type FragmentShape,
  type NoiseShape
} from './incy-finalmask'
import { muxSkipReason, xrayOutboundSubject } from './incy-mux'

export interface XrayBuildOptions {
  /** Ports this Xray instance should bind. */
  ports: IncyPorts
  /**
   * When true Xray is behind sing-box's TUN and only needs the internal SOCKS
   * bridge; the user-facing HTTP/SOCKS ports belong to sing-box in that mode.
   */
  chained: boolean
  /** Domains that must skip the tunnel (split tunnelling + user extras). */
  bypassDomains: string[]
  /**
   * Свои исключения «Адреса мимо VPN» (домены и подсети): всегда напрямую; домены
   * здесь нужны для режима `global`, где список обхода РФ не действует.
   */
  extraDirect?: { domains: string[]; cidrs: string[] }
  /** Не включать логин и пароль на входящих (системный прокси их передать не может). */
  ignoreAuth?: boolean
  routingMode: 'bypass-ru' | 'global' | 'direct'
  /**
   * How much of the geo database to rely on.
   *
   * Xray rejects the whole config on the first unknown category code, and
   * which codes exist depends entirely on who built the .dat file. Rather than
   * betting on one layout, the caller walks down these tiers until the core
   * accepts a config:
   *
   *  - `full`    — every curated category (games, Apple, Microsoft, Twitch …)
   *  - `minimal` — only the codes present in essentially every RU-oriented
   *                build: `category-ru`, `private`, `geoip:direct`. This keeps
   *                the routing that actually matters when an exotic category
   *                like `epic-games` is missing.
   *  - `none`    — no geo references at all; plain domain lists and literal
   *                private CIDRs.
   */
  geoTier: 'full' | 'minimal' | 'none'
  /**
   * Цепочка узлов на Xray: узел-вход. Выход (тег `proxy`) подключается через него
   * (`streamSettings.sockopt.dialerProxy`). Фрагментация и шумы — на входе: DPI видит только его.
   */
  chainEntry?: IncyNode
}

/**
 * RoscomVPN geosite categories that should bypass the tunnel.
 *
 * Russian services, banks and state portals obviously; but also Steam, Epic,
 * Riot and Tarkov (routing game traffic through a proxy adds latency for no
 * benefit and burns server bandwidth), Apple and Microsoft (push notification
 * delivery breaks behind a proxy), and Faceit (more available regions when
 * connecting directly).
 */
const GEOSITE_DIRECT = [
  'geosite:whitelist',
  'geosite:category-ru',
  'geosite:apple',
  'geosite:microsoft',
  'geosite:steam',
  'geosite:epic-games',
  'geosite:riot',
  'geosite:escapefromtarkov',
  'geosite:faceit',
  'geosite:twitch',
  'geosite:pinterest',
  'geosite:private'
]

/**
 * The same categories, described for the UI.
 *
 * Until now these three arrays were invisible: the routing tab offered one
 * master "использовать гео-базы" switch, and what was actually inside those
 * databases — which services go direct, which are forced through the tunnel,
 * which are dropped — could only be discovered by reading this file. Anyone
 * who wanted Steam through the VPN, or wanted ad-blocking off, had no way to
 * say so.
 *
 * `id` is the raw category code used in the config; `essential` marks the ones
 * that survive the `minimal` tier and should not be casually switched off,
 * because they are what keeps RU sites and local addresses off the tunnel.
 */
export interface GeoCategoryInfo {
  id: string
  label: string
  hint: string
  target: 'direct' | 'proxy' | 'block'
  essential?: boolean
}

export const GEO_CATEGORY_CATALOG: GeoCategoryInfo[] = [
  // --- напрямую, мимо туннеля ---
  { id: 'geosite:whitelist', label: 'Белый список RoscomVPN', hint: 'Кураторский список сайтов, которым туннель только мешает', target: 'direct', essential: true },
  { id: 'geosite:category-ru', label: 'Российские сайты', hint: 'Домены .ru/.рф, банки, госуслуги, маркетплейсы', target: 'direct', essential: true },
  { id: 'geosite:private', label: 'Локальная сеть', hint: 'Приватные адреса и домены внутри вашей сети', target: 'direct', essential: true },
  { id: 'geosite:apple', label: 'Apple', hint: 'Через прокси ломаются push-уведомления и iCloud', target: 'direct' },
  { id: 'geosite:microsoft', label: 'Microsoft', hint: 'Обновления Windows и Office быстрее напрямую', target: 'direct' },
  { id: 'geosite:steam', label: 'Steam', hint: 'Загрузка игр напрямую — быстрее и не жжёт трафик сервера', target: 'direct' },
  { id: 'geosite:epic-games', label: 'Epic Games', hint: 'То же самое: лаунчер и загрузки мимо туннеля', target: 'direct' },
  { id: 'geosite:riot', label: 'Riot Games', hint: 'League of Legends, Valorant — меньше задержка напрямую', target: 'direct' },
  { id: 'geosite:escapefromtarkov', label: 'Escape from Tarkov', hint: 'Игровой трафик мимо туннеля', target: 'direct' },
  { id: 'geosite:faceit', label: 'FACEIT', hint: 'Больше доступных регионов при прямом подключении', target: 'direct' },
  { id: 'geosite:twitch', label: 'Twitch', hint: 'Само видео идёт напрямую, а реклама — через туннель', target: 'direct' },
  { id: 'geosite:pinterest', label: 'Pinterest', hint: 'Работает напрямую, туннель не нужен', target: 'direct' },

  // --- принудительно через туннель ---
  { id: 'geosite:youtube', label: 'YouTube', hint: 'Замедляется провайдерами — только через туннель', target: 'proxy' },
  { id: 'geosite:telegram', label: 'Telegram', hint: 'Блокируются звонки и медиа', target: 'proxy' },
  { id: 'geosite:github', label: 'GitHub', hint: 'Периодически недоступен напрямую', target: 'proxy' },
  { id: 'geosite:google-play', label: 'Google Play', hint: 'Установка и обновление приложений', target: 'proxy' },
  { id: 'geosite:twitch-ads', label: 'Реклама Twitch', hint: 'Через туннель — вырезается на стороне сервера', target: 'proxy' },

  // --- блокировать ---
  { id: 'geosite:win-spy', label: 'Телеметрия Windows', hint: 'Отчёты Microsoft о вашей активности', target: 'block' },
  { id: 'geosite:category-ads', label: 'Реклама и трекеры', hint: 'Рекламные сети и счётчики', target: 'block' },
  { id: 'geosite:torrent', label: 'Torrent DHT', hint: 'Торрент-трафик через VPN обычно запрещён провайдером', target: 'block' }
]

/**
 * Is a category switched on?
 *
 * Absent from the overrides map means "on" — the defaults are the curated set,
 * and a fresh install must behave exactly as it did before this feature.
 */
export function isGeoCategoryEnabled(
  id: string,
  overrides: Record<string, boolean> | undefined
): boolean {
  return overrides?.[id] !== false
}

/**
 * Categories forced through the tunnel even though they might resolve to
 * Russian CDN edges — these are the ones actively throttled by DPI.
 * `twitch-ads` in proxy (while `twitch` stays direct) is what restores full
 * stream quality without the ad breaks.
 */
const GEOSITE_PROXY = [
  'geosite:youtube',
  'geosite:telegram',
  'geosite:github',
  'geosite:google-play',
  'geosite:twitch-ads'
]

/** Telemetry, ad and torrent-DHT domains — dropped outright. */
const GEOSITE_BLOCK = ['geosite:win-spy', 'geosite:category-ads', 'geosite:torrent']

/** Что накладывается на исходящий: фрагментация TCP и шумовые UDP-пакеты. */
interface Shaping {
  fragment: FragmentShape | null
  noise: NoiseShape | null
}

/** Attach mux / xudp settings shared by every Xray proxy outbound. */
function applyXrayMux(outbound: Record<string, unknown>, settings: IncySettings): void {
  if (!settings.multiplexing) return
  outbound.mux = {
    enabled: true,
    concurrency: Math.max(1, settings.muxConcurrency || 8),
    xudpConcurrency: Math.max(0, settings.xudpConcurrency ?? 16),
    // "reject" makes QUIC fall back to TCP+TLS, which the proxy handles far
    // better than tunnelled UDP; "allow" tunnels it as-is.
    xudpProxyUDP443: settings.xudpProxy443 === 'allow' ? 'allow' : 'reject'
  }
}

/** Глубокая копия finalmask из ссылки (`fm`), чтобы правки не трогали узел. */
function cloneFinalmask(fm: NodeFinalmask | undefined): Record<string, unknown> | null {
  if (!fm) return null
  try {
    return JSON.parse(JSON.stringify(fm)) as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * Translate a node into an Xray `streamSettings` block (TLS / Reality / uTLS).
 *
 * Фрагментация и шумы сюда не входят: они добавляются отдельно через
 * `applyFinalmask`, уже поверх готового блока.
 */
function buildStreamSettings(node: IncyNode): Record<string, unknown> {
  // Transport first. This used to be hard-coded to `tcp`, which silently
  // downgraded every WebSocket / gRPC node into something that connects and
  // then fails its handshake.
  const network = node.network || 'tcp'
  const stream: Record<string, unknown> = { network }

  if (network === 'ws' || network === 'httpupgrade') {
    const wsSettings: Record<string, unknown> = { path: node.wsPath || '/' }
    if (node.wsHost) wsSettings.headers = { Host: node.wsHost }
    stream[network === 'ws' ? 'wsSettings' : 'httpupgradeSettings'] = wsSettings
  } else if (network === 'grpc') {
    stream.grpcSettings = {
      serviceName: node.grpcServiceName || '',
      ...(node.grpcAuthority ? { authority: node.grpcAuthority } : {})
    }
  } else if (network === 'xhttp') {
    stream.xhttpSettings = {
      path: node.wsPath || '/',
      ...(node.wsHost ? { host: node.wsHost } : {}),
      ...(node.xhttpMode ? { mode: node.xhttpMode } : {}),
      ...(node.xhttpExtra ? { extra: node.xhttpExtra } : {})
    }
  }

  if (node.security === 'reality' && node.publicKey) {
    stream.security = 'reality'
    stream.realitySettings = {
      serverName: node.sni || node.server,
      publicKey: node.publicKey,
      shortId: node.shortId || '',
      fingerprint: node.fingerprint || 'chrome',
      ...(node.spiderX ? { spiderX: node.spiderX } : {}),
      ...(node.mldsa65Verify ? { mldsa65Verify: node.mldsa65Verify } : {})
    }
  } else if (node.security === 'tls') {
    stream.security = 'tls'
    stream.tlsSettings = {
      serverName: node.sni || node.server,
      fingerprint: node.fingerprint || 'chrome',
      allowInsecure: node.insecure === true,
      ...(node.alpn && node.alpn.length > 0 ? { alpn: node.alpn } : {}),
      ...(node.echConfigList ? { echConfigList: node.echConfigList } : {}),
      ...(node.pinnedCertSha256 ? { pinnedPeerCertSha256: node.pinnedCertSha256 } : {}),
      ...(node.verifyCertByName ? { verifyPeerCertByName: node.verifyCertByName } : {})
    }
  }

  // Маски из ссылки (`fm`) — как есть; наши добавляются к ним позже.
  const fm = cloneFinalmask(node.finalmask)
  if (fm) stream.finalmask = fm

  return stream
}

/**
 * Hysteria2 для Xray (`protocol: "hysteria"`, Xray ≥ 26) из узла-ссылки.
 *
 * Нужен только для узлов с параметрами, которых нет у sing-box: закрепление
 * сертификата `pinSHA256` и маски `fm`. Obfs salamander, прыжки портов и
 * скорости переносятся в `finalmask.udp` / `finalmask.quicParams`.
 */
function buildHysteriaOutbound(node: IncyNode): Record<string, unknown> {
  const fm: Record<string, unknown> = cloneFinalmask(node.finalmask) ?? {}
  const udp = Array.isArray(fm.udp) ? [...(fm.udp as unknown[])] : []
  if (node.obfsPassword) {
    udp.unshift({ type: 'salamander', settings: { password: node.obfsPassword } })
  }
  if (udp.length > 0) fm.udp = udp

  const quic: Record<string, unknown> = {
    ...(fm.quicParams && typeof fm.quicParams === 'object' ? (fm.quicParams as Record<string, unknown>) : {})
  }
  if (node.hopPorts && node.hopPorts.length > 0 && quic.udpHop === undefined) {
    quic.udpHop = {
      ports: node.hopPorts.map((p) => p.replace(':', '-').replace(/^(\d+)-\1$/, '$1')).join(','),
      interval: String(node.hopInterval ?? 30)
    }
  }
  if ((node.upMbps || node.downMbps) && quic.congestion === undefined) {
    quic.congestion = 'brutal'
    if (node.upMbps) quic.brutalUp = `${node.upMbps} mbps`
    if (node.downMbps) quic.brutalDown = `${node.downMbps} mbps`
  }
  if (Object.keys(quic).length > 0) fm.quicParams = quic

  const stream: Record<string, unknown> = {
    network: 'hysteria',
    security: 'tls',
    tlsSettings: {
      serverName: node.sni || node.server,
      alpn: node.alpn && node.alpn.length > 0 ? node.alpn : ['h3'],
      allowInsecure: node.insecure === true,
      ...(node.pinSha256 ? { pinnedPeerCertSha256: node.pinSha256 } : {})
    },
    hysteriaSettings: { version: 2, auth: node.password || '' }
  }
  if (Object.keys(fm).length > 0) stream.finalmask = fm

  return {
    tag: 'proxy',
    protocol: 'hysteria',
    settings: { version: 2, address: node.server, port: node.port },
    streamSettings: stream
  }
}

/** Тег исходящего узла-входа (как в sing-box). */
export const XRAY_CHAIN_ENTRY_TAG = 'chain-entry'

/**
 * Цепочка на Xray: [выход с dialerProxy на вход, вход]. Маски (фрагментация, шумы) — на входе:
 * провайдер видит только первый сервер, а выход идёт уже внутри его туннеля.
 */
export function buildXrayChainOutbounds(
  exit: IncyNode,
  entry: IncyNode,
  settings: IncySettings
): { ok: true; outbounds: Record<string, unknown>[] } | { ok: false; reason: string } {
  const none: Shaping = { fragment: null, noise: null }
  const entryShaping: Shaping = {
    fragment: resolveFragment(entry, settings)?.shape ?? null,
    noise: resolveNoise(entry, settings)?.shape ?? null
  }
  const out = buildProxyOutbound(exit, settings, none)
  if (!out) return { ok: false, reason: `Ядро Xray не может собрать узел-выход «${exit.name}»` }
  const inn = buildProxyOutbound(entry, settings, entryShaping)
  if (!inn) return { ok: false, reason: `Ядро Xray не может собрать узел-вход «${entry.name}»` }
  const ss = ((out.streamSettings as Record<string, unknown> | undefined) ?? {}) as Record<string, unknown>
  const sockopt = (ss.sockopt as Record<string, unknown> | undefined) ?? {}
  if (sockopt.dialerProxy !== undefined) return { ok: false, reason: `«${exit.name}» уже настроен провайдером на подключение через другой сервер` }
  out.streamSettings = { ...ss, sockopt: { ...sockopt, dialerProxy: XRAY_CHAIN_ENTRY_TAG } }
  out.tag = 'proxy'
  inn.tag = XRAY_CHAIN_ENTRY_TAG
  return { ok: true, outbounds: [out, inn] }
}

/**
 * Replay a provider-supplied *Xray* outbound verbatim, exactly as
 * `reuseProviderOutbound` does on the sing-box side. JSON subscriptions can
 * carry transports this module does not model (xhttp, grpc, httpupgrade,
 * splithttp); rebuilding from parsed fields would silently drop them.
 */
function reuseProviderXrayOutbound(
  node: IncyNode,
  settings: IncySettings,
  shaping: Shaping
): Record<string, unknown> | null {
  if (node.rawOutboundDialect !== 'xray' || !node.rawOutbound) return null
  let clone: Record<string, unknown>
  try {
    clone = JSON.parse(JSON.stringify(node.rawOutbound))
  } catch {
    return null
  }
  if (!clone || typeof clone !== 'object' || typeof clone.protocol !== 'string') return null

  clone.tag = 'proxy'
  // Hysteria работает поверх QUIC: mux и TCP-фрагментация к нему неприменимы.
  const isQuic = clone.protocol === 'hysteria'
  // Исходящее провайдера с flow (Vision), XHTTP и т. п. MUX не получает:
  // иначе соединение не поднимется (см. incy-mux.ts).
  if (clone.mux === undefined && !isQuic && muxSkipReason(xrayOutboundSubject(clone)) === null) {
    applyXrayMux(clone, settings)
  }

  // Маски кладутся в finalmask самого исходящего. Свои маски провайдера
  // (в том числе fragment) сохраняются, `sockopt.dialerProxy` не трогается.
  applyFinalmask(clone, shaping, { allowTcp: !isQuic })
  return clone
}

function buildProxyOutbound(
  node: IncyNode,
  settings: IncySettings,
  shaping: Shaping
): Record<string, unknown> | null {
  const verbatim = reuseProviderXrayOutbound(node, settings, shaping)
  if (verbatim) return verbatim

  // Refuse to rebuild a node whose provider object is written for the other
  // core. `buildStreamSettings` can only emit `network: "tcp"`, so a WebSocket
  // or gRPC node would be silently downgraded into something that connects and
  // then fails its handshake — the server drops it and the only visible
  // symptom is an unexplained EOF. Returning null makes the caller fall back
  // to sing-box, which can replay the object exactly as the provider wrote it.
  if (node.rawOutboundDialect === 'sing-box') return null

  if (node.protocol === 'hysteria2') {
    const outbound = buildHysteriaOutbound(node)
    applyFinalmask(outbound, shaping, { allowTcp: false })
    return outbound
  }

  const streamSettings = buildStreamSettings(node)

  if (node.protocol === 'vless') {
    const outbound: Record<string, unknown> = {
      tag: 'proxy',
      protocol: 'vless',
      settings: {
        vnext: [
          {
            address: node.server,
            port: node.port,
            users: [
              {
                id: node.uuid || '',
                encryption: 'none',
                ...(node.flow ? { flow: node.flow } : {})
              }
            ]
          }
        ]
      },
      streamSettings
    }
    // xtls-rprx-vision and mux are mutually exclusive in Xray.
    if (muxSkipReason({ protocol: 'vless', flow: node.flow, network: node.network }) === null) {
      applyXrayMux(outbound, settings)
    }
    applyFinalmask(outbound, shaping)
    return outbound
  }

  if (node.protocol === 'vmess') {
    const outbound: Record<string, unknown> = {
      tag: 'proxy',
      protocol: 'vmess',
      settings: {
        vnext: [
          {
            address: node.server,
            port: node.port,
            users: [{ id: node.uuid || '', security: node.vmessCipher || 'auto', alterId: node.alterId || 0 }]
          }
        ]
      },
      streamSettings
    }
    applyXrayMux(outbound, settings)
    applyFinalmask(outbound, shaping)
    return outbound
  }

  if (node.protocol === 'trojan') {
    const outbound: Record<string, unknown> = {
      tag: 'proxy',
      protocol: 'trojan',
      settings: {
        servers: [{ address: node.server, port: node.port, password: node.password || '' }]
      },
      // У старых сохранённых trojan-узлов нет поля security: считаем TLS, но
      // строим блок целиком (с serverName), а не одну пометку «tls».
      streamSettings: node.security === undefined ? buildStreamSettings({ ...node, security: 'tls' }) : streamSettings
    }
    applyXrayMux(outbound, settings)
    applyFinalmask(outbound, shaping)
    return outbound
  }

  if (node.protocol === 'shadowsocks') {
    const outbound: Record<string, unknown> = {
      tag: 'proxy',
      protocol: 'shadowsocks',
      settings: {
        servers: [
          {
            address: node.server,
            port: node.port,
            method: node.method || 'aes-128-gcm',
            password: node.password || '',
            uot: true
          }
        ]
      }
    }
    applyXrayMux(outbound, settings)
    applyFinalmask(outbound, shaping)
    return outbound
  }

  // Anything else is not an Xray protocol — the caller must route those to
  // sing-box instead.
  return null
}

/**
 * Build the complete Xray config.
 *
 * Returns null when the node cannot be served by Xray, so the caller can fall
 * back to sing-box rather than writing a config that would fail at startup.
 */
export function buildXrayConfig(
  node: IncyNode,
  settings: IncySettings,
  opts: XrayBuildOptions
): Record<string, unknown> | null {
  // Фрагментация и шумы — маски finalmask на самом исходящем прокси. Отдельного
  // freedom-исходящего с dialerProxy больше нет: в Xray 26 он объявлен устаревшим.
  const shaping: Shaping = {
    fragment: resolveFragment(node, settings)?.shape ?? null,
    noise: resolveNoise(node, settings)?.shape ?? null
  }

  const chain = opts.chainEntry ? buildXrayChainOutbounds(node, opts.chainEntry, settings) : null
  if (opts.chainEntry && (!chain || !chain.ok)) return null
  const proxy = chain && chain.ok ? chain.outbounds[0] : buildProxyOutbound(node, settings, shaping)
  if (!proxy) return null

  const sniffing = {
    enabled: Boolean(settings.sniffing),
    destOverride: ['http', 'tls', 'quic'],
    routeOnly: false
  }

  const inbounds: Record<string, unknown>[] = []

  if (opts.chained) {
    // Behind sing-box's TUN: one internal SOCKS inbound, loopback only.
    inbounds.push({
      tag: 'socks-bridge',
      listen: '127.0.0.1',
      port: opts.ports.bridge,
      protocol: 'socks',
      settings: { auth: 'noauth', udp: true },
      sniffing
    })
  } else {
    // Xray is the front core. Windows' system proxy setting points at a single
    // host:port and treats it as HTTP, so the HTTP inbound takes the primary
    // port and SOCKS5 sits next to it. (Xray has no "mixed" inbound — unlike
    // sing-box it cannot serve both on one port.)
    const listen = settings.allowLan ? '0.0.0.0' : '127.0.0.1'
    const accounts =
      settings.socksAuth && settings.socksUser && settings.socksPass && !opts.ignoreAuth
        ? [{ user: settings.socksUser, pass: settings.socksPass }]
        : undefined

    inbounds.push({
      tag: 'http-in',
      listen,
      port: opts.ports.front,
      protocol: 'http',
      settings: accounts ? { accounts, allowTransparent: false } : { allowTransparent: false },
      sniffing
    })
    inbounds.push({
      tag: 'socks-in',
      listen,
      port: opts.ports.socks,
      protocol: 'socks',
      settings: accounts
        ? { auth: 'password', accounts, udp: true }
        : { auth: 'noauth', udp: true },
      sniffing
    })
  }

  const outbounds: Record<string, unknown>[] = [proxy]
  if (chain && chain.ok) outbounds.push(chain.outbounds[1])
  outbounds.push({ tag: 'direct', protocol: 'freedom', settings: {} })
  outbounds.push({ tag: 'block', protocol: 'blackhole', settings: {} })

  const rules: Record<string, unknown>[] = []

  // User rules come first — an explicit choice must beat every curated list.
  for (const rule of settings.customRoutingRules ?? []) {
    if (!rule.enabled || !rule.value?.trim()) continue
    const value = rule.value.trim()
    const tag = rule.action === 'proxy' ? 'proxy' : rule.action === 'block' ? 'block' : 'direct'
    // Route by IP when it looks like an address or CIDR, by category when the
    // user typed one, otherwise as a domain suffix.
    if (/^geoip:/i.test(value)) {
      rules.push({ type: 'field', ip: [value], outboundTag: tag })
    } else if (/^geosite:/i.test(value)) {
      rules.push({ type: 'field', domain: [value], outboundTag: tag })
    } else if (/^[\d.]+(\/\d{1,2})?$/.test(value) || value.includes(':')) {
      rules.push({ type: 'field', ip: [value], outboundTag: tag })
    } else {
      rules.push({ type: 'field', domain: [`domain:${value.replace(/^\*\./, '')}`], outboundTag: tag })
    }
  }

  // Свои исключения (если не действует список обхода РФ): всегда напрямую.
  if (opts.extraDirect && opts.routingMode !== 'direct') {
    // Домены в режиме «Раздельно» уже входят в список обхода (bypassDomains).
    if (opts.routingMode === 'global' && opts.extraDirect.domains.length > 0) {
      rules.push({
        type: 'field',
        domain: opts.extraDirect.domains.map((d) => `domain:${d}`),
        outboundTag: 'direct'
      })
    }
    if (opts.extraDirect.cidrs.length > 0) {
      rules.push({ type: 'field', ip: opts.extraDirect.cidrs, outboundTag: 'direct' })
    }
  }

  if (settings.blockUdp) {
    rules.push({ type: 'field', network: 'udp', outboundTag: 'block' })
  } else if (settings.xudpProxy443 === 'reject') {
    rules.push({ type: 'field', network: 'udp', port: '443', outboundTag: 'block' })
  }

  if (settings.allowLan && !settings.lanViaProxy && !opts.chained) {
    rules.push({
      type: 'field',
      source: ['192.168.0.0/16', '10.0.0.0/8', '172.16.0.0/12'],
      outboundTag: 'direct'
    })
  }

  if (opts.routingMode === 'bypass-ru') {
    // Order matters: block first, then the forced-proxy categories, then
    // direct. A domain listed in several categories takes the first match, so
    // e.g. a YouTube CDN edge hosted on a Russian subnet still goes through
    // the tunnel instead of being caught by the RU direct rule below.
    if (opts.geoTier === 'full') {
      // Each category is individually switchable in the routing tab. An empty
      // group is skipped rather than emitted as `domain: []`, which Xray
      // rejects as a malformed rule.
      const on = (list: string[]): string[] =>
        list.filter((id) => isGeoCategoryEnabled(id, settings.geoCategoryOverrides))

      const blocked = on(GEOSITE_BLOCK)
      const proxied = on(GEOSITE_PROXY)
      // Храним прежний ID настройки, а ядру передаём имя категории из geosite.dat.
      const direct = on(GEOSITE_DIRECT).map((id) => id === 'geosite:epic-games' ? 'geosite:epicgames' : id)
      if (blocked.length) rules.push({ type: 'field', domain: blocked, outboundTag: 'block' })
      if (proxied.length) rules.push({ type: 'field', domain: proxied, outboundTag: 'proxy' })
      if (direct.length) rules.push({ type: 'field', domain: direct, outboundTag: 'direct' })
    } else if (opts.geoTier === 'minimal') {
      rules.push({
        type: 'field',
        domain: ['geosite:category-ru', 'geosite:private'],
        outboundTag: 'direct'
      })
    }

    // The user's own split-tunnelling entries always apply, with or without
    // the geo databases — they are explicit choices and must win over a
    // curated list.
    const domains = opts.bypassDomains
      // Xray matches bare suffixes with the `domain:` prefix; the stored list
      // uses the `*.example.com` shape, so the wildcard is stripped first.
      .map((d) => d.replace(/^\*\./, '').replace(/^\./, '').trim())
      .filter(Boolean)
      .map((d) => `domain:${d}`)
    if (domains.length) {
      rules.push({ type: 'field', domain: domains, outboundTag: 'direct' })
    }

    if (opts.geoTier !== 'none') {
      // `geoip:direct` is RU/BY subnets minus RKN-blocked ranges minus the
      // Russian edges of foreign CDNs — the subtraction is what keeps blocked
      // services tunnelled even when they resolve to a local IP.
      rules.push({ type: 'field', ip: ['geoip:direct', 'geoip:private'], outboundTag: 'direct' })
    } else {
      // Explicit CIDRs rather than `geoip:private`: the fallback config must
      // not reference the geo databases at all, because it exists precisely
      // for the case where those databases are missing, outdated, or built
      // without the categories this app expects.
      rules.push({
        type: 'field',
        ip: ['127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '::1/128', 'fc00::/7'],
        outboundTag: 'direct'
      })
    }
  }

  const finalTag = opts.routingMode === 'direct' ? 'direct' : 'proxy'

  return {
    // access: 'none' — журнал доступа Xray («accepted tcp:… -> proxy») писал
    // строку на каждое соединение и забивал вкладку «Логи».
    log: { loglevel: 'warning', access: 'none' },
    inbounds,
    outbounds,
    routing: {
      // 'IPv6Prefer' для routing в Xray не существует — ядро молча
      // откатывалось на AsIs. Предпочтение IPv6 задаётся на стороне DNS.
      domainStrategy: 'IPIfNonMatch',
      rules: [...rules, { type: 'field', network: 'tcp,udp', outboundTag: finalTag }]
    }
  }
}
