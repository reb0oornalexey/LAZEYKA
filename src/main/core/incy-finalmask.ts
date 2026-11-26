/**
 * Фрагментация TLS и шумовые пакеты через `streamSettings.finalmask` Xray.
 *
 * Раньше для этого строился отдельный `freedom`-исходящий с `fragment` /
 * `noises`, а прокси цеплялся к нему через `sockopt.dialerProxy`. В Xray-core
 * 26.x этот путь объявлен устаревшим: маски задаются на самом исходящем:
 *
 *   "streamSettings": { "finalmask": {
 *     "tcp": [ { "type": "fragment", "settings": { "packets": "tlshello", "length": "100-200", "delay": "10-20" } } ],
 *     "udp": [ { "type": "noise",    "settings": { "noise": [ { "rand": "50-100", "delay": "10-16" } ] } } ]
 *   } }
 *
 * Чистые функции без Electron. Приоритет значений: параметры узла из ссылки >
 * подсказки провайдера (если пользователь их не отключил) > общие настройки.
 */

import type { IncyNode, IncySettings } from './incy-engine'
import { sanitizeFragmentPackets, sanitizeRange } from './incy-links'

export interface FragmentShape {
  packets: string
  length: string
  interval: string
}

export interface NoiseShape {
  type: 'rand' | 'str' | 'hex'
  packet: string
  delay: string
}

export type ShapeSource = 'link' | 'provider' | 'user'

export interface ResolvedFragment {
  shape: FragmentShape
  source: ShapeSource
}

export interface ResolvedNoise {
  shape: NoiseShape
  source: ShapeSource
}

/** Значения по умолчанию совпадают с прежними у отдельного freedom-исходящего. */
const DEFAULT_FRAGMENT: FragmentShape = { packets: 'tlshello', length: '50-100', interval: '10-20' }

function userFragmentShape(s: IncySettings): FragmentShape {
  return {
    packets: sanitizeFragmentPackets(s.fragmentationPackets) ?? DEFAULT_FRAGMENT.packets,
    length: sanitizeRange(s.fragmentationLength) ?? DEFAULT_FRAGMENT.length,
    interval: sanitizeRange(s.fragmentationInterval) ?? DEFAULT_FRAGMENT.interval
  }
}

function userNoiseShape(s: IncySettings): NoiseShape {
  const type = s.noisesType === 'str' || s.noisesType === 'hex' ? s.noisesType : 'rand'
  const raw = (s.noisesPacket ?? '').trim()
  const packet = type === 'rand' ? sanitizeRange(raw) ?? '50-100' : raw || '50-100'
  return { type, packet, delay: sanitizeRange(s.noisesDelay) ?? '10-16' }
}

/**
 * Какая фрагментация действует для узла (null — никакой).
 *
 * Параметры из ссылки применяются всегда, даже если общий переключатель
 * выключен, — но только при TLS / Reality: на открытом TCP фрагментировать
 * нечего. Подсказка провайдера «выключить» пользовательскую настройку не
 * отменяет: провайдер вправе предлагать, а не запрещать.
 */
export function resolveFragment(node: IncyNode, settings: IncySettings): ResolvedFragment | null {
  const base = userFragmentShape(settings)
  const tlsLike = node.security === 'tls' || node.security === 'reality'

  if (node.fragment && tlsLike) {
    return {
      source: 'link',
      shape: {
        packets: sanitizeFragmentPackets(node.fragment.packets) ?? base.packets,
        length: sanitizeRange(node.fragment.length) ?? base.length,
        interval: sanitizeRange(node.fragment.interval) ?? base.interval
      }
    }
  }

  const hint = settings.ignoreProviderSettings ? undefined : node.providerHints?.fragment
  if (hint?.enabled) {
    return {
      source: 'provider',
      shape: {
        packets: sanitizeFragmentPackets(hint.packets) ?? base.packets,
        length: sanitizeRange(hint.length) ?? base.length,
        interval: sanitizeRange(hint.interval) ?? base.interval
      }
    }
  }

  return settings.fragmentation ? { source: 'user', shape: base } : null
}

