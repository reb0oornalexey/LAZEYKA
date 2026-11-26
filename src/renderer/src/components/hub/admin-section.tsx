import React, { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { Hint } from '@renderer/components/prematch/hint'
import { LzPanel } from '@renderer/components/lz'

/**
 * Секция «Админки» на языке «Сигнал»: поверхность LzPanel (берёт стиль карточек из
 * «Оформления»), заголовок 14/700 с «i», короткое пояснение и действия справа.
 * Значок слева — одноцветный, без плитки. Можно свернуть.
 */
export const AdminSection: React.FC<{
  icon?: React.ComponentType<{ className?: string }>
  title: string
  subtitle?: React.ReactNode
  hint?: string
  right?: React.ReactNode
  tour?: string
  collapsible?: boolean
  defaultOpen?: boolean
  className?: string
  children: React.ReactNode
}> = ({ icon: Icon, title, subtitle, hint, right, tour, collapsible, defaultOpen = true, className, children }) => {
  const [open, setOpen] = useState(defaultOpen)
  const shown = !collapsible || open
  return (
    <LzPanel data-tour={tour} className={cn('p-4 text-card-foreground', className)}>
      <div className={cn('flex min-h-8 items-center gap-2.5', shown && 'mb-3.5')}>
        {Icon && <Icon className="size-[18px] shrink-0 text-muted-foreground" />}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {collapsible ? (
              <button type="button" onClick={() => setOpen((v) => !v)} className="flex cursor-pointer items-center gap-1.5 text-left">
                <h2 className="text-[14px] font-bold text-[color:var(--text-title)]">{title}</h2>
                <ChevronDown className={cn('size-4 text-muted-foreground transition-transform', open && 'rotate-180')} />
              </button>
            ) : (
              <h2 className="text-[14px] font-bold text-[color:var(--text-title)]">{title}</h2>
            )}
            {hint && <Hint text={hint} />}
          </div>
          {subtitle && <div className="truncate text-[11.5px] text-muted-foreground">{subtitle}</div>}
        </div>
        {right && <div className="ml-auto flex shrink-0 items-center gap-1.5">{right}</div>}
      </div>
      {shown && children}
    </LzPanel>
  )
}

/** Подзаголовок внутри секции — обычным регистром, мелко (вместо подписей капсом). */
export const SubLabel: React.FC<{ children: React.ReactNode; className?: string; right?: React.ReactNode }> = ({ children, className, right }) => (
  <div className={cn('flex items-center justify-between gap-2 text-[12px] font-semibold text-muted-foreground', className)}>
    <span className="flex min-w-0 items-center gap-1.5">{children}</span>
    {right}
  </div>
)

/** Вкладки внутри раздела «Админки»: сегменты с бегунком и счётчиком справа (например, заявок на проверке). */
export function AdminTabs<T extends string>({
  value,
  onChange,
  items,
  label,
  className
}: {
  value: T
  onChange: (v: T) => void
  items: { id: T; label: string; icon?: React.ComponentType<{ className?: string }>; badge?: number; tone?: 'warn' | 'on' }[]
  label: string
  className?: string
}): React.ReactElement {
  const n = Math.max(1, items.length)
  const idx = Math.max(0, items.findIndex((i) => i.id === value))
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn('relative grid rounded-xl border border-foreground/[0.08] bg-foreground/[0.04] p-1', className)}
      style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
        e.preventDefault()
        onChange(items[(idx + (e.key === 'ArrowRight' ? 1 : n - 1)) % n].id)
      }}
    >
      <span
        aria-hidden
        className="lz-seg-thumb pointer-events-none absolute top-1 bottom-1 left-1 rounded-lg bg-primary shadow-sm"
        style={{ width: `calc((100% - 0.5rem) / ${n})`, transform: `translateX(${idx * 100}%)` }}
      />
      {items.map((it) => {
        const active = it.id === value
        const Icon = it.icon
        return (
          <button
            key={it.id}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(it.id)}
            className={cn(
              'relative z-[1] flex h-8 min-w-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-semibold transition-colors',
              active ? 'text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {Icon && <Icon className="size-3.5 shrink-0" />}
            <span className="truncate">{it.label}</span>
            {it.badge ? (
              <span
                className={cn(
                  'flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full px-1 text-[10px] font-bold tabular-nums',
                  active ? 'bg-primary-foreground/90 text-primary' : it.tone === 'on' ? 'bg-primary text-primary-foreground' : 'bg-st-warn text-black'
                )}
              >
                {it.badge}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

/** Сегментированный переключатель (как в остальных формах программы): пункты равной ширины, бегунок цвета темы. */
export function Segmented<T extends string | number>({
  value,
  onChange,
  items,
  label,
  disabled,
  size = 'sm'
}: {
  value: T
  onChange: (v: T) => void
  items: [T, string][]
  label: string
  disabled?: boolean
  size?: 'xs' | 'sm'
}): React.ReactElement {
  const n = Math.max(1, items.length)
  const idx = items.findIndex(([v]) => v === value)
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn('relative inline-grid max-w-full rounded-xl border border-foreground/[0.08] bg-foreground/[0.04] p-0.5', disabled && 'opacity-60')}
      style={{ gridTemplateColumns: `repeat(${n}, minmax(0, auto))` }}
    >
      {items.map(([v, t], i) => (
        <button
          key={String(v)}
          type="button"
          role="radio"
          aria-checked={value === v}
          disabled={disabled}
          onClick={() => onChange(v)}
          className={cn(
            'relative min-w-0 cursor-pointer rounded-lg font-semibold whitespace-nowrap transition-colors disabled:cursor-default',
            size === 'xs' ? 'h-6 px-2.5 text-[11px]' : 'h-7 px-3 text-xs',
            i === idx ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {t}
        </button>
      ))}
    </div>
  )
}

/** Поле формы: подпись, «необязательно», подсказка или ошибка под полем. */
export const Field: React.FC<{ label: string; optional?: boolean; help?: string; error?: string | null; className?: string; children: React.ReactNode }> = ({
  label,
  optional,
  help,
  error,
  className,
  children
}) => (
  <label className={cn('flex min-w-0 flex-col gap-1.5', className)}>
    <span className="flex items-center gap-1.5 text-[12px] font-semibold text-foreground/90">
      {label}
      {optional && <span className="rounded-md bg-foreground/[0.06] px-1.5 py-px text-[10.5px] font-medium text-muted-foreground">необязательно</span>}
    </span>
    {children}
    {error ? (
      <span role="alert" className="text-[11px] leading-snug text-st-err-text">
        {error}
      </span>
    ) : help ? (
      <span className="text-[11px] leading-snug text-muted-foreground">{help}</span>
    ) : null}
  </label>
)

/** Поле ввода в стиле форм программы. */
export const inputClass =
  'h-9 w-full min-w-0 rounded-xl border border-[color:var(--input-border)] bg-[color:var(--input-bg)] px-3 text-xs outline-none transition-all placeholder:text-muted-foreground/60 focus-visible:border-[color:var(--input-focus-border)] focus-visible:ring-2 focus-visible:ring-[color:var(--input-focus-ring)] disabled:opacity-50'

/** Мягкая «вложенная» поверхность внутри секции (форма, список). */
export const insetClass = 'rounded-xl border border-foreground/[0.08] bg-foreground/[0.025]'
