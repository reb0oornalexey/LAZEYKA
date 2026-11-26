/**
 * «Проверить пинг» и «Обновить подписки» на странице INCY: кнопка с меню объёма (split button), остановка,
 * строка хода и итога. Само действие идёт в главном процессе (общий менеджер incy-ops) — его же видит и может
 * остановить пульт с телефона, поэтому состояние берётся только из событий incy:opsUpdate.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Activity, CheckCircle2, ChevronDown, CircleSlash, RefreshCw, Smartphone, Square, X } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { incyConnect, incyGetNodes, incyGetSettings, incyGetStatus, incySelectNode, type IncyNode } from '@renderer/utils/ipc'
import {
  onOpsUpdate,
  opsGet,
  opsStart,
  opsStop,
  type OpKind,
  type OpScope,
  type OpSnapshot,
  type OpView
} from '@renderer/utils/incy-ops-api'

// ---- Итог действия: тосты и «подключаться к лучшему» --------------------------------------------
//
// Живут на уровне модуля, а не страницы: замер идёт в главном процессе и может закончиться, когда
// пользователь уже ушёл со страницы INCY. Подписка ставится один раз при первом показе страницы.

let finishHookInstalled = false
let lastFinishedSeq = 0

async function autoConnectBest(view: OpView): Promise<void> {
  // «Подключаться к лучшему после замера» — как раньше: только для замера из программы больше чем одного
  // сервера, не после остановки, и только если лучший заметно быстрее текущего.
  if (view.kind !== 'ping' || view.stopped || view.total < 2) return
  const settings = await incyGetSettings().catch(() => null)
  if (!settings?.routeAutoConnectBest) return
  const [nodes, status] = await Promise.all([incyGetNodes(), incyGetStatus()])
  const measured = nodes.filter((n) => (n.latencyAt ?? 0) >= view.startedAt)
  const words = String(settings.autoSelectExcludeKeywords ?? '')
    .split(/[,;\n]+/)
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean)
  const excluded = new Set(settings.autoSelectExcludedKeys ?? [])
  const allowed = (n: IncyNode): boolean =>
    !excluded.has(`${n.name}|${n.server}:${n.port}`) && !words.some((w) => `${n.name} ${n.description ?? ''}`.toLowerCase().includes(w))
  const best = measured.filter((n) => n.latencyMs != null && allowed(n)).sort((a, b) => a.latencyMs! - b.latencyMs!)[0]
  const curId = status.state === 'running' ? status.activeNodeId : status.selectedNodeId
  const cur = measured.find((n) => n.id === curId)
  const muchBetter =
    best && best.id !== curId && (cur?.latencyMs == null || (best.latencyMs! < cur.latencyMs * 0.7 && cur.latencyMs - best.latencyMs! > 30))
  if (!best || !muchBetter) return
  if (status.state === 'running') {
    toast.info(`Переключаю на лучший узел: ${best.name} (${best.latencyMs} мс)`)
    await incyConnect(best.id)
  } else {
    await incySelectNode(best.id)
    toast.info(`Выбран лучший узел: ${best.name} (${best.latencyMs} мс)`)
  }
}

function onFinished(view: OpView): void {
  if (view.seq <= lastFinishedSeq) return
  lastFinishedSeq = view.seq
  // Действие с телефона итог показывает на телефоне; здесь достаточно обновлённого списка.
  if (view.source !== 'app') return
  const text = view.text ?? (view.ok ? 'Готово' : 'Не получилось')
  if (view.stopped) toast.info(text)
  else if (view.ok) toast.success(text)
  else if (view.kind === 'refresh') toast.warning(text)
  else toast.error(text)
  if (view.ok) void autoConnectBest(view).catch(() => void 0)
}

function installFinishHook(): void {
  if (finishHookInstalled) return
  finishHookInstalled = true
  void opsGet()
    .then((s) => {
      // Итог, случившийся до первого показа страницы, повторно не показываем.
      if (s.view) lastFinishedSeq = s.view.running ? s.view.seq - 1 : s.view.seq
    })
    .catch(() => void 0)
  onOpsUpdate((s) => {
    if (s.view && !s.view.running) onFinished(s.view)
  })
}

// ---- Хук состояния ---------------------------------------------------------------------------------

export interface IncyOps {
  snap: OpSnapshot | null
  /** Идущее действие (или null). */
  running: OpView | null
  start: (kind: OpKind, scope: OpScope) => Promise<void>
  stop: () => Promise<void>
}

