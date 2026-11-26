/**
 * «Перед каткой»: чистые функции без Electron и без обращений к системе.
 * Здесь: пороги, статистика пинга, разбор вывода системных утилит (Windows и
 * macOS), детектор лагов и тексты вердиктов. Системные вызовы — в prematch.ts.
 */

// ---- пороги ----------------------------------------------------------------------

/** Сколько замеров делает проверка: до цели и до роутера. Windows-ping шлёт по одному в секунду. */
export const CHECK_TARGET_SAMPLES = 18
export const CHECK_GATEWAY_SAMPLES = 12

/** Пинг до сервера, мс. Порог для шутеров: до 80 — комфортно, 80–140 — заметно, выше — тяжело. */
export const PING_WARN_MS = 80
export const PING_BAD_MS = 140

/** Джиттер (среднее отклонение соседних замеров), мс. Выше 8 мс прицеливание уже «плавает». */
export const JITTER_WARN_MS = 8
export const JITTER_BAD_MS = 20

/**
 * Потери до сервера, %. В проверке ~18 замеров: один потерянный пакет (~5,6%) — предупреждение,
 * два и больше (≥10%) — плохо.
 */
export const LOSS_WARN_PCT = 1
export const LOSS_BAD_PCT = 10

/** Пинг до роутера, мс. По кабелю обычно 1–2 мс, по Wi-Fi 2–8. Больше 12 — что-то не так дома. */
export const GATEWAY_WARN_MS = 12
export const GATEWAY_BAD_MS = 30
export const GATEWAY_JITTER_WARN_MS = 8

/**
 * Сигнал Wi-Fi, дБм (чем ближе к нулю, тем лучше). Выше −67 — хорошо для игры,
 * −67…−75 — средне, ниже −75 — слабо, ниже −82 — игра будет рваться.
 */
export const WIFI_MEDIUM_DBM = -67
export const WIFI_WEAK_DBM = -75
export const WIFI_BAD_DBM = -82

/** Рост пинга под нагрузкой (bufferbloat) уже оценён в runBufferbloatTest: A/B — нормально, C — заметно, D — плохо. */

/** Сессия: период замера, длительность, пауза компьютера. */
export const SESSION_INTERVAL_MS = 3000
export const SESSION_MAX_MS = 6 * 3600 * 1000
/** Если между замерами прошло больше этого (сон ноутбука), пропуск не считается ни потерями, ни временем игры. */
export const SESSION_GAP_MS = 15_000
/** Отчёт не строится, если замеров меньше (сессия короче ~15 секунд). */
export const REPORT_MIN_SAMPLES = 5
/** Сколько последних отчётов хранится. */
export const HISTORY_LIMIT = 20
/** «Скачок» в отчёте: пинг выше медианы сессии на столько мс (независимо от настроек сигнала). */
export const REPORT_SPIKE_MS = 40
/** Скачков в час (при сессии короче 10 минут время условно считается за 10 минут). */
export const REPORT_SPIKES_PER_HOUR_WARN = 6
export const REPORT_SPIKES_PER_HOUR_BAD = 20
export const REPORT_JITTER_WARN_MS = 6
export const REPORT_JITTER_BAD_MS = 15
export const REPORT_LOSS_WARN_PCT = 1
export const REPORT_LOSS_BAD_PCT = 5
/** Точек на графике отчёта. */
export const REPORT_SERIES_POINTS = 300

// ---- типы ------------------------------------------------------------------------

export interface SeriesStats {
  sent: number
  received: number
  lossPct: number
  avgMs: number | null
  minMs: number | null
  maxMs: number | null
  medianMs: number | null
  jitterMs: number | null
}

export type Severity = 'bad' | 'warn' | 'info' | 'ok'

export interface Issue {
  id: string
  severity: Severity
  /** Что не так, простыми словами (с цифрами). */
  title: string
  /** Что с этим делать. */
  advice: string
  /** Короткая формулировка для заголовка «Играть можно, но …». */
  short?: string
}

export type VerdictKind = 'good' | 'warn' | 'bad' | 'unknown'

export interface Verdict {
  kind: VerdictKind
  headline: string
  issues: Issue[]
}

