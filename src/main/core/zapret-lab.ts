/**
 * «Лаборатория» Zapret (Windows): проверка стратегии из конструктора, быстрый
 * автоподбор и IPC для своих стратегий.
 *
 * Ничего не работает в фоне: всё — только по кнопке. Одновременно может идти
 * одно из трёх (тест всех стратегий, автоподбор, проверка) — zapret-busy.ts;
 * запуски winws идут под общим замком withZapretLock.
 *
 * Автоподбор:
 *   0) без Zapret, ~4–5 с: по пяти целям — TLS 1.2 и 1.3 (на каком этапе обрыв) и
 *      «обрыв на 16–20 КБ» для целей за Cloudflare → тип проблемы;
 *   1) приёмы по порядку для этого типа (orderFamilies, эвристика), по одному
 *      представителю; ранний выход, как только все цели открылись;
 *   2) если ни один не открыл всё — 2–4 уточнения чисел в лучшем приёме.
 *   Худший случай: 8 + 4 = 12 запусков winws по ~5–9 с ≈ 1–2 мин.
 * После — прежнее состояние Zapret (был включён — включается снова с прежней
 * стратегией; выбранная стратегия не меняется, пока человек не нажмёт «Включить»).
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { BrowserWindow, ipcMain } from 'electron'
import { zapretBundleDir } from '../utils/dirs'
import { writeFileAtomic } from '../utils/atomic-write'
import { appLog } from '../utils/app-logger'
import { createConsoleDecoder } from '../utils/console-decode'
import { getAppConfig, patchAppConfig } from '../config'
import { physicalSourceIp } from './core-probe'
import { getGameFilterVars } from './zapret-service-settings'
import {
  clearOwnWinwsForProbe,
  ensureWinDivertReady,
  getZapretStatus,
  isWinwsRunning,
  killOwnWinwsForProbe,
  listStrategies,
  restartZapret,
  startZapret,
  stopZapret,
  withZapretLock
} from './zapret'
import { claimZapretBusy, releaseZapretBusy, zapretBusy } from './zapret-busy'
import {
  defaultModel,
  describeModel,
  familySpec,
  FAMILIES,
  generateBat,
  LIMITS,
  normalizeModel,
  type FamilyId,
  type StrategyModel
} from './zapret-model'
import {
  PROBE_TARGETS,
  diagnose,
  evaluateTargets,
  orderFamilies,
  refineVariants,
  resolve4,
  scoredTargets,
  summarize,
  verdictText,
  type EvalResult,
  type TargetDiag,
  type Verdict
} from './zapret-probe'
import {
  deleteCustomStrategy,
  exportCustomStrategy,
  importCustomStrategy,
  listBinFiles,
  listCustomStrategies,
  modelFromStrategyFile,
  previewCustomModel,
  saveCustomStrategy,
  type SaveInput
} from './zapret-custom'
import { isSafeStrategyFileName, validateStrategyName, listStrategyFiles } from './zapret-strategy'

// ---- Общее ------------------------------------------------------------------------

function h<T>(fn: (...args: unknown[]) => Promise<T> | T) {
  return async (_e: Electron.IpcMainInvokeEvent, ...args: unknown[]): Promise<{ ok: true; value: T } | { ok: false; message: string }> => {
    try {
      return { ok: true, value: await fn(...args) }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) }
    }
  }
}

function broadcast(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, payload)
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Пауза, которую прерывает отмена. */
function sleepAbortable(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const t = setTimeout(done, ms)
    function done(): void {
      clearTimeout(t)
      signal.removeEventListener('abort', done)
      resolve()
    }
    signal.addEventListener('abort', done, { once: true })
  })
}

const PROBE_BAT = 'lazeyka-probe.bat'
const CHECK_TIMEOUT_MS = 4000
const DIAG_TIMEOUT_MS = 3500
const BOOT_TIMEOUT_MS = 7000

class Cancelled extends Error {
  constructor() {
    super('Остановлено')
  }
}

// ---- Запуск стратегии для проверки ----------------------------------------------

interface Running {
  child: ChildProcess
  stop: () => Promise<void>
}

let firstLaunchInRun = true

/**
 * Запустить модель через временную .bat в папке сборки (имя не `general…`, в списке
 * стратегий не видно) — тем же путём, что и обычный запуск: cmd /c, NO_UPDATE_CHECK,
 * Game Filter через окружение.
 */
