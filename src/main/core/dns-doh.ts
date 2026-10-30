import http2 from 'node:http2'
import net from 'node:net'
import dgram from 'node:dgram'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { dataDir } from '../utils/dirs'
import {
  isMacBackup,
  readMacDnsState,
  snapshotMacDns,
  writeMacDns,
  type MacDnsBackup
} from './dns-mac'

const execFileAsync = promisify(execFile)


export interface DohProvider {
  id: string
  name: string
  /** Шаблон DoH (`https://…/dns-query`). Пусто — обычный DNS без шифрования. */
  url: string
  ip: string
  secondaryIp?: string
  /** IPv6-адреса (основной, второй) — ставятся вместе с IPv4, если на адаптере включён IPv6. */
  ipv6?: string[]
  description: string
  latencyMs: number | null
  /**
   * Только шифрованно, без возврата к открытому тексту (AllowFallbackToUdp
   * = false + флаг адаптера DohFlags = 1) — так требует, например, dns-ai.ru.
   */
  strict?: boolean
  /** Добавлен пользователем в настройках. */
  custom?: boolean
  /** Страница сервиса — ссылка «подробнее». */
  site?: string
  /** Страница с профилем конфигурации macOS для шифрованного DNS (DoH/DoT). */
  macProfile?: string
}

/** Репозиторий с подписанными профилями DoH/DoT для macOS и iOS (Cloudflare, Google, Quad9, AdGuard). */
const MAC_PROFILES_URL = 'https://github.com/paulmillr/encrypted-dns'

export const DOH_PROVIDERS: DohProvider[] = [
  {
    id: 'dns-ai',
    name: 'DNS-AI (dns-ai.ru)',
    url: 'https://dns.dns-ai.ru/dns-query',
    // Актуальные адреса берутся из endpoints.json сервиса (см. refreshDnsAi),
    // здесь — встроенная пара на случай, если список недоступен.
    ip: '192.144.59.14',
    secondaryIp: '186.246.49.127',
    ipv6: ['2a0d:8480:0:67c::14', '2a0a:2b41:0:500d::53'],
    description: 'Открывает зарубежные нейросети и AI-сервисы, режет рекламу и трекеры, без журнала запросов. IPv4 + IPv6, только шифрованный DoH',
    latencyMs: null,
    strict: true,
    site: 'https://dns-ai.ru/#setup'
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare 1.1.1.1',
    url: 'https://cloudflare-dns.com/dns-query',
    ip: '1.1.1.1',
    secondaryIp: '1.0.0.1',
    description: 'Самый быстрый и конфиденциальный DNS',
    latencyMs: null,
    macProfile: MAC_PROFILES_URL
  },
  {
    id: 'google',
    name: 'Google 8.8.8.8',
    url: 'https://dns.google/dns-query',
    ip: '8.8.8.8',
    secondaryIp: '8.8.4.4',
    description: 'Максимальная стабильность и глобальное покрытие',
    latencyMs: null,
    macProfile: MAC_PROFILES_URL
  },
  {
    id: 'adguard',
    name: 'AdGuard DNS',
    url: 'https://dns.adguard-dns.com/dns-query',
    ip: '94.140.14.14',
    secondaryIp: '94.140.15.15',
    description: 'Блокировка рекламы, трекеров и фишинга на уровне DNS',
    latencyMs: null,
    macProfile: MAC_PROFILES_URL
  },
  {
    id: 'quad9',
    name: 'Quad9 9.9.9.9',
    url: 'https://dns.quad9.net/dns-query',
    ip: '9.9.9.9',
    secondaryIp: '149.112.112.112',
    description: 'Безопасность и защита от вредоносных доменов',
    latencyMs: null,
    macProfile: MAC_PROFILES_URL
  },
  {
    id: 'xbox-dns',
    name: 'Xbox DNS (xbox-dns.ru)',
    url: 'https://xbox-dns.ru/dns-query',
    // Адреса обновлены по xbox-dns.ru (старые .50/.51 больше не указаны).
    ip: '111.88.96.54',
    secondaryIp: '111.88.96.55',
    description: 'Обход ограничений Xbox Live / Microsoft и ускорение отклика',
    latencyMs: null
  }
]

