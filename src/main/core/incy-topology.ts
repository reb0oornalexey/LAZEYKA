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
import { nodeNeedsXray } from './incy-links'
import { wantsXrayShaping } from './incy-finalmask'

/** Protocols Xray-core can carry. Hysteria2 is deliberately absent. */
const XRAY_PROTOCOLS: ReadonlySet<IncyNode['protocol']> = new Set([
  'vless',
  'vmess',
  'trojan',
  'shadowsocks'
])

/** Protocols only sing-box can carry. */
const SINGBOX_ONLY_PROTOCOLS: ReadonlySet<IncyNode['protocol']> = new Set(['hysteria2', 'wireguard'])

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
  // Hysteria2, записанный провайдером для Xray (`protocol: "hysteria"`,
  // Xray ≥ 26), воспроизводится Xray как есть — со всеми параметрами QUIC
  // (finalmask, congestion и т.п.). Пересборка для sing-box из нескольких
  // полей эти параметры теряла.
  if (
    node.protocol === 'hysteria2' &&
    node.rawOutboundDialect === 'xray' &&
    (node.rawOutbound as { protocol?: string } | undefined)?.protocol === 'hysteria'
  ) {
    return 'xray'
  }

  // Hysteria2 из ссылки с параметрами, которые знает только Xray (закрепление
  // сертификата `pinSHA256`, маски `fm`), собирается для Xray. Без таких
  // параметров выбор прежний — sing-box.
  if (node.protocol === 'hysteria2' && !node.rawOutbound && nodeNeedsXray(node)) return 'xray'

  // Otherwise Hysteria2 / WireGuard are served by sing-box.
  if (SINGBOX_ONLY_PROTOCOLS.has(node.protocol)) return 'sing-box'

  // Provider JSON: follow the dialect it was written in.
  if (node.rawOutboundDialect === 'sing-box') return 'sing-box'
  if (node.rawOutboundDialect === 'xray') return 'xray'

  // xhttp есть только в Xray; плагины Shadowsocks — только в sing-box.
  if (node.network === 'xhttp' && XRAY_PROTOCOLS.has(node.protocol)) return 'xray'
  if (node.protocol === 'shadowsocks' && node.plugin) return 'sing-box'

  // Параметры из ссылки (ECH, закрепление сертификата, finalmask, параметры
  // XHTTP …) есть только у Xray: узел с ними идёт через него, иначе они
  // молча потерялись бы.
  if (XRAY_PROTOCOLS.has(node.protocol) && nodeNeedsXray(node)) return 'xray'

  // URI-parsed node: both cores can carry it, so prefer the simpler path.
  //
  // sing-box alone means no SOCKS bridge, no second process to exclude from
  // the tunnel, and no reconstruction of a transport we might model
  // imperfectly. Xray is worth the extra moving parts only when the user
  // actually asked for something it alone provides — fragmentation or noise
  // packets. Both default to off, so the common case is the simple one.
  // Учитываются и подсказки провайдера для узла: они включают фрагментацию
  // только для его подписки. Без подсказок и параметров в ссылке результат тот
  // же, что был: решает общий переключатель.
  const wantsXrayOnly = settings ? wantsXrayShaping(node, settings) : false
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
          ? 'Hysteria2 обслуживается ядром sing-box'
          : node.protocol === 'wireguard'
          ? 'WireGuard/WARP обслуживается ядром sing-box'
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
        '(фрагментация, шумы и параметры узла только для Xray недоступны до загрузки Xray)'
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

// ---- Цепочка узлов (двойной VPN) --------------------------------------------
//
// Вход → выход: исходящее соединение узла-выхода идёт через узел-вход
// (`detour` в sing-box). Функция выключена, пока в настройках не задан
// `chainEntryNodeId`; весь код ниже вызывается только при заданном значении.

/** Тег исходящего узла-входа в конфиге sing-box. */
export const CHAIN_ENTRY_TAG = 'chain-entry'

export const CHAIN_ONLY_SINGBOX_REASON = 'Цепочка работает только для узлов на ядре sing-box'

export type ChainCore = 'sing-box' | 'xray'
export type ChainVerdict = { ok: true; core?: ChainCore } | { ok: false; reason: string }

