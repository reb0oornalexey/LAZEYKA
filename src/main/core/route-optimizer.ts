/**
 * Оптимизатор маршрута ExitLag (Faceit / CS2 и любые Source-серверы).
 *
 * Что меряется — по-настоящему, а не «по расстоянию»:
 *   1. Прямой путь ПК → игровой сервер: A2S-запросы по UDP (как это делает
 *      браузер серверов Steam), при их отсутствии — ICMP-пинг.
 *   2. Путь ПК → узел VPN → игровой сервер для каждого узла подписки: для
 *      узла поднимается временное ядро (Xray или sing-box — то же, что
 *      использует туннель) с SOCKS5 на loopback, и A2S-запросы идут через его
 *      UDP ASSOCIATE. Это ровно тот путь, которым пойдёт UDP-трафик игры.
 *
 * По серии запросов считаются пинг (медиана), джиттер (среднее отклонение
 * соседних замеров) и потери. Итоговая оценка: пинг + 2×джиттер + 5 мс за
 * каждый процент потерь — стабильность в CS2 важнее пары миллисекунд.
 *
 * Если сервер не отвечает на A2S ни напрямую, ни через узлы (так бывает у
 * серверов с защитой от флуда), честно показывается оценка: задержка до узла
 * + расчёт по расстоянию до сервера, с пометкой «оценка».
 */
import net from 'node:net'
import dgram from 'node:dgram'
import { execFile } from 'node:child_process'
import { performance } from 'node:perf_hooks'
import { BrowserWindow } from 'electron'
import {
  loadIncyNodes,
  loadIncySettings,
  getIncyStatus,
  getLiveConnectionMode,
  connectIncyNode,
  selectIncyNode,
  isNodeAllowedForAuto,
  type IncyNode
} from './incy-engine'
import { startTempCore, withCoreSlot, physicalSourceIp, tcpRtt, icmpRtt, sleep, type TempCore } from './core-probe'
import {
  parseGameServerAddress,
  resolveGameServerGeo,
  calculateFiberRtt,
  type GameServerGeoInfo
} from './game-ping'

// ---- types -----------------------------------------------------------------

export type ProbeMethod = 'a2s' | 'icmp' | 'estimate' | 'failed'

export interface PathStats {
  method: ProbeMethod
  /** Медиана RTT, мс. */
  pingMs: number | null
  jitterMs: number | null
  /** Потери, % (0–100). */
  lossPct: number | null
  sent: number
  received: number
}

export interface NodeRouteResult {
  nodeId: string
  nodeName: string
  protocol: string
  server: string
  core: 'xray' | 'sing-box' | null
  /** Задержка ПК → узел (TCP), мс. */
  userToNodePing: number | null
  /** Через узел до игрового сервера. */
  path: PathStats
  /** Сколько узел выигрывает у прямого пути (мс, >0 — быстрее). */
  savingMs: number | null
  score: number | null
  isBest: boolean
  /** Узел разрешён правилами автовыбора. */
  autoAllowed?: boolean
  error?: string
  // Поля старого формата — чтобы не ломать страницу INCY.
  nodeToGamePing: number
  totalPing: number | null
}

export interface RouteOptimizerResult {
  targetHost: string
  targetPort: number
  targetIp: string
  geo: GameServerGeoInfo
  direct: PathStats
  /** Прямой замер прошёл через уже поднятый полный VPN — не «чистый» прямой. */
  directViaTunnel: boolean
  /** Сервер отвечает на A2S хотя бы по одному пути. */
  a2sSupported: boolean
  measuredNodes: number
  totalNodes: number
  nodes: NodeRouteResult[]
  warnings: string[]
  /** Узел, к которому оптимизатор подключился сам (настройка «Автоподключение»). */
  autoConnectedNodeId?: string
  // Поля старого формата.
  directPing: number | null
  directPingEstimated: boolean
}

// ---- constants -------------------------------------------------------------

const A2S_INFO = Buffer.concat([
  Buffer.from([0xff, 0xff, 0xff, 0xff, 0x54]),
  Buffer.from('Source Engine Query\0', 'ascii')
])
const SAMPLES = 20
const SAMPLE_GAP_MS = 50
const SAMPLE_TIMEOUT_MS = 900
/** Сколько узлов меряем глубоко (остальные отсекаются по задержке до узла). */
const DEEP_NODES = 12
const CONCURRENCY = 4

