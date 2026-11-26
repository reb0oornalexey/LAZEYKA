/**
 * Проверки доступности для автоподбора стратегии Zapret.
 *
 * Только модули Node (net/tls/dns), без Electron — разбор и решения проверяются
 * node-скриптом. Запросы идут с адреса физического адаптера (если он передан):
 * на Windows такой сокет уходит мимо TUN-адаптера VPN — как другие проверки
 * «мимо VPN» в проекте. Системные настройки не трогаются.
 *
 * Что смотрим по каждой цели (как utils/test zapret.ps1 у Flowseal):
 *  - HEAD / отдельно по TLS 1.2 и TLS 1.3 — на каком этапе обрывается
 *    (DNS, TCP, TLS-рукопожатие, HTTP-ответ);
 *  - для целей за Cloudflare — проверка «обрыв на 16–20 КБ» (hyperion-cs/dpi-checkers
 *    tcp-16-20): POST 64 КБ; «вероятно блокировка», если отправлено больше 0,
 *    получено 0 и упёрлись в таймаут.
 */
import net from 'node:net'
import tls from 'node:tls'
import dns from 'node:dns'
import { randomBytes } from 'node:crypto'
import type { FamilyId, TcpParams } from './zapret-model'
import { FAKE_4PDA, FAKE_GOOGLE, FAKE_STUN, familySpec } from './zapret-model'

// ---- Цели -------------------------------------------------------------------------

export interface ProbeTarget {
  id: string
  label: string
  host: string
  /** Проверять «обрыв на 16–20 КБ» (сайт за Cloudflare). */
  stall: boolean
}

/** Пять целей, как группы в HTTP_TARGETS тестера и targets.txt Flowseal. */
export const PROBE_TARGETS: readonly ProbeTarget[] = [
  { id: 'discord', label: 'Discord', host: 'discord.com', stall: true },
  { id: 'youtube', label: 'YouTube', host: 'www.youtube.com', stall: false },
  { id: 'googlevideo', label: 'Видео YouTube', host: 'redirector.googlevideo.com', stall: false },
  { id: 'google', label: 'Google', host: 'www.google.com', stall: false },
  { id: 'cloudflare', label: 'Cloudflare', host: 'www.cloudflare.com', stall: true }
]

export type TlsVer = '1.2' | '1.3'

/** До какого этапа дошёл запрос. 'ok' — пришёл HTTP-ответ. */
export type Stage = 'ok' | 'dns' | 'tcp' | 'tls' | 'http' | 'cert'

export interface CheckResult {
  stage: Stage
  /** Причина: timeout | reset | refused | closed | cert | другое (код ошибки Node). */
  why?: string
  ms: number
}

export interface StallResult {
  /** Похоже на обрыв по объёму: отправили > 0, получили 0, упёрлись в таймаут. */
  stalled: boolean
  sent: number
  received: number
  /** Рукопожатие не прошло — проверка объёма не имела смысла. */
  noHandshake: boolean
}

export interface ProbeOpts {
  timeoutMs: number
  localAddress?: string
  /** Отмена извне (кнопка «Остановить»). */
  signal?: AbortSignal
  /** Только для node-теста: свой корневой сертификат. */
  ca?: string
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'

const CERT_ERR = /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER|ALTNAME|HOSTNAME|DEPTH_ZERO/i

/** Адрес IPv4 по системному DNS с таймаутом (getaddrinfo без него может висеть десятки секунд). */
export async function resolve4(host: string, timeoutMs = 3000): Promise<string | null> {
  if (net.isIPv4(host)) return host
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      dns.promises.lookup(host, { family: 4 }).then((r) => r.address),
      new Promise<null>((r) => {
        timer = setTimeout(() => r(null), timeoutMs)
      })
    ])
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Адреса из диапазона «фейковых» DNS VPN-клиентов (198.18.0.0/15): напрямую до них не достучаться. */
export function isFakeIp(ip: string): boolean {
  const m = /^198\.(18|19)\./.exec(ip)
  return Boolean(m)
}