/** DNS-запрос youtube.com A в формате RFC 8484 (base64url, без «=»). */
function dnsWireQuery(name: string): string {
  const header = Buffer.from([0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0])
  const labels = Buffer.concat(
    name.split('.').map((p) => Buffer.concat([Buffer.from([p.length]), Buffer.from(p, 'ascii')]))
  )
  const q = Buffer.concat([header, labels, Buffer.from([0, 0, 1, 0, 1])])
  return q.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Задержка DoH-сервера.
 *
 * Раньше запрос шёл в JSON-формате (`?name=…`) по HTTP/1.1. Google и AdGuard
 * такой формат не принимают (400), Quad9 не работает по HTTP/1.1 (505), и в
 * настройках у трёх из пяти серверов пинга не было вовсе, а Xbox DNS отвечал
 * HTML-страницей и считался рабочим. Теперь — стандартный DNS-запрос
 * (RFC 8484) по HTTP/2, как делает сама Windows. Время — второго запроса по
 * уже открытому соединению, без рукопожатия TLS: это и есть задержка DNS.
 */
export async function pingDohProvider(provider: DohProvider): Promise<number | null> {
  let url: URL
  try {
    url = new URL(provider.url)
  } catch {
    return null
  }
  const path = `${url.pathname}?dns=${dnsWireQuery('youtube.com')}`
  return new Promise((resolve) => {
    let done = false
    const session = http2.connect(url.origin)
    const finish = (v: number | null): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      try {
        session.close()
        session.destroy()
      } catch { /* noop */ }
      resolve(v)
    }
    const timer = setTimeout(() => finish(null), 4000)
    session.on('error', () => finish(null))
    const ask = (): Promise<number | null> =>
      new Promise((res) => {
        const t0 = Date.now()
        const req = session.request({
          ':path': path,
          accept: 'application/dns-message',
          'user-agent': 'LAZEYKA-DNS'
        })
        let ok = false
        req.on('response', (h) => {
          ok = Number(h[':status']) === 200 && String(h['content-type'] ?? '').includes('dns-message')
        })
        req.on('data', () => void 0)
        req.on('end', () => res(ok ? Date.now() - t0 : null))
        req.on('error', () => res(null))
        req.end()
      })
    void (async () => {
      const first = await ask()
      if (first == null) return finish(null)
      const second = await ask()
      finish(Math.max(1, second ?? first))
    })()
  })
}

// ---- DNS-AI: актуальные адреса ------------------------------------------------
//
// Сервис меняет адреса и публикует их в endpoints.json (тот же список читает
// его официальный скрипт setup.ps1). Берём оттуда, со встроенной парой как
// запасным вариантом. Устаревшие адреса («retired») тоже запоминаем, чтобы
// при смене/сбросе убрать их флаги DoH с адаптера.
const DNS_AI_MANIFESTS = [
  'https://raw.githubusercontent.com/confeden/DNS-AI/main/endpoints.json',
  'https://dns-ai.ru/endpoints.json'
]
let dnsAiCache: { at: number; v4: string[]; v6: string[]; retired: string[] } | null = null

async function refreshDnsAi(): Promise<{ v4: string[]; v6: string[]; retired: string[] } | null> {
  if (dnsAiCache && Date.now() - dnsAiCache.at < 6 * 60 * 60 * 1000) return dnsAiCache
  for (const url of DNS_AI_MANIFESTS) {
    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), 8000)
      const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'LAZEYKA-DNS' } })
      clearTimeout(t)
      if (!res.ok) continue
      const j = (await res.json()) as { v4?: string[]; v6?: string[]; retired?: string[] }
      const v4 = (j.v4 ?? []).filter((a) => net.isIPv4(a)).slice(0, 2)
      if (v4.length === 0) continue
      const v6 = (j.v6 ?? []).filter((a) => net.isIPv6(a)).slice(0, 2)
      dnsAiCache = { at: Date.now(), v4, v6, retired: (j.retired ?? []).filter((a) => net.isIP(a)) }
      return dnsAiCache
    } catch {
      /* следующий источник */
    }
  }
  return null
}

