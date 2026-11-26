import React from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@renderer/lib/utils'

/** Общие кусочки форм «Отчёт в поддержку» и «Предложить идею»: один стиль для обеих. */

export interface KindTile<K extends string> {
  id: K
  icon: LucideIcon
  title: string
  sub: string
  /** Цвет значка (классы статусных цветов). */
  tone: string
}

/** Крупные плитки выбора вида обращения. */
export function KindTiles<K extends string>({
  items,
  value,
  onChange,
  disabled,
  label
}: {
  items: KindTile<K>[]
  value: K | null
  onChange: (k: K) => void
  disabled?: boolean
  label: string
}): React.ReactElement {
  return (
    <div role="radiogroup" aria-label={label} className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      {items.map((it) => {
        const on = value === it.id
        const Icon = it.icon
        return (
          <button
            key={it.id}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onChange(it.id)}
            className={cn(
              'flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60',
              on ? 'border-primary/60 bg-primary/10 ring-1 ring-primary/30' : 'border-border bg-card/40 hover:border-primary/35 hover:bg-foreground/[0.03]'
            )}
          >
            <span className={cn('mt-px flex size-8 shrink-0 items-center justify-center rounded-lg', on ? 'bg-primary/15' : 'bg-foreground/[0.06]')}>
              <Icon className={cn('size-4', it.tone)} />
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold text-foreground">{it.title}</span>
              <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">{it.sub}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** Список «что написать»: короткие подсказки под выбранным видом. */
export const WriteHints: React.FC<{ title?: string; items: string[]; className?: string }> = ({ title = 'Что стоит написать', items, className }) => (
  <div className={cn('rounded-xl border border-foreground/[0.08] bg-foreground/[0.03] px-3 py-2.5', className)}>
    <div className="mb-1 text-[11px] font-semibold text-foreground">{title}</div>
    <ul className="space-y-0.5 text-[11px] leading-relaxed text-muted-foreground">
      {items.map((t) => (
        <li key={t} className="flex gap-1.5">
          <span className="select-none text-primary">•</span>
          <span>{t}</span>
        </li>
      ))}
    </ul>
  </div>
)

export interface NextStep {
  icon: LucideIcon
  text: React.ReactNode
}

/** Блок «Что будет дальше». */
export const NextSteps: React.FC<{ items: NextStep[]; className?: string }> = ({ items, className }) => (
  <div className={cn('rounded-xl border border-foreground/[0.08] bg-foreground/[0.03] px-3 py-2.5', className)}>
    <div className="mb-1.5 text-[11px] font-semibold text-foreground">Что будет дальше</div>
    <ul className="space-y-1.5">
      {items.map((s, i) => {
        const Icon = s.icon
        return (
          <li key={i} className="flex items-start gap-2 text-[11px] leading-relaxed text-muted-foreground">
            <Icon className="mt-0.5 size-3.5 shrink-0 text-primary" />
            <span>{s.text}</span>
          </li>
        )
      })}
    </ul>
  </div>
)

/** Счётчик символов под полем. */
export const CharCount: React.FC<{ n: number; max: number }> = ({ n, max }) => (
  <span className={cn('tabular-nums text-[11px] text-muted-foreground', n >= max && 'text-st-warn-text')}>
    {n}/{max}
  </span>
)