// ---- progress --------------------------------------------------------------

function progress(done: number, total: number, stage: string): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('exitlag:optimizerProgress', { done, total, stage })
  }
}

// ---- stats -----------------------------------------------------------------

function summarize(method: ProbeMethod, samples: (number | null)[]): PathStats {
  const ok = samples.filter((s): s is number => typeof s === 'number')
  const sent = samples.length
  if (ok.length === 0) return { method: 'failed', pingMs: null, jitterMs: null, lossPct: 100, sent, received: 0 }
  const sorted = [...ok].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  let jitter = 0
  for (let i = 1; i < ok.length; i++) jitter += Math.abs(ok[i] - ok[i - 1])
  jitter = ok.length > 1 ? jitter / (ok.length - 1) : 0
  return {
    method,
    pingMs: Math.round(median),
    jitterMs: Math.round(jitter * 10) / 10,
    lossPct: Math.round(((sent - ok.length) / sent) * 100),
    sent,
    received: ok.length
  }
}

function scoreOf(p: PathStats): number | null {
  if (p.pingMs == null) return null
  return Math.round(p.pingMs + 2 * (p.jitterMs ?? 0) + 5 * (p.lossPct ?? 0))
}


function isA2sReply(msg: Buffer): boolean {
  // FF FF FF FF + 'I' (info) / 'A' (challenge) / 'E' (multipacket split ответа)
  return msg.length >= 5 && msg.readInt32LE(0) === -1 && [0x49, 0x41, 0x6d].includes(msg[4])
}

/**
 * Серия A2S-запросов через уже открытый UDP-сокет. `wrap`/`unwrap` —
 * SOCKS5-заголовок для пути через узел (для прямого пути — тождественны).
 */
async function a2sSeries(
  sock: dgram.Socket,
  send: (payload: Buffer) => void,
  unwrap: (msg: Buffer) => Buffer | null
): Promise<(number | null)[]> {
  const results: (number | null)[] = []
  let pending: { start: number; resolve: (v: number | null) => void } | null = null
  const onMessage = (raw: Buffer): void => {
    const msg = unwrap(raw)
    if (!msg || !isA2sReply(msg) || !pending) return
    const p = pending
    pending = null
    p.resolve(performance.now() - p.start)
  }
  sock.on('message', onMessage)
  try {
    for (let i = 0; i < SAMPLES; i++) {
      const rtt = await new Promise<number | null>((resolve) => {
        const timer = setTimeout(() => {
          pending = null
          resolve(null)
        }, SAMPLE_TIMEOUT_MS)
        pending = {
          start: performance.now(),
          resolve: (v) => {
            clearTimeout(timer)
            resolve(v)
          }
        }
        try {
          send(A2S_INFO)
        } catch {
          clearTimeout(timer)
          pending = null
          resolve(null)
        }
      })
      results.push(rtt)
      // Первые три запроса без ответа — сервер A2S не отвечает, дальше не ждём.
      if (i === 2 && results.every((r) => r === null)) break
      // После таймаута ждём дольше: опоздавший ответ иначе засчитался бы
      // следующему запросу с почти нулевым RTT и занизил бы пинг узла.
      await sleep(rtt === null ? SAMPLE_GAP_MS + 300 : SAMPLE_GAP_MS)
    }
  } finally {
    sock.off('message', onMessage)
  }
  return results
}

// ---- direct path -------------------------------------------------------------

async function directA2s(ip: string, port: number, sourceIp?: string): Promise<(number | null)[]> {
  const sock = dgram.createSocket('udp4')
  try {
    // Привязка к физическому адаптеру — прямой замер идёт мимо поднятого TUN.
    await new Promise<void>((resolve, reject) => {
      sock.once('error', reject)
      if (sourceIp) sock.bind(0, sourceIp, () => resolve())
      else sock.bind(0, () => resolve())
    })
    return await a2sSeries(
      sock,
      (p) => sock.send(p, port, ip),
      (m) => m
    )
  } catch {
    return [null]
  } finally {
    try { sock.close() } catch { /* noop */ }
  }
}

