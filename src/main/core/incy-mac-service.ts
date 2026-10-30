/**
 * macOS: режим TUN через root-службу `lxd` из ядра sing-box-lx.
 *
 * На Windows приложение запущено с правами администратора и само порождает
 * sing-box с wintun. На Mac приложение работает от обычного пользователя, а
 * создать utun может только root. Ядро sing-box-lx умеет быть своим
 * привилегированным демоном (`sing-box lxd`, docs-lx/lxd-daemon.md):
 *
 *   1. «Установить службу» — один раз, через системное окно пароля (osascript):
 *      `sing-box lxd --service install --invite-out <файл>`. Демон кладёт
 *      root-копию ядра в /Library/PrivilegedHelperTools/sing-box-lxd, ставит
 *      LaunchDaemon и пишет одноразовое приглашение `адрес#отпечаток#код`.
 *   2. Сопряжение: читаем приглашение, делаем самоподписанный сертификат,
 *      POST /admin/enroll по mTLS с пином отпечатка сервера. Идентичность
 *      (сертификат+ключ) и пин лежат в dataDir с правами 600.
 *   3. Подключение: конфиг sing-box уходит в POST /admin/apply (демон сам
 *      проверит его `sing-box check`, при неудаче откатится на last-good),
 *      остановка — POST /admin/stop. Пароль больше не нужен.
 *   4. DNS: ядро системный DNS не трогает, поэтому при установке в каталог
 *      хуков службы кладутся post_start/post_stop (root-владелец, как требует
 *      демон) и включается `hooks` в daemon.json.
 *
 * xray (мост) по-прежнему запускает само приложение от пользователя.
 */
