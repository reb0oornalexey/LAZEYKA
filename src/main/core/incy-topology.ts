/**
 * INCY dual-core topology planner.
 *
 * LAZEYKA ships two proxy cores because neither one covers everything the
 * INCY-style UI promises:
 *
 *   - **Xray-core** speaks VLESS / VMess / Trojan / Shadowsocks and is the only
 *     one of the two that implements TCP fragmentation and noise packets —
 *     the "Фрагментация" and "Шумы" sections in the settings tab are Xray
 *     features and cannot work on sing-box at all.
 *   - **sing-box** is the only one that speaks Hysteria2 (Xray-core has no
 *     Hysteria2 implementation), and it is the only one with a real TUN
 *     inbound. Xray has no TUN of its own.
 *
 * The two never compete for the same resource. Exactly one topology is active
 * at a time, and every one of them has a single owner for each scarce
 * resource: one TUN adapter, one user-facing port, one system-proxy writer.
 *
 * ```
 *  A. SINGBOX_ONLY   Hysteria2 node (any mode)
 *                    sing-box: mixed inbound :front (+ TUN) ─► hysteria2 out
 *                    xray.exe is not started at all
 *
 *  B. XRAY_ONLY      VLESS/VMess/Trojan/SS in «Системный прокси» / «Только прокси»
 *                    xray: http :front + socks :front+1 ─► proxy out
 *                    sing-box.exe is not started at all
 *
 *  C. CHAINED        VLESS/VMess/Trojan/SS in «Туннелирование (TUN)»
 *                    sing-box: TUN + mixed :front ─► socks out ─┐
 *                    xray:     socks :bridge  ◄─────────────────┘─► proxy out
 *                    sing-box owns the TUN adapter, Xray does the protocol
 *                    work (so fragmentation/noises still apply under TUN).
 * ```
 *
 * Port map (derived from the user's `mixedPort`, default 20808):
 *
 * | offset | owner            | purpose                                    |
 * |--------|------------------|--------------------------------------------|
 * | +0     | front core       | user-facing HTTP/mixed port (system proxy) |
 * | +1     | front core       | SOCKS5 (Xray only — sing-box `mixed` does both) |
 * | +2     | sing-box         | Clash API (traffic statistics)             |
 * | +3     | Xray             | internal SOCKS bridge in CHAINED mode      |
 *
 * Offsets are fixed rather than probed so a crashed run leaves no ambiguity
 * about which port belonged to whom; `planTopology` still reports them so the
 * caller can free them before starting.
 */

import type { IncyNode, IncySettings } from './incy-engine'

/** Protocols Xray-core can carry. Hysteria2 is deliberately absent. */
const XRAY_PROTOCOLS: ReadonlySet<IncyNode['protocol']> = new Set([
  'vless',
  'vmess',
  'trojan',
  'shadowsocks'
])

/** Protocols only sing-box can carry. */
const SINGBOX_ONLY_PROTOCOLS: ReadonlySet<IncyNode['protocol']> = new Set(['hysteria2'])

export type IncyCore = 'xray' | 'sing-box'
export type IncyTopologyKind = 'SINGBOX_ONLY' | 'XRAY_ONLY' | 'CHAINED'
export type IncyConnectionMode = 'tun' | 'system_proxy' | 'only_proxy'

export interface IncyPorts {
  /** User-facing port: system proxy and manual client configuration point here. */
  front: number
  /** SOCKS5 port. Only allocated when Xray is the front core. */
  socks: number
  /** sing-box Clash API — traffic counters for the statistics tab. */
  clashApi: number
  /** Internal Xray SOCKS inbound that sing-box forwards TUN traffic into. */
  bridge: number
}

export interface IncyTopology {
  kind: IncyTopologyKind
  /** Core that terminates the user's traffic and applies the node protocol. */
  protocolCore: IncyCore
  /** True when sing-box must run (as front, as TUN provider, or as both). */
  needsSingBox: boolean
  /** True when xray.exe must run. */
  needsXray: boolean
  /** True when sing-box forwards into Xray instead of dialing the node itself. */
  chained: boolean
  mode: IncyConnectionMode
  ports: IncyPorts
  /** Every port this topology will bind — used to clear stale listeners first. */
  usedPorts: number[]
  /** Human-readable reason, surfaced in the INCY log so the choice is visible. */
  reason: string
}

/**
 * Pick the core that can carry this node **without losing anything**.
 *
 * Fidelity beats features here. A JSON subscription ships the provider's own
 * outbound object, and it can specify a transport this app does not model —
 * WebSocket, gRPC, xhttp, httpupgrade, custom ALPN. That object can only be
 * replayed verbatim into the core whose schema it is written in:
 *
 *   - `type` key  → sing-box dialect → sing-box replays it as-is
 *   - `protocol`  → Xray dialect     → Xray replays it as-is
 *
 * Handing a sing-box-dialect node to Xray means rebuilding it from the handful
 * of flat fields the parser recognised, and `buildStreamSettings` can only
 * emit `network: "tcp"`. A WebSocket node reconstructed that way connects,
 * fails its handshake, and the server drops the connection — which showed up
 * in the logs as `dns: exchange failed … EOF` with Xray itself reporting no
 * error at all.
 *
 * So: dialect decides. Only nodes parsed from a URI (where the flat fields are
 * the complete truth) or already written for Xray go to Xray.
 */