/** ICMP-серия (ping.exe -n N). Разбор по «число перед TTL=» — работает в любой локали. */
function icmpSeries(ip: string, count = 10, sourceIp?: string): Promise<(number | null)[]> {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve([null])
    execFile(
      'ping.exe',
      ['-n', String(count), '-w', '1000', ...(sourceIp ? ['-S', sourceIp] : []), ip],
      { windowsHide: true, timeout: count * 1500 + 3000, encoding: 'latin1' },
      (_err, stdout) => {
        const text = String(stdout ?? '')
        const ok = [...text.matchAll(/[=<](\d+)\s*[^\s\d]{0,4}\s+TTL=/gi)].map((m) => Number(m[1]))
        const res: (number | null)[] = ok.map((v) => Math.max(1, v))
        while (res.length < count) res.push(null)
        resolve(res)
      }
    )
  })
}

// ---- per-node path via temporary core ---------------------------------------

/** SOCKS5 UDP ASSOCIATE → адрес UDP-релея. Управляющее TCP-соединение держим открытым. */
function socksUdpAssociate(port: number): Promise<{ ctrl: net.Socket; relayPort: number }> {
  return new Promise((resolve, reject) => {
    const ctrl = net.createConnection({ host: '127.0.0.1', port })
    let stage = 0
    let buf = Buffer.alloc(0)
    const fail = (e: Error): void => {
      ctrl.destroy()
      reject(e)
    }
    ctrl.setTimeout(4000, () => fail(new Error('SOCKS timeout')))
    ctrl.once('error', fail)
    // Закрытие до ответа — ошибка, а не вечное ожидание (после resolve
    // reject уже ничего не делает).
    ctrl.once('close', () => fail(new Error('SOCKS closed')))
    ctrl.once('connect', () => ctrl.write(Buffer.from([0x05, 0x01, 0x00])))
    ctrl.on('data', (d) => {
      buf = Buffer.concat([buf, d])
      if (stage === 0 && buf.length >= 2) {
        if (buf[0] !== 0x05 || buf[1] !== 0x00) return fail(new Error('SOCKS auth rejected'))
        buf = buf.subarray(2)
        stage = 1
        ctrl.write(Buffer.from([0x05, 0x03, 0x00, 0x01, 0, 0, 0, 0, 0, 0]))
      }
      if (stage === 1 && buf.length >= 10) {
        if (buf[1] !== 0x00) return fail(new Error(`SOCKS UDP ASSOCIATE refused (${buf[1]})`))
        const atyp = buf[3]
        const off = atyp === 0x01 ? 8 : atyp === 0x04 ? 20 : 5 + buf[4]
        if (buf.length < off + 2) return
        const relayPort = buf.readUInt16BE(off)
        ctrl.setTimeout(0)
        stage = 2
        resolve({ ctrl, relayPort })
      }
    })
  })
}

async function a2sViaSocks(socksPort: number, ip: string, port: number): Promise<(number | null)[]> {
  const { ctrl, relayPort } = await socksUdpAssociate(socksPort)
  const sock = dgram.createSocket('udp4')
  try {
    await new Promise<void>((resolve, reject) => {
      sock.once('error', reject)
      sock.bind(0, '127.0.0.1', () => resolve())
    })
    const header = Buffer.alloc(10)
    header[3] = 0x01
    ip.split('.').forEach((o, i) => (header[4 + i] = Number(o)))
    header.writeUInt16BE(port, 8)
    return await a2sSeries(
      sock,
      (p) => sock.send(Buffer.concat([header, p]), relayPort, '127.0.0.1'),
      (m) => {
        if (m.length < 10 || m[2] !== 0x00) return null
        const atyp = m[3]
        const off = atyp === 0x01 ? 10 : atyp === 0x04 ? 22 : 7 + m[4]
        return m.subarray(off)
      }
    )
  } finally {
    try { sock.close() } catch { /* noop */ }
    ctrl.destroy()
  }
}

// ---- user → node ----------------------------------------------------------------

