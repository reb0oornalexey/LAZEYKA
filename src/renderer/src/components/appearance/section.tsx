import React, { memo, useEffect, useRef, useState } from 'react'
import { ChevronDown, Info, RotateCcw } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { useUiState } from '@renderer/lib/appearance/ui-state'

/** Маленькая «i» с пояснением — вместо абзацев текста. */
export const InfoTip: React.FC<{ text: React.ReactNode; className?: string }> = ({ text, className }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <span tabIndex={0} className={cn('inline-flex cursor-help text-muted-foreground hover:text-foreground', className)}>
        <Info className="size-3.5" />
      </span>
    </TooltipTrigger>
    <TooltipContent side="top" className="max-w-64 text-xs">
      {text}
    </TooltipContent>
  </Tooltip>
)

/** Карточка раздела: значок + заголовок + (i) с описанием. */
export const SectionCard: React.FC<{
  icon: React.ComponentType<{ className?: string }>
  title: string
  tip?: React.ReactNode
  right?: React.ReactNode
  className?: string
  children: React.ReactNode
}> = ({ icon: Icon, title, tip, right, className, children }) => (
  <section className={cn('rounded-xl border border-border bg-card p-3 text-card-foreground', className)}>
    <div className="mb-2 flex items-center gap-1.5">
      <Icon className="size-4 text-primary" />
      <h3 className="text-[13px] font-semibold text-[color:var(--text-title)]">{title}</h3>
      {tip && <InfoTip text={tip} />}
      {right && <div className="ml-auto flex items-center gap-1">{right}</div>}
    </div>
    {children}
  </section>
)

/** Строка настройки, на которую можно перейти из предпросмотра (data-ctl + подсветка). */
export const Ctl: React.FC<{ id: string; className?: string; children: React.ReactNode }> = ({ id, className, children }) => {
  const hot = useUiState((s) => s.focusKey === id)
  return (
    <div data-ctl={id} className={cn('rounded-lg transition-shadow', hot && 'ring-2 ring-primary ring-offset-1 ring-offset-card', className)}>
      {children}
    </div>
  )
}

const track: React.CSSProperties = { background: 'color-mix(in oklab, var(--muted-foreground) 28%, transparent)' }

/**
 * Ползунок. Пока тянете, значение сохраняется не чаще 10 раз в секунду, а итог — по отпусканию;
 * подпись обновляется сразу.
 */
export const SliderRow = memo(function SliderRow({
  id,
  label,
  value,
  min,
  max,
  step,
  format,
  onChange
}: {
  id: string
  label: string
  value: number
  min: number
  max: number
  step: number
  format: (v: number) => string
  onChange: (v: number) => void
}) {
  const [local, setLocal] = useState<number | null>(null)
  const latest = useRef(value)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cb = useRef(onChange)
  cb.current = onChange
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )
  const finish = (): void => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    if (local !== null) cb.current(latest.current)
    setLocal(null)
  }
  const shown = local ?? value
  return (
    <Ctl id={id} className="px-1 py-0.5">
      <div className="mb-0.5 flex items-center justify-between text-xs">
        <span>{label}</span>
        <span className="font-mono text-[11px] text-muted-foreground">{format(shown)}</span>
      </div>
      <input
        type="range"
        className="cp-range"
        style={track}
        min={min}
        max={max}
        step={step}
        value={shown}
        onChange={(e) => {
          const v = Number(e.target.value)
          latest.current = v
          setLocal(v)
          if (!timer.current) {
            timer.current = setTimeout(() => {
              timer.current = null
              cb.current(latest.current)
            }, 100)
          }
        }}
        onPointerUp={finish}
        onKeyUp={finish}
        onBlur={finish}
      />
    </Ctl>
  )
})

/** Переключатель-строка: подпись + (i) + Switch справа. */
export function Segmented<T extends string>({
  value,
  options,
  onChange
}: {
  value: T
  options: { id: T; label: string }[]
  onChange: (v: T) => void
}): React.JSX.Element {
  return (
    <div className="inline-flex rounded-lg border border-border bg-background p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={cn(
            'h-7 cursor-pointer rounded-md px-2.5 text-xs font-medium transition-colors',
            value === o.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Выпадающий список в стиле полей ввода приложения (нативный список, свой вид и стрелка). */
export function SelectField({ className, children, ...props }: React.ComponentProps<'select'>): React.JSX.Element {
  return (
  <div className="relative min-w-0">
    <select
      {...props}
      className={cn(
        'h-8 w-full cursor-pointer appearance-none rounded-lg border border-[color:var(--input-border)] bg-[color:var(--input-bg)] pr-7 pl-2 text-xs text-foreground outline-none transition-colors',
        'hover:border-primary/50 focus-visible:border-[color:var(--input-focus-border)] focus-visible:ring-2 focus-visible:ring-[color:var(--input-focus-ring)]',
        '[&>option]:bg-popover [&>option]:text-popover-foreground',
        className
      )}
    >
      {children}
    </select>
    <ChevronDown className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
  </div>
)
}

/** Единая кнопка сброса в правой части заголовка раздела. */
export const ResetButton: React.FC<{ onClick: () => void; label?: string; disabled?: boolean }> = ({ onClick, label = 'Сбросить', disabled }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="flex h-6 cursor-pointer items-center gap-1 rounded-md border border-border px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
  >
    <RotateCcw className="size-3" /> {label}
  </button>
)
