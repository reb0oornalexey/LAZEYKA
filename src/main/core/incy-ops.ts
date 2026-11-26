/**
 * INCY: общий менеджер долгих действий со списком серверов — «Проверить пинг» и «Обновить подписки».
 *
 * Одно действие на всё приложение: его запускают и программа (страница INCY), и пульт с телефона.
 * Кто бы ни запустил, второй источник видит тот же прогресс и может остановить. Повторный запуск того же
 * действия во время идущего не создаёт второе, а возвращает текущее (joined).
 *
 * Остановка:
 *  - пинг: новые замеры не начинаются; идущие (до 5 одновременно) больше не ждём — их результаты
 *    отбрасываются, а сами замеры заканчиваются в фоне в пределах своего таймаута. Полученные до остановки
 *    числа записываются, итог: «Проверено 12 из 48, остановлено»;
 *  - обновление подписок: между подписками (идущий запрос к провайдеру доживает до конца).
 *
 * Не зависит от Electron — проверяется обычным node.
 */

export type OpKind = 'ping' | 'refresh'
export type OpSource = 'app' | 'remote'

/** Что именно проверять или обновлять. */
export type OpScope =
  | { type: 'all' }
  /** Серверы одной подписки; subId = null — «Добавлены вручную». */
  | { type: 'sub'; subId: string | null }
  /** Конкретные серверы: один (кнопка у строки) или видимые после поиска/фильтра. */
  | { type: 'ids'; ids: string[]; label?: string }

export interface OpView {
  kind: OpKind
  source: OpSource
  scope: OpScope['type']
  /** Для scope = 'sub': какая подписка (null — добавленные вручную). */
  subId?: string | null
  /** «все серверы», «Mighty VPN», «найденные (12)» — для текста прогресса. */
  scopeLabel: string
  running: boolean
  /** Нажали «Остановить», ждём, пока закончится текущий шаг (только обновление подписок). */
  stopping?: boolean
  stopped?: boolean
  done: number
  total: number
  ok?: boolean
  text?: string
  /** Растёт с каждым запуском: по нему окно и телефон понимают, что итог относится к новому действию. */
  seq: number
  startedAt: number
  finishedAt?: number
}

export interface OpSnapshot {
  view: OpView | null
  /** id серверов идущего замера (пусто для обновления подписок). */
  targetIds: string[]
  /** Уже полученные результаты замера: id → задержка (null — нет ответа) и время. */
  results: Record<string, { latencyMs: number | null; at: number }>
}

export interface OpStartResult {
  ok: boolean
  /** Действие уже шло — новое не запускали, view — текущее. */
  joined?: boolean
  code?: 'busy' | 'rate' | 'no_subs' | 'no_nodes' | 'bad_scope'
  message?: string
  view: OpView | null
}

export interface OpsNode {
  id: string
  name: string
  subscriptionId?: string | null
}

export interface OpsDeps<N extends OpsNode> {
  nodes(): N[]
  subscriptions(): { id: string; title: string }[]
  /** Замер одного сервера с настройками пинга. signal — на случай, если замер умеет прерываться. */
  pingNode(node: N, signal: AbortSignal): Promise<number | null>
  saveLatencies(results: { id: string; latencyMs: number | null }[]): void
  /** Обновить одну подписку (та же функция, что у кнопки в программе). */
  refreshOne(subId: string): Promise<unknown>
  /** «Пинг после обновления подписки». */
  pingAfterRefresh(): boolean
  /** Любое изменение состояния (прогресс, итог). Вызывающий сам решает, как часто рассылать. */
  onChange?(snap: OpSnapshot): void
  /** Итог действия (лог, плашка на телефоне). */
  onFinish?(view: OpView): void
  now?: () => number
  concurrency?: number
  /** Пауза между запусками одного действия с телефона (защита от частых нажатий). */
  remoteGapMs?: number
}

export function pluralRu(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100
  const b = a % 10
  if (a > 10 && a < 20) return many
  if (b === 1) return one
  if (b >= 2 && b <= 4) return few
  return many
}

export function serversWord(n: number): string {
  return `${n} ${pluralRu(n, 'сервер', 'сервера', 'серверов')}`
}