export function corePreferenceFor(node: IncyNode, settings?: IncySettings): IncyCore {
  // Hysteria2 exists only in sing-box, whatever the dialect says.
  if (SINGBOX_ONLY_PROTOCOLS.has(node.protocol)) return 'sing-box'

  // Provider JSON: follow the dialect it was written in.
  if (node.rawOutboundDialect === 'sing-box') return 'sing-box'
  if (node.rawOutboundDialect === 'xray') return 'xray'

  // URI-parsed node: both cores can carry it, so prefer the simpler path.
  //
  // sing-box alone means no SOCKS bridge, no second process to exclude from
  // the tunnel, and no reconstruction of a transport we might model
  // imperfectly. Xray is worth the extra moving parts only when the user
  // actually asked for something it alone provides — fragmentation or noise
  // packets. Both default to off, so the common case is the simple one.
  const wantsXrayOnly = Boolean(settings?.fragmentation || settings?.noises)
  if (wantsXrayOnly && XRAY_PROTOCOLS.has(node.protocol)) return 'xray'

  return 'sing-box'
}

export function computePorts(mixedPort: number | undefined): IncyPorts {
  const base = Number(mixedPort) > 0 ? Number(mixedPort) : 20808
  return {
    front: base,
    socks: base + 1,
    clashApi: base + 2,
    bridge: base + 3
  }
}

/**
 * Decide which cores run and how they are wired for a given node + settings.
 *
 * `xrayAvailable` is passed in rather than probed here so the caller can fall
 * back gracefully when xray.exe has not been downloaded yet: an Xray-capable
 * node simply runs on sing-box (losing fragmentation/noises but staying
 * connected) instead of failing outright.
 */
export function planTopology(
  node: IncyNode,
  settings: IncySettings,
  xrayAvailable: boolean
): IncyTopology {
  const mode = (settings.connectionMode || 'tun') as IncyConnectionMode
  const ports = computePorts(settings.mixedPort)
  const preferred = corePreferenceFor(node, settings)

  // ---- A. sing-box only -------------------------------------------------
  if (preferred === 'sing-box') {
    return {
      kind: 'SINGBOX_ONLY',
      protocolCore: 'sing-box',
      needsSingBox: true,
      needsXray: false,
      chained: false,
      mode,
      ports,
      usedPorts: [ports.front, ports.clashApi],
      reason:
        node.protocol === 'hysteria2'
          ? 'Hysteria2 поддерживает только sing-box — Xray не запускается'
          : `Протокол ${node.protocol} обслуживается ядром sing-box`
    }
  }

  // Xray-capable node, but the binary is missing — degrade instead of failing.
  if (!xrayAvailable) {
    return {
      kind: 'SINGBOX_ONLY',
      protocolCore: 'sing-box',
      needsSingBox: true,
      needsXray: false,
      chained: false,
      mode,
      ports,
      usedPorts: [ports.front, ports.clashApi],
      reason:
        'xray.exe ещё не загружен — узел временно обслуживается ядром sing-box ' +
        '(фрагментация и шумы недоступны до загрузки Xray)'
    }
  }

  // ---- C. chained: sing-box owns TUN, Xray does the protocol ------------
  if (mode === 'tun') {
    return {
      kind: 'CHAINED',
      protocolCore: 'xray',
      needsSingBox: true,
      needsXray: true,
      chained: true,
      mode,
      ports,
      usedPorts: [ports.front, ports.clashApi, ports.bridge],
      reason:
        'Режим TUN: sing-box держит виртуальный адаптер и передаёт трафик в Xray ' +
        `через 127.0.0.1:${ports.bridge} — фрагментация и шумы продолжают работать`
    }
  }

  // ---- B. Xray only -----------------------------------------------------
  return {
    kind: 'XRAY_ONLY',
    protocolCore: 'xray',
    needsSingBox: false,
    needsXray: true,
    chained: false,
    mode,
    ports,
    usedPorts: [ports.front, ports.socks],
    reason: `Протокол ${node.protocol} обслуживается ядром Xray (HTTP :${ports.front}, SOCKS5 :${ports.socks})`
  }
}

/**
 * True when the settings ask for something the sing-box path cannot deliver.
 *
 * Noise packets are Xray-only at any version. Fragmentation is listed too:
 * sing-box 1.12 gained a `tls_fragment` field, but not as a route-rule option
 * (see the note in incy-engine.ts), so on this path it is still unimplemented.
 */
export function usesXrayOnlyFeatures(settings: IncySettings): boolean {
  return Boolean(settings.noises || settings.fragmentation)
}
