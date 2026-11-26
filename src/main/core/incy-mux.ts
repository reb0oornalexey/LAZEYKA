/**
 * Когда мультиплексирование (MUX / h2mux) к узлу применять нельзя.
 *
 * Чистые функции без Electron. Причина жалоб «включил Фрагментацию, Noises и
 * Мультиплексирование — интернет пропал»: у узла VLESS + Reality с `flow:
 * xtls-rprx-vision` Xray не поднимает соединение, если на исходящем включён
 * `mux` (Vision и MUX взаимоисключающие), а sing-box отвергает такой конфиг при
 * запуске. Для узлов из ссылки это уже учитывалось, а исходящее, присланное
 * провайдером JSON-подпиской, получало `mux` безусловно.
 */

/** Протоколы, у которых MUX вообще бывает (Hysteria2, TUIC, WireGuard — нет). */
const MUX_PROTOCOLS: ReadonlySet<string> = new Set(['vless', 'vmess', 'trojan', 'shadowsocks'])

export interface MuxSubject {
  /** `vless`, `vmess`… — как у узла LAZEYKA, у Xray (`protocol`) или sing-box (`type`). */
  protocol?: string
  /** Значение flow (`xtls-rprx-vision`), пусто — нет. */
  flow?: string
  /** Транспорт: tcp, ws, grpc, xhttp… */
  network?: string
}

/**
 * Причина, по которой MUX не включается; null — можно. Текст пригоден для
 * журнала и подсказки: простым языком, без англицизмов, где есть русское слово.
 */
export function muxSkipReason(s: MuxSubject): string | null {
  const protocol = String(s.protocol ?? '').toLowerCase()
  if (protocol && !MUX_PROTOCOLS.has(protocol)) {
    return `протокол ${protocol} не использует мультиплексирование`
  }
  const flow = String(s.flow ?? '').trim()
  if (flow) {
    return `узел использует flow ${flow}: он несовместим с мультиплексированием, соединение не поднялось бы`
  }
  if (String(s.network ?? '').toLowerCase() === 'xhttp') {
    return 'XHTTP мультиплексирует соединения сам'
  }
  return null
}

function asObj(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

/** flow в исходящем Xray: `settings.vnext[].users[].flow` или `settings.flow`. */
export function xrayOutboundFlow(outbound: unknown): string {
  const o = asObj(outbound)
  const settings = asObj(o?.settings)
  if (!settings) return ''
  if (typeof settings.flow === 'string' && settings.flow) return settings.flow
  const vnext = Array.isArray(settings.vnext) ? settings.vnext : []
  for (const server of vnext) {
    const users = Array.isArray(asObj(server)?.users) ? (asObj(server)?.users as unknown[]) : []
    for (const user of users) {
      const flow = asObj(user)?.flow
      if (typeof flow === 'string' && flow) return flow
    }
  }
  return ''
}

/** Данные исходящего Xray, нужные для решения о MUX. */
export function xrayOutboundSubject(outbound: unknown): MuxSubject {
  const o = asObj(outbound)
  return {
    protocol: typeof o?.protocol === 'string' ? o.protocol : undefined,
    flow: xrayOutboundFlow(outbound),
    network: typeof asObj(o?.streamSettings)?.network === 'string' ? (asObj(o?.streamSettings)?.network as string) : undefined
  }
}

/** Данные исходящего sing-box (`type`, `flow`, `transport.type`). */
export function singBoxOutboundSubject(outbound: unknown): MuxSubject {
  const o = asObj(outbound)
  return {
    protocol: typeof o?.type === 'string' ? o.type : undefined,
    flow: typeof o?.flow === 'string' ? o.flow : undefined,
    network: typeof asObj(o?.transport)?.type === 'string' ? (asObj(o?.transport)?.type as string) : undefined
  }
}
