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
import { updateFetch } from '../core/update-route'
import { createHash } from 'node:crypto'
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

/** Сколько ждать ответа сервера (заголовков). */
const RESPONSE_TIMEOUT_MS = 20_000
/** Сколько терпеть тишину посреди скачивания («полумёртвая» сеть держит соединение открытым). */
const STALL_TIMEOUT_MS = 30_000

async function readAll(res: Response, signal: { slow: boolean }, checkSpeed: boolean): Promise<Buffer> {
  if (!res.body) return Buffer.from(await res.arrayBuffer())
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let got = 0
  const t0 = Date.now()
  for (;;) {
    let stall: ReturnType<typeof setTimeout> | null = null
    const step = await Promise.race([
      reader.read(),
      new Promise<'stall'>((r) => {
        stall = setTimeout(() => r('stall'), STALL_TIMEOUT_MS)
      })
    ]).finally(() => {
      if (stall) clearTimeout(stall)
    })
    if (step === 'stall') {
      await reader.cancel().catch(() => void 0)
      throw new Error(`скачивание остановилось: ${STALL_TIMEOUT_MS / 1000} с без данных`)
    }
    const { done, value } = step
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

/** fetch с таймаутом на ответ сервера (тело читается отдельно со сторожем простоя). */
async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), RESPONSE_TIMEOUT_MS)
  const outer = init.signal
  const onAbort = (): void => ctrl.abort()
  if (outer) {
    if (outer.aborted) ctrl.abort()
    else outer.addEventListener('abort', onAbort, { once: true })
  }
  try {
    // Е6: через VPN INCY, если так настроено и он подключён (иначе напрямую).
    return await updateFetch(url, { ...init, signal: ctrl.signal })
  } catch (e) {
    if (ctrl.signal.aborted && !outer?.aborted) throw new Error(`сервер не ответил за ${RESPONSE_TIMEOUT_MS / 1000} с`)
    throw e
  } finally {
    clearTimeout(t)
    outer?.removeEventListener('abort', onAbort)
  }
}

/** «sha256:<64 hex>» или просто 64 hex → нижний регистр; иначе null. */
export function normalizeSha256(digest: string | null | undefined): string | null {
  const m = /^(?:sha256:)?([0-9a-f]{64})$/i.exec(String(digest ?? '').trim())
  return m ? m[1].toLowerCase() : null
}

export function sha256Hex(buf: Uint8Array): string {
  return createHash('sha256').update(buf).digest('hex')
}

export interface MirrorOptions {
  /**
   * Ожидаемая сумма SHA-256 (из поля `digest` ассета в API релизов GitHub).
   * Если задана — файл с любого источника сверяется с ней, при несовпадении
   * ошибка и ничего не возвращается.
   */
  sha256?: string | null
  /**
   * Без суммы зеркалу не доверять: файл с SourceForge нечем проверить, а он
   * потом запускается с правами администратора. Тогда при сбое GitHub — ошибка.
   */
  mirrorRequiresDigest?: boolean
}

function verify(body: Buffer, expected: string | null, where: string): void {
  if (!expected) return
  const got = sha256Hex(body)
  if (got !== expected) {
    appLog('warn', `[mirror] ${where}: контрольная сумма не совпала (ждали ${expected}, получили ${got})`)
    throw new Error(`Контрольная сумма файла (${where}) не совпала с опубликованной на GitHub — установка отменена`)
  }
}

/**
 * fetch для файлов с GitHub с запасным путём через зеркало. Возвращает
 * Response с уже скачанным телом (вызывающий код делает arrayBuffer() как раньше).
 */
export async function fetchWithMirror(url: string, init: RequestInit = {}, opts: MirrorOptions = {}): Promise<Response> {
  const expected = normalizeSha256(opts.sha256)
  const mirror = sourceforgeUrlFor(url)
  if (!mirror) {
    const res = await fetchWithTimeout(url, init)
    if (!res.ok) return res
    const body = await readAll(res, { slow: false }, false)
    verify(body, expected, 'GitHub')
    return new Response(new Uint8Array(body), { status: 200, headers: res.headers })
  }
  const flag = { slow: false }
  let fromGithub: Buffer
  try {
    // Таймаут только на ответ сервера: само скачивание может идти дольше,
    // его скорость и простой проверяет readAll.
    const res = await fetchWithTimeout(url, init)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    fromGithub = await readAll(res, flag, true)
    const headers = res.headers
    verify(fromGithub, expected, 'GitHub')
    return new Response(new Uint8Array(fromGithub), { status: 200, headers })
  } catch (e) {
    // Несовпадение суммы с GitHub — не повод идти на зеркало.
    if (e instanceof Error && e.message.startsWith('Контрольная сумма')) throw e
    if (!expected && opts.mirrorRequiresDigest) {
      throw new Error(
        `GitHub не отдал файл (${e instanceof Error ? e.message : String(e)}), а скачать с зеркала без контрольной суммы небезопасно. Попробуйте позже`
      )
    }
    appLog('warn', `[mirror] GitHub: ${e instanceof Error ? e.message : String(e)} — качаю с зеркала SourceForge`)
    const res = await fetchWithTimeout(mirror, { ...init, redirect: 'follow' })
    if (!res.ok) throw new Error(`Не скачалось ни с GitHub, ни с зеркала (HTTP ${res.status})`)
    const body = await readAll(res, flag, false)
    verify(body, expected, 'зеркало SourceForge')
    return new Response(new Uint8Array(body), { status: 200, headers: res.headers })
  }
}