import { execFile, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import path from 'node:path'
import { BrowserWindow } from 'electron'
import { dataDir, incyBinaryPath } from '../utils/dirs'
import { appLog } from '../utils/app-logger'
import {
  HOOK_POST_START,
  HOOK_POST_STOP,
  buildAdminScript,
  daemonError,
  isOsascriptCancel,
  makeClientIdentity,
  parseIdentity,
  parseInvite,
  pinnedRequest,
  readableOsascriptError,
  serializeIdentity,
  shQuote,
  stripAnsi,
  type ClientIdentity,
  type PinnedTarget
} from './incy-mac-lxd'

const IS_MAC = process.platform === 'darwin'

const SUPPORT_DIR = '/Library/Application Support/sing-box-lxd'
const STATE_DIR = `${SUPPORT_DIR}/state`
const HOOKS_DIR = `${STATE_DIR}/hooks`
const DAEMON_JSON = `${STATE_DIR}/daemon.json`
const SIDECAR = '/Library/PrivilegedHelperTools/sing-box-lxd.install.json'
const PLIST = '/Library/LaunchDaemons/com.leadaxe.sing-box-lxd.plist'
const CLIENT_NAME = 'LAZEYKA'
const HOOKS_JSON = '{"enabled":true,"timeout_seconds":15}'

export type MacServiceStateId =
  | 'unsupported'
  | 'not_installed'
  | 'not_paired'
  | 'needs_update'
  | 'not_running'
  | 'ready'

export interface MacServiceInfo {
  state: MacServiceStateId
  installed: boolean
  paired: boolean
  /** Версия ядра в установленной службе (из sidecar). */
  serviceVersion?: string
  /** Версия ядра, которое лежит в приложении. */
  bundledVersion?: string
  detail?: string
}

export interface MacServiceResult {
  ok: boolean
  cancelled?: boolean
  message: string
  info: MacServiceInfo
}

/** Событие для окна: «нужна / нужно обновить службу». */
export interface MacServiceNotice {
  reason: 'required' | 'update'
  state: MacServiceStateId
  message: string
}

/** Подключение в TUN невозможно, пока служба не установлена и не сопряжена. */
export class MacServiceRequiredError extends Error {
  readonly state: MacServiceStateId
  constructor(state: MacServiceStateId, message: string) {
    super(message)
    this.name = 'MacServiceRequiredError'
    this.state = state
  }
}

const REQUIRED_TEXT =
  'Для режима TUN на macOS нужна служба LAZEYKA с правами администратора. Пароль спросят один раз.'

// ---- Хранилище идентичности ----------------------------------------------------

function identityDir(): string {
  return path.join(dataDir(), 'macos-service')
}
const identityFile = (): string => path.join(identityDir(), 'client.pem')
const pinFile = (): string => path.join(identityDir(), 'pin.json')
const inviteFile = (): string => path.join(identityDir(), 'invite.txt')

interface Pin {
  address: string
  fingerprint: string
}

function ensureIdentityDir(): void {
  mkdirSync(identityDir(), { recursive: true, mode: 0o700 })
  chmodSync(identityDir(), 0o700)
}

/** Файл создаётся сразу с правами 600 (не «записали, потом сузили»). */
function writePrivate(file: string, content: string): void {
  writeFileSync(file, content, { mode: 0o600 })
  chmodSync(file, 0o600) // уже существовавший файл сохраняет старый режим
}

function loadTarget(): PinnedTarget | null {
  try {
    if (!existsSync(identityFile()) || !existsSync(pinFile())) return null
    const identity = parseIdentity(readFileSync(identityFile(), 'utf-8'))
    const pin = JSON.parse(readFileSync(pinFile(), 'utf-8')) as Pin
    if (!identity || !pin.address || !pin.fingerprint) return null
    return { address: pin.address, fingerprint: pin.fingerprint, identity }
  } catch {
    return null
  }
}

function forgetIdentity(): void {
  for (const f of [identityFile(), pinFile(), inviteFile()]) {
    try {
      rmSync(f, { force: true })
    } catch {
      /* noop */
    }
  }
}

// ---- Версия и хэш ядра приложения ------------------------------------------------

let bundledHashCache: { key: string; sha: string } | null = null

async function bundledSha256(bin: string): Promise<string> {
  const st = statSync(bin)
  const key = `${bin}:${st.size}:${st.mtimeMs}`
  if (bundledHashCache?.key === key) return bundledHashCache.sha
  const sha = await new Promise<string>((resolve, reject) => {
    const h = createHash('sha256')
    const s = createReadStream(bin)
    s.on('data', (c) => h.update(c))
    s.on('error', reject)
    s.on('end', () => resolve(h.digest('hex')))
  })
  bundledHashCache = { key, sha }
  return sha
}

let bundledVersionCache: { bin: string; version: string } | null = null

function bundledVersion(bin: string): Promise<string | undefined> {
  if (bundledVersionCache?.bin === bin) return Promise.resolve(bundledVersionCache.version)
  return new Promise((resolve) => {
    execFile(bin, ['version'], { timeout: 4000 }, (err, stdout) => {
      const m = err ? null : /version\s+(\d+\.\d+\.\d+\S*)/i.exec(String(stdout))
      if (m) bundledVersionCache = { bin, version: m[1] }
      resolve(m ? m[1] : undefined)
    })
  })
}

interface Sidecar {
  sha256?: string
  version?: string
}

function readSidecar(): Sidecar | null {
  try {
    return JSON.parse(readFileSync(SIDECAR, 'utf-8')) as Sidecar
  } catch {
    return null
  }
}

// ---- Состояние службы -------------------------------------------------------------

export async function macServiceState(): Promise<MacServiceInfo> {
  if (!IS_MAC) return { state: 'unsupported', installed: false, paired: false }
  const installed = existsSync(PLIST) && existsSync(SIDECAR)
  const target = loadTarget()
  const paired = Boolean(target)
  if (!installed) return { state: 'not_installed', installed: false, paired }

  const sidecar = readSidecar()
  const bin = incyBinaryPath()
  let outdated = false
  let bundled: string | undefined
  try {
    if (existsSync(bin)) {
      bundled = await bundledVersion(bin)
      // Копия сервиса побайтово равна ядру, из которого её ставили, поэтому
      // сравниваем хэши (версия в sidecar — только для показа).
      if (sidecar?.sha256) outdated = sidecar.sha256 !== (await bundledSha256(bin))
    }
  } catch {
    /* не смогли сравнить — считаем, что обновление не нужно */
  }
  const base = { installed: true, paired, serviceVersion: sidecar?.version, bundledVersion: bundled }
  if (!target) return { state: 'not_paired', ...base }

  let reach: 'ok' | 'untrusted' | 'down' = 'down'
  try {
    const r = await pinnedRequest(target, 'GET', 'status', undefined, 3000)
    reach = r.status === 200 ? 'ok' : r.status === 403 ? 'untrusted' : 'down'
  } catch {
    reach = 'down'
  }
  if (reach === 'untrusted') return { state: 'not_paired', ...base, detail: 'служба не узнаёт это приложение' }
  if (outdated) return { state: 'needs_update', ...base }
  if (reach === 'down') return { state: 'not_running', ...base, detail: 'служба не отвечает' }
  return { state: 'ready', ...base }
}

/** Окно приложения должно показать диалог службы. */
export function notifyMacService(notice: MacServiceNotice): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('macService:notice', notice)
  }
}