async function launchModel(model: StrategyModel, signal: AbortSignal): Promise<{ ok: true; run: Running } | { ok: false; message: string }> {
  const dir = zapretBundleDir()
  const bat = path.join(dir, PROBE_BAT)
  writeFileAtomic(bat, generateBat(model, 'проверка'))
  await killOwnWinwsForProbe()
  try {
    ensureWinDivertReady()
  } catch {
    /* как у теста стратегий: не критично, winws сам зарегистрирует драйвер */
  }
  const child = spawn('cmd.exe', ['/c', bat], {
    cwd: dir,
    windowsHide: true,
    detached: false,
    env: { ...process.env, NO_UPDATE_CHECK: '1', ...getGameFilterVars() }
  })
  let capturing = false
  let failed: string | null = null
  const dec = createConsoleDecoder()
  const onData = (buf: Buffer): void => {
    for (const line of dec(buf).split(/\r?\n/)) {
      if (/windivert\s+initialized|capture\s+is\s+started/i.test(line)) capturing = true
      else if (/windivert.*failed|windivertopen.*failed|driver.*not.*loaded|access\s+is\s+denied/i.test(line)) failed = line.trim()
    }
  }
  child.stdout?.on('data', onData)
  child.stderr?.on('data', onData)
  child.on('error', (e) => {
    failed = e.message
  })
  const stop = async (): Promise<void> => {
    if (child.pid && child.exitCode === null) {
      await new Promise<void>((r) => {
        const k = spawn('taskkill.exe', ['/F', '/T', '/PID', String(child.pid)], { windowsHide: true })
        k.on('exit', () => r())
        k.on('error', () => r())
      })
    }
    await killOwnWinwsForProbe()
  }
  // Ждём признак захвата из вывода winws; вывод через канал бывает буферизован —
  // тогда смотрим, появился ли процесс winws.exe.
  const deadline = Date.now() + BOOT_TIMEOUT_MS
  let seenProcess = false
  while (Date.now() < deadline && !signal.aborted) {
    if (capturing || failed) break
    if (child.exitCode !== null) break
    await sleepAbortable(400, signal)
    if (!seenProcess && !capturing) seenProcess = await isWinwsRunning()
    if (seenProcess && !capturing && Date.now() > deadline - BOOT_TIMEOUT_MS + 2500) break
  }
  if (signal.aborted) {
    await stop()
    throw new Cancelled()
  }
  if (failed || (!capturing && !seenProcess) || child.exitCode !== null) {
    await stop()
    return { ok: false, message: failed ? `winws.exe: ${failed}` : 'winws.exe не запустился с этой стратегией' }
  }
  // Время на загрузку фильтров: при первом запуске драйвер ещё поднимается.
  await sleepAbortable(capturing ? (firstLaunchInRun ? 1500 : 800) : firstLaunchInRun ? 3000 : 1800, signal)
  firstLaunchInRun = false
  if (signal.aborted) {
    await stop()
    throw new Cancelled()
  }
  return { ok: true, run: { child, stop } }
}

function removeProbeBat(): void {
  try {
    const p = path.join(zapretBundleDir(), PROBE_BAT)
    if (existsSync(p)) unlinkSync(p)
  } catch {
    /* занят — перезапишется в следующий раз */
  }
}

interface EvalTarget {
  id: string
  label: string
  host: string
  ip: string | null
  stall: boolean
}

async function runAndEvaluate(model: StrategyModel, targets: EvalTarget[], local: string | undefined, signal: AbortSignal): Promise<EvalResult & { launchError?: string }> {
  const l = await launchModel(model, signal)
  if (!l.ok) {
    return { targets: targets.map((t) => ({ id: t.id, label: t.label, tls12: false, tls13: false, stallOk: null, ok: false })), okChecks: 0, totalChecks: 1, score: 0, allOpen: false, launchError: l.message }
  }
  try {
    const r = await evaluateTargets(targets, { timeoutMs: CHECK_TIMEOUT_MS, localAddress: local, signal })
    if (signal.aborted) throw new Cancelled()
    return r
  } finally {
    await l.run.stop()
    await sleep(300)
  }
}

/**
 * Общая обёртка проверок: занять «занято», выключить Zapret, взять замок, убрать
 * свои остатки winws (чужой — отказ), выполнить, вернуть прежнее состояние.
 */