/** Какие шумовые пакеты действуют для узла (null — никаких). */
export function resolveNoise(node: IncyNode, settings: IncySettings): ResolvedNoise | null {
  const base = userNoiseShape(settings)
  const hint = settings.ignoreProviderSettings ? undefined : node.providerHints?.noises
  if (hint?.enabled) {
    const type = hint.type ?? 'rand'
    const packet = hint.packet ?? (type === base.type ? base.packet : type === 'rand' ? '50-100' : '')
    // Для str/hex без данных шум бессмыслен — падаем на общие настройки.
    if (type === 'rand' || packet) {
      return {
        source: 'provider',
        shape: { type, packet: packet || '50-100', delay: sanitizeRange(hint.delay) ?? base.delay }
      }
    }
  }
  return settings.noises ? { source: 'user', shape: base } : null
}

/**
 * Нужен ли узлу Xray из-за фрагментации или шумов: общий переключатель,
 * параметры в ссылке или включённая провайдером подсказка.
 */
export function wantsXrayShaping(node: IncyNode, settings: IncySettings): boolean {
  return resolveFragment(node, settings) !== null || resolveNoise(node, settings) !== null
}

export function buildFragmentMask(shape: FragmentShape): Record<string, unknown> {
  return {
    type: 'fragment',
    settings: { packets: shape.packets, length: shape.length, delay: shape.interval }
  }
}

export function buildNoiseMask(shape: NoiseShape): Record<string, unknown> {
  // rand — диапазон длины случайных байт; str/hex — готовые данные.
  const item: Record<string, unknown> =
    shape.type === 'rand'
      ? { rand: shape.packet, delay: shape.delay }
      : { type: shape.type, packet: shape.packet, delay: shape.delay }
  return { type: 'noise', settings: { noise: [item] } }
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function hasType(list: unknown[], type: string): boolean {
  return list.some((m) => isObj(m) && m.type === type)
}

/**
 * Добавить наши маски в `streamSettings.finalmask` исходящего Xray.
 *
 *  - fragment ставится ПЕРВОЙ в `tcp`, если там нет своей fragment;
 *  - noise добавляется в КОНЕЦ `udp`, если там нет своей noise;
 *  - чужие маски (header-custom, sudoku, salamander…) остаются как есть;
 *  - `sockopt.dialerProxy`, заданный провайдером, не трогается.
 *
 * `allowTcp` выключает TCP-фрагментацию для QUIC-исходящих (Hysteria): там
 * нечего фрагментировать.
 */
export function applyFinalmask(
  outbound: Record<string, unknown>,
  shaping: { fragment: FragmentShape | null; noise: NoiseShape | null },
  opts: { allowTcp?: boolean } = {}
): void {
  const addFragment = shaping.fragment !== null && opts.allowTcp !== false
  const addNoise = shaping.noise !== null
  if (!addFragment && !addNoise) return

  const stream: Record<string, unknown> = isObj(outbound.streamSettings) ? outbound.streamSettings : {}
  const fm: Record<string, unknown> = isObj(stream.finalmask) ? { ...stream.finalmask } : {}

  if (addFragment && shaping.fragment) {
    const tcp = Array.isArray(fm.tcp) ? (fm.tcp as unknown[]) : []
    if (!hasType(tcp, 'fragment')) fm.tcp = [buildFragmentMask(shaping.fragment), ...tcp]
  }
  if (addNoise && shaping.noise) {
    const udp = Array.isArray(fm.udp) ? (fm.udp as unknown[]) : []
    if (!hasType(udp, 'noise')) fm.udp = [...udp, buildNoiseMask(shaping.noise)]
  }

  stream.finalmask = fm
  outbound.streamSettings = stream
}

/** Строка для лога: что именно и откуда применено к узлу. */
export function describeShaping(fragment: ResolvedFragment | null, noise: ResolvedNoise | null): string {
  const src = (s: ShapeSource): string => (s === 'link' ? 'из ссылки узла' : s === 'provider' ? 'от провайдера' : 'из настроек')
  const parts: string[] = []
  if (fragment) {
    const f = fragment.shape
    parts.push(`фрагментация ${f.packets} ${f.length} / ${f.interval} мс (${src(fragment.source)})`)
  }
  if (noise) parts.push(`шум ${noise.shape.type} ${noise.shape.packet} (${src(noise.source)})`)
  return parts.join('; ')
}