/**
 * Проверка перед подключением в TUN. Устаревшая служба не мешает работать —
 * её только предлагают обновить; всё остальное — отказ с понятным текстом
 * (окно с кнопкой «Установить службу» показывается отдельно).
 */
export async function ensureMacServiceReady(): Promise<void> {
  const info = await macServiceState()
  if (info.state === 'ready') return
  if (info.state === 'needs_update') {
    appLog('warn', `[mac-service] служба ${info.serviceVersion ?? '?'} старше ядра в приложении ${info.bundledVersion ?? '?'}`)
    notifyMacService({
      reason: 'update',
      state: info.state,
      message: 'Служба LAZEYKA устарела: в приложении более новое ядро. Обновите службу (спросят пароль).'
    })
    return
  }
  if (info.state === 'not_running') {
    throw new MacServiceRequiredError(
      info.state,
      'Служба LAZEYKA установлена, но не отвечает. Попробуйте «Обновить службу» в Настройках или перезагрузите Mac.'
    )
  }
  notifyMacService({ reason: 'required', state: info.state, message: REQUIRED_TEXT })
  throw new MacServiceRequiredError(info.state, REQUIRED_TEXT)
}

// ---- Установка и удаление ---------------------------------------------------------

function runElevated(shellCommand: string): Promise<{ ok: boolean; cancelled: boolean; error: string }> {
  return new Promise((resolve) => {
    // Пароль вводится в системное окно и до нас не доходит.
    execFile(
      '/usr/bin/osascript',
      ['-e', buildAdminScript(shellCommand)],
      { timeout: 10 * 60_000, maxBuffer: 4 * 1024 * 1024 },
      (err, _stdout, stderr) => {
        const text = String(stderr || (err ? err.message : ''))
        if (!err) return resolve({ ok: true, cancelled: false, error: '' })
        if (isOsascriptCancel(text)) return resolve({ ok: false, cancelled: true, error: '' })
        resolve({ ok: false, cancelled: false, error: readableOsascriptError(text) || 'неизвестная ошибка' })
      }
    )
  })
}

/** Команда установки: подготовка хуков, `--service install`, выдача приглашения пользователю. */
export function buildInstallCommand(bin: string, invite: string, uid: number): string {
  const b64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64')
  const writeHook = (name: string, body: string): string[] => [
    `printf %s ${shQuote(b64(body))} | /usr/bin/base64 -D > ${shQuote(`${HOOKS_DIR}/${name}`)}`,
    `/bin/chmod 0755 ${shQuote(`${HOOKS_DIR}/${name}`)}`
  ]
  return [
    // Каталоги и хуки готовим ДО установки: демон при старте создаёт заглушки
    // только для отсутствующих скриптов, а hooks в daemon.json читает на первом
    // же запуске. Всё принадлежит root и не доступно на запись остальным —
    // демон проверяет это перед каждым запуском хука.
    `/bin/mkdir -p ${shQuote(HOOKS_DIR)}`,
    `/bin/chmod 0700 ${shQuote(SUPPORT_DIR)} ${shQuote(STATE_DIR)}`,
    `/bin/chmod 0755 ${shQuote(HOOKS_DIR)}`,
    ...writeHook('post_start', HOOK_POST_START),
    ...writeHook('post_stop', HOOK_POST_STOP),
    `/usr/sbin/chown -R root:wheel ${shQuote(SUPPORT_DIR)}`,
    // daemon.json: нет файла — создаём с включёнными хуками; есть, но без
    // секции hooks (чужая установка) — дописываем её. Остальное install
    // достроит сам (адрес, tls, секрет) и сохранит наши hooks.
    `{ [ -f ${shQuote(DAEMON_JSON)} ] || { printf '%s\\n' ${shQuote(`{"hooks":${HOOKS_JSON}}`)} > ${shQuote(DAEMON_JSON)} && /bin/chmod 0600 ${shQuote(DAEMON_JSON)}; }; }`,
    `{ /usr/bin/grep -q '"hooks"' ${shQuote(DAEMON_JSON)} || /usr/bin/plutil -insert hooks -json ${shQuote(HOOKS_JSON)} ${shQuote(DAEMON_JSON)}; }`,
    // Единственная команда, которая делает работу службы: документированный install.
    `${shQuote(bin)} lxd --service install --invite-out ${shQuote(invite)} --invite-name ${CLIENT_NAME}`,
    // Файл создан root'ом с правами 600 — отдаём его пользователю, чтобы прочитать код.
    `/usr/sbin/chown ${uid} ${shQuote(invite)}`
  ].join(' && ')
}