// ---- свои DNS-серверы пользователя ----------------------------------------------

export interface CustomDnsInput {
  name: string
  ipv4: string[]
  ipv6?: string[]
  /** Шаблон DoH; пусто — без шифрования. */
  doh?: string
  /** Разрешить возврат к обычному DNS, если DoH не ответил. */
  allowFallback?: boolean
}

function customDnsFile(): string {
  return path.join(dataDir(), 'custom-dns.json')
}

function loadCustomProviders(): DohProvider[] {
  try {
    if (!existsSync(customDnsFile())) return []
    const raw = JSON.parse(readFileSync(customDnsFile(), 'utf-8')) as DohProvider[]
    return Array.isArray(raw) ? raw.filter((p) => p && p.id && net.isIP(p.ip)).map((p) => ({ ...p, custom: true, latencyMs: null })) : []
  } catch {
    return []
  }
}

function saveCustomProviders(list: DohProvider[]): void {
  mkdirSync(path.dirname(customDnsFile()), { recursive: true })
  writeFileSync(customDnsFile(), JSON.stringify(list.map((p) => ({ ...p, latencyMs: null })), null, 2), 'utf-8')
}

function normalizeTemplate(raw?: string): string {
  const v = String(raw ?? '').trim()
  if (!v) return ''
  let u: URL
  try {
    u = new URL(v)
  } catch {
    throw new Error('Шаблон DoH должен быть ссылкой вида https://dns.example.com/dns-query')
  }
  if (u.protocol !== 'https:') throw new Error('Шаблон DoH должен начинаться с https://')
  return u.toString()
}

export function addCustomDnsProvider(input: CustomDnsInput): DohProvider[] {
  const name = String(input.name ?? '').trim().slice(0, 60)
  if (!name) throw new Error('Укажите название сервера')
  const v4 = (input.ipv4 ?? []).map((a) => a.trim()).filter(Boolean)
  const v6 = (input.ipv6 ?? []).map((a) => a.trim()).filter(Boolean)
  if (v4.length === 0) throw new Error('Нужен хотя бы один IPv4-адрес')
  for (const a of v4) if (!net.isIPv4(a)) throw new Error(`«${a}» — не IPv4-адрес`)
  for (const a of v6) if (!net.isIPv6(a)) throw new Error(`«${a}» — не IPv6-адрес`)
  const url = normalizeTemplate(input.doh)
  const list = loadCustomProviders()
  const provider: DohProvider = {
    id: `custom-${Date.now().toString(36)}`,
    name,
    url,
    ip: v4[0],
    secondaryIp: v4[1],
    ipv6: v6.slice(0, 2),
    description: [
      [...v4.slice(0, 2), ...v6.slice(0, 2)].join(', '),
      url ? (input.allowFallback ? 'DoH, с запасным обычным DNS' : 'только DoH') : 'без шифрования'
    ].join(' · '),
    latencyMs: null,
    strict: Boolean(url) && !input.allowFallback,
    custom: true
  }
  saveCustomProviders([...list, provider])
  return loadCustomProviders()
}

export function removeCustomDnsProvider(id: string): DohProvider[] {
  saveCustomProviders(loadCustomProviders().filter((p) => p.id !== id))
  return loadCustomProviders()
}

export async function allProviders(): Promise<DohProvider[]> {
  const fresh = await refreshDnsAi().catch(() => null)
  const builtins = DOH_PROVIDERS.map((p) =>
    p.id === 'dns-ai' && fresh
      ? { ...p, ip: fresh.v4[0], secondaryIp: fresh.v4[1], ipv6: fresh.v6.length ? fresh.v6 : p.ipv6 }
      : p
  )
  return [...builtins, ...loadCustomProviders()]
}