export interface WifiInfo {
  ifaceName: string | null
  signalPct: number | null
  rssiDbm: number | null
  band: '2.4' | '5' | '6' | null
  channel: number | null
  phy: string | null
}

export interface WifiParse {
  /** Имена всех Wi-Fi-адаптеров, которые удалось увидеть. */
  ifaces: string[]
  /** Подключённый адаптер (есть уровень сигнала) или null. */
  active: WifiInfo | null
}

export type LinkType = 'wired' | 'wifi' | 'wifi-unknown' | 'unknown'

export interface LinkInfo {
  type: LinkType
  ifaceName: string | null
  wifi: WifiInfo | null
}

// ---- статистика ------------------------------------------------------------------

export function median(values: number[]): number | null {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Среднее отклонение между соседними полученными замерами. */
export function jitterOf(rtts: number[]): number | null {
  if (rtts.length < 2) return rtts.length ? 0 : null
  let sum = 0
  for (let i = 1; i < rtts.length; i++) sum += Math.abs(rtts[i] - rtts[i - 1])
  return Math.round((sum / (rtts.length - 1)) * 10) / 10
}

/** samples: время ответа, мс, либо null — пакет потерян. */
export function summarizeSeries(samples: (number | null)[]): SeriesStats {
  const ok = samples.filter((s): s is number => typeof s === 'number' && Number.isFinite(s))
  const sent = samples.length
  if (!ok.length) {
    return { sent, received: 0, lossPct: sent ? 100 : 0, avgMs: null, minMs: null, maxMs: null, medianMs: null, jitterMs: null }
  }
  const med = median(ok) as number
  return {
    sent,
    received: ok.length,
    lossPct: Math.round(((sent - ok.length) / sent) * 1000) / 10,
    avgMs: Math.round(ok.reduce((a, b) => a + b, 0) / ok.length),
    minMs: Math.min(...ok),
    maxMs: Math.max(...ok),
    medianMs: Math.round(med),
    jitterMs: jitterOf(ok)
  }
}

/** rtts — только полученные ответы, sent — сколько пакетов отправлено. */
export function summarizeReplies(rtts: number[], sent: number): SeriesStats {
  const samples: (number | null)[] = rtts.slice(0, sent)
  while (samples.length < sent) samples.push(null)
  return summarizeSeries(samples)
}

/**
 * Скачки: эпизоды, в которых пинг выше медианы на spikeMs. Подряд идущие
 * замеры выше порога считаются одним скачком. lossBursts — серии из 2+ потерь подряд.
 */
export function countSpikes(samples: (number | null)[], baselineMs: number | null, spikeMs = REPORT_SPIKE_MS): { spikes: number; lossBursts: number } {
  let spikes = 0
  let lossBursts = 0
  let inSpike = false
  let lossRun = 0
  for (const s of samples) {
    if (s == null) {
      lossRun++
      if (lossRun === 2) lossBursts++
      inSpike = false
      continue
    }
    lossRun = 0
    const high = baselineMs != null && s > baselineMs + spikeMs
    if (high && !inSpike) spikes++
    inSpike = high
  }
  return { spikes, lossBursts }
}

export interface Bucketed {
  avg: (number | null)[]
  max: (number | null)[]
  lost: number[]
}

/** Сжать длинную серию до maxPoints корзин: среднее, максимум и число потерь в каждой. */
export function bucketize(samples: (number | null)[], maxPoints = REPORT_SERIES_POINTS): Bucketed {
  const n = samples.length
  const size = Math.max(1, Math.ceil(n / maxPoints))
  const out: Bucketed = { avg: [], max: [], lost: [] }
  for (let i = 0; i < n; i += size) {
    const part = samples.slice(i, i + size)
    const ok = part.filter((v): v is number => v != null)
    out.avg.push(ok.length ? Math.round(ok.reduce((a, b) => a + b, 0) / ok.length) : null)
    out.max.push(ok.length ? Math.max(...ok) : null)
    out.lost.push(part.length - ok.length)
  }
  return out
}

// ---- разбор вывода ping ----------------------------------------------------------

/**
 * Windows: «Reply from 1.1.1.1: bytes=32 time=12ms TTL=57». Берём число перед «ms»
 * (в любой локали — по «=число … TTL=»); «time<1ms» → 1.
 */
export function parseWinPingRtts(out: string): number[] {
  return [...out.matchAll(/[=<](\d+)\s*[^\s\d]{0,4}\s+TTL=/gi)].map((m) => Math.max(1, Number(m[1])))
}

// ---- маршрут по умолчанию --------------------------------------------------------

export interface DefaultRoute {
  gateway: string
  ip: string | null
  iface: string | null
}

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/

/**
 * Windows, `route print -4 0.0.0.0`: строки «0.0.0.0  0.0.0.0  шлюз  адрес-интерфейса  метрика».
 * Разбор по числам, не по словам. Адаптеры 172.19.0.x (туннель LAZEYKA) пропускаем,
 * побеждает меньшая метрика — как в core-probe.physicalSourceIp.
 */
export function parseWinDefaultRoute(out: string): DefaultRoute | null {
  let best: { gateway: string; ip: string; metric: number } | null = null
  for (const line of out.split(/\r?\n/)) {
    const m = /^\s*0\.0\.0\.0\s+0\.0\.0\.0\s+(\S+)\s+(\d+\.\d+\.\d+\.\d+)\s+(\d+)/.exec(line)
    if (!m) continue
    const [, gateway, ip, metric] = m
    if (ip.startsWith('172.19.0.') || !IPV4.test(gateway)) continue
    if (!best || Number(metric) < best.metric) best = { gateway, ip, metric: Number(metric) }
  }
  return best ? { gateway: best.gateway, ip: best.ip, iface: null } : null
}

/** Интерфейсы-туннели macOS: на них «физический» путь не идёт. */
const MAC_VIRTUAL_IF = /^(utun|ipsec|ppp|gif|stf|lo|bridge|awdl|llw|ap|anpi|vmenet|vnic|feth)\d*$/i

/**
 * macOS, `netstat -rn -f inet`: «default  192.168.1.1  UGScg  en0». Первая строка
 * default с IPv4-шлюзом на обычном (не туннельном) интерфейсе.
 */
export function parseMacDefaultRoute(out: string): DefaultRoute | null {
  for (const line of out.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 4 || parts[0] !== 'default') continue
    const gateway = parts[1]
    const iface = parts[3]
    if (!IPV4.test(gateway) || MAC_VIRTUAL_IF.test(iface)) continue
    return { gateway, ip: null, iface }
  }
  return null
}