const PROTO_NAME: Record<string, string> = {
  vless: 'VLESS',
  vmess: 'VMess',
  trojan: 'Trojan',
  shadowsocks: 'Shadowsocks',
  hysteria2: 'Hysteria2',
  hysteria: 'Hysteria',
  wireguard: 'WireGuard',
  tuic: 'TUIC'
}
const protoName = (p: string): string => PROTO_NAME[p] ?? p

/** Протокол узла как его видит ядро: у конфига провайдера — из самого конфига. */
function chainProto(node: IncyNode): string {
  const raw = node.rawOutbound as { type?: string; protocol?: string } | undefined
  if (raw && node.rawOutboundDialect === 'sing-box' && typeof raw.type === 'string') return raw.type.toLowerCase()
  if (raw && node.rawOutboundDialect === 'xray' && typeof raw.protocol === 'string') return raw.protocol.toLowerCase()
  return node.protocol
}

/** Транспорт конфига Xray поверх UDP (QUIC/KCP) — через первый сервер его не провести надёжно. */
function xrayUdpTransport(node: IncyNode): boolean {
  const raw = node.rawOutbound as { streamSettings?: { network?: string } } | undefined
  const n = String(raw?.streamSettings?.network ?? node.network ?? '').toLowerCase()
  return n === 'kcp' || n === 'mkcp' || n === 'quic'
}

/** Каким ядром собирается узел в цепочке; null — в цепочку не встраивается. */
function chainCoreOf(node: IncyNode, settings?: IncySettings): ChainCore | null {
  if (node.id.startsWith('node-warp-') || node.protocol === 'wireguard' || chainProto(node) === 'wireguard') return null
  if (node.rawOutbound) {
    if (node.rawOutboundDialect === 'sing-box') return (node.rawOutbound as { detour?: unknown }).detour === undefined ? 'sing-box' : null
    if (node.rawOutboundDialect === 'xray') {
      const raw = node.rawOutbound as { streamSettings?: { sockopt?: { dialerProxy?: unknown } }; proxySettings?: unknown }
      return raw.streamSettings?.sockopt?.dialerProxy === undefined && raw.proxySettings === undefined ? 'xray' : null
    }
    return null
  }
  return corePreferenceFor(node, settings) === 'xray' ? 'xray' : 'sing-box'
}

/** Выход: только протоколы поверх TCP — их соединение можно провести через первый сервер. */
const EXIT_TCP = new Set(['vless', 'vmess', 'trojan', 'shadowsocks'])
/** Вход на sing-box: TCP-протоколы и Hysteria2/TUIC (TCP-соединения через них работают). */
const ENTRY_SINGBOX = new Set(['vless', 'vmess', 'trojan', 'shadowsocks', 'hysteria2', 'tuic'])
/** Вход на Xray: всё, что умеет Xray, кроме служебного. */
const ENTRY_XRAY = new Set(['vless', 'vmess', 'trojan', 'shadowsocks', 'hysteria', 'hysteria2', 'socks', 'http'])

/** Может ли узел быть выходом цепочки (без учёта входа). Для списка «Узел-выход». */
export function chainExitEligible(node: IncyNode, settings?: IncySettings): ChainVerdict {
  const who = `«${node.name}»`
  if (node.id.startsWith('node-warp-')) return { ok: false, reason: `${who} — это WARP, его нельзя поставить выходом цепочки` }
  const core = chainCoreOf(node, settings)
  const proto = chainProto(node)
  if (!core) return { ok: false, reason: `${who} не встраивается в цепочку (${protoName(proto)})` }
  if (!EXIT_TCP.has(proto)) {
    return { ok: false, reason: `${who} работает на ${protoName(proto)} (по UDP) — выходом цепочки может быть только VLESS, VMess, Trojan или Shadowsocks` }
  }
  if (core === 'xray' && xrayUdpTransport(node)) return { ok: false, reason: `${who} использует транспорт поверх UDP (KCP/QUIC) — выходом цепочки быть не может` }
  return { ok: true, core }
}

/**
 * Можно ли собрать цепочку «вход → выход» надёжно.
 *
 * Два вида: оба узла на ядре sing-box (выход получает `detour`) или оба на Xray (выход получает
 * `sockopt.dialerProxy`). Смешать нельзя — второй сервер должен подключаться внутри того же ядра.
 * `topology` — раскладка ядер для узла-выхода (null — не известна). Отказ — с понятной причиной.
 */