/** Итог обновления подписок. */
export function refreshSummary(subsTotal: number, serversInSubs: number, failed: { title: string; error: string }[]): { ok: boolean; text: string } {
  if (!failed.length) return { ok: true, text: `Обновлено: ${serversWord(serversInSubs)}` }
  const okCount = Math.max(0, subsTotal - failed.length)
  const names = failed
    .slice(0, 3)
    .map((f) => `«${f.title}»`)
    .join(', ')
  const more = failed.length > 3 ? ` и ещё ${failed.length - 3}` : ''
  if (okCount === 0) {
    const why = failed.length === 1 ? `: ${failed[0].error}` : ''
    return { ok: false, text: `Не удалось обновить ${failed.length === 1 ? 'подписку' : 'подписки'} ${names}${more}${why}` }
  }
  return { ok: false, text: `Обновлено ${okCount} из ${subsTotal} подписок (${serversWord(serversInSubs)}). Не обновились: ${names}${more}` }
}

/** Итог замера пинга. */
export function pingSummary(results: { name: string; latencyMs: number | null }[]): { ok: boolean; text: string } {
  const alive = results.filter((r) => typeof r.latencyMs === 'number' && r.latencyMs > 0)
  if (!results.length) return { ok: false, text: 'Нет серверов для проверки' }
  if (!alive.length) return { ok: false, text: `Ни один сервер не ответил (проверено: ${results.length})` }
  const best = alive.reduce((a, b) => (b.latencyMs! < a.latencyMs! ? b : a))
  if (results.length === 1) return { ok: true, text: `${best.name}: ${Math.round(best.latencyMs!)} мс` }
  return { ok: true, text: `Пинг проверен: ответили ${alive.length} из ${results.length}. Быстрее всех — ${best.name}, ${Math.round(best.latencyMs!)} мс` }
}

/** Разобрать объём, пришедший из окна или с телефона. */
export function parseScope(raw: unknown): OpScope | null {
  if (raw == null) return { type: 'all' }
  if (typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (r.type === 'all') return { type: 'all' }
  if (r.type === 'sub') {
    if (r.subId === null) return { type: 'sub', subId: null }
    return typeof r.subId === 'string' && r.subId.length > 0 && r.subId.length <= 200 ? { type: 'sub', subId: r.subId } : null
  }
  if (r.type === 'ids' && Array.isArray(r.ids)) {
    const ids = r.ids.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 200).slice(0, 5000)
    if (!ids.length) return null
    const label = typeof r.label === 'string' ? r.label.slice(0, 60) : undefined
    return { type: 'ids', ids, ...(label ? { label } : {}) }
  }
  return null
}

const KIND_BUSY: Record<OpKind, string> = {
  ping: 'Сейчас проверяется пинг. Дождитесь или остановите проверку.',
  refresh: 'Сейчас обновляются подписки. Дождитесь или остановите обновление.'
}

export class IncyOpsManager<N extends OpsNode> {
  private cur: OpView | null = null
  private seq = 0
  private ac: AbortController | null = null
  private targetIds: string[] = []
  private results = new Map<string, { latencyMs: number | null; at: number }>()
  private lastRemoteStart: Record<OpKind, number> = { ping: -Infinity, refresh: -Infinity }
  private readonly now: () => number
  /** Промис идущего действия — для тестов и для ожидания при выходе. */
  private task: Promise<void> | null = null

  constructor(private readonly deps: OpsDeps<N>) {
    this.now = deps.now ?? Date.now
  }

  view(): OpView | null {
    return this.cur ? { ...this.cur } : null
  }

  running(): boolean {
    return Boolean(this.cur?.running)
  }

  snapshot(): OpSnapshot {
    const results: OpSnapshot['results'] = {}
    for (const [id, r] of this.results) results[id] = { ...r }
    return { view: this.view(), targetIds: this.cur?.running && this.cur.kind === 'ping' ? [...this.targetIds] : [], results }
  }

  /** Пинг из идущего замера (undefined — этот сервер ещё не мерили или замер не идёт). */
  partialLatency(id: string): number | null | undefined {
    if (!this.cur?.running || this.cur.kind !== 'ping') return undefined
    const r = this.results.get(id)
    return r ? r.latencyMs : undefined
  }

  /** Ждёт окончания текущего действия (для тестов). */
  async settled(): Promise<void> {
    while (this.task) await this.task
  }