/** Обычный DNS-запрос по UDP — для своих серверов без DoH. */
function pingUdpDns(ip: string): Promise<number | null> {
  return new Promise((resolve) => {
    const sock = dgram.createSocket(net.isIPv6(ip) ? 'udp6' : 'udp4')
    const q = Buffer.from(dnsWireQuery('youtube.com').replace(/-/g, '+').replace(/_/g, '/'), 'base64')
    q.writeUInt16BE(0x1d2c, 0)
    let t0 = 0
    const done = (v: number | null): void => {
      clearTimeout(timer)
      try { sock.close() } catch { /* noop */ }
      resolve(v)
    }
    const timer = setTimeout(() => done(null), 3000)
    sock.once('message', () => done(Math.max(1, Date.now() - t0)))
    sock.once('error', () => done(null))
    t0 = Date.now()
    sock.send(q, 53, ip, (e) => e && done(null))
  })
}

export async function getDohProvidersWithPing(): Promise<DohProvider[]> {
  const list = await allProviders()
  return Promise.all(
    list.map(async (p) => ({ ...p, latencyMs: p.url ? await pingDohProvider(p) : await pingUdpDns(p.ip) }))
  )
}

/**
 * PowerShell-скрипт смены DNS — тот же порядок, что у официального скрипта
 * DNS-AI (setup.ps1) и в инструкции dns-ai.ru для Windows 11:
 *
 *  1. каждому адресу (IPv4 и IPv6) — свой шаблон DoH
 *     (Add/Set-DnsClientDohServerAddress, AutoUpgrade, AllowFallbackToUdp);
 *  2. на адаптере — IPv4, и IPv6, если протокол на нём включён;
 *  3. «только шифрованно» — флаг адаптера DohFlags = 1 для каждого адреса
 *     (Dnscache\InterfaceSpecificParameters\{GUID}\DohInterfaceSettings\
 *     Doh|Doh6\<IP>), после чего список DNS записывается ещё раз, чтобы
 *     служба DNS перечитала флаг;
 *  4. сброс DNS-кэша.
 *
 * Меняются только физические адаптеры, через которые идёт интернет, без VPN
 * и виртуальных (Hyper-V, WSL, Wintun…). Прежние адреса (IPv4 и IPv6)
 * запоминаются и возвращаются при сбросе; наши флаги DoH при этом убираются.
 */