function errWhy(e: unknown): string {
  const code = (e as NodeJS.ErrnoException)?.code ?? ''
  if (CERT_ERR.test(code) || CERT_ERR.test(String((e as Error)?.message ?? ''))) return 'cert'
  if (code === 'ECONNRESET' || code === 'EPIPE') return 'reset'
  if (code === 'ECONNREFUSED') return 'refused'
  if (code === 'ETIMEDOUT') return 'timeout'
  return code || 'error'
}

interface Session {
  socket: tls.TLSSocket
  done: (r: CheckResult) => void
}

/**
 * TCP → TLS (заданной версии) → `onSecure`. Возвращает этап, на котором всё закончилось.
 * Каждый этап отмечается отдельно, чтобы отличить блокировку IP от блокировки по имени сайта.
 */
function tlsSession(
  host: string,
  ip: string,
  ver: TlsVer,
  o: ProbeOpts,
  onSecure: (s: Session) => void,
  onTimeoutAfterSecure: () => CheckResult
): Promise<CheckResult> {
  return new Promise((resolve) => {
    const t0 = Date.now()
    let stage: 'tcp' | 'tls' | 'http' = 'tcp'
    let finished = false
    let raw: net.Socket | null = null
    let sec: tls.TLSSocket | null = null
    const finish = (r: CheckResult): void => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      o.signal?.removeEventListener('abort', onAbort)
      try {
        sec?.destroy()
      } catch {
        /* уже закрыт */
      }
      try {
        raw?.destroy()
      } catch {
        /* уже закрыт */
      }
      resolve({ ...r, ms: Date.now() - t0 })
    }
    const onAbort = (): void => finish({ stage, why: 'cancelled', ms: 0 })
    const timer = setTimeout(() => {
      if (stage === 'http') finish(onTimeoutAfterSecure())
      else finish({ stage, why: 'timeout', ms: 0 })
    }, o.timeoutMs)
    if (o.signal?.aborted) return onAbort()
    o.signal?.addEventListener('abort', onAbort, { once: true })
    try {
      raw = net.connect({ host: ip, port: 443, localAddress: o.localAddress, family: 4 })
    } catch (e) {
      return finish({ stage: 'tcp', why: errWhy(e), ms: 0 })
    }
    raw.once('error', (e) => finish({ stage, why: errWhy(e), ms: 0 }))
    raw.once('connect', () => {
      if (finished) return
      stage = 'tls'
      const v = ver === '1.2' ? 'TLSv1.2' : 'TLSv1.3'
      try {
        sec = tls.connect({
          socket: raw!,
          servername: host,
          minVersion: v,
          maxVersion: v,
          ALPNProtocols: ['http/1.1'],
          rejectUnauthorized: true,
          ...(o.ca ? { ca: o.ca } : {})
        })
      } catch (e) {
        return finish({ stage: 'tls', why: errWhy(e), ms: 0 })
      }
      sec.once('error', (e) => {
        const why = errWhy(e)
        finish({ stage: why === 'cert' ? 'cert' : stage, why, ms: 0 })
      })
      sec.once('close', () => finish({ stage, why: 'closed', ms: 0 }))
      sec.once('secureConnect', () => {
        if (finished) return
        stage = 'http'
        onSecure({ socket: sec!, done: finish })
      })
    })
  })
}