  start(kind: OpKind, scopeIn: OpScope | null | undefined, source: OpSource): OpStartResult {
    const scope: OpScope = scopeIn ?? { type: 'all' }
    if (this.cur?.running) {
      if (this.cur.kind === kind) return { ok: true, joined: true, view: this.view() }
      return { ok: false, code: 'busy', message: KIND_BUSY[this.cur.kind], view: this.view() }
    }
    const t = this.now()
    if (source === 'remote') {
      const gap = this.deps.remoteGapMs ?? 10_000
      const wait = this.lastRemoteStart[kind] + gap - t
      if (wait > 0) return { ok: false, code: 'rate', message: `Не чаще раза в 10 секунд. Подождите ${Math.ceil(wait / 1000)} с.`, view: this.view() }
    }
    if (kind === 'refresh') {
      const subs = this.refreshTargets(scope)
      if (!subs) return { ok: false, code: 'bad_scope', message: 'Подписка не найдена. Обновите список.', view: this.view() }
      if (!subs.length) {
        return {
          ok: false,
          code: 'no_subs',
          message:
            source === 'remote'
              ? 'Подписок нет. Добавьте подписку в программе на компьютере: раздел INCY, вкладка «Сервера».'
              : 'Подписок нет — сначала добавьте ссылку на подписку.',
          view: this.view()
        }
      }
      if (source === 'remote') this.lastRemoteStart.refresh = t
      this.task = this.runRefresh(scope, subs, source).finally(() => (this.task = null))
      return { ok: true, view: this.view() }
    }
    const list = this.pingTargets(scope)
    if (!list.length) {
      return {
        ok: false,
        code: 'no_nodes',
        message: source === 'remote' && scope.type === 'all' ? 'Серверов нет. Добавьте подписку в программе на компьютере: раздел INCY.' : 'Нет серверов для проверки.',
        view: this.view()
      }
    }
    if (source === 'remote') this.lastRemoteStart.ping = t
    this.task = this.runPing(scope, list, source).finally(() => (this.task = null))
    return { ok: true, view: this.view() }
  }

  /** Остановить текущее действие. Без действия — ничего не делает. */
  stop(reason?: string): { ok: boolean; view: OpView | null } {
    if (!this.cur?.running || !this.ac) return { ok: false, view: this.view() }
    if (!this.ac.signal.aborted) {
      this.ac.abort(reason)
      this.cur.stopping = true
      this.emit()
    }
    return { ok: true, view: this.view() }
  }

  // ---- внутреннее ----------------------------------------------------------------------

  private pingTargets(scope: OpScope): N[] {
    const all = this.deps.nodes()
    if (scope.type === 'all') return all
    if (scope.type === 'sub') return all.filter((n) => (scope.subId === null ? !n.subscriptionId : n.subscriptionId === scope.subId))
    const want = new Set(scope.ids)
    return all.filter((n) => want.has(n.id))
  }

  private refreshTargets(scope: OpScope): { id: string; title: string }[] | null {
    const subs = this.deps.subscriptions()
    if (scope.type === 'sub') {
      if (scope.subId === null) return null
      const one = subs.find((s) => s.id === scope.subId)
      return one ? [one] : null
    }
    return subs
  }

  private scopeLabel(kind: OpKind, scope: OpScope, count: number): string {
    if (scope.type === 'all') return kind === 'ping' ? 'все серверы' : 'все подписки'
    if (scope.type === 'sub') {
      if (scope.subId === null) return 'добавленные вручную'
      const t = this.deps.subscriptions().find((s) => s.id === scope.subId)?.title
      return t ? `«${t}»` : 'подписка'
    }
    if (count === 1) {
      const n = this.deps.nodes().find((x) => x.id === scope.ids[0])
      return n ? n.name : 'один сервер'
    }
    return scope.label ? `${scope.label} (${count})` : `выбранные (${count})`
  }

  private begin(kind: OpKind, scope: OpScope, source: OpSource, total: number): AbortController {
    this.ac = new AbortController()
    this.cur = {
      kind,
      source,
      scope: scope.type,
      ...(scope.type === 'sub' ? { subId: scope.subId } : {}),
      scopeLabel: this.scopeLabel(kind, scope, total),
      running: true,
      done: 0,
      total,
      seq: ++this.seq,
      startedAt: this.now()
    }
    return this.ac
  }

  private finish(ok: boolean, text: string, stopped: boolean): void {
    if (!this.cur) return
    this.cur = { ...this.cur, running: false, stopping: false, stopped, ok, text, finishedAt: this.now() }
    this.ac = null
    this.emit()
    try {
      this.deps.onFinish?.(this.view()!)
    } catch {
      /* итог уже показан */
    }
  }

  private emit(): void {
    try {
      this.deps.onChange?.(this.snapshot())
    } catch {
      /* рассылка не должна ломать действие */
    }
  }

