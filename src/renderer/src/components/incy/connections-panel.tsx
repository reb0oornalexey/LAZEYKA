import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ChevronDown, Pause, Play, Search, X } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { Hint } from '@renderer/components/prematch/hint'
import { listHasProc } from '@renderer/utils/per-app'
import {
  connClose,
  connStart,
  connStop,
  onConnections,
  ruleForDomain,
  type ConnectionsEvent,
  type ConnRow,
  type RuleAction
} from '@renderer/utils/incy-extra-api'

function fmtBytes(b: number): string {
  if (b < 1024) return `${Math.round(b)} Б`
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(b < 10 * 1024 ? 1 : 0)} КБ`
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(b < 10 * 1024 ** 2 ? 1 : 0)} МБ`
  return `${(b / 1024 ** 3).toFixed(2)} ГБ`
}
const fmtRate = (bps: number): string => (bps < 1 ? '0' : `${fmtBytes(bps)}/с`)
function fmtDur(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s} с`
  if (s < 3600) return `${Math.floor(s / 60)} мин`
  return `${Math.floor(s / 3600)} ч ${Math.floor((s % 3600) / 60)} мин`
}

const ROUTE_LABEL: Record<ConnRow['route'], string> = {
  vpn: 'Через VPN',
  direct: 'Напрямую',
  block: 'Заблокировано',
  other: '—'
}
const ROUTE_CLASS: Record<ConnRow['route'], string> = {
  vpn: 'text-primary',
  direct: 'text-muted-foreground',
  block: 'text-st-err-text',
  other: 'text-st-warn-text'
}

const COLS = 'grid-cols-[minmax(0,1.1fr)_minmax(0,2fr)_minmax(0,1.3fr)_6.5rem_5.5rem_6.5rem_4rem_3.5rem]'

type Filter = 'all' | 'vpn' | 'direct'
type Sort = 'speed' | 'recent'

interface RowProps {
  row: ConnRow
  /** Возраст соединения строкой — меняется раз в секунду, остальное реже. */
  age: string
  menuOpen: boolean
  onToggleMenu: (id: string) => void
  onRule: (row: ConnRow, action: RuleAction) => void
  onClose: (id: string) => void
}

const ConnRowView = React.memo(
  function ConnRowView({ row, age, menuOpen, onToggleMenu, onRule, onClose }: RowProps): React.JSX.Element {
    const target = row.hostIsIp ? 'адреса' : 'домена'
    return (
      <div className="border-t border-border/30">
        <div className={cn('grid items-center gap-2 px-2 py-1 text-[11px]', COLS)}>
          <span className="truncate font-mono font-semibold" title={row.process}>
            {row.process || '—'}
          </span>
          <span className="truncate font-mono" title={`${row.host}:${row.port}`}>
            {row.hostIsIp ? <span data-sensitive="ip">{row.host}</span> : row.host}
            {row.port ? `:${row.port}` : ''}
            <span className="ml-1 text-[9px] uppercase text-muted-foreground">{row.network}</span>
          </span>
          <span className="truncate text-muted-foreground" title={row.rule}>
            {row.customRule && <span className="mr-1 rounded bg-primary/10 px-1 text-[9px] text-primary">своё</span>}
            {row.rule}
          </span>
          <span className={cn('font-semibold', ROUTE_CLASS[row.route])}>{ROUTE_LABEL[row.route]}</span>
          <span className="text-right tabular-nums">
            ↓{fmtRate(row.downSpeed)}
            <br />
            <span className="text-muted-foreground">↑{fmtRate(row.upSpeed)}</span>
          </span>
          <span className="text-right tabular-nums text-muted-foreground">
            ↓{fmtBytes(row.download)}
            <br />↑{fmtBytes(row.upload)}
          </span>
          <span className="text-right tabular-nums text-muted-foreground">{age}</span>
          <span className="flex items-center justify-end gap-1">
            <button
              type="button"
              title={`Правило для этого ${target}`}
              aria-expanded={menuOpen}
              onClick={() => onToggleMenu(row.id)}
              className="inline-flex cursor-pointer items-center rounded border border-border/50 px-1 text-muted-foreground hover:text-foreground"
            >
              <ChevronDown className={cn('size-3 transition-transform', menuOpen && 'rotate-180')} />
            </button>
            <button
              type="button"
              title="Закрыть соединение"
              onClick={() => onClose(row.id)}
              className="cursor-pointer text-muted-foreground hover:text-destructive"
            >
              <X className="size-3" />
            </button>
          </span>
        </div>
        {menuOpen && (
          <div className="flex flex-wrap items-center gap-1.5 bg-muted/20 px-2 py-1.5 text-[11px]">
            <span className="text-muted-foreground">
              Для этого {target} всегда:
            </span>
            <button type="button" onClick={() => onRule(row, 'direct')} className="cursor-pointer rounded-lg border border-border/60 px-2 py-0.5 font-semibold hover:border-primary/50">
              напрямую
            </button>
            <button type="button" onClick={() => onRule(row, 'proxy')} className="cursor-pointer rounded-lg border border-primary/40 px-2 py-0.5 font-semibold text-primary hover:bg-primary/10">
              через VPN
            </button>
            <button type="button" onClick={() => onRule(row, 'block')} className="cursor-pointer rounded-lg border border-border/60 px-2 py-0.5 font-semibold hover:border-destructive/50 hover:text-destructive">
              блокировать
            </button>
          </div>
        )}
      </div>
    )
  },
  (a, b) =>
    a.menuOpen === b.menuOpen &&
    a.age === b.age &&
    a.onRule === b.onRule &&
    a.onClose === b.onClose &&
    a.row.id === b.row.id &&
    a.row.route === b.row.route &&
    a.row.rule === b.row.rule &&
    a.row.download === b.row.download &&
    a.row.upload === b.row.upload &&
    a.row.downSpeed === b.row.downSpeed &&
    a.row.upSpeed === b.row.upSpeed
)

interface PanelProps {
  /**
   * Список приложений ExitLag. Если передан, панель встроена на страницу ExitLag: появляется фильтр
   * «только приложения из списка» (включён по умолчанию). Это та же таблица, что в INCY → «Статистика»,
   * одна реализация на оба места.
   */
  appList?: string[]
}

/**
 * Окно «Соединения»: живая таблица соединений ядра. Данные запрашиваются, только
 * пока панель открыта и окно видно.
 */
const ConnectionsPanel: React.FC<PanelProps> = ({ appList }) => {
  const embedded = Array.isArray(appList)
  const [onlyListed, setOnlyListed] = useState(true)
  const [ev, setEv] = useState<ConnectionsEvent | null>(null)
  const [paused, setPaused] = useState(false)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<Sort>('speed')
  const [menuId, setMenuId] = useState<string | null>(null)
  const [hidden, setHidden] = useState(typeof document !== 'undefined' && document.hidden)

  useEffect(() => {
    const onVis = (): void => setHidden(document.hidden)
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  const live = !paused && !hidden
  useEffect(() => {
    if (!live) return
    const off = onConnections(setEv)
    connStart().catch(() => void 0)
    return () => {
      off()
      connStop().catch(() => void 0)
    }
  }, [live])

  const closeConn = useCallback(async (id: string) => {
    const ok = await connClose(id).catch(() => false)
    if (ok) setEv((e) => (e ? { ...e, rows: e.rows.filter((r) => r.id !== id), total: Math.max(0, e.total - 1) } : e))
    else toast.error('Не удалось закрыть соединение')
  }, [])

  const toggleMenu = useCallback((id: string) => setMenuId((cur) => (cur === id ? null : id)), [])

  const applyRule = useCallback(async (row: ConnRow, action: RuleAction) => {
    setMenuId(null)
    try {
      const res = await ruleForDomain(row.host, action)
      toast.success('Правило добавлено. Изменить можно в „Свои правила“', {
        description: res.reapplied ? 'VPN переподключится, чтобы применить правило.' : undefined
      })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось добавить правило')
    }
  }, [])

  // Свежее ядро присылает строки каждую секунду; фильтры считаем один раз на событие.
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const rows = (ev?.rows ?? []).filter(
      (r) =>
        (!embedded || !onlyListed || listHasProc(appList ?? [], r.process, r.appRule)) &&
        (filter === 'all' || (filter === 'vpn' ? r.route === 'vpn' : r.route === 'direct')) &&
        (!q || r.process.toLowerCase().includes(q) || r.host.toLowerCase().includes(q) || r.rule.toLowerCase().includes(q))
    )
    return rows.sort((a, b) =>
      sort === 'speed' ? b.downSpeed + b.upSpeed - (a.downSpeed + a.upSpeed) || b.start - a.start : b.start - a.start
    )
  }, [ev, query, filter, sort, embedded, onlyListed, appList])

  const at = ev?.at ?? Date.now()
  const chip = (id: Filter, label: string): React.JSX.Element => (
    <button
      type="button"
      onClick={() => setFilter(id)}
      className={cn(
        'cursor-pointer rounded-md px-2 py-0.5 text-[11px] font-semibold transition-colors',
        filter === id ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'
      )}
    >
      {label}
    </button>
  )

  return (
    <div
      data-tour={embedded ? 'exitlag-connections' : 'incy-connections'}
      className={cn('space-y-3', embedded ? '' : 'rounded-xl border border-border bg-card/40 p-4')}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-sm font-semibold">
          {embedded ? 'Живые соединения' : 'Соединения'}
          <Hint
            text={
              embedded
                ? 'Те же живые соединения, что в INCY → «Статистика», с фильтром по списку ExitLag. Для каждого адреса можно задать правило: всегда напрямую, через VPN или блокировать.'
                : 'Что сейчас открыто в сети: какая программа, куда, по какому правилу и через что идёт. Данные запрашиваются раз в секунду, только пока это окно открыто. На странице ExitLag эта же таблица есть с фильтром «только приложения из списка».'
            }
          />
        </div>
        <button
          type="button"
          onClick={() => setPaused((p) => !p)}
          className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-border/60 px-2 py-1 text-[11px] font-semibold hover:border-primary/50"
        >
          {paused ? <Play className="size-3" /> : <Pause className="size-3" />}
          {paused ? 'Продолжить' : 'Пауза'}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[10rem] flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск по программе, адресу или правилу"
            className="h-7 w-full rounded-lg border border-border/60 bg-background/60 pl-7 pr-2 text-[11px] outline-none focus:border-primary/60"
          />
        </div>
        {embedded && (
          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
            <input type="checkbox" checked={onlyListed} onChange={(e) => setOnlyListed(e.target.checked)} />
            только приложения из списка
          </label>
        )}
        <div className="flex items-center gap-0.5">
          {chip('all', 'Все')}
          {chip('vpn', 'Только через VPN')}
          {chip('direct', 'Только напрямую')}
        </div>
        <button
          type="button"
          onClick={() => setSort((s) => (s === 'speed' ? 'recent' : 'speed'))}
          className="cursor-pointer rounded-lg border border-border/60 px-2 py-1 text-[11px] font-semibold hover:border-primary/50"
        >
          {sort === 'speed' ? 'По скорости' : 'По времени'}
        </button>
      </div>

      {ev && ev.state === 'ok' && (
        <div className="text-[11px] text-muted-foreground">
          Соединений: <b className="text-foreground">{embedded && onlyListed ? `${shown.length} из ${ev.total}` : ev.total}</b> · всего ↓ {fmtBytes(ev.downTotal)} · ↑ {fmtBytes(ev.upTotal)}
          {ev.viaNode && (
            <>
              {' '}
              · через <span data-sensitive="node">{ev.viaNode}</span>
            </>
          )}
          {paused && <span className="ml-2 text-st-warn-text">обновление остановлено</span>}
        </div>
      )}

      {ev === null ? (
        <p className="text-[11px] text-muted-foreground">{paused ? 'Обновление остановлено.' : 'Получаю данные ядра…'}</p>
      ) : ev.state === 'unavailable' ? (
        <p className="rounded-lg border border-border/50 bg-background/40 px-3 py-2 text-[11px] leading-snug text-muted-foreground">
          {ev.reason}
        </p>
      ) : shown.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">Подходящих соединений сейчас нет.</p>
      ) : (
        <div className="max-h-[28rem] overflow-auto rounded-lg border border-border/40">
          <div className={cn('sticky top-0 z-10 grid gap-2 bg-background/95 px-2 py-1 text-[11px] font-medium text-muted-foreground', COLS)}>
            <span>Программа</span>
            <span>Адрес</span>
            <span>Правило</span>
            <span>Маршрут</span>
            <span className="text-right">Скорость</span>
            <span className="text-right">Объём</span>
            <span className="text-right">Время</span>
            <span />
          </div>
          {shown.map((r) => (
            <ConnRowView
              key={r.id}
              row={r}
              age={fmtDur(at - r.start)}
              menuOpen={menuId === r.id}
              onToggleMenu={toggleMenu}
              onRule={applyRule}
              onClose={closeConn}
            />
          ))}
        </div>
      )}
      {ev && ev.more > 0 && (
        <p className="text-[11px] text-muted-foreground">…и ещё {ev.more} соединений (показаны самые активные).</p>
      )}
    </div>
  )
}

export default ConnectionsPanel