/** HEAD / по TLS заданной версии: любой HTTP-ответ — «открывается» (как curl -I у Flowseal). */
export async function checkHttps(host: string, ip: string | null, ver: TlsVer, o: ProbeOpts): Promise<CheckResult> {
  if (!ip) return { stage: 'dns', why: 'nxdomain', ms: 0 }
  return tlsSession(
    host,
    ip,
    ver,
    o,
    ({ socket, done }) => {
      let head = ''
      socket.on('data', (d: Buffer) => {
        head += d.toString('latin1')
        if (head.length >= 12 || head.includes('\r\n')) {
          done(/^HTTP\/\d(?:\.\d)?\s+\d{3}/.test(head) ? { stage: 'ok', ms: 0 } : { stage: 'http', why: 'bad-response', ms: 0 })
        }
      })
      socket.write(`HEAD / HTTP/1.1\r\nHost: ${host}\r\nUser-Agent: ${UA}\r\nAccept: */*\r\nConnection: close\r\n\r\n`)
    },
    () => ({ stage: 'http', why: 'timeout', ms: 0 })
  )
}

const STALL_BYTES = 65536

/** Проверка «обрыв на 16–20 КБ»: POST 64 КБ с Range, как tcp-16-20 у hyperion-cs/dpi-checkers. */
export async function checkStall(host: string, ip: string | null, o: ProbeOpts): Promise<StallResult> {
  if (!ip) return { stalled: false, sent: 0, received: 0, noHandshake: true }
  let sent = 0
  let received = 0
  const r = await tlsSession(
    host,
    ip,
    '1.3',
    o,
    ({ socket, done }) => {
      socket.on('data', (d: Buffer) => {
        received += d.length
        done({ stage: 'ok', ms: 0 })
      })
      const head =
        `POST / HTTP/1.1\r\nHost: ${host}\r\nUser-Agent: ${UA}\r\nAccept: */*\r\nRange: bytes=0-${STALL_BYTES - 1}\r\n` +
        `Content-Type: application/octet-stream\r\nContent-Length: ${STALL_BYTES}\r\nConnection: close\r\n\r\n`
      socket.write(head)
      const body = randomBytes(STALL_BYTES)
      // Частями по 4 КБ: bytesWritten растёт по мере того, как данные уходят в сокет.
      for (let off = 0; off < body.length; off += 4096) socket.write(body.subarray(off, off + 4096))
      sent = socket.bytesWritten
      const tick = setInterval(() => {
        sent = socket.bytesWritten
      }, 100)
      socket.once('close', () => clearInterval(tick))
      socket.once('error', () => clearInterval(tick))
    },
    () => ({ stage: 'http', why: 'timeout', ms: 0 })
  )
  const noHandshake = r.stage === 'tcp' || r.stage === 'tls' || r.stage === 'dns'
  return { stalled: !noHandshake && r.stage === 'http' && r.why === 'timeout' && sent > 0 && received === 0, sent, received, noHandshake }
}

// ---- Диагностика без Zapret (шаг 0) ----------------------------------------------

export type Verdict = 'ok' | 'sni' | 'stall' | 'ip' | 'dns' | 'cert' | 'fakeip' | 'other'

export interface TargetDiag {
  id: string
  label: string
  host: string
  ip: string | null
  tls12: CheckResult
  tls13: CheckResult
  stall?: StallResult
  verdict: Verdict
}

/**
 * Вердикт по цели. Порядок важен: сначала то, что Zapret не исправит (DNS, IP,
 * подмена сертификата), потом блокировка по имени (рукопожатие не проходит),
 * потом обрыв потока (рукопожатие прошло, а ответа нет или поток замер на 16–20 КБ).
 */
export function classifyTarget(ip: string | null, tls12: CheckResult, tls13: CheckResult, stall?: StallResult): Verdict {
  if (!ip) return 'dns'
  if (isFakeIp(ip)) return 'fakeip'
  const both = [tls12, tls13]
  if (both.every((r) => r.stage === 'ok')) return stall?.stalled ? 'stall' : 'ok'
  if (both.some((r) => r.stage === 'cert')) return 'cert'
  if (both.every((r) => r.stage === 'tcp')) return 'ip'
  if (both.some((r) => r.stage === 'tls')) return 'sni'
  if (both.some((r) => r.stage === 'http')) return 'stall'
  // Одна версия прошла, вторая оборвалась на TCP — похоже на нестабильную сеть.
  return 'other'
}

