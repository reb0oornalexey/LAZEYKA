/**
 * Диагностика пути до игрового сервера — как WinMTR, но мимо поднятого TUN.
 *
 *  1. Трассировка: ping.exe с растущим TTL (`-i N`) и адресом физического
 *     адаптера (`-S`). Обычный tracert так не умеет (у него -S только для
 *     IPv6), и при включённом VPN показывал бы путь в туннель.
 *  2. По 10 пингов каждому найденному узлу одновременно: средняя задержка,
 *     разброс и потери.
 *  3. Вывод: на каком участке появляется задержка — дома (роутер/Wi-Fi), у
 *     провайдера или дальше — и есть ли потери, которые доходят до сервера.
 *
 * Потери на промежуточном узле, которые не повторяются дальше, — это не
 * потери: маршрутизаторы отвечают на ICMP по остаточному принципу. Настоящие
 * потери видны на последнем узле.
 */
import { execFile } from 'node:child_process'
import net from 'node:net'
import dns from 'node:dns'
import { physicalSourceIp } from './core-probe'
import { parseGameServerAddress } from './game-ping'
import { appendLog } from './incy-engine'

export interface TraceHop {
  hop: number
  ip: string | null
  avgMs: number | null
  minMs: number | null
  maxMs: number | null
  lossPct: number | null
  /** Прирост задержки относительно предыдущего ответившего узла. */
  deltaMs: number | null
  isPrivate: boolean
}

export interface TraceResult {
  target: string
  targetIp: string
  reached: boolean
  hops: TraceHop[]
  /** Узел, на котором задержка выросла сильнее всего. */
  biggestJump: { hop: number; ip: string | null; deltaMs: number } | null
  verdict: string[]
  viaPhysical: boolean
}

const MAX_HOPS = 24

function runPing(args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve('')
    execFile('ping.exe', args, { windowsHide: true, timeout: timeoutMs, encoding: 'latin1' }, (_e, stdout) =>
      resolve(String(stdout ?? ''))
    )
  })
}

/** IPv4 из первой строки ответа (строки ответа содержат «TTL»: и «TTL=55», и «TTL expired»). */
function hopFromTtlPing(out: string): string | null {
  for (const line of out.split(/\r?\n/)) {
    if (!/TTL/i.test(line)) continue
    const m = /(\d{1,3}(?:\.\d{1,3}){3})/.exec(line)
    if (m) return m[1]
  }
  return null
}

function rtts(out: string): number[] {
  return [...out.matchAll(/[=<](\d+)\s*[^\s\d]{0,4}\s+TTL=/gi)].map((m) => Math.max(1, Number(m[1])))
}

function isPrivateIp(ip: string): boolean {
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|127\.)/.test(ip)
}