export function useIncyOps(onSnapshot?: (s: OpSnapshot) => void): IncyOps {
  const [snap, setSnap] = useState<OpSnapshot | null>(null)
  const cb = useRef(onSnapshot)
  cb.current = onSnapshot

  useEffect(() => {
    installFinishHook()
    let alive = true
    const apply = (s: OpSnapshot): void => {
      if (!alive) return
      setSnap(s)
      cb.current?.(s)
    }
    const off = onOpsUpdate(apply)
    void opsGet().then(apply).catch(() => void 0)
    return () => {
      alive = false
      off()
    }
  }, [])

  const start = useCallback(async (kind: OpKind, scope: OpScope) => {
    try {
      const r = await opsStart(kind, scope)
      if (r.joined && r.view) {
        const by = r.view.source === 'remote' ? ' (запущено с телефона)' : ''
        toast.info(
          `${r.view.kind === 'ping' ? 'Пинг уже проверяется' : 'Подписки уже обновляются'}${by}: ${r.view.done} из ${r.view.total}`
        )
      } else if (!r.ok) {
        toast.warning(r.message ?? 'Не получилось')
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }, [])

  const stop = useCallback(async () => {
    await opsStop().catch(() => void 0)
  }, [])

  return { snap, running: snap?.view?.running ? snap.view : null, start, stop }
}

// ---- Кнопка с меню объёма ----------------------------------------------------------------------------

export interface ScopeOption {
  key: string
  label: string
  /** Подпись справа: число серверов/подписок. */
  count?: number
  hint?: string
  disabled?: boolean
  scope: OpScope
}

/** Всплывающее меню: закрывается по клику снаружи и Esc. */
function useDismiss(open: boolean, close: () => void, ref: React.RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, close, ref])
}