async function pairFromInvite(): Promise<void> {
  const file = inviteFile()
  const text = readFileSync(file, 'utf-8')
  const invite = parseInvite(text)
  if (!invite) throw new Error('приглашение службы непонятного вида')
  const identity = makeClientIdentity(CLIENT_NAME)
  const res = await pinnedRequest(
    { address: invite.address, fingerprint: invite.fingerprint },
    'POST',
    'enroll',
    JSON.stringify({ code: invite.code, name: CLIENT_NAME, cert_pem: identity.cert })
  )
  if (res.status < 200 || res.status >= 300) throw new Error(daemonError(res.body, `служба отказала (HTTP ${res.status})`))
  writePrivate(identityFile(), serializeIdentity(identity))
  writePrivate(pinFile(), JSON.stringify({ address: invite.address, fingerprint: invite.fingerprint } satisfies Pin))
  // Код одноразовый — файл с ним больше не нужен.
  rmSync(file, { force: true })
}

/** Установка, обновление (повторный install) и повторное сопряжение — одна и та же команда. */
export async function installMacService(): Promise<MacServiceResult> {
  const fail = async (message: string, cancelled = false): Promise<MacServiceResult> => ({
    ok: false,
    cancelled,
    message,
    info: await macServiceState()
  })
  if (!IS_MAC) return fail('Служба нужна только на macOS')
  const bin = incyBinaryPath()
  if (!existsSync(bin)) return fail(`Ядро sing-box не найдено: ${bin}`)
  if (typeof process.getuid !== 'function') return fail('Не удалось определить пользователя')

  ensureIdentityDir()
  rmSync(inviteFile(), { force: true }) // --invite-out отказывается писать в существующий файл
  appLog('info', '[mac-service] установка службы: запрашиваю пароль администратора')
  const run = await runElevated(buildInstallCommand(bin, inviteFile(), process.getuid()))
  if (run.cancelled) {
    appLog('info', '[mac-service] установка отменена пользователем')
    return fail('Установка отменена', true)
  }
  if (!run.ok) {
    appLog('error', `[mac-service] установка не удалась: ${run.error}`)
    return fail(`Служба не установилась: ${run.error}`)
  }
  appLog('info', '[mac-service] служба установлена, сопрягаюсь')
  // Служба только что (пере)запущена: дожидаемся, пока она начнёт слушать.
  let lastError = ''
  for (let i = 0; i < 6; i++) {
    try {
      await pairFromInvite()
      lastError = ''
      break
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e)
      await new Promise((r) => setTimeout(r, 700))
    }
  }
  if (lastError) {
    appLog('error', `[mac-service] сопряжение не удалось: ${lastError}`)
    return fail(`Служба установлена, но сопрячься не вышло: ${lastError}`)
  }
  appLog('info', '[mac-service] приложение сопряжено со службой')
  return { ok: true, message: 'Служба установлена', info: await macServiceState() }
}

export async function uninstallMacService(): Promise<MacServiceResult> {
  if (!IS_MAC) return { ok: false, message: 'Служба нужна только на macOS', info: await macServiceState() }
  const bin = incyBinaryPath()
  // Ядро в службе остановится само при удалении, но корректнее вернуть DNS через хук до этого.
  await stopCoreViaDaemon().catch(() => false)
  appLog('info', '[mac-service] удаление службы: запрашиваю пароль администратора')
  const cmd = [
    `${shQuote(bin)} lxd --service uninstall --purge`,
    `/bin/rm -rf ${shQuote(SUPPORT_DIR)}`
  ].join(' && ')
  const run = await runElevated(cmd)
  if (run.cancelled) return { ok: false, cancelled: true, message: 'Удаление отменено', info: await macServiceState() }
  if (!run.ok) {
    appLog('error', `[mac-service] удаление не удалось: ${run.error}`)
    return { ok: false, message: `Служба не удалилась: ${run.error}`, info: await macServiceState() }
  }
  forgetIdentity()
  daemonCoreMaybeRunning = false
  appLog('info', '[mac-service] служба удалена')
  return { ok: true, message: 'Служба удалена', info: await macServiceState() }
}