export function chainEligibility(
  exit: IncyNode | undefined,
  entry: IncyNode | undefined,
  topology: IncyTopology | null,
  settings?: IncySettings
): ChainVerdict {
  if (!entry) return { ok: false, reason: 'Узел-вход не найден в списке серверов' }
  if (!exit) return { ok: false, reason: 'Сначала выберите узел-выход' }
  if (entry.id === exit.id || (entry.server && entry.server === exit.server && entry.port === exit.port)) {
    return { ok: false, reason: 'Узел-вход не может совпадать с узлом-выходом' }
  }
  const e = chainExitEligible(exit, settings)
  if (!e.ok) return e
  const core = e.core as ChainCore
  if (core === 'sing-box' && topology && topology.kind !== 'SINGBOX_ONLY') {
    if (settings && usesXrayOnlyFeatures(settings)) {
      return {
        ok: false,
        reason: 'Включены «Фрагментация» или «Шумы» — с ними выход работает на ядре Xray, а этот вход — на sing-box. Выключите их в настройках INCY или выберите вход того же вида'
      }
    }
    return { ok: false, reason: CHAIN_ONLY_SINGBOX_REASON }
  }
  const who = `«${entry.name}»`
  const entryProto = chainProto(entry)
  if (entry.id.startsWith('node-warp-') || entryProto === 'wireguard') return { ok: false, reason: `${who} — WireGuard/WARP, входом цепочки быть не может` }
  if (core === 'sing-box') {
    if (entry.rawOutbound && entry.rawOutboundDialect !== 'sing-box') {
      return { ok: false, reason: `${who} — конфиг для ядра Xray, а выход работает на sing-box. Выберите вход того же вида или выход-конфиг Xray` }
    }
    if (chainCoreOf(entry, settings) !== 'sing-box') return { ok: false, reason: `${who} использует параметры, которые понимает только ядро Xray, а выход — на sing-box` }
    if (!ENTRY_SINGBOX.has(entryProto)) return { ok: false, reason: `${who} на ${protoName(entryProto)} не может быть входом цепочки` }
    return { ok: true, core }
  }
  // Выход на Xray: вход тоже должен собираться ядром Xray.
  if (entry.rawOutbound && entry.rawOutboundDialect !== 'xray') {
    return { ok: false, reason: `${who} — конфиг для ядра sing-box, а выход работает на Xray. Выберите вход того же вида` }
  }
  if (!entry.rawOutbound && !XRAY_PROTOCOLS.has(entry.protocol)) {
    return { ok: false, reason: `${who} на ${protoName(entryProto)} ядро Xray собрать не может — выберите другой вход` }
  }
  if (entry.rawOutbound && chainCoreOf(entry, settings) !== 'xray') return { ok: false, reason: `${who} уже настроен провайдером на подключение через другой сервер` }
  if (!ENTRY_XRAY.has(entryProto)) return { ok: false, reason: `${who} на ${protoName(entryProto)} не может быть входом цепочки` }
  return { ok: true, core }
}

/**
 * Два готовых исходящих sing-box → пара для цепочки.
 *
 * Выход (тег `proxy`, на него ссылаются все правила) получает
 * `detour: "chain-entry"`; вход переименовывается и сам detour иметь не может.
 */
export function buildChainOutbounds(
  exitOutbound: Record<string, unknown>,
  entryOutbound: Record<string, unknown>
): { ok: true; outbounds: Record<string, unknown>[] } | { ok: false; reason: string } {
  if (!exitOutbound || !entryOutbound) return { ok: false, reason: CHAIN_ONLY_SINGBOX_REASON }
  if (exitOutbound.detour !== undefined || entryOutbound.detour !== undefined) {
    return { ok: false, reason: CHAIN_ONLY_SINGBOX_REASON }
  }
  const exit = { ...exitOutbound, tag: 'proxy', detour: CHAIN_ENTRY_TAG }
  const entry = { ...entryOutbound, tag: CHAIN_ENTRY_TAG }
  return { ok: true, outbounds: [exit, entry] }
}

/** Что произошло с цепочкой в текущей сессии (для интерфейса). */
export interface ChainSessionState {
  entryNodeId: string
  exitNodeId: string
  applied: boolean
  reason?: string
}
let chainSession: ChainSessionState | null = null
export function setChainSession(s: ChainSessionState | null): void {
  chainSession = s
}
export function getChainSession(): ChainSessionState | null {
  return chainSession
}
