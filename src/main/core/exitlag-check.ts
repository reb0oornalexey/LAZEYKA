/**
 * Живая проверка ExitLag: с какого IP выходят приложения НЕ из списка и с
 * какого — приложения из списка.
 *
 *  - «не из списка»: запрос делает сам процесс LAZEYKA. В режиме ExitLag его
 *    нет в списке, поэтому ядро обязано пустить его напрямую — должен
 *    получиться IP провайдера. Если тут IP VPN, значит туннель забирает всё.
 *  - «из списка»: тот же запрос через временное ядро с подключённым узлом —
 *    ровно так выходят приложения из списка.
 */
import { appendLog, getIncyStatus, loadIncyNodes, loadIncySettings, normalizePerAppList } from './incy-engine'
import { startTempCore, socksConnect, withCoreSlot } from './core-probe'
import path from 'node:path'
import { app } from 'electron'

export interface ExitIp {
  ip: string | null
  country?: string
  countryCode?: string
  isp?: string
  error?: string
}

export interface ExitLagCheckResult {
  exitLagActive: boolean
  mode: 'proxy_only' | 'bypass_only'
  /** Как выходит в сеть приложение не из списка (сама LAZEYKA). */
  outside: ExitIp
  /** Как выходит приложение из списка (через подключённый узел). */
  listed: ExitIp
  /** LAZEYKA сама в списке — тогда «не из списка» проверить ею нельзя. */
  selfListed: boolean
  verdict: 'ok' | 'leak' | 'unknown'
  message: string
}

const IP_API = { host: 'ip-api.com', path: '/json/?fields=status,query,country,countryCode,isp&lang=ru' }

function parseIpApi(text: string): ExitIp {
  try {
    const body = text.slice(text.indexOf('{'))
    const j = JSON.parse(body) as { status?: string; query?: string; country?: string; countryCode?: string; isp?: string }
    if (j.query) return { ip: j.query, country: j.country, countryCode: j.countryCode, isp: j.isp }
  } catch {
    /* ниже */
  }
  return { ip: null, error: 'непонятный ответ сервиса' }
}

async function directExit(): Promise<ExitIp> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 8000)
    const res = await fetch(`http://${IP_API.host}${IP_API.path}`, { signal: ctrl.signal })
    clearTimeout(t)
    return parseIpApi(await res.text())
  } catch (e) {
    return { ip: null, error: e instanceof Error ? e.message : String(e) }
  }
}

async function exitViaNode(nodeId: string): Promise<ExitIp> {
  const node = loadIncyNodes().find((n) => n.id === nodeId)
  if (!node) return { ip: null, error: 'узел не найден' }
  return withCoreSlot(async () => {
    let tc: Awaited<ReturnType<typeof startTempCore>> | null = null
    try {
      tc = await startTempCore(node)
      const sock = await socksConnect(tc.port, IP_API.host, 80, 8000)
      const text = await new Promise<string>((resolve) => {
        let buf = ''
        const timer = setTimeout(() => resolve(buf), 8000)
        sock.on('data', (d: Buffer) => (buf += d.toString('utf-8')))
        sock.once('close', () => {
          clearTimeout(timer)
          resolve(buf)
        })
        sock.once('error', () => {
          clearTimeout(timer)
          resolve(buf)
        })
        sock.write(`GET ${IP_API.path} HTTP/1.1\r\nHost: ${IP_API.host}\r\nUser-Agent: LAZEYKA\r\nConnection: close\r\n\r\n`)
      })
      sock.destroy()
      return parseIpApi(text)
    } catch (e) {
      return { ip: null, error: e instanceof Error ? e.message : String(e) }
    } finally {
      tc?.stop()
    }
  })
}

export async function checkExitLag(): Promise<ExitLagCheckResult> {
  const st = getIncyStatus()
  const settings = loadIncySettings()
  const mode = settings.perAppMode === 'bypass_only' ? 'bypass_only' : 'proxy_only'
  const list = normalizePerAppList(settings.perAppProcesses).map((p) => p.toLowerCase())
  const selfName = path.basename(app.getPath('exe')).toLowerCase()
  const selfListed = list.includes(selfName)
  const nodeId = st.activeNodeId ?? st.selectedNodeId ?? null

  const [outside, listed] = await Promise.all([
    directExit(),
    nodeId ? exitViaNode(nodeId) : Promise.resolve<ExitIp>({ ip: null, error: 'узел не выбран' })
  ])

  const exitLagActive = st.state === 'running' && Boolean(st.exitLagActive)
  let verdict: ExitLagCheckResult['verdict'] = 'unknown'
  let message: string
  if (!exitLagActive) {
    message = 'ExitLag сейчас не работает: подключите INCY с включённым ExitLag и повторите проверку.'
  } else if (selfListed) {
    message = `${selfName} есть в списке ExitLag — проверить «не из списка» этим способом нельзя.`
  } else if (!outside.ip || !listed.ip) {
    message = `Не удалось узнать IP: ${outside.error ?? listed.error ?? 'нет ответа'}`
  } else if (mode === 'proxy_only') {
    if (outside.ip === listed.ip) {
      verdict = 'leak'
      message = 'Приложения не из списка выходят с IP VPN — туннель забирает весь трафик. Сохраните логи и пришлите их.'
    } else {
      verdict = 'ok'
      message = 'ExitLag работает: приложения не из списка идут напрямую (IP провайдера), из списка — через VPN.'
    }
  } else {
    // «Все, кроме выбранных»: LAZEYKA не в списке исключений → должна идти через VPN.
    if (outside.ip === listed.ip) {
      verdict = 'ok'
      message = 'Режим исключений работает: всё, кроме приложений из списка, идёт через VPN.'
    } else {
      verdict = 'leak'
      message = 'В режиме исключений приложение не из списка идёт мимо VPN.'
    }
  }
  appendLog(
    `Проверка ExitLag: не из списка → ${outside.ip ?? '—'} (${outside.countryCode ?? outside.error ?? '?'}), ` +
      `из списка → ${listed.ip ?? '—'} (${listed.countryCode ?? listed.error ?? '?'}) — ${verdict}`,
    'exitlag'
  )
  return { exitLagActive, mode, outside, listed, selfListed, verdict, message }
}