// ---- Wi-Fi: Windows --------------------------------------------------------------

interface Entry {
  key: string
  value: string
}

/**
 * Вывод `netsh wlan show interfaces` локализован (названия полей на языке системы),
 * поэтому разбираем по структуре: блок начинается с поля «Name» (оно всегда первое),
 * сигнал — единственное значение вида «NN%», тип радио — «802.11…», канал — первое
 * целое число после типа радио, диапазон — значение вида «5 GHz» / «5 ГГц».
 */
export function parseNetshWlan(text: string): WifiParse {
  const blocks: Entry[][] = []
  let cur: Entry[] | null = null
  let firstKey: string | null = null
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([^:]+?)\s*:\s+(.*?)\s*$/.exec(line)
    if (!m) continue
    const key = m[1]
    if (firstKey == null) firstKey = key
    if (key === firstKey || !cur) {
      cur = []
      blocks.push(cur)
    }
    cur.push({ key, value: m[2] })
  }
  const ifaces: string[] = []
  let active: WifiInfo | null = null
  for (const b of blocks) {
    if (!b.length) continue
    const name = b[0].value || null
    if (name) ifaces.push(name)
    const sigIdx = b.findIndex((e) => /^\d{1,3}\s*%$/.test(e.value))
    if (sigIdx < 0 || active) continue
    const signalPct = Math.max(0, Math.min(100, parseInt(b[sigIdx].value, 10)))
    const phyIdx = b.findIndex((e) => /^802\.11[a-z0-9/]*$/i.test(e.value))
    let channel: number | null = null
    let band: WifiInfo['band'] = null
    if (phyIdx >= 0) {
      for (let i = phyIdx + 1; i < b.length; i++) {
        const v = b[i].value
        const bm = /^(2[.,]4|5|6)\s*\D{2,4}$/.exec(v)
        if (bm && band == null) band = bm[1].startsWith('2') ? '2.4' : (bm[1] as '5' | '6')
        if (/^\d{1,3}$/.test(v)) {
          channel = Number(v)
          break
        }
      }
    }
    if (band == null && channel != null) band = channel <= 14 ? '2.4' : '5'
    active = {
      ifaceName: name,
      signalPct,
      // Windows отдаёт качество сигнала в процентах; обратный пересчёт Microsoft: dBm ≈ % / 2 − 100.
      rssiDbm: Math.round(signalPct / 2 - 100),
      band,
      channel,
      phy: phyIdx >= 0 ? b[phyIdx].value : null
    }
  }
  return { ifaces, active }
}

