/**
 * Карточка «Wi-Fi»: текущая сеть и соседние сети по каналам. Запускается
 * только по кнопке. Windows: netsh wlan; macOS 14+: system_profiler
 * SPAirPortDataType -json (устаревшая утилита airport не нужна).
 *
 * Разбор текущей сети — из prematch-stats.ts (parseNetshWlan, parseMacWifi,
 * decideLink), список соседей и советы — в diag-logic.ts.
 */
import { decideLink, parseMacWifi, parseNetshWlan, type LinkType } from './prematch-stats'
import {
  adviseWifi,
  countChannels,
  markOwnNetwork,
  parseMacScan,
  parseNetshInterfaceExtras,
  parseNetshNetworks,
  type ChannelStat,
  type ScanNetwork,
  type WifiAdvice,
  type WifiBand
} from './diag-logic'
import { physAdapter, runCmd } from './diag-net'

export interface WifiCurrent {
  ssid: string | null
  signalPct: number | null
  rssiDbm: number | null
  band: WifiBand | null
  channel: number | null
  phy: string | null
  /** Скорость соединения с роутером, Мбит/с. */
  rxMbps: number | null
  txMbps: number | null
}

export type WifiProblem = 'location' | 'service' | 'no-adapter' | 'unsupported'

export interface WifiScanResult {
  checkedAt: number
  platform: 'win32' | 'darwin' | 'other'
  link: { type: LinkType; ifaceName: string | null }
  current: WifiCurrent | null
  networks: ScanNetwork[]
  channels: ChannelStat[]
  advice: WifiAdvice
  problem?: WifiProblem
  message?: string
}

const LOCATION_MESSAGE =
  'Windows не отдаёт список сетей без доступа к геолокации. Откройте «Параметры» → «Конфиденциальность и безопасность» → «Расположение», ' +
  'включите «Службы определения расположения» и «Разрешить классическим приложениям доступ к расположению», затем повторите проверку.'

async function scanWindows(): Promise<{ wifi: ReturnType<typeof parseNetshWlan>; ifaceText: string; scan: ReturnType<typeof parseNetshNetworks> }> {
  const [ifaceText, netText] = await Promise.all([
    runCmd('netsh.exe', ['wlan', 'show', 'interfaces'], 8000),
    runCmd('netsh.exe', ['wlan', 'show', 'networks', 'mode=bssid'], 15_000)
  ])
  return { wifi: parseNetshWlan(ifaceText), ifaceText, scan: parseNetshNetworks(netText) }
}

export async function runWifiScan(): Promise<WifiScanResult> {
  const platform = process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'other'
  const empty = (problem: WifiProblem, message: string, link: WifiScanResult['link'] = { type: 'unknown', ifaceName: null }): WifiScanResult => ({
    checkedAt: Date.now(),
    platform,
    link,
    current: null,
    networks: [],
    channels: [],
    advice: adviseWifi({ link: link.type, current: null, channels: [], rxMbps: null }),
    problem,
    message
  })
  if (platform === 'other') return empty('unsupported', 'Проверка Wi-Fi доступна в Windows и macOS.')

  const adapter = await physAdapter()
  let wifi: ReturnType<typeof parseNetshWlan>
  let networks: ScanNetwork[] = []
  let ownBssid: string | null = null
  let ownSsid: string | null = null
  let rx: number | null = null
  let tx: number | null = null
  let needsLocation = false
  let serviceDown = false

  if (platform === 'win32') {
    const r = await scanWindows()
    wifi = r.wifi
    networks = r.scan.networks
    needsLocation = r.scan.needsLocation
    serviceDown = r.scan.serviceDown
    const ex = parseNetshInterfaceExtras(r.ifaceText)
    ownBssid = ex.bssid
    ownSsid = ex.ssid
    rx = ex.rxMbps
    tx = ex.txMbps
    if (/ms-settings:privacy-location/i.test(r.ifaceText)) needsLocation = true
  } else {
    const out = await runCmd('/usr/sbin/system_profiler', ['SPAirPortDataType', '-json'], 25_000)
    let json: unknown = null
    try {
      json = JSON.parse(out)
    } catch {
      /* ниже — нет данных */
    }
    wifi = parseMacWifi(json)
    const sc = parseMacScan(json)
    networks = sc.networks
    ownSsid = sc.ssid && !/redacted/i.test(sc.ssid) ? sc.ssid : null
    rx = sc.rateMbps
    tx = sc.rateMbps
  }

  const link = decideLink(wifi, adapter.iface, process.platform)
  const linkInfo = { type: link.type, ifaceName: link.ifaceName }

  if (link.type === 'wired') {
    return {
      checkedAt: Date.now(),
      platform,
      link: linkInfo,
      current: null,
      networks: [],
      channels: [],
      advice: adviseWifi({ link: 'wired', current: null, channels: [], rxMbps: null })
    }
  }
  if (wifi.ifaces.length === 0 && networks.length === 0) {
    if (serviceDown) return empty('service', 'Служба автонастройки WLAN не запущена. Включите её в «Службах» Windows (WLAN AutoConfig) и повторите.', linkInfo)
    if (needsLocation) return empty('location', LOCATION_MESSAGE, linkInfo)
    return empty('no-adapter', 'Wi-Fi-адаптер не найден или выключен.', linkInfo)
  }

  const a = wifi.active
  const current: WifiCurrent | null = a
    ? { ssid: ownSsid, signalPct: a.signalPct, rssiDbm: a.rssiDbm, band: a.band, channel: a.channel, phy: a.phy, rxMbps: rx, txMbps: tx }
    : null

  // Без списка соседей (нет доступа к геолокации и т. п.) про загруженность каналов ничего не говорим.
  const haveScan = networks.length > 0
  const marked = a && haveScan ? markOwnNetwork(networks, { ssid: ownSsid, bssid: ownBssid, channel: a.channel, band: a.band }) : networks
  const channels = haveScan ? countChannels(marked) : []
  const advice = adviseWifi({
    link: link.type,
    current: a ? { rssiDbm: a.rssiDbm, band: a.band, channel: a.channel } : null,
    channels,
    rxMbps: rx
  })

  const result: WifiScanResult = { checkedAt: Date.now(), platform, link: linkInfo, current, networks: marked, channels, advice }
  if (networks.length === 0) {
    if (needsLocation) {
      result.problem = 'location'
      result.message = LOCATION_MESSAGE
    } else if (serviceDown) {
      result.problem = 'service'
      result.message = 'Список соседних сетей получить не удалось: служба автонастройки WLAN не запущена.'
    } else {
      result.message = 'Список соседних сетей пуст: система его не отдала. Повторите проверку через несколько секунд.'
    }
  }
  return result
}
