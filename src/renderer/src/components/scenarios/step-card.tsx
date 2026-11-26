import React from 'react'
import { Check, ChevronDown, ChevronUp, GripVertical, X } from 'lucide-react'
import { Segmented } from '@renderer/components/lz'
import { Hint } from '@renderer/components/prematch/hint'
import { DnsProviderIcon } from '@renderer/components/service-icons'
import type { FullScenario } from '@renderer/lib/scenario-extra'
import { cn } from '@renderer/lib/utils'
import type { DohProvider, IncyNode } from '@renderer/utils/ipc'
import { ACTION_BY_ID, getValue, setValue, type ActionId } from './actions'

export interface StepData {
  strategies: { file: string; title: string }[]
  nodes: IncyNode[]
  dns: DohProvider[]
  /** Список программ ExitLag, который сейчас стоит на вкладке ExitLag. */
  currentApps: string[]
}

/** Чип выбора (стратегия, узел, DNS-сервер). */
export const OptionChip: React.FC<{
  active: boolean
  onClick: () => void
  children: React.ReactNode
  sensitive?: string
  title?: string
}> = ({ active, onClick, children, sensitive, title }) => (
  <button
    type="button"
    aria-pressed={active}
    title={title}
    onClick={onClick}
    className={cn(
      'inline-flex h-7 min-w-0 max-w-full cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-[12px] font-semibold transition-colors',
      active
        ? 'border-primary/50 bg-primary/12 text-foreground'
        : 'border-foreground/[0.08] bg-foreground/[0.03] text-muted-foreground hover:border-foreground/20 hover:text-foreground'
    )}
  >
    {active && <Check className="size-3.5 shrink-0 text-primary" strokeWidth={3} />}
    <span data-sensitive={sensitive} className="truncate">
      {children}
    </span>
  </button>
)

const Sub: React.FC<{ label: string; children: React.ReactNode; right?: React.ReactNode }> = ({ label, children, right }) => (
  <div className="mt-3">
    <div className="mb-1.5 flex items-center justify-between gap-2 text-[11.5px] text-muted-foreground">
      <span>{label}</span>
      {right}
    </div>
    <div className="flex max-h-[68px] flex-wrap gap-1.5 overflow-y-auto pr-1">{children}</div>
  </div>
)

interface Props {
  id: ActionId
  index: number
  last: boolean
  s: FullScenario
  data: StepData
  onChange: (s: FullScenario) => void
  onRemove: () => void
  flash?: boolean
  /** Перетаскивание и стрелки: свой порядок выполнения шагов. */
  reorder?: {
    first: boolean
    dragging: boolean
    over: 'before' | 'after' | null
    onMove: (delta: -1 | 1) => void
    onDragStart: () => void
    onDragOver: (where: 'before' | 'after') => void
    onDrop: () => void
    onDragEnd: () => void
  }
}

/**
 * Шаг сценария на линии «Сделать». Номер слева — порядок выполнения; сам шаг —
 * карточка: что делает, выбор варианта и подробности (стратегия, узел, сервер).
 */