async function withProbeSession<T>(kind: 'autopick' | 'check', body: (local: string | undefined) => Promise<T>): Promise<T> {
  if (process.platform !== 'win32') throw new Error('Работает только в Windows')
  claimZapretBusy(kind)
  const st = getZapretStatus().state
  const wasRunning = st === 'running' || st === 'starting'
  firstLaunchInRun = true
  try {
    if (wasRunning) await stopZapret().catch(() => void 0)
    return await withZapretLock(async () => {
      const reason = await clearOwnWinwsForProbe()
      if (reason) throw new Error(reason)
      const local = (await physicalSourceIp().catch(() => null)) ?? undefined
      try {
        return await body(local)
      } finally {
        await killOwnWinwsForProbe()
        removeProbeBat()
      }
    })
  } finally {
    releaseZapretBusy(kind)
    // Прежнее состояние: был включён — включаем снова (стратегия в настройках не менялась).
    if (wasRunning) startZapret().catch((e) => appLog('warn', `zapret: не удалось включить после проверки: ${e instanceof Error ? e.message : String(e)}`))
  }
}

// ---- Проверка одной стратегии (конструктор) -------------------------------------

export interface CheckReport {
  result: EvalResult
  launchError?: string
  ms: number
}

let checkAbort: AbortController | null = null

export async function checkModel(raw: unknown): Promise<CheckReport> {
  const model = normalizeModel(raw)
  const ac = new AbortController()
  checkAbort = ac
  const t0 = Date.now()
  try {
    return await withProbeSession('check', async (local) => {
      const ips = await Promise.all(PROBE_TARGETS.map((t) => resolve4(t.host)))
      const targets = PROBE_TARGETS.map((t, i) => ({ ...t, ip: ips[i] }))
      const r = await runAndEvaluate(model, targets, local, ac.signal)
      return { result: r, launchError: r.launchError, ms: Date.now() - t0 }
    })
  } finally {
    checkAbort = null
  }
}

export function stopCheck(): boolean {
  if (!checkAbort) return false
  checkAbort.abort()
  return true
}

// ---- Автоподбор ------------------------------------------------------------------

export interface PickTry {
  label: string
  family: FamilyId
  score: number
  allOpen: boolean
  okChecks: number
  totalChecks: number
  error?: string
}

export interface PickDiagRow {
  id: string
  label: string
  verdict: Verdict
  text: string
}

export interface AutopickState {
  phase: 'idle' | 'diagnose' | 'families' | 'refine' | 'done' | 'error' | 'stopped'
  startedAt?: number
  finishedAt?: number
  /** Шаг из ориентировочного числа шагов. */
  step: number
  totalSteps: number
  current?: string
  diag?: PickDiagRow[]
  problem?: { sni: boolean; stall: boolean; unfixable: Verdict[] }
  tries: PickTry[]
  /** Итог. */
  outcome?: 'found' | 'partial' | 'not-needed' | 'unfixable' | 'nothing'
  model?: StrategyModel
  modelLabel?: string
  why?: string
  result?: EvalResult
  suggestedName?: string
  message?: string
}

let pick: AutopickState = { phase: 'idle', step: 0, totalSteps: 0, tries: [] }
let pickAbort: AbortController | null = null

function setPick(patch: Partial<AutopickState>): void {
  pick = { ...pick, ...patch }
  broadcast('zapretlab:autopick', pick)
}

export function getAutopickState(): AutopickState {
  return pick
}

export function stopAutopick(): boolean {
  if (!pickAbort) return false
  pickAbort.abort()
  return true
}

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']

function suggestedName(): string {
  const d = new Date()
  const base = `Подбор ${d.getDate()} ${MONTHS[d.getMonth()]}`
  const taken = new Set(listStrategies().map((s) => s.title.toLowerCase()))
  let name = base
  for (let i = 2; taken.has(`general (lz ${name})`.toLowerCase()); i++) name = `${base} ${i}`
  return name
}

function whyText(model: StrategyModel, summary: { sni: boolean; stall: boolean }, outcome: 'found' | 'partial', refined?: string): string {
  const f = familySpec(model.family)
  const kind =
    summary.sni && summary.stall
      ? 'Провайдер обрывает соединение по имени сайта и режет потоки по объёму.'
      : summary.sni
        ? 'Провайдер обрывает соединение по имени сайта в самом начале.'
        : 'Соединение устанавливается, но данные перестают идти через 16–20 КБ.'
  const how = `Помог приём «${f.title.toLowerCase()}»: ${f.what.charAt(0).toLowerCase()}${f.what.slice(1)}`
  const extra = refined ? ` Уточнение: ${refined}.` : ''
  const tail = outcome === 'partial' ? ' Открылось не всё — часть целей осталась недоступной, подробности ниже.' : ''
  return `${kind} ${how}${extra}${tail}`
}