const PS_DNS = String.raw`param([string]$Mode, [string]$ArgsFile)
$ErrorActionPreference = 'Stop'
$cfg = Get-Content -Raw -LiteralPath $ArgsFile | ConvertFrom-Json
$DohKey = 'HKLM:\SYSTEM\CurrentControlSet\Services\Dnscache\InterfaceSpecificParameters'
$skip = 'Wintun|WireGuard|TAP-|sing-box|Hyper-V|vEthernet|VMware|VirtualBox|WSL|Tailscale|ZeroTier|Amnezia|OpenVPN|Loopback|Virtual'
$route = @(Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty InterfaceIndex -Unique)
$phys = @(Get-NetAdapter | Where-Object { $_.Status -eq 'Up' -and -not $_.Virtual -and $_.Name -notmatch $skip -and $_.InterfaceDescription -notmatch $skip })
$ad = @($phys | Where-Object { $route -contains $_.InterfaceIndex })
if ($ad.Count -eq 0) { $ad = $phys }
if ($ad.Count -eq 0) { $ad = @(Get-NetAdapter -Physical | Where-Object { $_.Status -eq 'Up' }) }
function Get-StaticDns($a, $stack) {
  $p = "HKLM:\SYSTEM\CurrentControlSet\Services\$stack\Parameters\Interfaces\$($a.InterfaceGuid)"
  $ns = (Get-ItemProperty -LiteralPath $p -Name NameServer -ErrorAction SilentlyContinue).NameServer
  if ($ns) { return @($ns -split '[ ,]+' | Where-Object { $_ }) }
  return @()
}
function Has-V6($a) {
  $b = Get-NetAdapterBinding -Name $a.Name -ComponentID ms_tcpip6 -ErrorAction SilentlyContinue
  return [bool]($b -and $b.Enabled)
}
function Clear-OurFlags($a, $keep) {
  foreach ($fam in 'Doh', 'Doh6') {
    $k = Join-Path $DohKey ("{0}\DohInterfaceSettings\{1}" -f $a.InterfaceGuid, $fam)
    foreach ($ip in @($cfg.ours)) {
      if ($keep -contains $ip) { continue }
      $ik = Join-Path $k $ip
      if (Test-Path -LiteralPath $ik) { Remove-Item -LiteralPath $ik -Recurse -Force -ErrorAction SilentlyContinue }
    }
  }
}
$before = @{}
foreach ($a in $ad) { $before[[string]$a.InterfaceIndex] = [pscustomobject]@{ v4 = @(Get-StaticDns $a 'Tcpip'); v6 = @(Get-StaticDns $a 'Tcpip6') } }
$hasDoh = [bool](Get-Command Add-DnsClientDohServerAddress -ErrorAction SilentlyContinue)
$v6used = $false
if ($Mode -eq 'set') {
  $v4 = @($cfg.v4 | Where-Object { $_ })
  $v6 = @($cfg.v6 | Where-Object { $_ })
  $fallback = [bool]$cfg.fallback
  if ($cfg.doh -and $hasDoh) {
    foreach ($ip in $v4 + $v6) {
      if (Get-DnsClientDohServerAddress -ServerAddress $ip -ErrorAction SilentlyContinue) {
        Set-DnsClientDohServerAddress -ServerAddress $ip -DohTemplate $cfg.doh -AllowFallbackToUdp $fallback -AutoUpgrade $true | Out-Null
      } else {
        Add-DnsClientDohServerAddress -ServerAddress $ip -DohTemplate $cfg.doh -AllowFallbackToUdp $fallback -AutoUpgrade $true | Out-Null
      }
    }
  }
  foreach ($a in $ad) {
    $useV6 = ($v6.Count -gt 0) -and (Has-V6 $a)
    if ($useV6) { $v6used = $true }
    $servers = if ($useV6) { @($v4 + $v6) } else { @($v4) }
    Set-DnsClientServerAddress -InterfaceIndex $a.InterfaceIndex -ServerAddresses $servers
    $keep = @()
    if ($cfg.doh -and $hasDoh -and -not $fallback) {
      $sets = @(@{ Fam = 'Doh'; Ips = $v4 })
      if ($useV6) { $sets += @{ Fam = 'Doh6'; Ips = $v6 } }
      foreach ($s in $sets) {
        $k = Join-Path $DohKey ("{0}\DohInterfaceSettings\{1}" -f $a.InterfaceGuid, $s.Fam)
        foreach ($ip in $s.Ips) {
          $ik = Join-Path $k $ip
          if (-not (Test-Path -LiteralPath $ik)) { New-Item -Path $ik -Force | Out-Null }
          New-ItemProperty -Path $ik -Name 'DohFlags' -PropertyType QWord -Value 1 -Force | Out-Null
          $keep += $ip
        }
      }
    }
    Clear-OurFlags $a $keep
    Set-DnsClientServerAddress -InterfaceIndex $a.InterfaceIndex -ServerAddresses $servers
  }
} elseif ($Mode -eq 'reset') {
  $restore = $cfg.restore
  foreach ($a in $ad) {
    $k = [string]$a.InterfaceIndex
    $s4 = @(); $s6 = @()
    if ($restore -and ($restore.PSObject.Properties.Name -contains $k)) {
      $r = $restore.$k
      if ($r -is [System.Array] -or $r -is [string]) { $s4 = @($r) }
      else { $s4 = @($r.v4); $s6 = @($r.v6) }
    }
    $s4 = @($s4 | Where-Object { $_ }); $s6 = @($s6 | Where-Object { $_ })
    Clear-OurFlags $a @()
    if (($s4.Count + $s6.Count) -gt 0) { Set-DnsClientServerAddress -InterfaceIndex $a.InterfaceIndex -ServerAddresses @($s4 + $s6) }
    else { Set-DnsClientServerAddress -InterfaceIndex $a.InterfaceIndex -ResetServerAddresses }
  }
}
if ($Mode -ne 'read') { Clear-DnsClientCache -ErrorAction SilentlyContinue }
$now = @{}
foreach ($a in $ad) {
  $now[[string]$a.InterfaceIndex] = @((Get-DnsClientServerAddress -InterfaceIndex $a.InterfaceIndex -AddressFamily IPv4).ServerAddresses) + @((Get-DnsClientServerAddress -InterfaceIndex $a.InterfaceIndex -AddressFamily IPv6).ServerAddresses)
}
[pscustomobject]@{ before = $before; now = $now; doh = $hasDoh; v6 = $v6used; count = $ad.Count } | ConvertTo-Json -Depth 5 -Compress
`

