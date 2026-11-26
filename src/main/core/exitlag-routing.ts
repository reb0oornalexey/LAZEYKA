/**
 * Правила sing-box для режима ExitLag (VPN только для программ из списка).
 * Чистые функции без Electron: проверяются обычным node-скриптом.
 *
 * Как устроен режим (TUN, rule-set файлы, которые ядро перечитывает само):
 *  - exitlag-vpn    — программы из списка → через VPN, их DNS → remote-dns (через VPN);
 *  - exitlag-direct — всё остальное → напрямую, его DNS → DNS сетевого адаптера
 *    (system-dns), как будто VPN нет.
 * ExitLag выключен на лету — оба набора ничего не ловят, работает полный VPN.
 */

export const EXITLAG_VPN_SET = 'lz-exitlag-vpn'
export const EXITLAG_DIRECT_SET = 'lz-exitlag-direct'

/** Правило, которое не совпадает ни с чем, — пустой rule-set sing-box может не принять. */
export const EXITLAG_NEVER_MATCH = { process_name: ['__lazeyka_no_match__.exe'] }

/**
 * Содержимое двух rule-set файлов.
 *
 * «Всё остальное» в белом списке — по сети, а не по процессу: так туда попадают
 * и пакеты, чей процесс ядро не определило. ICMP (ping) — тоже: с sing-box 1.13
 * ping маршрутизируется, и без `icmp` он у не-игр уходил бы в `route.final` (VPN),
 * где прокси его не передаёт. Старые ядра незнакомое значение просто не сопоставят.
 */
export function exitLagRuleSetRules(opts: {
  perAppProxy: boolean
  whitelist: boolean
  processRegexes: string[]
}): { vpn: Record<string, unknown>[]; direct: Record<string, unknown>[] } {
  const byProcess = opts.processRegexes.length > 0 ? [{ process_path_regex: opts.processRegexes }] : [EXITLAG_NEVER_MATCH]
  if (!opts.perAppProxy) return { vpn: [EXITLAG_NEVER_MATCH], direct: [EXITLAG_NEVER_MATCH] }
  if (opts.whitelist) return { vpn: byProcess, direct: [{ network: ['tcp', 'udp', 'icmp'] }] }
  return { vpn: [EXITLAG_NEVER_MATCH], direct: byProcess }
}

/**
 * Глобальный (рабочий в интернете) IPv6-адрес: не петля, не link-local (fe80::/10),
 * не уникальный локальный (fc00::/7 — сюда же адрес нашего TUN fdfe:dcba:…),
 * не Teredo (2001::/32) и не 6to4 (2002::/16).
 */
export function isGlobalIpv6(addr: string): boolean {
  const a = String(addr ?? '').toLowerCase().split('%')[0]
  if (!a.includes(':')) return false
  if (a === '::1' || a === '::') return false
  const first = parseInt(a.split(':')[0] || '0', 16)
  if (Number.isNaN(first)) return false
  if ((first & 0xffc0) === 0xfe80) return false // link-local
  if ((first & 0xfe00) === 0xfc00) return false // ULA, в т.ч. адрес TUN
  if (first === 0x2002) return false // 6to4
  if (first === 0x2001 && /^2001:0*:/.test(a)) return false // Teredo 2001:0::/32
  if (a.startsWith('::ffff:')) return false
  return (first & 0xe000) === 0x2000 // 2000::/3 — глобальные одноадресные
}

/** У физических адаптеров есть глобальный IPv6 — IPv6 у сайтов без VPN работает. */
export function hasGlobalIpv6(
  ifaces: Record<string, { family: string | number; address: string; internal?: boolean }[] | undefined>
): boolean {
  return Object.values(ifaces).some((list) =>
    (list ?? []).some((x) => (x.family === 'IPv6' || x.family === 6) && !x.internal && isGlobalIpv6(x.address))
  )
}

/**
 * Правила маршрутизации для IPv6, которые раньше были одним «IPv6 → отказ» на всё.
 *
 * `split` = ExitLag в белом списке и у компьютера настоящий IPv6:
 *  - IPv6 программ из списка — отказ (игра сразу уходит на IPv4 через VPN);
 *  - IPv6 остальных — напрямую, как без VPN (иначе у не-игр IPv6-сайты и
 *    сервисы только по IPv6 переставали работать);
 *  - прочий IPv6 (ExitLag выключили на лету → полный VPN) — отказ, как раньше.
 * Без `split` — прежнее единственное правило.
 */
export function exitLagIpv6RouteRules(split: boolean): Record<string, unknown>[] {
  const rejectAll = { ip_version: 6, action: 'reject' }
  if (!split) return [rejectAll]
  return [
    { type: 'logical', mode: 'and', rules: [{ ip_version: 6 }, { rule_set: [EXITLAG_VPN_SET] }], action: 'reject' },
    { type: 'logical', mode: 'and', rules: [{ ip_version: 6 }, { rule_set: [EXITLAG_DIRECT_SET] }], outbound: 'direct' },
    rejectAll
  ]
}

/**
 * DNS-правила ExitLag. Ставятся ДО правил обхода РФ: иначе запросы не-игр к
 * российским доменам уходили бы во встроенный local-dns (публичный 8.8.8.8 и т. п.),
 * а не в DNS адаптера.
 *
 * `v6Split` — см. exitLagIpv6RouteRules: глобальная стратегия DNS тогда не
 * «только IPv4», поэтому AAAA-ответы для программ из списка и для полного VPN
 * гасятся правилом (пустой ответ, ровно как делала стратегия ipv4_only), а не-игры
 * получают настоящие AAAA от DNS адаптера.
 */
export function exitLagDnsRules(opts: { directServer: string; v6Split: boolean }): Record<string, unknown>[] {
  const aaaaFor = (set: string): Record<string, unknown> => ({
    type: 'logical',
    mode: 'and',
    rules: [{ query_type: ['AAAA'] }, { rule_set: [set] }],
    action: 'predefined'
  })
  return [
    ...(opts.v6Split ? [aaaaFor(EXITLAG_VPN_SET)] : []),
    { rule_set: [EXITLAG_VPN_SET], server: 'remote-dns' },
    { rule_set: [EXITLAG_DIRECT_SET], server: opts.directServer },
    ...(opts.v6Split ? [{ query_type: ['AAAA'], action: 'predefined' }] : [])
  ]
}