// ---- Wi-Fi: macOS ----------------------------------------------------------------

/**
 * `system_profiler SPAirPortDataType -json` (macOS 14+, без устаревшей утилиты airport).
 * Подключённый интерфейс имеет spairport_current_network_information, в нём
 * spairport_signal_noise = «-55 dBm / -93 dBm» и spairport_network_channel = «149 (5GHz, 80MHz)».
 * Название сети (SSID) на новых macOS скрыто без доступа к геолокации — оно нам не нужно.
 */
export function parseMacWifi(json: unknown): WifiParse {
  const ifaces: string[] = []
  let active: WifiInfo | null = null
  const root = (json as { SPAirPortDataType?: unknown[] } | null)?.SPAirPortDataType
  if (!Array.isArray(root)) return { ifaces, active }
  for (const entry of root) {
    const list = (entry as { spairport_airport_interfaces?: unknown[] })?.spairport_airport_interfaces
    if (!Array.isArray(list)) continue
    for (const raw of list) {
      const it = raw as Record<string, unknown>
      const name = typeof it._name === 'string' ? it._name : null
      if (name) ifaces.push(name)
      const cur = it.spairport_current_network_information as Record<string, unknown> | undefined
      if (!cur || active) continue
      const sn = typeof cur.spairport_signal_noise === 'string' ? cur.spairport_signal_noise : ''
      const dbm = [...sn.matchAll(/(-\d+)\s*dBm/gi)].map((m) => Number(m[1]))
      if (!dbm.length) continue
      const ch = typeof cur.spairport_network_channel === 'string' ? cur.spairport_network_channel : ''
      const chNum = /^\s*(\d+)/.exec(ch)
      const bandM = /(2\.4|5|6)\s*GHz/i.exec(ch)
      const channel = chNum ? Number(chNum[1]) : null
      const band: WifiInfo['band'] = bandM ? (bandM[1] as '2.4' | '5' | '6') : channel != null ? (channel <= 14 ? '2.4' : '5') : null
      active = {
        ifaceName: name,
        signalPct: Math.max(0, Math.min(100, Math.round((dbm[0] + 100) * 2))),
        rssiDbm: dbm[0],
        band,
        channel,
        phy: typeof cur.spairport_network_phymode === 'string' ? cur.spairport_network_phymode : null
      }
    }
  }
  return { ifaces, active }
}

/**
 * Как компьютер выходит в сеть. activeIface — интерфейс физического маршрута по умолчанию
 * (имя соединения в Windows, enN в macOS).
 */
export function decideLink(wifi: WifiParse, activeIface: string | null, platform: NodeJS.Platform): LinkInfo {
  const same = (a: string | null, b: string | null): boolean => !!a && !!b && a.toLowerCase() === b.toLowerCase()
  if (wifi.active && (activeIface == null || same(wifi.active.ifaceName, activeIface))) {
    return { type: 'wifi', ifaceName: wifi.active.ifaceName, wifi: wifi.active }
  }
  if (activeIface) {
    // Маршрут идёт через Wi-Fi-адаптер, но данных о сигнале нет (служба выключена, нет прав на геолокацию).
    const looksWifi = wifi.ifaces.some((n) => same(n, activeIface)) || (platform === 'win32' && /wi-?fi|wlan|wireless|беспровод/i.test(activeIface))
    if (looksWifi) return { type: 'wifi-unknown', ifaceName: activeIface, wifi: null }
    return { type: 'wired', ifaceName: activeIface, wifi: null }
  }
  return { type: 'unknown', ifaceName: null, wifi: null }
}