interface PsDnsResult {
  before: Record<string, { v4: string[]; v6: string[] }>
  now: Record<string, string[]>
  doh: boolean
  v6: boolean
  count: number
}

function dnsBackupFile(): string {
  return path.join(dataDir(), 'dns-backup.json')
}

async function runDnsScript(mode: 'set' | 'reset' | 'read', args: Record<string, unknown>): Promise<PsDnsResult> {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const script = path.join(os.tmpdir(), `lazeyka-dns-${id}.ps1`)
  const argsFile = path.join(os.tmpdir(), `lazeyka-dns-${id}.json`)
  // BOM: Windows PowerShell 5 читает .ps1 без BOM в кодировке ANSI.
  writeFileSync(script, '﻿' + PS_DNS, 'utf-8')
  writeFileSync(argsFile, JSON.stringify(args), 'utf-8')
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Mode', mode, '-ArgsFile', argsFile],
      { windowsHide: true, timeout: 45_000 }
    )
    const line = String(stdout).trim().split(/\r?\n/).pop() ?? ''
    const parsed = JSON.parse(line) as Record<string, unknown>
    const arr = (v: unknown): string[] => (Array.isArray(v) ? v : v ? [v] : []).map(String)
    const now: Record<string, string[]> = {}
    for (const [k, v] of Object.entries((parsed.now as Record<string, unknown>) ?? {})) now[k] = arr(v)
    const before: Record<string, { v4: string[]; v6: string[] }> = {}
    for (const [k, v] of Object.entries((parsed.before as Record<string, unknown>) ?? {})) {
      const o = (v ?? {}) as { v4?: unknown; v6?: unknown }
      before[k] = { v4: arr(o.v4), v6: arr(o.v6) }
    }
    return { before, now, doh: Boolean(parsed.doh), v6: Boolean(parsed.v6), count: Number(parsed.count) || 0 }
  } finally {
    try { unlinkSync(script) } catch { /* noop */ }
    try { unlinkSync(argsFile) } catch { /* noop */ }
  }
}

/** Все адреса, которые LAZEYKA могла выставить, — их флаги DoH убираем при смене/сбросе. */
async function ourAddresses(): Promise<string[]> {
  const list = await allProviders()
  const fresh = dnsAiCache
  const all = list.flatMap((p) => [p.ip, p.secondaryIp, ...(p.ipv6 ?? [])])
  if (fresh) all.push(...fresh.retired)
  return [...new Set(all.filter((a): a is string => Boolean(a)))]
}

/**
 * Какой DNS сейчас стоит в системе — для «Проверки сайта»: адреса и, если это
 * один из известных провайдеров (DNS-AI, AdGuard…), его название и id.
 */
export async function describeSystemDns(): Promise<{ servers: string[]; providerId?: string; providerName?: string }> {
  const { servers } = await getSystemDnsState()
  if (servers.length === 0) return { servers }
  try {
    const list = await allProviders()
    for (const p of list) {
      const addrs = [p.ip, p.secondaryIp, ...(p.ipv6 ?? [])].filter(Boolean) as string[]
      if (servers.some((s) => addrs.includes(s))) return { servers, providerId: p.id, providerName: p.name }
    }
  } catch {
    /* без названия */
  }
  return { servers }
}

/** Какие DNS-серверы сейчас стоят на рабочих адаптерах (для подсветки в настройках). */
export async function getSystemDnsState(): Promise<{ servers: string[]; changedByApp: boolean }> {
  if (process.platform === 'darwin') {
    try {
      return { servers: await readMacDnsState(), changedByApp: existsSync(dnsBackupFile()) }
    } catch {
      return { servers: [], changedByApp: existsSync(dnsBackupFile()) }
    }
  }
  if (process.platform !== 'win32') return { servers: [], changedByApp: false }
  try {
    const r = await runDnsScript('read', {})
    const servers = [...new Set(Object.values(r.now).flat())]
    return { servers, changedByApp: existsSync(dnsBackupFile()) }
  } catch {
    return { servers: [], changedByApp: existsSync(dnsBackupFile()) }
  }
}