export function OpsSplitButton({
  kind,
  ops,
  label,
  options,
  defaultScope,
  menuTitle,
  tour,
  disabled
}: {
  kind: OpKind
  ops: IncyOps
  label: string
  options: ScopeOption[]
  defaultScope: OpScope
  menuTitle: string
  tour?: string
  disabled?: boolean
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useDismiss(open, close, box)
  const run = ops.running
  const mine = run?.kind === kind
  const busyOther = Boolean(run && !mine)
  const Icon = kind === 'ping' ? Activity : RefreshCw

  if (mine) {
    return (
      <button
        type="button"
        data-tour={tour}
        onClick={() => void ops.stop()}
        disabled={run.stopping}
        title={run.kind === 'refresh' ? 'Остановить после текущей подписки' : 'Остановить проверку: уже полученные результаты сохранятся'}
        className="inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-st-err/50 bg-st-err/10 px-2.5 text-xs font-semibold text-st-err-text transition-colors hover:bg-st-err/15 disabled:cursor-default disabled:opacity-70"
      >
        <Square className="size-3 fill-current" />
        {run.stopping ? 'Останавливаю…' : 'Остановить'}
        <span className="font-mono tabular-nums opacity-80">
          {run.done} из {run.total}
        </span>
      </button>
    )
  }

  return (
    <div ref={box} data-tour={tour} className="relative inline-flex shrink-0">
      {/* Вся пара «действие + меню» — одна кнопка общего вида: на неё действует стиль кнопок
          из «Оформления» (свечение, стекло, клавиши), как на соседних «Из буфера» и «Импорт». */}
      <div
        data-slot="button"
        data-variant="outline"
        data-size="sm"
        className={cn(
          'inline-flex h-7 items-stretch overflow-hidden rounded-md border border-[color:var(--btn-outline-border)] bg-[color:var(--btn-outline-bg)] text-[color:var(--btn-outline-fg)] transition-colors hover:border-[color:var(--btn-outline-hover-border)]',
          (disabled || busyOther) && 'opacity-50'
        )}
      >
        <button
          type="button"
          onClick={() => void ops.start(kind, defaultScope)}
          disabled={disabled || busyOther}
          title={busyOther ? 'Дождитесь окончания текущего действия' : undefined}
          className="inline-flex cursor-pointer items-center gap-1.5 px-2.5 text-xs font-semibold transition-colors hover:bg-[color:var(--btn-outline-hover)] disabled:cursor-default"
        >
          <Icon className="size-3.5" />
          {label}
        </button>
        <span aria-hidden className="my-1.5 w-px bg-[color:var(--btn-outline-border)] opacity-50" />
        <button
          type="button"
          aria-label={menuTitle}
          aria-haspopup="menu"
          aria-expanded={open}
          title={menuTitle}
          onClick={() => setOpen((v) => !v)}
          disabled={disabled || busyOther}
          className="inline-flex cursor-pointer items-center px-1.5 transition-colors hover:bg-[color:var(--btn-outline-hover)] disabled:cursor-default"
        >
          <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} />
        </button>
      </div>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 w-64 overflow-hidden rounded-xl border border-border bg-popover p-1 shadow-lg"
        >
          <div className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{menuTitle}</div>
          {options.map((o) => (
            <button
              key={o.key}
              type="button"
              role="menuitem"
              disabled={o.disabled}
              onClick={() => {
                setOpen(false)
                void ops.start(kind, o.scope)
              }}
              className="flex w-full cursor-pointer flex-col items-start rounded-lg px-2.5 py-1.5 text-left hover:bg-primary/10 disabled:cursor-default disabled:opacity-45 disabled:hover:bg-transparent"
            >
              <span className="flex w-full items-center justify-between gap-2 text-xs font-semibold">
                <span className="truncate">{o.label}</span>
                {o.count != null && <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{o.count}</span>}
              </span>
              {o.hint && <span className="text-[10.5px] leading-snug text-muted-foreground">{o.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Маленькая кнопка-значок (в шапке карточки подписки): запускает действие для этой подписки,
 * а пока оно идёт — превращается в «Остановить».
 */
export function OpsIconButton({
  kind,
  ops,
  scope,
  title,
  disabled,
  activeHere
}: {
  kind: OpKind
  ops: IncyOps
  scope: OpScope
  title: string
  disabled?: boolean
  /** Идущее действие относится к этой кнопке (крутить значок). */
  activeHere?: boolean
}): React.JSX.Element {
  const run = ops.running
  const Icon = kind === 'ping' ? Activity : RefreshCw
  if (run?.kind === kind && activeHere) {
    return (
      <button
        type="button"
        onClick={() => void ops.stop()}
        disabled={run.stopping}
        title={`Остановить (${run.done} из ${run.total})`}
        className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-st-err-text hover:bg-st-err/10 disabled:opacity-60"
      >
        <Square className="size-3 fill-current" />
      </button>
    )
  }
  return (
    <button
      type="button"
      onClick={() => void ops.start(kind, scope)}
      disabled={disabled || Boolean(run)}
      title={run ? 'Дождитесь окончания текущего действия' : title}
      className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-foreground hover:bg-accent disabled:cursor-default disabled:opacity-50"
    >
      <Icon className={cn('h-3.5 w-3.5', run?.kind === kind && 'animate-pulse text-st-warn-text')} />
    </button>
  )
}

/** Строка хода: «Проверяю пинг: 12 из 48 · Mighty VPN» с полосой; после конца — итог до следующего действия. */
export function OpsStatusLine({ ops, className }: { ops: IncyOps; className?: string }): React.JSX.Element | null {
  const v = ops.snap?.view ?? null
  // Итог показываем только для действия, которое началось или шло, пока страница открыта.
  const [seenSeq, setSeenSeq] = useState<number | null>(null)
  const [hiddenSeq, setHiddenSeq] = useState<number | null>(null)
  useEffect(() => {
    if (v?.running) setSeenSeq(v.seq)
  }, [v?.running, v?.seq])
  if (!v || hiddenSeq === v.seq || (!v.running && seenSeq !== v.seq)) return null
  const pct = v.total ? Math.max(3, Math.round((v.done / v.total) * 100)) : 0
  const where = v.scope === 'all' ? '' : ` · ${v.scopeLabel}`
  const from = v.source === 'remote' ? 'с телефона' : null
  const text = v.running
    ? v.stopping
      ? 'Останавливаю: дожидаюсь текущей подписки…'
      : v.kind === 'ping'
        ? `Проверяю пинг: ${v.done} из ${v.total}${where}`
        : `Обновляю подписки: ${v.done} из ${v.total}${where}`
    : (v.text ?? '')
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'rounded-xl border px-3 py-2 text-xs',
        v.running
          ? 'border-border bg-card/40'
          : v.stopped
            ? 'border-st-warn/30 bg-st-warn/10 text-st-warn-text'
            : v.ok
              ? 'border-st-ok/30 bg-st-ok/10'
              : 'border-st-err/30 bg-st-err/10',
        className
      )}
    >
      <div className="flex items-center gap-2">
        {v.running ? (
          <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
        ) : v.stopped ? (
          <CircleSlash className="size-3.5 shrink-0" />
        ) : v.ok ? (
          <CheckCircle2 className="size-3.5 shrink-0 text-st-ok-text" />
        ) : (
          <X className="size-3.5 shrink-0 text-st-err-text" />
        )}
        <span className="min-w-0 flex-1 truncate font-medium" title={text}>
          {text}
        </span>
        {from && (
          <span className="inline-flex shrink-0 items-center gap-1 text-[10.5px] text-muted-foreground">
            <Smartphone className="size-3" /> {from}
          </span>
        )}
        {!v.running && (
          <button
            type="button"
            onClick={() => setHiddenSeq(v.seq)}
            title="Скрыть"
            className="shrink-0 cursor-pointer text-muted-foreground hover:text-foreground"
          >
            <X className="size-3" />
          </button>
        )}
      </div>
      {v.running && (
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-secondary/80">
          <div className={cn('h-full rounded-full bg-primary transition-all duration-300', !v.total && 'w-1/3 animate-pulse')} style={v.total ? { width: `${pct}%` } : undefined} />
        </div>
      )}
    </div>
  )
}