export const StepCard: React.FC<Props> = ({ id, index, last, s, data, onChange, onRemove, flash, reorder }) => {
  const a = ACTION_BY_ID[id]
  // Тянуть можно только за ручку: иначе перетаскивание мешало бы нажимать варианты и выделять текст.
  const [armed, setArmed] = React.useState(false)
  const v = getValue(s, id)
  const Icon = a.icon
  const off = a.options.find((o) => o.value === v)?.tone === 'off'

  return (
    <li
      className={cn('relative pl-12 transition-opacity', reorder?.dragging && 'opacity-40')}
      data-step={id}
      draggable={Boolean(reorder) && armed}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', id)
        reorder?.onDragStart()
      }}
      onDragOver={(e) => {
        if (!reorder) return
        e.preventDefault()
        const r = e.currentTarget.getBoundingClientRect()
        reorder.onDragOver(e.clientY < r.top + r.height / 2 ? 'before' : 'after')
      }}
      onDrop={(e) => {
        e.preventDefault()
        reorder?.onDrop()
      }}
      onDragEnd={() => {
        setArmed(false)
        reorder?.onDragEnd()
      }}
    >
      {/* Куда встанет шаг при перетаскивании. */}
      {reorder?.over && (
        <span
          aria-hidden
          className={cn('absolute left-12 right-0 z-10 h-[3px] rounded-full bg-primary', reorder.over === 'before' ? '-top-[5px]' : 'bottom-[3px]')}
        />
      )}
      {/* Линия сигнала между шагами. */}
      <span aria-hidden className={cn('absolute left-[15px] top-0 w-[2px] bg-primary/25', last ? 'h-5' : 'bottom-0')} />
      <span
        aria-hidden
        className={cn(
          'absolute left-0 top-3 flex size-8 items-center justify-center rounded-full border-2 bg-[color:var(--popover)] text-[12px] font-extrabold tabular-nums',
          off ? 'border-foreground/20 text-muted-foreground' : 'border-primary/60 text-primary'
        )}
      >
        {index + 1}
      </span>
      <div
        className={cn(
          'sc-step-in mb-2.5 rounded-2xl border border-foreground/[0.08] bg-foreground/[0.03] p-3.5',
          flash && 'sc-flash'
        )}
      >
        <div className="flex items-center gap-2.5">
          <span
            className={cn(
              'flex size-8 shrink-0 items-center justify-center rounded-[10px] [&_svg]:size-[17px]',
              off ? 'bg-foreground/[0.06] text-muted-foreground' : 'bg-primary/12 text-primary'
            )}
          >
            <Icon />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-[14px] font-bold text-foreground">
              {a.title}
              <Hint text={a.hint} />
            </div>
            <div className="truncate text-[11.5px] text-muted-foreground">{a.desc}</div>
          </div>
          {id !== 'dns' && a.options.length > 0 && (
            <Segmented
              size="sm"
              aria-label={a.title}
              className={cn('shrink-0', a.options.length > 2 ? 'w-[264px]' : 'w-[200px]')}
              items={a.options.map((o) => ({ id: o.value, label: o.label }))}
              value={v}
              onChange={(nv) => onChange(setValue(s, id, nv))}
            />
          )}
          {reorder && (
            <div className="flex shrink-0 items-center">
              <span
                title="Перетащите, чтобы поменять порядок"
                aria-hidden
                onPointerDown={() => setArmed(true)}
                onPointerUp={() => setArmed(false)}
                className="flex size-7 cursor-grab items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground active:cursor-grabbing"
              >
                <GripVertical className="size-4" />
              </span>
              <div className="flex flex-col">
                <button
                  type="button"
                  aria-label={`Шаг «${a.title}» раньше`}
                  title="Выполнить раньше"
                  disabled={reorder.first}
                  onClick={() => reorder.onMove(-1)}
                  className="flex h-3.5 w-6 cursor-pointer items-center justify-center rounded text-muted-foreground hover:text-foreground disabled:cursor-default disabled:opacity-30"
                >
                  <ChevronUp className="size-3.5" />
                </button>
                <button
                  type="button"
                  aria-label={`Шаг «${a.title}» позже`}
                  title="Выполнить позже"
                  disabled={last}
                  onClick={() => reorder.onMove(1)}
                  className="flex h-3.5 w-6 cursor-pointer items-center justify-center rounded text-muted-foreground hover:text-foreground disabled:cursor-default disabled:opacity-30"
                >
                  <ChevronDown className="size-3.5" />
                </button>
              </div>
            </div>
          )}
          <button
            type="button"
            title="Убрать шаг"
            aria-label={`Убрать шаг «${a.title}»`}
            onClick={onRemove}
            className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-st-err/12 hover:text-st-err-text"
          >
            <X className="size-4" />
          </button>
        </div>

        {id === 'zapret' && v === 'on' && (
          <Sub label="Стратегия">
            <OptionChip active={!s.zapretStrategy} onClick={() => onChange({ ...s, zapretStrategy: undefined })}>
              Текущая
            </OptionChip>
            {data.strategies.map((st) => (
              <OptionChip key={st.file} active={s.zapretStrategy === st.file} onClick={() => onChange({ ...s, zapretStrategy: st.file })}>
                {st.title}
              </OptionChip>
            ))}
          </Sub>
        )}

        {id === 'incy' && v === 'on' && (
          <Sub label="Узел">
            <OptionChip active={!s.incyNodeId} onClick={() => onChange({ ...s, incyNodeId: undefined })}>
              Выбранный сейчас
            </OptionChip>
            {data.nodes.map((n) => (
              <OptionChip key={n.id} sensitive="node" active={s.incyNodeId === n.id} onClick={() => onChange({ ...s, incyNodeId: n.id })}>
                {n.name}
              </OptionChip>
            ))}
          </Sub>
        )}

        {id === 'exitlag' && v === 'on' && (
          <Sub
            label={s.exitlagApps?.length ? 'Только эти программы' : 'Программы — текущий список с вкладки ExitLag'}
            right={
              s.exitlagApps?.length ? (
                <button type="button" className="cursor-pointer font-semibold text-primary hover:underline" onClick={() => onChange({ ...s, exitlagApps: undefined })}>
                  Брать текущий
                </button>
              ) : (
                <button
                  type="button"
                  disabled={data.currentApps.length === 0}
                  title={data.currentApps.length ? data.currentApps.join(', ') : 'Список на вкладке ExitLag пуст'}
                  className="cursor-pointer font-semibold text-primary hover:underline disabled:cursor-default disabled:text-muted-foreground disabled:no-underline"
                  onClick={() => onChange({ ...s, exitlagApps: [...data.currentApps] })}
                >
                  Запомнить текущий ({data.currentApps.length})
                </button>
              )
            }
          >
            {(s.exitlagApps?.length ? s.exitlagApps : data.currentApps).map((app) => (
              <span
                key={app}
                className={cn(
                  'inline-flex h-7 items-center rounded-lg border px-2.5 text-[12px] font-semibold',
                  s.exitlagApps?.length ? 'border-foreground/[0.1] bg-foreground/[0.04] text-foreground/90' : 'border-dashed border-foreground/15 text-muted-foreground'
                )}
              >
                {app}
              </span>
            ))}
            {!s.exitlagApps?.length && data.currentApps.length === 0 && (
              <span className="text-[12px] text-muted-foreground">Список пока пуст — добавьте игры на вкладке ExitLag.</span>
            )}
          </Sub>
        )}

        {id === 'dns' && (
          <Sub label="Сервер">
            <OptionChip active={v === 'dhcp'} onClick={() => onChange(setValue(s, 'dns', 'dhcp'))} title="Адрес, который выдаёт роутер">
              Стандартный (DHCP)
            </OptionChip>
            {data.dns.map((d) => (
              <OptionChip key={d.id} active={v === d.id} onClick={() => onChange(setValue(s, 'dns', d.id))}>
                <span className="inline-flex items-center gap-1.5">
                  <DnsProviderIcon id={d.id} className="size-3.5" />
                  {d.name}
                </span>
              </OptionChip>
            ))}
            {v !== 'dhcp' && !data.dns.some((d) => d.id === v) && (
              <OptionChip active onClick={() => void 0}>
                {v}
              </OptionChip>
            )}
          </Sub>
        )}
      </div>
    </li>
  )
}

export default StepCard
