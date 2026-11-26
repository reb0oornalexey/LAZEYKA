/**
 * Чистая логика запуска Zapret на Windows: разбор вывода `sc`, решения по драйверу
 * WinDivert, самопроверка, повторы автозапуска. Никаких обращений к Electron и системе —
 * модуль проверяется обычным node-скриптом (см. отчёт).
 *
 * Разбор `sc query` / `sc qc` идёт по СТРУКТУРЕ строк, а не по русским словам: на русской
 * Windows заголовки полей переведены («СОСТОЯНИЕ», «ИМЯ_ДВОИЧНОГО_ФАЙЛА»), но числовой код
 * и английское имя состояния (`4  RUNNING`) остаются как есть.
 */

// ---------------------------------------------------------------- sc query / sc qc

export type ScState =
  | 'stopped'
  | 'start_pending'
  | 'stop_pending'
  | 'running'
  | 'continue_pending'
  | 'pause_pending'
  | 'paused'
  | 'unknown'

export interface ScQuery {
  /** Служба зарегистрирована (sc query вернул её состояние). */
  found: boolean
  state: ScState
  /** Числовой код состояния (1..7) или null. */
  code: number | null
}

const SC_STATE_BY_NAME: Record<string, ScState> = {
  STOPPED: 'stopped',
  START_PENDING: 'start_pending',
  STOP_PENDING: 'stop_pending',
  RUNNING: 'running',
  CONTINUE_PENDING: 'continue_pending',
  PAUSE_PENDING: 'pause_pending',
  PAUSED: 'paused'
}

/** Код ошибки Windows «указанная служба не установлена». */
export const ERROR_SERVICE_DOES_NOT_EXIST = 1060
/** Служба помечена на удаление. */
export const ERROR_SERVICE_MARKED_FOR_DELETE = 1072
/** Служба уже запущена. */
export const ERROR_SERVICE_ALREADY_RUNNING = 1056

/**
 * Разбор вывода `sc query <имя>`. Строка состояния — единственная вида
 * `<поле> : <число> <ИМЯ_СОСТОЯНИЯ>`, где ИМЯ из известного набора
 * (строка TYPE похожа на неё формой, но имя там KERNEL_DRIVER и т. п.).
 */
export function parseScQuery(text: string, exitCode: number | null): ScQuery {
  if (exitCode === ERROR_SERVICE_DOES_NOT_EXIST) return { found: false, state: 'unknown', code: null }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*\S+\s*:\s*(\d+)\s+([A-Z_]+)\b/)
    if (!m) continue
    const state = SC_STATE_BY_NAME[m[2]]
    if (state) return { found: true, state, code: Number(m[1]) }
  }
  // Служба есть, но состояние не разобрано (необычный вывод) — не выдаём её за отсутствующую.
  return { found: exitCode === 0 && /\S/.test(text), state: 'unknown', code: null }
}

export interface ScQc {
  binaryPath: string | null
}

const SC_PATH_KEYS = new Set(['BINARY_PATH_NAME', 'ИМЯ_ДВОИЧНОГО_ФАЙЛА'])

/**
 * Разбор `sc qc <имя>`: путь к двоичному файлу. Сначала по известным заголовкам
 * (английскому и русскому), иначе — по значению: путь к .sys/.exe.
 */
export function parseScQc(text: string): ScQc {
  let byStructure: string | null = null
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([^:]+?)\s*:\s*(.*?)\s*$/)
    if (!m) continue
    const key = m[1].toUpperCase()
    const value = m[2]
    if (SC_PATH_KEYS.has(key) && value) return { binaryPath: value }
    if (!byStructure && /^"?(?:\\\?\?\\|\\\\\?\\)?[A-Za-z]:\\.*\.(?:sys|exe)"?(?:\s.*)?$/i.test(value)) {
      byStructure = value
    }
  }
  return { binaryPath: byStructure }
}