// ---- вердикт проверки ------------------------------------------------------------

export interface CheckVerdictInput {
  target: { replied: boolean; stats: SeriesStats | null }
  gateway: { found: boolean; replied: boolean; stats: SeriesStats | null }
  link: LinkInfo
  load: { grade: 'A' | 'B' | 'C' | 'D' | 'unknown'; increaseMs: number | null; lossPct: number } | null
}

const dbmText = (v: number): string => `${v}`.replace('-', '−')

export function buildCheckVerdict(inp: CheckVerdictInput): Verdict {
  const issues: Issue[] = []
  const t = inp.target.stats
  const g = inp.gateway.stats
  const link = inp.link
  const wifi = link.wifi

  // Дом: роутер.
  let homeBad = false
  if (inp.gateway.replied && g) {
    const loss = g.lossPct
    const avg = g.avgMs ?? 0
    const jit = g.jitterMs ?? 0
    const fix =
      link.type === 'wifi' || link.type === 'wifi-unknown'
        ? 'Подойдите ближе к роутеру или подключите кабель. Если роутер двухдиапазонный, подключитесь к сети 5 ГГц.'
        : 'Проверьте кабель, перезагрузите роутер и посмотрите, не качает ли кто-то в сети (обновления, торренты, 4K-видео).'
    if (avg >= GATEWAY_BAD_MS || loss >= LOSS_BAD_PCT) {
      homeBad = true
      issues.push({
        id: 'gateway',
        severity: 'bad',
        title: `До роутера уже ${avg} мс${loss > 0 ? ` и теряется ${loss}% пакетов` : ''}. Проблема у вас дома.`,
        advice: fix,
        short: 'сеть дома работает плохо'
      })
    } else if (avg >= GATEWAY_WARN_MS || jit >= GATEWAY_JITTER_WARN_MS || loss >= LOSS_WARN_PCT) {
      homeBad = true
      issues.push({
        id: 'gateway',
        severity: 'warn',
        title: `До роутера ${avg} мс, разброс ±${jit} мс${loss > 0 ? `, потери ${loss}%` : ''}. Домашняя сеть работает неровно.`,
        advice: fix,
        short: 'дома неровная сеть'
      })
    } else {
      issues.push({ id: 'gateway', severity: 'ok', title: `Роутер отвечает быстро (${avg} мс), домашняя сеть в порядке.`, advice: '' })
    }
  } else if (!inp.gateway.found) {
    issues.push({ id: 'gateway', severity: 'info', title: 'Роутер не удалось найти или он не отвечает на пинг. Домашнюю сеть отдельно проверить нельзя.', advice: 'Ничего делать не нужно, но причину лагов придётся искать по остальным пунктам.' })
  } else {
    issues.push({ id: 'gateway', severity: 'info', title: 'Роутер не отвечает на пинг (часть роутеров закрывает его). Домашнюю сеть отдельно проверить нельзя.', advice: 'Ничего делать не нужно, но причину лагов придётся искать по остальным пунктам.' })
  }

  // Подключение.
  if (link.type === 'wired') {
    issues.push({ id: 'link', severity: 'ok', title: 'Компьютер подключён по кабелю, это хорошо для игры.', advice: '' })
  } else if (link.type === 'wifi' && wifi && wifi.rssiDbm != null) {
    const dbm = wifi.rssiDbm
    const band = wifi.band === '2.4' ? '2,4 ГГц' : wifi.band === '6' ? '6 ГГц' : wifi.band === '5' ? '5 ГГц' : null
    const desc = `${dbmText(dbm)} дБм${band ? `, ${band}` : ''}`
    if (dbm <= WIFI_BAD_DBM) {
      issues.push({
        id: 'wifi',
        severity: 'bad',
        title: `Очень слабый сигнал Wi-Fi (${desc}). Пакеты будут теряться.`,
        advice: 'Подойдите ближе к роутеру или подключите кабель. Это самое важное, что можно сделать.',
        short: 'Wi-Fi очень слабый'
      })
    } else if (dbm <= WIFI_WEAK_DBM) {
      issues.push({
        id: 'wifi',
        severity: 'warn',
        title: `Слабый сигнал Wi-Fi (${desc}).`,
        advice: 'Подойдите ближе к роутеру или подключите кабель.',
        short: 'сигнал Wi-Fi слабый'
      })
    } else if (dbm <= WIFI_MEDIUM_DBM) {
      issues.push({
        id: 'wifi',
        severity: 'info',
        title: `Сигнал Wi-Fi средний (${desc}).`,
        advice: 'Для игры лучше, чтобы между компьютером и роутером было поменьше стен. Кабель надёжнее.'
      })
    } else {
      issues.push({ id: 'wifi', severity: 'ok', title: `Сигнал Wi-Fi хороший (${desc}). Кабель всё равно стабильнее.`, advice: '' })
    }
    if (wifi.band === '2.4') {
      issues.push({
        id: 'band24',
        severity: homeBad ? 'warn' : 'info',
        title: 'Подключение идёт на частоте 2,4 ГГц. В этом диапазоне работают все соседские роутеры, поэтому он чаще даёт скачки пинга.',
        advice: 'Если роутер двухдиапазонный, подключитесь к сети 5 ГГц (часто она называется так же с припиской 5G).',
        short: homeBad ? 'Wi-Fi 2,4 ГГц перегружен' : undefined
      })
    }
  } else if (link.type === 'wifi' || link.type === 'wifi-unknown') {
    issues.push({
      id: 'wifi',
      severity: 'info',
      title: 'Компьютер подключён по Wi-Fi, но уровень сигнала определить не удалось.',
      advice: 'Для игры надёжнее кабель. На Windows 11 уровень сигнала может быть недоступен, если выключен доступ приложений к геолокации.'
    })
  }

  // Сервер.
  if (!inp.target.replied || !t) {
    issues.push({
      id: 'target-noreply',
      severity: 'info',
      title: 'Сервер не отвечает на пинг, поэтому пинг до него измерить не удалось.',
      advice: 'Выберите датацентр из списка рядом с полем (он отвечает на пинг) или проверьте, что IP указан верно.'
    })
  } else {
    const avg = t.avgMs ?? 0
    const jit = t.jitterMs ?? 0
    const homeCause = homeBad || link.type === 'wifi' || link.type === 'wifi-unknown'
    if (avg >= PING_BAD_MS) {
      issues.push({
        id: 'ping',
        severity: 'bad',
        title: `Пинг до сервера ${avg} мс. Это много для шутера.`,
        advice: 'Выберите сервер или датацентр ближе. Откройте вкладку «Оптимизатор»: трассировка покажет, на каком участке теряется время, а VPN-узел рядом с сервером иногда сокращает путь.',
        short: 'пинг высокий'
      })
    } else if (avg >= PING_WARN_MS) {
      issues.push({
        id: 'ping',
        severity: 'warn',
        title: `Пинг до сервера ${avg} мс. Играть можно, но реакция будет ощутимо запаздывать.`,
        advice: 'Если есть сервер ближе, выберите его. Вкладка «Оптимизатор» покажет путь до сервера.',
        short: 'пинг заметный'
      })
    } else {
      issues.push({ id: 'ping', severity: 'ok', title: `Пинг до сервера ${avg} мс, это хорошо.`, advice: '' })
    }
    if (jit >= JITTER_BAD_MS) {
      issues.push({
        id: 'jitter',
        severity: 'bad',
        title: `Пинг сильно скачет (разброс ±${jit} мс). В матче это выглядит как рывки и «телепорты».`,
        advice: homeCause ? 'Начните с дома: кабель вместо Wi-Fi, перезагрузка роутера, остановите загрузки.' : 'Дома всё ровно, значит причина дальше: у провайдера или на маршруте. Посмотрите трассировку на вкладке «Оптимизатор».',
        short: 'пинг сильно скачет'
      })
    } else if (jit >= JITTER_WARN_MS) {
      issues.push({
        id: 'jitter',
        severity: 'warn',
        title: `Пинг слегка скачет (разброс ±${jit} мс).`,
        advice: homeCause ? 'Помогает кабель вместо Wi-Fi и пауза загрузок на время матча.' : 'Дома всё ровно, значит скачки возникают у провайдера или на маршруте. Посмотрите трассировку на вкладке «Оптимизатор».',
        short: 'возможны скачки пинга'
      })
    } else {
      issues.push({ id: 'jitter', severity: 'ok', title: `Пинг ровный (разброс ±${jit} мс).`, advice: '' })
    }
    if (t.lossPct >= LOSS_BAD_PCT) {
      issues.push({
        id: 'loss',
        severity: 'bad',
        title: `До сервера теряется ${t.lossPct}% пакетов. В матче это рывки и «резиновые» возвраты.`,
        advice: homeCause ? 'Подключите кабель, перезагрузите роутер.' : 'Дома потерь нет, значит пакеты теряются у провайдера или на маршруте. Сообщите провайдеру или попробуйте другой датацентр.',
        short: 'теряются пакеты'
      })
    } else if (t.lossPct >= LOSS_WARN_PCT) {
      issues.push({
        id: 'loss',
        severity: 'warn',
        title: `Потеряно ${t.sent - t.received} из ${t.sent} пакетов до сервера.`,
        advice: 'Одиночная потеря бывает. Если повторяется, повторите проверку и сравните: стабильные потери говорят о проблеме в сети.',
        short: 'иногда теряются пакеты'
      })
    } else {
      issues.push({ id: 'loss', severity: 'ok', title: 'Потерь пакетов до сервера нет.', advice: '' })
    }
  }

  // Под нагрузкой.
  if (inp.load) {
    const l = inp.load
    if (l.grade === 'D') {
      issues.push({
        id: 'load',
        severity: 'bad',
        title: `Под нагрузкой пинг растёт на ${l.increaseMs ?? '?'} мс${l.lossPct ? ` и теряется ${l.lossPct}% пакетов` : ''}. Любая загрузка в сети превратит матч в слайд-шоу.`,
        advice: 'На время матча остановите загрузки (Steam, торренты, обновления) на всех устройствах. Надолго помогает функция SQM / Smart Queue в настройках роутера.',
        short: 'под нагрузкой сеть проседает'
      })
    } else if (l.grade === 'C') {
      issues.push({
        id: 'load',
        severity: 'warn',
        title: `Под нагрузкой пинг растёт на ${l.increaseMs ?? '?'} мс.`,
        advice: 'Не качайте ничего во время матча. В роутере можно включить SQM / Smart Queue.',
        short: 'загрузки в сети мешают игре'
      })
    } else if (l.grade === 'A' || l.grade === 'B') {
      issues.push({ id: 'load', severity: 'ok', title: 'Под нагрузкой пинг почти не растёт, загрузки в сети игре не мешают.', advice: '' })
    } else {
      issues.push({ id: 'load', severity: 'info', title: 'Проверку под нагрузкой выполнить не удалось (серверы для скачивания недоступны).', advice: 'Её можно повторить позже.' })
    }
  }

  const order: Record<Severity, number> = { bad: 0, warn: 1, info: 2, ok: 3 }
  issues.sort((a, b) => order[a.severity] - order[b.severity])

  const bad = issues.filter((i) => i.severity === 'bad')
  const warn = issues.filter((i) => i.severity === 'warn')
  if (bad.length) {
    return { kind: 'bad', headline: 'Будет лагать', issues }
  }
  if (warn.length) {
    const shorts = warn.map((i) => i.short).filter((s): s is string => !!s).slice(0, 2)
    return { kind: 'warn', headline: shorts.length ? `Играть можно, но ${shorts.join(' и ')}` : 'Играть можно, но есть замечания', issues }
  }
  if (!inp.target.replied) {
    return { kind: 'unknown', headline: 'Сервер не отвечает на пинг, оценить нельзя', issues }
  }
  return { kind: 'good', headline: 'Можно играть', issues }
}

