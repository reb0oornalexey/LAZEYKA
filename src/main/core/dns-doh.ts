import http2 from 'node:http2'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { dataDir } from '../utils/dirs'

const execFileAsync = promisify(execFile)


export interface DohProvider {
  id: string
  name: string
  url: string
  ip: string
  secondaryIp?: string
  description: string
  latencyMs: number | null
}

export const DOH_PROVIDERS: DohProvider[] = [
  {
    id: 'cloudflare',
    name: 'Cloudflare 1.1.1.1',
    url: 'https://cloudflare-dns.com/dns-query',
    ip: '1.1.1.1',
    secondaryIp: '1.0.0.1',
    description: 'Самый быстрый и конфиденциальный DNS',
    latencyMs: null
  },
  {
    id: 'google',
    name: 'Google 8.8.8.8',
    url: 'https://dns.google/dns-query',
    ip: '8.8.8.8',
    secondaryIp: '8.8.4.4',
    description: 'Максимальная стабильность и глобальное покрытие',
    latencyMs: null
  },
  {
    id: 'adguard',
    name: 'AdGuard DNS',
    url: 'https://dns.adguard-dns.com/dns-query',
    ip: '94.140.14.14',
    secondaryIp: '94.140.15.15',
    description: 'Блокировка рекламы, трекеров и фишинга на уровне DNS',
    latencyMs: null
  },
  {
    id: 'quad9',
    name: 'Quad9 9.9.9.9',
    url: 'https://dns.quad9.net/dns-query',
    ip: '9.9.9.9',
    secondaryIp: '149.112.112.112',
    description: 'Безопасность и защита от вредоносных доменов',
    latencyMs: null
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

export async function getDohProvidersWithPing(): Promise<DohProvider[]> {
  const results = await Promise.all(
    DOH_PROVIDERS.map(async (p) => {
      const latencyMs = await pingDohProvider(p)
      return {
        ...p,
        latencyMs
      }
    })
  )
  return results
}

/**
 * PowerShell-скрипт смены DNS.
 *
 * Меняем только адаптеры, через которые реально идёт интернет (маршрут по
 * умолчанию), без VPN- и виртуальных адаптеров. Раньше условие
 * `Status -eq 'Up' -or InterfaceType -ne 'Loopback'` было всегда истинным, и
 * DNS прописывался на Hyper-V, WSL, VMware и чужие VPN, а «Сбросить» стирал
 * ручной DNS везде. Прежние значения теперь запоминаются и возвращаются.
 */
const PS_DNS = String.raw`param([string]$Mode, [string]$ArgsFile)
$ErrorActionPreference = 'Stop'
$cfg = Get-Content -Raw -LiteralPath $ArgsFile | ConvertFrom-Json
$route = @(Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty InterfaceIndex -Unique)
$skip = 'Wintun|WireGuard|TAP-|sing-box|Hyper-V|VMware|VirtualBox|Loopback'
$ad = @(Get-NetAdapter | Where-Object { $_.Status -eq 'Up' -and ($route -contains $_.InterfaceIndex) -and $_.InterfaceDescription -notmatch $skip })
if ($ad.Count -eq 0) { $ad = @(Get-NetAdapter -Physical | Where-Object { $_.Status -eq 'Up' }) }
function Get-StaticDns($a) {
  $p = "HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\Interfaces\$($a.InterfaceGuid)"
  $ns = (Get-ItemProperty -LiteralPath $p -Name NameServer -ErrorAction SilentlyContinue).NameServer
  if ($ns) { return @($ns -split '[ ,]+' | Where-Object { $_ }) }
  return @()
}
$before = @{}
foreach ($a in $ad) { $before[[string]$a.InterfaceIndex] = @(Get-StaticDns $a) }
$hasDoh = [bool](Get-Command Add-DnsClientDohServerAddress -ErrorAction SilentlyContinue)
if ($Mode -eq 'set') {
  $servers = @($cfg.servers)
  if ($cfg.doh -and $hasDoh) {
    foreach ($s in $servers) {
      try {
        Add-DnsClientDohServerAddress -ServerAddress $s -DohTemplate $cfg.doh -AllowFallbackToUdp $true -AutoUpgrade $true -ErrorAction Stop | Out-Null
      } catch {
        try { Set-DnsClientDohServerAddress -ServerAddress $s -DohTemplate $cfg.doh -AllowFallbackToUdp $true -AutoUpgrade $true -ErrorAction Stop | Out-Null } catch { }
      }
    }
  }
  foreach ($a in $ad) { Set-DnsClientServerAddress -InterfaceIndex $a.InterfaceIndex -ServerAddresses $servers }
} elseif ($Mode -eq 'reset') {
  $restore = $cfg.restore
  foreach ($a in $ad) {
    $k = [string]$a.InterfaceIndex
    $saved = @()
    if ($restore -and ($restore.PSObject.Properties.Name -contains $k)) { $saved = @($restore.$k) }
    if ($saved.Count -gt 0) { Set-DnsClientServerAddress -InterfaceIndex $a.InterfaceIndex -ServerAddresses $saved }
    else { Set-DnsClientServerAddress -InterfaceIndex $a.InterfaceIndex -ResetServerAddresses }
  }
}
if ($Mode -ne 'read') { Clear-DnsClientCache -ErrorAction SilentlyContinue }
$now = @{}
foreach ($a in $ad) { $now[[string]$a.InterfaceIndex] = @((Get-DnsClientServerAddress -InterfaceIndex $a.InterfaceIndex -AddressFamily IPv4).ServerAddresses) }
[pscustomobject]@{ before = $before; now = $now; doh = $hasDoh; count = $ad.Count } | ConvertTo-Json -Depth 5 -Compress
`

interface PsDnsResult {
  before: Record<string, string[]>
  now: Record<string, string[]>
  doh: boolean
  count: number
}

function dnsBackupFile(): string {
  return path.join(dataDir(), 'dns-backup.json')
}

async function runDnsScript(mode: 'set' | 'reset' | 'read', args: Record<string, unknown>): Promise<PsDnsResult> {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const script = path.join(os.tmpdir(), `lazeyka-dns-${id}.ps1`)
  const argsFile = path.join(os.tmpdir(), `lazeyka-dns-${id}.json`)
  writeFileSync(script, PS_DNS, 'utf-8')
  writeFileSync(argsFile, JSON.stringify(args), 'utf-8')
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Mode', mode, '-ArgsFile', argsFile],
      { windowsHide: true, timeout: 30_000 }
    )
    const line = String(stdout).trim().split(/\r?\n/).pop() ?? ''
    const parsed = JSON.parse(line) as PsDnsResult
    const norm = (m: unknown): Record<string, string[]> => {
      const out: Record<string, string[]> = {}
      for (const [k, v] of Object.entries((m as Record<string, unknown>) ?? {})) {
        out[k] = (Array.isArray(v) ? v : v ? [v] : []).map(String)
      }
      return out
    }
    return { before: norm(parsed.before), now: norm(parsed.now), doh: Boolean(parsed.doh), count: Number(parsed.count) || 0 }
  } finally {
    try { unlinkSync(script) } catch { /* noop */ }
    try { unlinkSync(argsFile) } catch { /* noop */ }
  }
}

