import https from 'node:https'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(exec)

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
    ip: '111.88.96.50',
    secondaryIp: '111.88.96.51',
    description: 'Обход ограничений Xbox Live / Microsoft и ускорение отклика',
    latencyMs: null
  }
]

export async function pingDohProvider(provider: DohProvider): Promise<number | null> {
  const start = Date.now()
  return new Promise((resolve) => {
    const req = https.get(
      `${provider.url}?name=youtube.com&type=A`,
      {
        timeout: 2500,
        headers: { Accept: 'application/dns-json', 'User-Agent': 'LAZEYKA-DNS' }
      },
      (res) => {
        if (res.statusCode && res.statusCode < 400) {
          resolve(Date.now() - start)
        } else {
          resolve(null)
        }
      }
    )
    req.on('error', () => resolve(null))
    req.on('timeout', () => {
      req.destroy()
      resolve(null)
    })
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

export async function applySystemDns(target: string | 'dhcp'): Promise<{ success: boolean; message: string }> {
  if (process.platform !== 'win32') {
    return { success: false, message: 'Смена DNS поддерживается только на Windows' }
  }

  try {
    if (target === 'dhcp') {
      const resetPs = `
        Get-NetAdapter | Where-Object { $_.InterfaceType -ne 'Loopback' } | ForEach-Object {
          Set-DnsClientServerAddress -InterfaceIndex $_.InterfaceIndex -ResetServerAddresses -ErrorAction SilentlyContinue
        }
        ipconfig /flushdns
      `
      await execAsync(`powershell -NoProfile -Command "${resetPs.replace(/\r?\n\s*/g, ' ')}"`, { windowsHide: true })
      try {
        await execAsync('netsh interface ip set dns "Ethernet" dhcp', { windowsHide: true })
        await execAsync('netsh interface ip set dns "Wi-Fi" dhcp', { windowsHide: true })
        await execAsync('ipconfig /flushdns', { windowsHide: true })
      } catch { /* best effort fallback */ }

      return { success: true, message: 'DNS сброшен на стандартный от провайдера (DHCP)' }
    }

    const provider = DOH_PROVIDERS.find((p) => p.id === target || p.ip === target)
    const primaryIp = provider?.ip || target
    const secondaryIp = provider?.secondaryIp || ''
    const dohUrl = provider?.url || ''

    const addrList = secondaryIp ? `@('${primaryIp}', '${secondaryIp}')` : `@('${primaryIp}')`

    const psCommands = [
      dohUrl ? `Add-DnsClientDohServerAddress -ServerAddress '${primaryIp}' -DohTemplate '${dohUrl}' -AllowFallbackToUdp $true -AutoUpgrade $true -ErrorAction SilentlyContinue;` : '',
      dohUrl ? `Set-DnsClientDohServerAddress -ServerAddress '${primaryIp}' -DohTemplate '${dohUrl}' -AllowFallbackToUdp $true -AutoUpgrade $true -ErrorAction SilentlyContinue;` : '',
      dohUrl && secondaryIp ? `Add-DnsClientDohServerAddress -ServerAddress '${secondaryIp}' -DohTemplate '${dohUrl}' -AllowFallbackToUdp $true -AutoUpgrade $true -ErrorAction SilentlyContinue;` : '',
      dohUrl && secondaryIp ? `Set-DnsClientDohServerAddress -ServerAddress '${secondaryIp}' -DohTemplate '${dohUrl}' -AllowFallbackToUdp $true -AutoUpgrade $true -ErrorAction SilentlyContinue;` : '',
      `Get-NetAdapter | Where-Object { $_.Status -eq 'Up' -or $_.InterfaceType -ne 'Loopback' } | ForEach-Object { Set-DnsClientServerAddress -InterfaceIndex $_.InterfaceIndex -ServerAddresses ${addrList} -ErrorAction SilentlyContinue };`,
      `ipconfig /flushdns`
    ].filter(Boolean).join(' ')

    await execAsync(`powershell -NoProfile -Command "${psCommands}"`, { windowsHide: true })

    try {
      await execAsync(`netsh interface ip set dns "Ethernet" static ${primaryIp}`, { windowsHide: true })
      if (secondaryIp) {
        await execAsync(`netsh interface ip add dns "Ethernet" ${secondaryIp} index=2`, { windowsHide: true })
      }
      await execAsync(`netsh interface ip set dns "Wi-Fi" static ${primaryIp}`, { windowsHide: true })
      if (secondaryIp) {
        await execAsync(`netsh interface ip add dns "Wi-Fi" ${secondaryIp} index=2`, { windowsHide: true })
      }
      await execAsync('ipconfig /flushdns', { windowsHide: true })
    } catch { /* best effort fallback */ }

    const desc = secondaryIp ? `${primaryIp}, ${secondaryIp}` : primaryIp
    return {
      success: true,
      message: `Системный DNS настроен: ${provider?.name || primaryIp} (${desc})`
    }
  } catch (e: any) {
    throw new Error(`Не удалось изменить DNS: ${e?.message || String(e)}`)
  }
}