async function userToNode(node: IncyNode): Promise<number | null> {
  // UDP-протоколы (Hysteria2, WireGuard) по TCP не ответят — берём последний
  // замер из списка узлов, если он свежий.
  // Сохранённый замер обнуляется через 15 минут и после перезапуска, и такие
  // узлы (часто лучшие для игр) не попадали в глубокий замер — меряем ICMP.
  if (node.protocol === 'hysteria2' || node.protocol === 'wireguard') {
    if (typeof node.latencyMs === 'number' && node.latencyMs > 0) return node.latencyMs
    return icmpRtt(node.server, 1500, await physicalSourceIp())
  }
  return tcpRtt(node.server, node.port, 1500, (await physicalSourceIp()) ?? undefined)
}

async function pool<T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

// ---- main ------------------------------------------------------------------------

let running = false

export async function optimizeRoute(input: string): Promise<RouteOptimizerResult> {
  if (running) throw new Error('Замер уже идёт — дождитесь результата.')
  running = true
  const temps: TempCore[] = []
  try {
    const parsed = parseGameServerAddress(input)
    if (!parsed) throw new Error('Не удалось распознать адрес. Вставьте строку «connect IP:порт» из комнаты матча.')

    const geo = await resolveGameServerGeo(parsed.host, parsed.port)
    const targetIp = geo.ip
    if (!net.isIPv4(targetIp)) throw new Error(`Не удалось определить IPv4-адрес сервера «${parsed.host}».`)
    const warnings: string[] = []

    const incy = getIncyStatus()
    const tunUp = getLiveConnectionMode() === 'tun'
    const sourceIp = tunUp ? ((await physicalSourceIp()) ?? undefined) : undefined
    const directViaTunnel = tunUp && !incy.exitLagActive && !sourceIp
    if (directViaTunnel) {
      warnings.push('Сейчас включён полный VPN, и обойти его для прямого замера не удалось — «прямой» пинг может идти через VPN.')
    }
    if (loadIncySettings().blockUdp) {
      warnings.push('В настройках INCY включена «Блокировка UDP» — CS2 работает по UDP и через VPN не пойдёт. Выключите её.')
    }

    // 1) Прямой путь.
    progress(0, 1, 'Замер прямого пути')
    let directSamples = await directA2s(targetIp, parsed.port, sourceIp)
    let direct = summarize('a2s', directSamples)
    if (direct.method === 'failed') {
      directSamples = await icmpSeries(targetIp, 10, sourceIp)
      direct = summarize('icmp', directSamples)
    }

    // 2) Отбор узлов по задержке ПК → узел.
    const all = loadIncyNodes().filter((n) => n.server && n.port)
    progress(0, all.length, 'Задержка до узлов')
    const u2n = await pool(all, 16, (n) => userToNode(n))
    const ranked = all
      .map((n, i) => ({ n, rtt: u2n[i] }))
      .sort((a, b) => (a.rtt ?? 1e9) - (b.rtt ?? 1e9))
    const deep = ranked.filter((r) => r.rtt !== null || r.n.protocol === 'hysteria2' || r.n.protocol === 'wireguard').slice(0, DEEP_NODES)
    if (incy.activeNodeId && !deep.some((d) => d.n.id === incy.activeNodeId)) {
      const active = ranked.find((r) => r.n.id === incy.activeNodeId)
      if (active) deep.push(active)
    }

    // 3) Глубокий замер через каждый узел.
    let done = 0
    progress(0, deep.length, 'Замер через узлы')
    const measured = await pool(deep, CONCURRENCY, async ({ n, rtt }): Promise<NodeRouteResult> => {
      const base: Omit<NodeRouteResult, 'path' | 'score' | 'savingMs' | 'totalPing' | 'nodeToGamePing'> = {
        nodeId: n.id,
        nodeName: n.name,
        protocol: n.protocol,
        server: n.server,
        core: null,
        userToNodePing: rtt,
        isBest: false
      }
      let pathStats: PathStats = { method: 'failed', pingMs: null, jitterMs: null, lossPct: null, sent: 0, received: 0 }
      let error: string | undefined
      try {
        await withCoreSlot(async () => {
          const tc = await startTempCore(n)
          temps.push(tc)
          base.core = tc.core
          try {
            pathStats = summarize('a2s', await a2sViaSocks(tc.port, targetIp, parsed.port))
          } finally {
            tc.stop()
          }
        })
      } catch (e) {
        error = e instanceof Error ? e.message : String(e)
      }
      progress(++done, deep.length, 'Замер через узлы')
      return {
        ...base,
        path: pathStats,
        error,
        score: null,
        savingMs: null,
        totalPing: null,
        nodeToGamePing: 0
      }
    })

    const a2sSupported = direct.method === 'a2s' || measured.some((m) => m.path.method === 'a2s')

    // 4) Сервер не отвечает на A2S — честная оценка вместо замера.
    if (!a2sSupported) {
      warnings.push(
        'Сервер не отвечает на игровые запросы (A2S) — задержку «через VPN до сервера» измерить нельзя. ' +
          'Показана оценка: задержка до узла + расчёт по расстоянию.'
      )
      const tLat = geo.lat
      const tLon = geo.lon
      for (const m of measured) {
        // Где сервер, неизвестно — оценивать по расстоянию не из чего.
        if (typeof tLat !== 'number' || typeof tLon !== 'number') break
        if (m.userToNodePing == null) continue
        let est: number | null = null
        try {
          const g = await resolveGameServerGeo(m.server, 443)
          if (typeof g.lat === 'number' && typeof g.lon === 'number') est = calculateFiberRtt(g.lat, g.lon, tLat, tLon)
        } catch { /* noop */ }
        if (est == null) continue
        m.path = {
          method: 'estimate',
          pingMs: m.userToNodePing + est,
          jitterMs: null,
          lossPct: null,
          sent: 0,
          received: 0
        }
      }
    }

    // 5) Итог.
    const directScore = scoreOf(direct)
    for (const m of measured) {
      m.score = scoreOf(m.path)
      m.totalPing = m.path.pingMs
      m.nodeToGamePing =
        m.path.pingMs != null && m.userToNodePing != null ? Math.max(0, m.path.pingMs - m.userToNodePing) : 0
      m.savingMs = direct.pingMs != null && m.path.pingMs != null ? direct.pingMs - m.path.pingMs : null
    }
    measured.sort((a, b) => (a.score ?? 1e9) - (b.score ?? 1e9))
    const best = measured.find((m) => m.score != null)
    if (best && (directScore == null || best.score! < directScore)) best.isBest = true

    // Автоподключение — только если пользователь сам включил его и лучший узел
    // измерен по-настоящему (не «оценка»).
    let autoConnectedNodeId: string | undefined
    // Для автоподключения — лучший среди узлов, разрешённых правилами автовыбора
    // (например, без узлов с ограниченным пакетом трафика).
    const settingsNow = loadIncySettings()
    const allowed = new Set(all.filter((n) => isNodeAllowedForAuto(n, settingsNow)).map((n) => n.id))
    const bestAllowed = measured.find((m) => m.score != null && allowed.has(m.nodeId))
    const bestNode =
      bestAllowed && (directScore == null || bestAllowed.score! < directScore) ? bestAllowed : undefined
    for (const m of measured) m.autoAllowed = allowed.has(m.nodeId)
    if (
      settingsNow.routeAutoConnectBest &&
      bestNode &&
      bestNode.path.method === 'a2s' &&
      bestNode.nodeId !== getIncyStatus().activeNodeId
    ) {
      try {
        selectIncyNode(bestNode.nodeId)
        await connectIncyNode(bestNode.nodeId)
        // connectIncyNode молча выходит, если подключение уже идёт, — сверяем.
        const st = getIncyStatus()
        if (st.state === 'running' && st.activeNodeId === bestNode.nodeId) autoConnectedNodeId = bestNode.nodeId
        else warnings.push(`Автоподключение к «${bestNode.nodeName}» не состоялось: идёт другое подключение.`)
      } catch (e) {
        warnings.push(`Автоподключение к «${bestNode.nodeName}» не удалось: ${e instanceof Error ? e.message : String(e)}`)
      }
    }

    return {
      targetHost: parsed.host,
      targetPort: parsed.port,
      targetIp,
      geo,
      direct,
      directViaTunnel,
      a2sSupported,
      measuredNodes: measured.length,
      totalNodes: all.length,
      nodes: measured,
      warnings,
      autoConnectedNodeId,
      directPing: direct.pingMs,
      directPingEstimated: false
    }
  } finally {
    for (const t of temps) t.stop()
    running = false
    progress(1, 1, 'Готово')
  }
}