/** Какие DNS-серверы сейчас стоят на рабочих адаптерах (для подсветки в настройках). */
export async function getSystemDnsState(): Promise<{ servers: string[]; changedByApp: boolean }> {
  if (process.platform !== 'win32') return { servers: [], changedByApp: false }
  try {
    const r = await runDnsScript('read', {})
    const servers = [...new Set(Object.values(r.now).flat())]
    return { servers, changedByApp: existsSync(dnsBackupFile()) }
  } catch {
    return { servers: [], changedByApp: existsSync(dnsBackupFile()) }
  }
}

export async function applySystemDns(target: string | 'dhcp'): Promise<{ success: boolean; message: string }> {
  if (process.platform !== 'win32') {
    return { success: false, message: 'Смена DNS поддерживается только на Windows' }
  }

  try {
    if (target === 'dhcp') {
      let restore: Record<string, string[]> | undefined
      try {
        if (existsSync(dnsBackupFile())) restore = JSON.parse(readFileSync(dnsBackupFile(), 'utf-8'))
      } catch {
        restore = undefined
      }
      const r = await runDnsScript('reset', { restore: restore ?? {} })
      if (r.count === 0) return { success: false, message: 'Не найден активный сетевой адаптер' }
      try { unlinkSync(dnsBackupFile()) } catch { /* noop */ }
      const hadStatic = restore && Object.values(restore).some((v) => v.length > 0)
      return {
        success: true,
        message: hadStatic ? 'Возвращён DNS, который стоял до LAZEYKA' : 'DNS сброшен на стандартный от провайдера (DHCP)'
      }
    }

    // Только известные серверы: строка из окна уходила в команду
    // PowerShell как есть.
    const provider = DOH_PROVIDERS.find((p) => p.id === target || p.ip === target)
    if (!provider) return { success: false, message: 'Неизвестный DNS-сервер' }
    const servers = [provider.ip, provider.secondaryIp].filter(Boolean) as string[]

    const r = await runDnsScript('set', { servers, doh: provider.url || '' })
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
    const desc = servers.join(', ')
    return {
      success: true,
      message: r.doh
        ? `Системный DNS: ${provider.name} (${desc}), шифрование DoH включено`
        : `Системный DNS: ${provider.name} (${desc}). Эта версия Windows не умеет DoH — запросы идут без шифрования`
    }
  } catch (e: any) {
    throw new Error(`Не удалось изменить DNS: ${e?.message || String(e)}`)
  }
}