// ---- Управление ядром через демон -----------------------------------------------------

/** Ядро могло быть запущено нами в этой сессии — нужно остановить при выходе. */
let daemonCoreMaybeRunning = false
let logBaseline: string[] | null = null

export function isDaemonCoreActive(): boolean {
  return daemonCoreMaybeRunning
}

function requireTarget(): PinnedTarget {
  const target = loadTarget()
  if (!target) throw new MacServiceRequiredError('not_paired', REQUIRED_TEXT)
  return target
}

async function daemonStatus(timeoutMs = 4000): Promise<{ status: string; lastError: string; hooks?: unknown } | null> {
  try {
    const r = await pinnedRequest(requireTarget(), 'GET', 'status', undefined, timeoutMs)
    if (r.status !== 200) return null
    const j = JSON.parse(r.body) as { status?: string; last_error?: string; hooks?: unknown }
    return { status: String(j.status ?? ''), lastError: String(j.last_error ?? ''), hooks: j.hooks }
  } catch {
    return null
  }
}

async function tailLog(lines: number): Promise<string[] | null> {
  try {
    const r = await pinnedRequest(requireTarget(), 'GET', `logs?tail=${lines}`, undefined, 4000)
    if (r.status !== 200) return null
    return stripAnsi(r.body).split('\n').map((l) => l.trimEnd()).filter(Boolean)
  } catch {
    return null
  }
}

/**
 * Отдать конфиг демону: он проверит его `sing-box check`, поднимет ядро и
 * вызовет хук post_start. Отдельный /admin/start не нужен — apply на
 * остановленном ядре и есть запуск (а start — это откат к last-good).
 */
export async function applyCoreViaDaemon(configJson: string, log: (line: string) => void): Promise<void> {
  const target = requireTarget()
  logBaseline = await tailLog(80)
  const res = await pinnedRequest(target, 'POST', 'apply', configJson, 90_000).catch((e: Error) => {
    throw new Error(`служба не отвечает: ${e.message}`)
  })
  if (res.status === 403) throw new MacServiceRequiredError('not_paired', REQUIRED_TEXT)
  if (res.status !== 200) {
    // Демон при неудаче откатывается на last-good — это ПРЕДЫДУЩИЙ узел, и без
    // остановки он поднялся бы вместо выбранного.
    await stopCoreViaDaemon().catch(() => false)
    const lines = (await tailLog(12)) ?? []
    const tail = lines.length ? ` Журнал службы: ${lines.slice(-4).join(' | ')}` : ''
    throw new Error(`Служба не приняла конфиг: ${daemonError(res.body, `HTTP ${res.status}`)}.${tail}`)
  }
  daemonCoreMaybeRunning = true
  try {
    const parsed = JSON.parse(res.body) as { warning?: string }
    if (parsed.warning) log(`[служба] ${parsed.warning}`)
  } catch {
    /* ответ без JSON */
  }
  // Хуки (DNS) не останавливают ядро при ошибке — сообщаем, если что-то пошло не так.
  const st = await daemonStatus()
  const hooks = JSON.stringify(st?.hooks ?? {})
  if (/"state":"(failed|timeout)"/.test(hooks)) log(`[служба] хук DNS завершился с ошибкой: ${hooks}`)
}

/** Остановить ядро в службе (демон при этом вызовет post_stop и вернёт DNS). */
export async function stopCoreViaDaemon(): Promise<boolean> {
  const target = loadTarget()
  if (!target) return false
  try {
    const r = await pinnedRequest(target, 'POST', 'stop', undefined, 25_000)
    if (r.status === 200) daemonCoreMaybeRunning = false
    return r.status === 200
  } catch {
    return false
  }
}

