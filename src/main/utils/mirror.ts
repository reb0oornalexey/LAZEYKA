/**
 * Зеркало загрузок на SourceForge (его наполняет GitHub Actions
 * mirror-sourceforge.yml). Структура повторяет GitHub:
 *   github.com/<o>/<r>/releases/download/<tag>/<файл>
 *     → downloads.sourceforge.net/project/<проект>/mirror/<o>/<r>/<tag>/<файл>
 *   github.com/<o>/<r>/archive/refs/tags/<tag>.zip
 *     → …/mirror/<o>/<r>/<tag>/source.zip
 *
 * GitHub в РФ часто тормозит: если он не отвечает, отдаёт ошибку или качает
 * медленнее порога — переключаемся на зеркало.
 */
import { appLog } from './app-logger'

export const SF_PROJECT = 'lazeyka'
const SELF_OWNER = 'reb0oornalexey'
const SELF_REPO = 'lazeyka'
/** Ниже этой скорости (после разгона) GitHub считается «медленным». */
export const MIRROR_MIN_BYTES_PER_SEC = 200 * 1024
/** Сколько ждать, прежде чем судить о скорости. */
export const MIRROR_PROBE_MS = 8_000

export function sourceforgeUrlFor(url: string): string | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (u.hostname !== 'github.com') return null
  const rel = /^\/([^/]+)\/([^/]+)\/releases\/download\/([^/]+)\/(.+)$/.exec(u.pathname)
  // Релизы самой LAZEYKA SourceForge забирает сам («Import from GitHub»)
  // в папки /<tag>/ в корне проекта.
  if (rel && rel[1].toLowerCase() === SELF_OWNER && rel[2].toLowerCase() === SELF_REPO)
    return `https://downloads.sourceforge.net/project/${SF_PROJECT}/${rel[3]}/${rel[4]}`
  if (rel) return `https://downloads.sourceforge.net/project/${SF_PROJECT}/mirror/${rel[1]}/${rel[2]}/${rel[3]}/${rel[4]}`
  const arc = /^\/([^/]+)\/([^/]+)\/archive\/refs\/tags\/(.+)\.zip$/.exec(u.pathname)
  if (arc) return `https://downloads.sourceforge.net/project/${SF_PROJECT}/mirror/${arc[1]}/${arc[2]}/${arc[3]}/source.zip`
  return null
}

async function readAll(res: Response, signal: { slow: boolean }, checkSpeed: boolean): Promise<Buffer> {
  if (!res.body) return Buffer.from(await res.arrayBuffer())
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let got = 0
  const t0 = Date.now()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    got += value.length
    if (checkSpeed) {
      const ms = Date.now() - t0
      if (ms > MIRROR_PROBE_MS && got / (ms / 1000) < MIRROR_MIN_BYTES_PER_SEC) {
        signal.slow = true
        await reader.cancel().catch(() => void 0)
        throw new Error(`GitHub качает слишком медленно (${Math.round(got / 1024 / (ms / 1000))} КБ/с)`)
      }
    }
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c)))
}

/**
 * fetch для файлов с GitHub с запасным путём через зеркало. Возвращает
 * Response с уже скачанным телом (вызывающий код делает arrayBuffer() как раньше).
 */
export async function fetchWithMirror(url: string, init: RequestInit = {}): Promise<Response> {
  const mirror = sourceforgeUrlFor(url)
  if (!mirror) return fetch(url, init)
  const flag = { slow: false }
  try {
    // Таймаут только на ответ сервера: само скачивание может идти дольше,
    // его скорость следит readAll.
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 20_000)
    let res: Response
    try {
      res = await fetch(url, { ...init, signal: ctrl.signal })
    } finally {
      clearTimeout(t)
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const body = await readAll(res, flag, true)
    return new Response(new Uint8Array(body), { status: 200, headers: res.headers })
  } catch (e) {
    appLog('warn', `[mirror] GitHub: ${e instanceof Error ? e.message : String(e)} — качаю с зеркала SourceForge`)
    const res = await fetch(mirror, { ...init, redirect: 'follow' })
    if (!res.ok) throw new Error(`Не скачалось ни с GitHub, ни с зеркала (HTTP ${res.status})`)
    const body = await readAll(res, flag, false)
    return new Response(new Uint8Array(body), { status: 200, headers: res.headers })
  }
}
