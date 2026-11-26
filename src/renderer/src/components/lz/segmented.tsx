import React from 'react'
import { cn } from '@renderer/lib/utils'
import './lz.css'

export interface SegmentedItem<T extends string> {
  id: T
  label: string
  icon?: React.ComponentType<{ className?: string }>
  title?: string
  short?: string
}

interface Props<T extends string> {
  items: SegmentedItem<T>[]
  value: T
  onChange: (v: T) => void
  size?: 'sm' | 'md'
  className?: string
  wrapLabels?: boolean
  'aria-label'?: string
  'data-tour'?: string
}

/**
 * Сегментированный переключатель: пункты одинаковой ширины, под выбранным
 * едет бегунок цвета темы (как вкладки «Оформления»). Стрелки ←/→ переключают.
 */
export function Segmented<T extends string>({ items, value, onChange, size = 'md', className, wrapLabels, ...rest }: Props<T>): React.ReactElement {
  const n = Math.max(1, items.length)
  const idx = Math.max(0, items.findIndex((i) => i.id === value))
  return (
    <div
      role="tablist"
      aria-label={rest['aria-label']}
      data-tour={rest['data-tour']}
      className={cn('lz-control-surface relative grid rounded-xl border p-1', className)}
      style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
        e.preventDefault()
        const next = items[(idx + (e.key === 'ArrowRight' ? 1 : n - 1)) % n]
        if (!next) return
        onChange(next.id)
        e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[items.indexOf(next)]?.focus()
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
            aria-label={it.label}
            tabIndex={active ? 0 : -1}
            title={it.title ?? it.label}
            onClick={() => onChange(it.id)}
            className={cn(
              'relative z-[1] flex min-w-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg px-2 font-semibold transition-colors',
              size === 'sm' ? 'h-7 text-[11.5px]' : 'h-8 text-xs',
              wrapLabels && 'h-auto min-h-8 py-1 leading-tight',
              active ? 'text-primary-foreground' : 'lz-control-option'
            )}
          >
            {Icon && <Icon className={cn('size-3.5 shrink-0', wrapLabels ? '@max-[640px]:hidden' : '@max-[520px]:hidden')} />}
            <span className={cn('min-w-0', wrapLabels ? 'whitespace-normal break-words' : 'truncate', it.short && '@max-[600px]:hidden')}>{it.label}</span>
            {it.short && <span aria-hidden className="min-w-0 truncate @min-[601px]:hidden">{it.short}</span>}
          </button>
        )
      })}
    </div>
  )
}

export default Segmented