// ---- детектор лагов --------------------------------------------------------------

export interface LagSettings {
  enabled: boolean
  /** Пинг выше обычного на столько мс — лаг. */
  spikeMs: number
  /** Столько потерянных пакетов подряд — лаг. */
  lossStreak: number
  /** Пауза между сигналами, секунд. */
  cooldownSec: number
  sound: boolean
  notify: boolean
}

export const DEFAULT_LAG_SETTINGS: LagSettings = {
  enabled: true,
  spikeMs: 40,
  lossStreak: 2,
  cooldownSec: 30,
  sound: true,
  notify: true
}

export interface LagEvent {
  kind: 'spike' | 'loss'
  at: number
  rttMs: number | null
  baselineMs: number | null
  lostInRow: number
  message: string
}

/** Сколько первых успешных замеров идёт на «обычный пинг». */
export const BASELINE_SAMPLES = 10

export interface LagDetector {
  push(rtt: number | null, now: number, s: LagSettings): LagEvent | null
  baseline(): number | null
}

/**
 * Следит за потоком замеров одной сессии. «Обычный пинг» — медиана первых десяти
 * полученных ответов; пока их меньше десяти, ловятся только потери подряд.
 * Между сигналами выдерживается пауза cooldownSec.
 */
export function createLagDetector(): LagDetector {
  const first: number[] = []
  let base: number | null = null
  let streak = 0
  let lastSignal = -Infinity
  return {
    baseline: () => base,
    push(rtt, now, s) {
      if (rtt == null) {
        streak++
      } else {
        streak = 0
        if (base == null) {
          first.push(rtt)
          if (first.length >= BASELINE_SAMPLES) base = Math.round(median(first) as number)
        }
      }
      if (!s.enabled) return null
      if (now - lastSignal < s.cooldownSec * 1000) return null
      if (rtt == null && streak >= s.lossStreak) {
        lastSignal = now
        return { kind: 'loss', at: now, rttMs: null, baselineMs: base, lostInRow: streak, message: `Потеряно пакетов подряд: ${streak}. Связь с сервером прерывается.` }
      }
      if (rtt != null && base != null && rtt > base + s.spikeMs) {
        lastSignal = now
        return { kind: 'spike', at: now, rttMs: rtt, baselineMs: base, lostInRow: 0, message: `Пинг ${rtt} мс при обычных ${base} мс.` }
      }
      return null
    }
  }
}