/**
 * macOS: пока поднят TUN, DNS ведут хуки службы lxd (post_start/post_stop
 * снимают снимок и возвращают его) — не мешаем им.
 */
async function macTunActive(): Promise<boolean> {
  try {
    const { isDaemonCoreActive } = await import('./incy-mac-service')
    if (isDaemonCoreActive()) return true
    const { getLiveConnectionMode } = await import('./incy-engine')
    return getLiveConnectionMode() === 'tun'
  } catch {
    return false
  }
}

async function applySystemDnsMac(target: string | 'dhcp'): Promise<{ success: boolean; message: string }> {
  if (await macTunActive()) {
    return {
      success: false,
      message: 'Пока подключён режим TUN, DNS ведёт служба LAZEYKA. Отключите INCY и повторите.'
    }
  }
  const file = dnsBackupFile()

  if (target === 'dhcp') {
    let backup: MacDnsBackup | null = null
    try {
      const raw = existsSync(file) ? JSON.parse(readFileSync(file, 'utf-8')) : null
      backup = isMacBackup(raw) ? raw : null
    } catch {
      backup = null
    }
    const enabled = await snapshotMacDns().then((b) => Object.keys(b.services))
    if (enabled.length === 0) return { success: false, message: 'Не найдена ни одна включённая сетевая служба' }
    // Возвращаем только то, что меняли мы; без копии — сброс на DHCP у всех.
    const changes: Record<string, string[]> = {}
    for (const svc of backup ? Object.keys(backup.services) : enabled) {
      if (enabled.includes(svc)) changes[svc] = backup?.services[svc] ?? []
    }
    const res = await writeMacDns(changes)
    if (!res.ok) return { success: false, message: res.message }
    try { unlinkSync(file) } catch { /* noop */ }
    const hadStatic = Object.values(changes).some((v) => v.length > 0)
    return {
      success: true,
      message: hadStatic ? 'Возвращён DNS, который стоял до LAZEYKA' : 'DNS сброшен на стандартный от провайдера (DHCP)'
    }
  }

  const provider = (await allProviders()).find((p) => p.id === target || p.ip === target)
  if (!provider) return { success: false, message: 'Неизвестный DNS-сервер' }
  // macOS: шифрованный DNS ставится только профилем — открываем его сразу, как
  // на Windows «Включить» сразу включает DoH. Провайдеры «только DoH» (DNS-AI)
  // на обычный DNS не отвечают: их адреса в систему НЕ пишем, иначе пропал бы
  // весь интернет (и «ИИ-серверы не подключаются»).
  if (provider.url) {
    const { openMacDohProfile } = await import('./dns-mac-profile')
    const prof = await openMacDohProfile(provider)
    if (provider.strict) return prof
    if (!prof.success) return prof
  }
  const servers = [
    ...[provider.ip, provider.secondaryIp].filter((a): a is string => Boolean(a) && net.isIPv4(String(a))),
    ...(provider.ipv6 ?? []).filter((a) => net.isIPv6(a))
  ]
  if (servers.length === 0) return { success: false, message: 'У сервера нет адресов DNS' }

  const before = await snapshotMacDns()
  const services = Object.keys(before.services)
  if (services.length === 0) return { success: false, message: 'Не найдена ни одна включённая сетевая служба' }
  // Прежние значения запоминаем один раз — до первой смены из LAZEYKA.
  const createdBackup = !existsSync(file)
  if (createdBackup) {
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(before), 'utf-8')
  }
  const res = await writeMacDns(Object.fromEntries(services.map((s) => [s, servers])))
  if (!res.ok) {
    // Ничего не поменялось — копия не нужна, иначе «изменено LAZEYKA» осталось бы навсегда.
    if (createdBackup) try { unlinkSync(file) } catch { /* noop */ }
    return { success: false, message: res.message }
  }
  if (provider.url) {
    return {
      success: true,
      message:
        `Пока профиль не установлен, работает обычный DNS ${provider.name} (${servers.join(', ')}). ` +
        'Для шифрования: «Системные настройки» → «Основные» → «Управление устройством» → профиль LAZEYKA → «Установить», ' +
        'затем «Сеть» → «VPN и фильтры» → «Включено».'
    }
  }
  return { success: true, message: `Системный DNS: ${provider.name} (${servers.join(', ')}) — без шифрования` }
}