/** Ядро поднято в службе, а приложение об этом не знает (сирота после краша). */
export async function reapOrphanDaemonCore(): Promise<boolean> {
  if (!IS_MAC || !loadTarget()) return false
  const st = await daemonStatus(3000)
  if (!st || st.status !== 'started') return false
  appLog('warn', '[mac-service] в службе осталось работающее ядро от прошлого запуска — останавливаю')
  return stopCoreViaDaemon()
}

export interface DaemonCoreHandle {
  stop(): Promise<void>
}

/**
 * Следит за ядром в службе: раз в 3 секунды проверяет статус (аналог события
 * `exit` у дочернего процесса) и переносит новые строки журнала службы в лог
 * приложения — на Windows их даёт stdout ядра.
 */
export function watchDaemonCore(onDead: (reason: string) => void, log: (line: string) => void): DaemonCoreHandle {
  let stopped = false
  let busy = false
  let failures = 0
  let prev: string[] | null = logBaseline
  const tick = async (): Promise<void> => {
    if (stopped || busy) return
    busy = true
    try {
      const st = await daemonStatus(4000)
      if (stopped) return
      if (!st) {
        if (++failures >= 3) {
          stopped = true
          clearInterval(timer)
          onDead('служба LAZEYKA не отвечает')
        }
        return
      }
      failures = 0
      const cur = await tailLog(60)
      if (cur && !stopped) {
        if (prev) {
          let skip = 0
          for (let k = Math.min(prev.length, cur.length); k > 0; k--) {
            if (prev.slice(prev.length - k).every((l, i) => l === cur[i])) {
              skip = k
              break
            }
          }
          for (const line of cur.slice(skip).slice(-50)) log(`[служба] ${line}`)
        }
        prev = cur
      }
      if (st.status !== 'started') {
        stopped = true
        clearInterval(timer)
        daemonCoreMaybeRunning = false
        onDead(st.lastError ? `ядро в службе остановилось: ${st.lastError}` : 'ядро в службе остановилось')
      }
    } finally {
      busy = false
    }
  }
  const timer = setInterval(() => void tick(), 3000)
  timer.unref?.()
  return {
    async stop(): Promise<void> {
      stopped = true
      clearInterval(timer)
      await stopCoreViaDaemon()
    }
  }
}

/**
 * Последняя попытка при выходе/падении приложения, когда async уже нельзя:
 * синхронно запускаем дочерний Node (сам Electron в режиме RUN_AS_NODE) с
 * коротким скриптом, который шлёт POST /admin/stop с тем же пином и клиентским
 * сертификатом. Ничего не запускается от root — только запрос пользователя к
 * службе. Ошибки глотаем: это best effort.
 */
export function stopCoreViaDaemonSync(): void {
  if (!IS_MAC || !daemonCoreMaybeRunning) return
  try {
    const target = loadTarget()
    if (!target?.identity) return
    const script = `
const tls = require('tls'), http = require('http'), crypto = require('crypto');
const [host, port] = JSON.parse(process.env.LZ_ADDR);
const s = tls.connect({ host, port, rejectUnauthorized: false, ALPNProtocols: ['http/1.1'],
  cert: process.env.LZ_CERT, key: process.env.LZ_KEY });
const bye = () => process.exit(0);
setTimeout(bye, 3500);
s.on('error', bye);
s.once('secureConnect', () => {
  const raw = s.getPeerCertificate(true).raw;
  if (!raw || crypto.createHash('sha256').update(raw).digest('hex') !== process.env.LZ_PIN) return bye();
  const r = http.request({ method: 'POST', path: '/admin/stop', createConnection: () => s,
    headers: { Host: 'x', Connection: 'close', 'Content-Length': 0 } });
  r.on('response', (res) => { res.resume(); res.on('end', bye); });
  r.on('error', bye);
  r.end();
});`
    const i = target.address.lastIndexOf(':')
    spawnSync(process.execPath, ['-e', script], {
      timeout: 4500,
      stdio: 'ignore',
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        LZ_ADDR: JSON.stringify([target.address.slice(0, i).replace(/^\[|\]$/g, ''), Number(target.address.slice(i + 1))]),
        LZ_PIN: target.fingerprint.replace(/:/g, '').toLowerCase(),
        LZ_CERT: (target.identity as ClientIdentity).cert,
        LZ_KEY: (target.identity as ClientIdentity).key
      }
    })
    daemonCoreMaybeRunning = false
  } catch {
    /* best effort */
  }
}