/** Что Zapret может исправить. */
export function isFixable(v: Verdict): boolean {
  return v === 'sni' || v === 'stall'
}

export interface DiagSummary {
  /** Все цели открываются и без Zapret. */
  allOk: boolean
  sni: boolean
  stall: boolean
  /** Есть цели, которые Zapret не исправит (IP, DNS, подмена). */
  unfixable: Verdict[]
}

export function summarize(diag: TargetDiag[]): DiagSummary {
  const v = diag.map((d) => d.verdict)
  return {
    allOk: v.every((x) => x === 'ok'),
    sni: v.includes('sni'),
    stall: v.includes('stall'),
    unfixable: [...new Set(v.filter((x) => x === 'ip' || x === 'dns' || x === 'cert' || x === 'fakeip' || x === 'other'))]
  }
}

/** Цели, по которым оценивается стратегия: открывавшиеся и исправимые (IP/DNS не считаются — Zapret их не откроет). */
export function scoredTargets(diag: TargetDiag[]): TargetDiag[] {
  return diag.filter((d) => d.verdict === 'ok' || isFixable(d.verdict))
}

export async function diagnose(targets: readonly ProbeTarget[], o: ProbeOpts): Promise<TargetDiag[]> {
  const ips = await Promise.all(targets.map((t) => resolve4(t.host)))
  return Promise.all(
    targets.map(async (t, i) => {
      const ip = ips[i]
      const [tls12, tls13, stall] = await Promise.all([
        checkHttps(t.host, ip, '1.2', o),
        checkHttps(t.host, ip, '1.3', o),
        t.stall ? checkStall(t.host, ip, { ...o, timeoutMs: Math.max(o.timeoutMs, 5000) }) : Promise.resolve(undefined)
      ])
      return { id: t.id, label: t.label, host: t.host, ip, tls12, tls13, stall, verdict: classifyTarget(ip, tls12, tls13, stall) }
    })
  )
}

// ---- Оценка стратегии -------------------------------------------------------------

export interface TargetScore {
  id: string
  label: string
  tls12: boolean
  tls13: boolean
  /** null — проверка объёма не делалась. */
  stallOk: boolean | null
  ok: boolean
}

export interface EvalResult {
  targets: TargetScore[]
  okChecks: number
  totalChecks: number
  /** Доля пройденных проверок 0..1. */
  score: number
  /** Все оцениваемые цели открылись по TLS 1.2 и 1.3 (и без обрыва по объёму). */
  allOpen: boolean
}

/** Проверить уже работающую стратегию на целях (параллельно). Цели с stall=true проверяются и на обрыв. */
export async function evaluateTargets(
  targets: { id: string; label: string; host: string; ip: string | null; stall: boolean }[],
  o: ProbeOpts
): Promise<EvalResult> {
  const res = await Promise.all(
    targets.map(async (t) => {
      const [a, b, s] = await Promise.all([
        checkHttps(t.host, t.ip, '1.2', o),
        checkHttps(t.host, t.ip, '1.3', o),
        t.stall ? checkStall(t.host, t.ip, { ...o, timeoutMs: Math.max(o.timeoutMs, 5000) }) : Promise.resolve(undefined)
      ])
      return { t, a, b, s }
    })
  )
  return scoreEval(
    res.map(({ t, a, b, s }) => ({ id: t.id, label: t.label, tls12: a.stage === 'ok', tls13: b.stage === 'ok', stall: s }))
  )
}