export async function applySystemDns(target: string | 'dhcp'): Promise<{ success: boolean; message: string }> {
  if (process.platform === 'darwin') {
    try {
      return await applySystemDnsMac(target)
    } catch (e: any) {
      throw new Error(`Не удалось изменить DNS: ${e?.message || String(e)}`)
    }
  }
  if (process.platform !== 'win32') {
    return { success: false, message: 'Смена DNS поддерживается только на Windows' }
  }

  try {
    const ours = await ourAddresses()
    if (target === 'dhcp') {
      let restore: Record<string, unknown> | undefined
      try {
        if (existsSync(dnsBackupFile())) restore = JSON.parse(readFileSync(dnsBackupFile(), 'utf-8'))
      } catch {
        restore = undefined
      }
      const r = await runDnsScript('reset', { restore: restore ?? {}, ours })
      if (r.count === 0) return { success: false, message: 'Не найден активный сетевой адаптер' }
      try { unlinkSync(dnsBackupFile()) } catch { /* noop */ }
      const hadStatic =
        restore &&
        Object.values(restore).some((v) =>
          Array.isArray(v) ? v.length > 0 : ((v as { v4?: string[] })?.v4?.length ?? 0) + ((v as { v6?: string[] })?.v6?.length ?? 0) > 0
        )
      return {
        success: true,
        message: hadStatic ? 'Возвращён DNS, который стоял до LAZEYKA' : 'DNS сброшен на стандартный от провайдера (DHCP)'
      }
    }

    // Только известные серверы (встроенные и добавленные в настройках):
    // произвольная строка из окна в команду PowerShell не попадает.
    const provider = (await allProviders()).find((p) => p.id === target || p.ip === target)
    if (!provider) return { success: false, message: 'Неизвестный DNS-сервер' }
    const v4 = [provider.ip, provider.secondaryIp].filter((a): a is string => Boolean(a) && net.isIPv4(String(a)))
    const v6 = (provider.ipv6 ?? []).filter((a) => net.isIPv6(a))

    const r = await runDnsScript('set', {
      v4,
      v6,
      doh: provider.url || '',
      fallback: !provider.strict,
      ours
    })
    if (r.count === 0) return { success: false, message: 'Не найден активный сетевой адаптер' }
    // Прежние значения запоминаем один раз — до первой смены из LAZEYKA.
    if (!existsSync(dnsBackupFile())) {
      mkdirSync(path.dirname(dnsBackupFile()), { recursive: true })
      writeFileSync(dnsBackupFile(), JSON.stringify(r.before), 'utf-8')
    }
    const applied = Object.values(r.now).every((list) => list.includes(provider.ip))
    if (!applied) {
      return { success: false, message: 'Windows не применила DNS. Проверьте, что LAZEYKA запущена от администратора.' }
    }
    const desc = [...v4, ...(r.v6 ? v6 : [])].join(', ')
    const enc = !provider.url
      ? 'без шифрования'
      : !r.doh
        ? 'эта версия Windows не умеет DoH — запросы идут без шифрования (нужна Windows 11)'
        : provider.strict
          ? 'только шифрованный DoH, без возврата к открытому тексту'
          : 'DoH с запасным обычным DNS'
    return {
      success: true,
      message: `Системный DNS: ${provider.name} (${desc}) — ${enc}${v6.length && !r.v6 ? '. IPv6 на адаптере выключен — заданы только IPv4' : ''}`
    }
  } catch (e: any) {
    throw new Error(`Не удалось изменить DNS: ${e?.message || String(e)}`)
  }
}