/** Приводит путь к виду, пригодному для сравнения: без кавычек и префикса `\??\`, нижний регистр. */
export function normalizeWinPath(p: string): string {
  let s = p.trim()
  if (s.startsWith('"')) {
    const end = s.indexOf('"', 1)
    s = end > 0 ? s.slice(1, end) : s.slice(1)
  }
  s = s.replace(/^\\\?\?\\/, '').replace(/^\\\\\?\\/, '')
  s = s.replace(/\//g, '\\').replace(/\\{2,}/g, '\\').replace(/\\+$/, '')
  return s.toLowerCase()
}

export function samePath(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  return normalizeWinPath(a) === normalizeWinPath(b)
}

// ---------------------------------------------------------------- процессы winws.exe

export interface WinwsProc {
  pid: number
  path: string | null
}

/** Разбор JSON от `ConvertTo-Json`: пусто, один объект или массив. */
export function parseWinwsProcesses(text: string): WinwsProc[] | null {
  const t = text.replace(/^\uFEFF/, '').trim()
  if (!t) return []
  let data: unknown
  try {
    data = JSON.parse(t)
  } catch {
    return null
  }
  const arr = Array.isArray(data) ? data : [data]
  const out: WinwsProc[] = []
  for (const it of arr) {
    if (!it || typeof it !== 'object') continue
    const o = it as Record<string, unknown>
    const pid = Number(o.ProcessId ?? o.Id)
    if (!Number.isFinite(pid) || pid <= 0) continue
    const p = o.ExecutablePath ?? o.Path
    out.push({ pid, path: typeof p === 'string' && p ? p : null })
  }
  return out
}

export interface WinwsClassified {
  own: WinwsProc[]
  foreign: WinwsProc[]
  /**
   * Путь не удалось прочитать. Так бывает у процессов, запущенных с повышением, когда сама
   * LAZEYKA работает без прав администратора (Get-Process отдаёт пустой Path). Такие процессы
   * не убиваем (это может быть чужая копия) и не считаем помехой, пока не убедимся, что они живы.
   */
  unknown: WinwsProc[]
}

/**
 * «Свой» winws — тот, что лежит в нашей папке, либо файла по его пути уже нет (остаток удалённой установки).
 * «Чужой» — живой процесс из другой существующей папки (другая копия LAZEYKA, отдельный Zapret).
 * Путь неизвестен — отдельная группа «unknown» (раньше такие считались своими и убивались).
 */
export function classifyWinws(
  procs: WinwsProc[],
  ownExe: string,
  fileExists: (p: string) => boolean
): WinwsClassified {
  const own: WinwsProc[] = []
  const foreign: WinwsProc[] = []
  const unknown: WinwsProc[] = []
  for (const p of procs) {
    if (!p.path) unknown.push(p)
    else if (samePath(p.path, ownExe) || !fileExists(p.path)) own.push(p)
    else foreign.push(p)
  }
  return { own, foreign, unknown }
}

/**
 * Процессы с неизвестным путём, которые всё ещё живы (по свежему списку). Если процесса
 * на самом деле уже нет — он не мешает запуску.
 */
export function stillAlive(unknown: WinwsProc[], fresh: WinwsProc[] | null): WinwsProc[] {
  if (!fresh) return unknown
  const pids = new Set(fresh.map((p) => p.pid))
  return unknown.filter((p) => pids.has(p.pid))
}

// ---------------------------------------------------------------- драйвер WinDivert

export type DriverPrep =
  | { action: 'keep'; reason: 'foreign-in-use' | 'no-admin' }
  | { action: 'register-by-winws' }
  | { action: 'reuse' }
  | { action: 'start-service' }
  | { action: 'reregister'; reason: 'forced' | 'stale-path' | 'wrong-path' | 'stuck-stopping' }

export interface DriverPrepInput {
  /** Результат sc query по найденной службе WinDivert; null — служба не зарегистрирована. */
  svc: { state: ScState } | null
  /** Путь из sc qc (null — не разобран). */
  svcPath: string | null
  /** Файл WinDivert64.sys нашей сборки; null — не найден на диске. */
  expectedSys: string | null
  /** Существует ли файл по зарегистрированному пути. */
  svcPathExists: boolean
  /** Живой winws.exe из другой папки: службу WinDivert трогать нельзя. */
  foreignWinws: boolean
  /** У LAZEYKA есть права администратора (без них sc stop/delete/start отвечают кодом 5). */
  admin: boolean
  /** Полная очистка («Перезагрузить службы»). */
  force: boolean
}

/**
 * Перерегистрация службы на свой путь — только когда это возможно: есть права и драйвером
 * не пользуется живой чужой winws. Иначе службу оставляем как есть: драйвер из папки другой
 * копии LAZEYKA — тот же драйвер, и winws с ним работает.
 */
export function decideDriverPrep(i: DriverPrepInput): DriverPrep {
  if (i.foreignWinws) return { action: 'keep', reason: 'foreign-in-use' }
  if (!i.svc) return { action: 'register-by-winws' }
  if (!i.admin) return { action: 'keep', reason: 'no-admin' }
  if (i.force) return { action: 'reregister', reason: 'forced' }
  if (i.expectedSys && i.svcPath && !samePath(i.svcPath, i.expectedSys)) {
    return { action: 'reregister', reason: i.svcPathExists ? 'wrong-path' : 'stale-path' }
  }
  if (i.svc.state === 'stop_pending') return { action: 'reregister', reason: 'stuck-stopping' }
  if (i.svc.state === 'running') return { action: 'reuse' }
  return { action: 'start-service' }
}

/** Код ошибки Windows «отказано в доступе» (sc без прав администратора). */
export const ERROR_ACCESS_DENIED = 5

export interface ScDeleteOutcome {
  /** Как писать в журнал: ok — служба удалена/её нет; warn — не удалось, но запуск продолжается. */
  level: 'ok' | 'warn'
  text: string
  /** Запуск всегда продолжается: что получилось на деле, решит самопроверка. */
  proceed: true
}

/** Итог `sc delete`: неудача перерегистрации — предупреждение, а не ошибка запуска. */
export function scDeleteOutcome(code: number | null, timedOut: boolean): ScDeleteOutcome {
  if (timedOut) return { level: 'warn', text: 'sc delete не ответил вовремя — продолжаю со службой как есть', proceed: true }
  if (code === 0) return { level: 'ok', text: 'служба удалена', proceed: true }
  if (code === ERROR_SERVICE_DOES_NOT_EXIST) return { level: 'ok', text: 'службы уже нет', proceed: true }
  if (code === ERROR_SERVICE_MARKED_FOR_DELETE) return { level: 'ok', text: 'служба уже помечена на удаление', proceed: true }
  if (code === ERROR_ACCESS_DENIED) {
    return { level: 'warn', text: 'нет прав на перерегистрацию службы (код 5) — оставляю драйвер как есть', proceed: true }
  }
  return { level: 'warn', text: `sc delete вернул код ${code ?? '?'} — продолжаю со службой как есть`, proceed: true }
}

// ---------------------------------------------------------------- самопроверка

export type VerifyFailReason =
  | 'winws-dead'
  | 'winws-error'
  | 'driver-not-running'
  | 'no-capture-signal'

export interface VerifyInput {
  winwsAlive: boolean
  /** winws написал «windivert initialized / capture is started». */
  capture: boolean
  /** winws написал о фатальной ошибке. */
  fatalLine: boolean
  /** Служба WinDivert: null — под известными именами не найдена. */
  driver: { state: ScState; pathOk: boolean | null } | null
  /** Сколько уже ждём сигнал захвата после появления winws. */
  waitedForSignalMs: number
  /** Сколько ждать сигнал, прежде чем считать его отсутствие неудачей. */
  signalGraceMs: number
}

export type Verdict =
  /** foreignDriver — драйвер загружен из папки другой копии: работает, только пишем в журнал. */
  | { verdict: 'ok'; weak: boolean; foreignDriver: boolean }
  | { verdict: 'wait' }
  | { verdict: 'fail'; reason: VerifyFailReason }

/**
 * «Работает» — только если winws жив, драйвер загружен (RUNNING) и есть признак захвата.
 * Путь драйвера из другой папки (dev-версия рядом с установленной) сам по себе не провал:
 * это тот же драйвер WinDivert, и раз winws подтвердил захват — обход работает.
 * Исключение: служба не найдена ни под одним известным именем, но winws сам сообщил о захвате —
 * принимаем как «слабое» подтверждение (версии WinDivert называют службу по-разному).
 * «winws жив, сигнала нет» — это не «работает»: ждём сигнал и при его отсутствии признаём неудачу.
 */
export function decideVerification(i: VerifyInput): Verdict {
  if (!i.winwsAlive) return { verdict: 'fail', reason: 'winws-dead' }
  if (i.fatalLine) return { verdict: 'fail', reason: 'winws-error' }
  if (i.driver && i.driver.state !== 'running') {
    // Драйвер ещё поднимается — дадим время в пределах окна ожидания.
    if (i.driver.state === 'start_pending' && i.waitedForSignalMs < i.signalGraceMs) return { verdict: 'wait' }
    return { verdict: 'fail', reason: 'driver-not-running' }
  }
  if (!i.capture) {
    return i.waitedForSignalMs < i.signalGraceMs
      ? { verdict: 'wait' }
      : { verdict: 'fail', reason: 'no-capture-signal' }
  }
  return { verdict: 'ok', weak: i.driver === null, foreignDriver: i.driver?.pathOk === false }
}

/** Нужна ли полная очистка служб (то, что делает «Перезагрузить службы») после такой неудачи. */
export type StartFailReason = VerifyFailReason | 'launch-timeout' | 'bat-exited' | 'foreign' | 'no-admin' | 'cancelled'

/** Очистка и повтор не помогут, если мешает чужой winws или у LAZEYKA нет прав администратора. */
export function needsFullReset(reason: StartFailReason): boolean {
  return reason !== 'foreign' && reason !== 'cancelled' && reason !== 'no-admin'
}

// ---------------------------------------------------------------- повторы автозапуска

export const RETRY_DELAYS_MS: readonly number[] = [5_000, 15_000, 30_000]

export type AutoStep =
  | { kind: 'done' }
  | { kind: 'retry'; delayMs: number; nextAttempt: number; cleanup: boolean }
  | { kind: 'giveup'; attempts: number }
  | { kind: 'cancelled' }

/**
 * Конечный автомат повторов. attempt — номер только что завершённой попытки (с 1).
 * Всего попыток: 1 + число пауз (4 при 5/15/30 с).
 */
export function nextAutoStep(
  attempt: number,
  result: { ok: true } | { ok: false; reason: StartFailReason }
): AutoStep {
  if (result.ok) return { kind: 'done' }
  if (result.reason === 'cancelled') return { kind: 'cancelled' }
  // Чужая копия winws не уйдёт от повторов — не тратим время.
  if (result.reason === 'foreign' || result.reason === 'no-admin') return { kind: 'giveup', attempts: attempt }
  const delay = RETRY_DELAYS_MS[attempt - 1]
  if (delay === undefined) return { kind: 'giveup', attempts: attempt }
  return { kind: 'retry', delayMs: delay, nextAttempt: attempt + 1, cleanup: needsFullReset(result.reason) }
}

// ---------------------------------------------------------------- готовность системы

export interface NetIfaceAddr {
  family: string | number
  internal: boolean
  address: string
}

/** Есть активный интерфейс с настоящим IPv4-адресом (не loopback, не 169.254.x.x). */
export function hasUsableNetwork(ifaces: Record<string, NetIfaceAddr[] | undefined>): boolean {
  for (const list of Object.values(ifaces)) {
    for (const a of list ?? []) {
      const v4 = a.family === 'IPv4' || a.family === 4
      if (!v4 || a.internal) continue
      if (a.address.startsWith('169.254.') || a.address === '0.0.0.0') continue
      return true
    }
  }
  return false
}

export function isBootReady(bfe: ScState, networkUp: boolean): boolean {
  return bfe === 'running' && networkUp
}

// ---------------------------------------------------------------- тексты

export interface FailTextCtx {
  reason: StartFailReason
  adminOk: boolean
  /** Система загружена недавно или пришлось ждать сеть. */
  earlyBoot: boolean
  detail?: string
  foreignPath?: string
  /** Dev-версия (запуск через dev.bat): у неё свой текст про права. */
  dev?: boolean
}

const REASON_TEXT: Record<StartFailReason, string> = {
  'winws-dead': 'winws.exe завершился сразу после запуска',
  'winws-error': 'winws.exe сообщил об ошибке',
  'driver-not-running': 'драйвер WinDivert не загрузился',
  'no-capture-signal': 'winws.exe запущен, но не подтвердил перехват трафика',
  'launch-timeout': 'winws.exe не появился в системе',
  'bat-exited': 'сценарий запуска завершился без winws.exe',
  foreign: 'уже работает другой winws.exe',
  'no-admin': 'у LAZEYKA нет прав администратора',
  cancelled: 'запуск отменён'
}

export function reasonText(r: StartFailReason): string {
  return REASON_TEXT[r]
}

/** Короткое сообщение на время повтора (без «админ/антивирус», если права есть). */
export function retryText(c: FailTextCtx): string {
  if (!c.adminOk) {
    return 'Zapret не запустился: у LAZEYKA нет прав администратора. Пробую ещё раз…'
  }
  if (c.earlyBoot) return 'Zapret не запустился: Windows ещё загружала сеть. Пробую ещё раз…'
  return `Zapret не запустился (${REASON_TEXT[c.reason]}). Пробую ещё раз…`
}

/** Итоговое сообщение об ошибке после всех попыток. */
export function finalErrorText(c: FailTextCtx, attempts: number): string {
  if (c.reason === 'foreign') {
    return (
      `Уже работает другой winws.exe${c.foreignPath ? ` (${c.foreignPath})` : ''} — вероятно, другая копия LAZEYKA ` +
      'или отдельный Zapret. Остановите его там и включите Zapret снова.'
    )
  }
  const tail = ' Нажмите «Перезагрузить службы» на главной.'
  if (c.reason === 'no-admin' || !c.adminOk) return adminRequiredText(Boolean(c.dev))
  const what = c.earlyBoot
    ? `Windows ещё загружала сеть (${REASON_TEXT[c.reason]})`
    : REASON_TEXT[c.reason]
  const n = attempts > 1 ? ` после ${attempts} попыток` : ''
  return `Zapret не запустился${n}: ${what}${c.detail ? ` — ${c.detail}` : ''}.${tail}`
}

export const ADMIN_TEXT_INSTALLED =
  'Zapret не запустился: LAZEYKA работает без прав администратора. Запустите приложение от администратора.'
export const ADMIN_TEXT_DEV =
  'Dev-версия запущена без прав администратора. Закройте её и запустите dev.bat от имени администратора.'

/** Текст «нужны права»: для dev-версии — про dev.bat, для установленной — прежний. */
export function adminRequiredText(dev: boolean): string {
  return dev ? ADMIN_TEXT_DEV : ADMIN_TEXT_INSTALLED
}