export function startAutopick(): AutopickState {
  if (process.platform !== 'win32') throw new Error('Автоподбор работает только в Windows')
  if (pickAbort) return pick
  const busy = zapretBusy()
  if (busy) claimZapretBusy('autopick') // бросит понятную ошибку
  const ac = new AbortController()
  pickAbort = ac
  pick = { phase: 'diagnose', startedAt: Date.now(), step: 0, totalSteps: 1, tries: [], current: 'Проверяю сайты без Zapret' }
  broadcast('zapretlab:autopick', pick)
  void runAutopick(ac)
    .catch((e) => {
      if (e instanceof Cancelled || ac.signal.aborted) setPick({ phase: 'stopped', finishedAt: Date.now(), current: undefined })
      else setPick({ phase: 'error', finishedAt: Date.now(), current: undefined, message: e instanceof Error ? e.message : String(e) })
    })
    .finally(() => {
      pickAbort = null
    })
  return pick
}

/** Засчитываем только проверки, успешные в обоих прогонах одного кандидата. */
function confirmedResult(first: EvalResult, second: EvalResult): EvalResult {
  const repeated = new Map(second.targets.map((target) => [target.id, target]))
  let okChecks = 0
  const targets = first.targets.map((target) => {
    const again = repeated.get(target.id)
    const tls12 = target.tls12 && again?.tls12 === true
    const tls13 = target.tls13 && again?.tls13 === true
    const stallOk = target.stallOk === null ? null : target.stallOk && again?.stallOk === true
    okChecks += Number(tls12) + Number(tls13) + Number(stallOk === true)
    return { ...target, tls12, tls13, stallOk, ok: tls12 && tls13 && stallOk !== false }
  })
  return {
    targets,
    okChecks,
    totalChecks: first.totalChecks,
    score: first.totalChecks ? okChecks / first.totalChecks : 0,
    allOpen: targets.length > 0 && targets.every((target) => target.ok)
  }
}

async function runAutopick(ac: AbortController): Promise<void> {
  const signal = ac.signal
  await withProbeSession('autopick', async (local) => {
    // Шаг 0 — без Zapret.
    const diag = await diagnose(PROBE_TARGETS, { timeoutMs: DIAG_TIMEOUT_MS, localAddress: local, signal })
    if (signal.aborted) throw new Cancelled()
    const summary = summarize(diag)
    const rows = diag.map((d) => ({ id: d.id, label: d.label, verdict: d.verdict, text: verdictText(d.verdict) }))
    appLog('info', `zapret автоподбор: ${diag.map((d) => `${d.host}=${d.verdict}(${d.tls12.stage}/${d.tls13.stage}${d.stall ? `,stall=${d.stall.stalled}` : ''})`).join(' ')}`)
    setPick({ diag: rows, problem: { sni: summary.sni, stall: summary.stall, unfixable: summary.unfixable } })
    if (summary.allOk) {
      setPick({ phase: 'done', finishedAt: Date.now(), current: undefined, outcome: 'not-needed', why: 'Все проверочные сайты открываются и без Zapret — для них он сейчас не нужен.' })
      return
    }
    if (!summary.sni && !summary.stall) {
      setPick({
        phase: 'done',
        finishedAt: Date.now(),
        current: undefined,
        outcome: 'unfixable',
        why: 'Сайты недоступны по причинам, которые Zapret не исправляет: ' + summary.unfixable.map(verdictText).join('; ') + '.'
      })
      return
    }
    const scored = scoredTargets(diag)
    const targets: EvalTarget[] = scored.map((d: TargetDiag) => ({
      id: d.id,
      label: d.label,
      host: d.host,
      ip: d.ip,
      // Проверку объёма повторяем только там, где без Zapret был обрыв.
      stall: d.verdict === 'stall' && Boolean(d.stall?.stalled)
    }))
    const order = orderFamilies(summary)
    const base = defaultModel()
    type Candidate = { model: StrategyModel; label: string; r: EvalResult; refined?: string }
    const finalists = 3
    const refineLimit = 3
    let totalSteps = order.length
    const tries: PickTry[] = []
    let step = 0
    const tryModel = async (model: StrategyModel, label: string, phase: 'families' | 'refine'): Promise<EvalResult> => {
      if (signal.aborted) throw new Cancelled()
      step++
      setPick({ phase, step, totalSteps, current: label })
      const r = await runAndEvaluate(model, targets, local, signal)
      if (signal.aborted) throw new Cancelled()
      tries.push({ label, family: model.family, score: r.score, allOpen: r.allOpen, okChecks: r.okChecks, totalChecks: r.totalChecks, error: r.launchError })
      setPick({ tries: [...tries] })
      return r
    }

    const candidates: Candidate[] = []
    const rank = (a: Candidate, b: Candidate): number => b.r.score - a.r.score
    for (const fam of order) {
      const model: StrategyModel = { ...base, family: fam, tcp: defaultModel(fam).tcp }
      const label = familySpec(fam).title
      const r = await tryModel(model, label, 'families')
      if (r.score > 0) candidates.push({ model, label, r })
    }

    const variants = candidates.sort(rank).slice(0, 2).flatMap((candidate) =>
      candidate.r.allOpen ? [] : refineVariants(candidate.model.family, candidate.model.tcp)
        .slice(0, refineLimit)
        .map((variant) => ({ candidate, variant }))
    )
    totalSteps += variants.length
    for (const { candidate, variant } of variants) {
      const model = normalizeModel({ ...candidate.model, tcp: variant.tcp })
      const label = `${familySpec(model.family).title}: ${variant.label}`
      const r = await tryModel(model, label, 'refine')
      if (r.score > 0) candidates.push({ model, label, r, refined: variant.label })
    }

    const shortlist = candidates.sort(rank).slice(0, finalists)
    totalSteps += shortlist.length
    let best: Candidate | undefined
    for (const candidate of shortlist) {
      const second = await tryModel(candidate.model, `Повторная проверка: ${candidate.label}`, 'refine')
      const r = confirmedResult(candidate.r, second)
      if (!best || r.score > best.r.score) best = { ...candidate, r }
    }
    if (!best || best.r.score === 0) {
      setPick({
        phase: 'done',
        finishedAt: Date.now(),
        current: undefined,
        outcome: 'nothing',
        why: 'Ни один приём не открыл проверочные сайты. Попробуйте «Проверить все» встроенные стратегии, другой DNS или VPN.'
      })
      return
    }
    const outcome = best.r.allOpen ? 'found' : 'partial'
    setPick({
      phase: 'done',
      finishedAt: Date.now(),
      current: undefined,
      outcome,
      model: best.model,
      modelLabel: describeModel(best.model),
      result: best.r,
      why: whyText(best.model, summary, outcome, best.refined) + ' В результат засчитаны только проверки, успешные в обоих прогонах.',
      suggestedName: suggestedName()
    })
  })
}

