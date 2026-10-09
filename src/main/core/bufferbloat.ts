/**
 * Проверка «пинг под нагрузкой» (bufferbloat).
 *
 * Частая причина скачков пинга и потерь в матче — не сервер и не VPN, а
 * переполненная очередь в роутере/модеме, когда кто-то в сети качает
 * (обновление Steam, торрент, видео в 4K). Меряем пинг в покое, затем — пока
 * сами нагружаем канал скачиванием, — и сравниваем. Скачивание идёт с адреса
 * физического адаптера, мимо VPN, как и пинг.
 */
import https from 'node:https'
import http from 'node:http'
import { execFile } from 'node:child_process'
import { physicalSourceIp } from './core-probe'
import { appendLog } from './incy-engine'

export interface BufferbloatResult {
  target: string
  idle: { avgMs: number | null; maxMs: number | null; lossPct: number }
  loaded: { avgMs: number | null; maxMs: number | null; lossPct: number }
  /** Средняя скорость скачивания во время теста, Мбит/с. */
  downloadMbps: number | null
  increaseMs: number | null
  grade: 'A' | 'B' | 'C' | 'D' | 'unknown'
  verdict: string
}

const DOWNLOAD_URLS = [
  'https://speed.cloudflare.com/__down?bytes=300000000',
  'http://speedtest.tele2.net/1GB.zip',
  'https://proof.ovh.net/files/1Gb.dat'
]

function pingSeries(ip: string, count: number, src?: string): Promise<number[]> {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve([])
    execFile(
      'ping.exe',
      ['-n', String(count), '-w', '1000', ...(src ? ['-S', src] : []), ip],
      { windowsHide: true, timeout: count * 1500 + 3000, encoding: 'latin1' },
      (_e, stdout) => resolve([...String(stdout ?? '').matchAll(/[=<](\d+)\s*[^\s\d]{0,4}\s+TTL=/gi)].map((m) => Math.max(1, Number(m[1]))))
    )
  })
}

function summarize(r: number[], sent: number): BufferbloatResult['idle'] {
  return {
    avgMs: r.length ? Math.round(r.reduce((a, b) => a + b, 0) / r.length) : null,
    maxMs: r.length ? Math.max(...r) : null,
    lossPct: Math.round(((sent - r.length) / sent) * 100)
  }
}

/** Качать, пока не прервут; вернуть число байт. */
function download(url: string, src: string | undefined, signal: AbortSignal, onBytes: (n: number) => void): Promise<void> {
  return new Promise((resolve) => {
    const mod = url.startsWith('https:') ? https : http
    const req = mod.get(url, { ...(src ? { localAddress: src } : {}), headers: { 'User-Agent': 'LAZEYKA' }, timeout: 8000 }, (res) => {
      if ((res.statusCode ?? 0) >= 300) {
        res.resume()
        return resolve()
      }
      res.on('data', (d: Buffer) => onBytes(d.length))
      res.on('end', () => resolve())
      res.on('error', () => resolve())
    })
    req.on('error', () => resolve())
    req.on('timeout', () => req.destroy())
    signal.addEventListener('abort', () => {
      req.destroy()
      resolve()
    })
  })
}

export async function runBufferbloatTest(targetIp = '1.1.1.1'): Promise<BufferbloatResult> {
  const src = (await physicalSourceIp()) ?? undefined
  const idleR = await pingSeries(targetIp, 10, src)
  const idle = summarize(idleR, 10)

  // Нагрузка: два потока скачивания на ~10 секунд, пинг идёт параллельно.
  const ctrl = new AbortController()
  let bytes = 0
  let started = 0
  const loads: Promise<void>[] = []
  for (const url of DOWNLOAD_URLS) {
    // Первый источник, который начал отдавать данные, берём в два потока.
    const before = bytes
    const probe = download(url, src, ctrl.signal, (n) => {
      if (!started) started = Date.now()
      bytes += n
    })
    await new Promise((r) => setTimeout(r, 1500))
    if (bytes > before) {
      loads.push(probe, download(url, src, ctrl.signal, (n) => (bytes += n)))
      break
    }
  }
  const loadedR = await pingSeries(targetIp, 10, src)
  ctrl.abort()
  await Promise.all(loads).catch(() => void 0)
  const secs = started ? (Date.now() - started) / 1000 : 0
  const downloadMbps = secs > 1 && bytes > 0 ? Math.round(((bytes * 8) / secs / 1e6) * 10) / 10 : null
  const loaded = summarize(loadedR, 10)

  const increaseMs = idle.avgMs != null && loaded.avgMs != null ? loaded.avgMs - idle.avgMs : null
  let grade: BufferbloatResult['grade'] = 'unknown'
  let verdict: string
  if (downloadMbps == null) {
    verdict = 'Не удалось нагрузить канал (серверы скачивания недоступны) — проверка не состоялась.'
  } else if (increaseMs == null) {
    verdict = 'Пинг не измерился.'
  } else {
    grade = increaseMs < 5 ? 'A' : increaseMs < 30 ? 'B' : increaseMs < 100 ? 'C' : 'D'
    verdict =
      grade === 'A'
        ? 'Отлично: под нагрузкой пинг почти не растёт. Скачивания в сети на игру не влияют.'
        : grade === 'B'
          ? `Под нагрузкой пинг растёт на ${increaseMs} мс. Терпимо, но во время матча лучше не качать.`
          : `Под нагрузкой пинг растёт на ${increaseMs} мс${loaded.lossPct ? ` и теряется ${loaded.lossPct}% пакетов` : ''} — это bufferbloat. ` +
            'Когда кто-то в сети качает (Steam, торрент, обновления), в игре будут скачки и потери. Лечится в роутере: ' +
            'включите SQM / Smart Queue / «QoS» (fq_codel, CAKE) с ограничением скорости на 85–90% от тарифа, либо ограничьте скорость загрузки в Steam и торрент-клиенте.'
  }
  appendLog(
    `[под нагрузкой] ${targetIp}: покой ${idle.avgMs ?? '—'} мс, нагрузка ${loaded.avgMs ?? '—'} мс (потери ${loaded.lossPct}%), ` +
      `скачивание ${downloadMbps ?? '—'} Мбит/с, оценка ${grade}`,
    'exitlag'
  )
  return { target: targetIp, idle, loaded, downloadMbps, increaseMs, grade, verdict }
}