export function scoreEval(rows: { id: string; label: string; tls12: boolean; tls13: boolean; stall?: StallResult }[]): EvalResult {
  let okChecks = 0
  let totalChecks = 0
  const targets: TargetScore[] = rows.map((r) => {
    const stallOk = r.stall ? !r.stall.stalled && !r.stall.noHandshake : null
    totalChecks += 2 + (stallOk === null ? 0 : 1)
    okChecks += (r.tls12 ? 1 : 0) + (r.tls13 ? 1 : 0) + (stallOk ? 1 : 0)
    return { id: r.id, label: r.label, tls12: r.tls12, tls13: r.tls13, stallOk, ok: r.tls12 && r.tls13 && stallOk !== false }
  })
  return {
    targets,
    okChecks,
    totalChecks,
    score: totalChecks ? okChecks / totalChecks : 0,
    allOpen: targets.length > 0 && targets.every((x) => x.ok)
  }
}

// ---- Порядок семейств (эвристика) --------------------------------------------------

/**
 * Порядок проверки приёмов при блокировке по имени сайта (рукопожатие не проходит).
 * Эвристика по стратегиям Flowseal, не измерение:
 *  - multisplit + seqovl — основа general.bat (стратегия «по умолчанию» Flowseal):
 *    наложение чужих байт прячет имя сайта, подделок нет — меньше всего ломает;
 *  - fake + hostfakesplit (ALT3) — подменяет имя сайта, которое видит фильтр;
 *  - fake ts (ALT10) — простая подделка первого пакета;
 *  - fake + multidisorder midsld (FAKE TLS AUTO) — режет посередине имени и шлёт задом наперёд;
 *  - затем «тяжёлые» и badseq-варианты.
 */
const ORDER_SNI: readonly FamilyId[] = [
  'multisplit-seqovl',
  'fake-hostfakesplit',
  'fake-ts',
  'fake-multidisorder',
  'fakedsplit',
  'fake-multisplit-seqovl',
  'fake-multisplit-badseq',
  'fake-badseq'
]

/**
 * Порядок при обрыве по объёму (рукопожатие прошло, поток замер на 16–20 КБ).
 * Такой фильтр отслеживает поток после рукопожатия; помогает то, что сбивает
 * ему разбор соединения с самого начала: подделки + разрезание (fakedsplit ts —
 * ALT, тоже эвристика), обратный порядок частей (multidisorder), подделки +
 * наложение (ALT11), badseq-разрезание (ALT4).
 */
const ORDER_STALL: readonly FamilyId[] = [
  'fakedsplit',
  'fake-multidisorder',
  'fake-multisplit-seqovl',
  'fake-multisplit-badseq',
  'multisplit-seqovl',
  'fake-hostfakesplit',
  'fake-ts',
  'fake-badseq'
]

/**
 * Семейства в порядке проверки. syndata (ALT5, «не рекомендуется» у Flowseal) и
 * hostfakesplit без подделки (ALT9, частный случай ALT3) в автоподбор не входят —
 * их можно выбрать в конструкторе вручную.
 */
export function orderFamilies(kind: { sni: boolean; stall: boolean }): FamilyId[] {
  if (kind.sni && !kind.stall) return [...ORDER_SNI]
  if (kind.stall && !kind.sni) return [...ORDER_STALL]
  // Оба вида (или неясно): сумма мест в двух списках, при равенстве — порядок «по имени».
  const rank = (f: FamilyId): number => ORDER_SNI.indexOf(f) + ORDER_STALL.indexOf(f)
  return [...ORDER_SNI].sort((a, b) => rank(a) - rank(b) || ORDER_SNI.indexOf(a) - ORDER_SNI.indexOf(b))
}

/**
 * 2–4 уточнения чисел внутри семейства — значения, которые Flowseal сам
 * использует в соседних стратегиях этого семейства.
 */
