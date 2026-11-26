/**
 * Конфиг блокировки Kill Switch из конфига упавшей сессии sing-box.
 * Чистая функция без Electron: проверяется обычным node-скриптом.
 */

/**
 * Конфиг «блокировки» из конфига упавшей сессии: всё, что шло через VPN,
 * отклоняется; всё, что шло напрямую (обход РФ, локальная сеть, свои
 * исключения, процессы ядер), продолжает работать. Тот же TUN / тот же порт
 * системного прокси — поэтому трафик не утекает мимо VPN, пока тот лежит.
 *
 * Что пропускает блокировка (и почему это не утечка):
 *  - адрес VPN-сервера: правила `ip_cidr` / `domain` узла и `process_name`
 *    xray / sing-box остались «напрямую» — временное ядро проверки узла и
 *    следующее подключение доходят до сервера, даже если его IP сменился;
 *  - локальная сеть: правило `ip_is_private`, а также loopback (127.0.0.0/8 и
 *    ::1 добавлены явно);
 *  - российские сайты и свои исключения — как и до обрыва, напрямую.
 * Остальное отклоняется. DNS-запросы, пришедшие от приложений и не попавшие под
 * правила «напрямую», тоже отклоняются (`strictDns`): иначе имена сайтов, которые
 * шли бы через VPN, утекали бы открытым запросом к локальному DNS.
 */
export function buildKillSwitchConfig(cfg: any, opts: { strictDns?: boolean } = {}): any {
  const strictDns = opts.strictDns !== false
  const c = JSON.parse(JSON.stringify(cfg))
  const keptOutbounds = new Set<string>()
  c.outbounds = (c.outbounds ?? []).filter((o: any) => {
    const keep = o?.type === 'direct' || o?.type === 'dns'
    if (keep && o.tag) keptOutbounds.add(o.tag)
    return keep
  })
  if (!keptOutbounds.has('direct')) {
    c.outbounds.push({ type: 'direct', tag: 'direct' })
    keptOutbounds.add('direct')
  }
  delete c.endpoints
  if (c.experimental) delete c.experimental.clash_api
  const inboundTags = (c.inbounds ?? []).map((i: any) => i.tag).filter(Boolean)

  const route = (c.route ??= {})
  route.rules = (route.rules ?? []).map((r: any) => {
    if (r && typeof r.outbound === 'string' && !keptOutbounds.has(r.outbound)) {
      const { outbound: _drop, ...rest } = r
      void _drop
      return { ...rest, action: 'reject' }
    }
    return r
  })
  // Loopback — всегда напрямую (на случай, если до него дойдёт запрос через TUN).
  route.rules.unshift({ ip_cidr: ['127.0.0.0/8', '::1/128'], outbound: 'direct' })
  // Раньше основной поток шёл через VPN (final = прокси)? Тогда закрываем всё остальное.
  const finalWasVpn = !keptOutbounds.has(route.final ?? 'direct')
  if (finalWasVpn) {
    // Всё, что не попало в правила «напрямую», раньше шло в VPN — закрываем.
    route.rules.push({ inbound: inboundTags, action: 'reject' })
    route.final = 'direct'
  }

  // DNS-серверы, ходившие через VPN, недоступны: убираем их, а правила,
  // которые на них указывали, — отклоняют запрос.
  const dnsCfg = c.dns
  if (dnsCfg && Array.isArray(dnsCfg.servers)) {
    const removed = new Set<string>()
    dnsCfg.servers = dnsCfg.servers.filter((sv: any) => {
      const detour = sv?.detour
      const drop = typeof detour === 'string' && !keptOutbounds.has(detour)
      if (drop && sv.tag) removed.add(sv.tag)
      return !drop
    })
    if (Array.isArray(dnsCfg.rules)) {
      dnsCfg.rules = dnsCfg.rules.map((r: any) => {
        if (r && typeof r.server === 'string' && removed.has(r.server)) {
          const { server: _s, ...rest } = r
          void _s
          return { ...rest, action: 'reject' }
        }
        return r
      })
    }
    if (typeof dnsCfg.final === 'string' && removed.has(dnsCfg.final)) {
      dnsCfg.final = dnsCfg.servers[0]?.tag
    }
    // Остальные запросы приложений (не обход РФ, не адрес сервера) — отказ.
    // Правило `action` в DNS появилось в sing-box 1.11: в старой схеме
    // серверов (`address` вместо `type`) его не добавляем.
    const modern = dnsCfg.servers.length > 0 && dnsCfg.servers.every((sv: any) => typeof sv?.type === 'string')
    if (strictDns && modern && finalWasVpn && inboundTags.length > 0) {
      // Домены, которые маршрутизация и так отправляет напрямую (свои правила
      // «напрямую»), по-прежнему резолвятся прямым DNS-сервером.
      const localTag: string =
        dnsCfg.servers.find((sv: any) => sv?.tag === 'local-dns')?.tag ?? dnsCfg.servers[0]?.tag
      const directDomainRules: any[] = []
      for (const r of route.rules as any[]) {
        if (r?.outbound !== 'direct') continue
        const match: Record<string, unknown> = {}
        for (const key of ['domain', 'domain_suffix', 'domain_keyword', 'domain_regex']) {
          if (Array.isArray(r[key]) && r[key].length > 0) match[key] = r[key]
        }
        if (Object.keys(match).length > 0 && localTag) directDomainRules.push({ ...match, server: localTag })
      }
      dnsCfg.rules = [
        ...(Array.isArray(dnsCfg.rules) ? dnsCfg.rules : []),
        ...directDomainRules,
        { inbound: inboundTags, action: 'reject' }
      ]
    }
  }
  return c
}