// ---- вердикт сессии --------------------------------------------------------------

export interface SessionStats extends SeriesStats {
  spikes: number
  lossBursts: number
}

export function buildSessionStats(samples: (number | null)[]): SessionStats {
  const base = summarizeSeries(samples)
  const sc = countSpikes(samples, base.medianMs)
  return { ...base, ...sc }
}

export function buildSessionVerdict(st: SessionStats, durationMs: number): { kind: VerdictKind; text: string } {
  if (st.received < REPORT_MIN_SAMPLES) {
    return { kind: 'unknown', text: st.received === 0 ? 'Ответов от сервера не было, оценить сессию нельзя.' : 'Сессия слишком короткая для выводов.' }
  }
  const hours = Math.max(durationMs, 10 * 60 * 1000) / 3_600_000
  const perHour = st.spikes / hours
  const jit = st.jitterMs ?? 0
  const parts: string[] = []
  let sev = 0
  if (st.lossPct >= REPORT_LOSS_BAD_PCT) {
    sev = 2
    parts.push(`теряли пакеты (${st.lossPct}%)`)
  } else if (st.lossPct >= REPORT_LOSS_WARN_PCT) {
    sev = Math.max(sev, 1)
    parts.push(`были потери пакетов (${st.lossPct}%)`)
  }
  if (perHour >= REPORT_SPIKES_PER_HOUR_BAD || jit >= REPORT_JITTER_BAD_MS) {
    sev = 2
    parts.push(`пинг сильно скакал (скачков: ${st.spikes})`)
  } else if (perHour >= REPORT_SPIKES_PER_HOUR_WARN || jit >= REPORT_JITTER_WARN_MS) {
    sev = Math.max(sev, 1)
    parts.push(`пинг временами скакал (скачков: ${st.spikes})`)
  }
  if (sev === 0) {
    return { kind: 'good', text: `Матч прошёл ровно: средний пинг ${st.avgMs} мс, потерь ${st.lossPct > 0 ? `${st.lossPct}%` : 'нет'}.` }
  }
  const head = sev === 2 ? 'Связь была нестабильной' : 'В целом нормально'
  return { kind: sev === 2 ? 'bad' : 'warn', text: `${head}: ${parts.join(', ')}. Средний пинг ${st.avgMs} мс.` }
}