export function refineVariants(family: FamilyId, base: TcpParams): { label: string; tcp: TcpParams }[] {
  const v = (label: string, patch: Partial<TcpParams>): { label: string; tcp: TcpParams } => ({
    label,
    tcp: { ...base, fooling: [...base.fooling], fakeTls: [...base.fakeTls], ...patch }
  })
  const out: { label: string; tcp: TcpParams }[] = []
  switch (family) {
    case 'fakedsplit':
      out.push(v('больше повторов (8)', { repeats: 8 }))
      out.push(v('метка badseq вместо ts (как FAKE TLS AUTO ALT)', { fooling: ['badseq'], badseqIncrement: 2, repeats: 8, splitPos: '1' }))
      out.push(v('подделка 4pda', { fakeTls: [FAKE_STUN, FAKE_4PDA] }))
      out.push(v('ещё больше повторов (11)', { repeats: 11 }))
      break
    case 'multisplit-seqovl':
      out.push(v('наложение 681, разрез 1 (general)', { seqovl: 681, splitPos: '1' }))
      out.push(v('наложение 568, узор 4pda', { seqovl: 568, splitPos: '1', seqovlPattern: FAKE_4PDA }))
      out.push(v('наложение 679, разрез у имени сайта (ALT7)', { seqovl: 679, splitPos: '2,sniext+1' }))
      break
    case 'fake-hostfakesplit':
      out.push(v('имя www.google.com', { host: 'www.google.com', tlsSni: 'www.google.com' }))
      out.push(v('повторы 4', { repeats: 4 }))
      out.push(v('метки ts + md5sig', { fooling: ['ts', 'md5sig'] }))
      break
    case 'fake-multisplit-badseq':
      out.push(v('больше повторов (8)', { repeats: 8 }))
      out.push(v('сдвиг номера 2', { badseqIncrement: 2 }))
      out.push(v('повторов 11', { repeats: 11 }))
      break
    case 'fake-badseq':
      out.push(v('больше повторов (8)', { repeats: 8 }))
      out.push(v('сдвиг номера 1000', { badseqIncrement: 1000 }))
      out.push(v('повторов 11', { repeats: 11 }))
      break
    case 'fake-ts':
      out.push(v('больше повторов (8)', { repeats: 8 }))
      out.push(v('подделка www.google.com', { fakeTls: [FAKE_STUN, FAKE_GOOGLE] }))
      out.push(v('повторов 11', { repeats: 11 }))
      break
    case 'fake-multisplit-seqovl':
      out.push(v('наложение 681, узор google', { seqovl: 681, seqovlPattern: FAKE_GOOGLE }))
      out.push(v('наложение 568', { seqovl: 568 }))
      out.push(v('повторов 11', { repeats: 11 }))
      break
    case 'fake-multidisorder':
      out.push(v('метка ts вместо badseq', { fooling: ['ts'] }))
      out.push(v('меньше повторов (6)', { repeats: 6 }))
      out.push(v('сдвиг номера 2', { badseqIncrement: 2 }))
      break
    case 'hostfakesplit':
      out.push(v('имя www.google.com', { host: 'www.google.com' }))
      out.push(v('только метка ts', { fooling: ['ts'] }))
      break
    case 'syndata':
      break
  }
  const uses = familySpec(family).uses
  const same = (a: TcpParams): boolean =>
    uses.every((k) => JSON.stringify(a[k]) === JSON.stringify(base[k]))
  return out.filter((x) => !same(x.tcp)).slice(0, 4)
}

/** Пояснение к вердикту простыми словами. */
export function verdictText(v: Verdict): string {
  switch (v) {
    case 'ok':
      return 'открывается'
    case 'sni':
      return 'блокировка по имени сайта: соединение обрывается в самом начале'
    case 'stall':
      return 'соединение есть, но данные перестают идти (обрыв на 16–20 КБ)'
    case 'ip':
      return 'адрес недоступен целиком — Zapret тут не поможет, нужен VPN'
    case 'dns':
      return 'адрес сайта не нашёлся — проверьте DNS'
    case 'cert':
      return 'вместо сайта отвечает заглушка (подмена) — обычно помогает другой DNS'
    case 'fakeip':
      return 'адрес выдан VPN-программой — проверка мимо VPN невозможна'
    default:
      return 'нестабильная сеть'
  }
}