  private async runPing(scope: OpScope, list: N[], source: OpSource): Promise<void> {
    const ac = this.begin('ping', scope, source, list.length)
    const signal = ac.signal
    this.targetIds = list.map((n) => n.id)
    this.results = new Map()
    this.emit()
    const got: { id: string; name: string; latencyMs: number | null }[] = []
    // Прерывание: идущий замер «отпускаем» сразу, его результат не учитываем.
    const aborted = new Promise<'aborted'>((resolve) => {
      if (signal.aborted) resolve('aborted')
      else signal.addEventListener('abort', () => resolve('aborted'), { once: true })
    })
    let idx = 0
    let savedUpTo = 0
    const SAVE_EVERY = 5
    const worker = async (): Promise<void> => {
      while (idx < list.length && !signal.aborted) {
        const node = list[idx++]
        let lat: number | null
        try {
          const r = await Promise.race([this.deps.pingNode(node, signal), aborted])
          if (r === 'aborted') return
          lat = r
        } catch {
          if (signal.aborted) return
          lat = null
        }
        if (signal.aborted) return
        got.push({ id: node.id, name: node.name, latencyMs: lat })
        this.results.set(node.id, { latencyMs: lat, at: this.now() })
        if (this.cur) this.cur.done = got.length
        // Промежуточное сохранение: если во время проверки выбрать или включить сервер, страница
        // перечитывает список с диска — раньше там ещё не было ни одного нового замера, и все пинги
        // «сбрасывались». Пишем пачками, чтобы не писать файл после каждого сервера.
        if (got.length - savedUpTo >= SAVE_EVERY) {
          const part = got.slice(savedUpTo)
          savedUpTo = got.length
          try {
            this.deps.saveLatencies(part.map((r) => ({ id: r.id, latencyMs: r.latencyMs })))
          } catch {
            /* не мешаем замеру; в конце сохраним ещё раз */
          }
        }
        this.emit()
      }
    }
    const stopped = (): boolean => signal.aborted
    try {
      await Promise.all(Array.from({ length: Math.max(1, Math.min(this.deps.concurrency ?? 5, list.length)) }, worker))
      if (got.length > savedUpTo) this.deps.saveLatencies(got.slice(savedUpTo).map((r) => ({ id: r.id, latencyMs: r.latencyMs })))
      if (stopped()) {
        this.finish(true, `Проверено ${got.length} из ${list.length}, ${typeof signal.reason === 'string' ? signal.reason : 'остановлено'}`, true)
      } else {
        const sum = pingSummary(got)
        this.finish(sum.ok, sum.text, false)
      }
    } catch (e) {
      this.finish(false, `Не удалось проверить пинг: ${e instanceof Error ? e.message : String(e)}`, stopped())
    } finally {
      this.targetIds = []
      this.results = new Map()
    }
  }

  private async runRefresh(scope: OpScope, subs: { id: string; title: string }[], source: OpSource): Promise<void> {
    const ac = this.begin('refresh', scope, source, subs.length)
    this.emit()
    const failed: { title: string; error: string }[] = []
    let done = 0
    let chain = false
    try {
      for (const sub of subs) {
        if (ac.signal.aborted) break
        try {
          await this.deps.refreshOne(sub.id)
        } catch (e) {
          failed.push({ title: sub.title, error: e instanceof Error ? e.message : String(e) })
        }
        done++
        if (this.cur) this.cur.done = done
        this.emit()
      }
      const ids = new Set(subs.map((s) => s.id))
      const inSubs = this.deps.nodes().filter((n) => n.subscriptionId && ids.has(n.subscriptionId)).length
      if (ac.signal.aborted && done < subs.length) {
        const okCount = done - failed.length
        this.finish(failed.length === 0, `Обновлено ${okCount} из ${subs.length} ${pluralRu(subs.length, 'подписки', 'подписок', 'подписок')}, остановлено`, true)
      } else {
        const sum = refreshSummary(subs.length, inSubs, failed)
        this.finish(sum.ok, sum.text, false)
        chain = this.deps.pingAfterRefresh() && failed.length < subs.length
      }
    } catch (e) {
      this.finish(false, `Не удалось обновить подписки: ${e instanceof Error ? e.message : String(e)}`, ac.signal.aborted)
    }
    // «Пинг после обновления подписки»: сразу замер того же объёма.
    if (chain) {
      const pingScope: OpScope = scope.type === 'sub' ? scope : { type: 'all' }
      const list = this.pingTargets(pingScope)
      if (list.length) await this.runPing(pingScope, list, source)
    }
  }
}