// ---- Включить стратегию ----------------------------------------------------------

/** Выбрать стратегию и включить Zapret (если уже включён — перезапустить с ней). */
export async function activateStrategy(file: unknown): Promise<void> {
  if (zapretBusy()) throw new Error('Дождитесь окончания проверки')
  if (!isSafeStrategyFileName(file)) throw new Error('Недопустимое имя стратегии')
  const name = validateStrategyName(file, listStrategyFiles(zapretBundleDir()))
  const cfg = await getAppConfig()
  await patchAppConfig({ zapret: { ...cfg.zapret!, activeStrategy: name } })
  const st = getZapretStatus().state
  if (st === 'running' || st === 'starting') await restartZapret()
  else await startZapret()
}

// ---- IPC --------------------------------------------------------------------------

export function registerZapretLabIpc(): void {
  ipcMain.handle('zapretlab:families', h(() => ({ families: FAMILIES, limits: LIMITS, defaults: defaultModel() })))
  ipcMain.handle('zapretlab:binFiles', h(() => listBinFiles()))
  ipcMain.handle('zapretlab:list', h(() => (process.platform === 'win32' ? listCustomStrategies() : [])))
  ipcMain.handle('zapretlab:save', h((input) => saveCustomStrategy((input ?? {}) as SaveInput)))
  ipcMain.handle('zapretlab:delete', h((id) => deleteCustomStrategy(String(id))))
  ipcMain.handle('zapretlab:export', h((id) => exportCustomStrategy(String(id))))
  ipcMain.handle('zapretlab:import', h((text) => importCustomStrategy(text)))
  ipcMain.handle('zapretlab:preview', h((model, name) => previewCustomModel(model, name)))
  ipcMain.handle('zapretlab:fromStrategy', h((file) => modelFromStrategyFile(file)))
  ipcMain.handle('zapretlab:check', h((model) => checkModel(model)))
  ipcMain.handle('zapretlab:stopCheck', h(() => stopCheck()))
  ipcMain.handle('zapretlab:autopickStart', h(() => startAutopick()))
  ipcMain.handle('zapretlab:autopickStop', h(() => stopAutopick()))
  ipcMain.handle('zapretlab:autopickState', h(() => getAutopickState()))
  ipcMain.handle('zapretlab:activate', h((file) => activateStrategy(file)))
  ipcMain.handle('zapretlab:busy', h(() => zapretBusy()))
}