export async function traceRoute(input: string): Promise<TraceResult> {
  const parsed = parseGameServerAddress(input)
  const host = parsed?.host ?? input.trim()
  if (!host) throw new Error('Укажите IP или строку «connect IP:порт»')
  let ip = host
  if (!net.isIPv4(ip)) {
    try {
      ip = (await dns.promises.lookup(host, { family: 4 })).address
    } catch {
      throw new Error(`Не удалось узнать IP для «${host}»`)
    }
  }
  const src = (await physicalSourceIp()) ?? undefined
  const srcArgs = src ? ['-S', src] : []

  // 1. Все TTL одновременно — около секунды вместо полуминуты.
  const ttls = Array.from({ length: MAX_HOPS }, (_, i) => i + 1)
  const found = await Promise.all(
    ttls.map(async (ttl) => hopFromTtlPing(await runPing(['-n', '1', '-w', '1000', '-i', String(ttl), ...srcArgs, ip], 4000)))
  )
  const lastIdx = found.indexOf(ip)
  const reached = lastIdx >= 0
  const used = found.slice(0, reached ? lastIdx + 1 : found.length)
  // Хвост из неответивших узлов после последнего ответившего не показываем.
  while (used.length > 0 && used[used.length - 1] == null) used.pop()

  // 2. По 10 пингов каждому узлу, параллельно.
  const stats = await Promise.all(
    used.map(async (hopIp) => {
      if (!hopIp) return null
      const r = rtts(await runPing(['-n', '10', '-w', '1000', ...srcArgs, hopIp], 20000))
      return {
        avg: r.length ? Math.round(r.reduce((a, b) => a + b, 0) / r.length) : null,
        min: r.length ? Math.min(...r) : null,
        max: r.length ? Math.max(...r) : null,
        loss: Math.round(((10 - r.length) / 10) * 100)
      }
    })
  )

  const hops: TraceHop[] = []
  let prevAvg: number | null = 0
  for (let i = 0; i < used.length; i++) {
    const st = stats[i]
    const avg = st?.avg ?? null
    hops.push({
      hop: i + 1,
      ip: used[i],
      avgMs: avg,
      minMs: st?.min ?? null,
      maxMs: st?.max ?? null,
      lossPct: st ? st.loss : null,
      deltaMs: avg != null && prevAvg != null ? avg - prevAvg : null,
      isPrivate: used[i] ? isPrivateIp(used[i]!) : false
    })
    if (avg != null) prevAvg = avg
  }

  let biggestJump: TraceResult['biggestJump'] = null
  for (const h of hops) {
    if (h.deltaMs != null && h.deltaMs > (biggestJump?.deltaMs ?? 4)) biggestJump = { hop: h.hop, ip: h.ip, deltaMs: h.deltaMs }
  }

  // 3. Выводы простыми словами.
  const verdict: string[] = []
  const first = hops[0]
  const last = hops[hops.length - 1]
  if (first?.avgMs != null && first.isPrivate && first.avgMs >= 5) {
    verdict.push(`До вашего роутера уже ${first.avgMs} мс — это проблема дома: Wi-Fi, перегруженный роутер или кабель. Подключитесь кабелем и перезагрузите роутер.`)
  }
  if (first?.maxMs != null && first.isPrivate && first.maxMs - (first.minMs ?? 0) > 15) {
    verdict.push('До роутера задержка скачет — так ведёт себя Wi-Fi или загруженная сеть дома (кто-то качает/смотрит видео).')
  }
  if (biggestJump && biggestJump.deltaMs >= 10) {
    verdict.push(
      `Больше всего задержки (+${biggestJump.deltaMs} мс) добавляется на ${biggestJump.hop}-м узле (${biggestJump.ip ?? '—'}). ` +
        (biggestJump.hop <= 3
          ? 'Это сеть вашего провайдера.'
          : 'Это магистраль/стык провайдеров — маршрут выбирает провайдер. Обойти его можно узлом VPN, который ближе к серверу (например, в том же городе), — сравните узлы кнопкой «Замерить пинг».')
    )
  }
  if (reached && last?.lossPct != null && last.lossPct > 0) {
    verdict.push(`До самого сервера теряется ${last.lossPct}% пакетов — это реальные потери. Найдите первый узел, с которого потери идут до конца, — там и проблема.`)
  } else if (hops.some((h) => (h.lossPct ?? 0) > 0) && reached && (last?.lossPct ?? 0) === 0) {
    verdict.push('Потери на промежуточных узлах есть, но до сервера пакеты доходят все — это не потери: роутеры просто реже отвечают на пинг.')
  }
  if (!reached) verdict.push('Сервер не отвечает на пинг (ICMP закрыт) — показан путь до последнего ответившего узла.')
  if (verdict.length === 0) verdict.push('Маршрут ровный: задержка растёт плавно, потерь нет.')

  appendLog(
    `[трассировка] ${ip}: ${hops.length} узлов, до сервера ${last?.avgMs ?? '—'} мс` +
      (biggestJump ? `, больший прирост +${biggestJump.deltaMs} мс на узле ${biggestJump.hop} (${biggestJump.ip})` : ''),
    'exitlag'
  )
  return { target: host, targetIp: ip, reached, hops, biggestJump, verdict, viaPhysical: Boolean(src) }
}
