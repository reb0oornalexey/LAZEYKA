import React, { useCallback, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@renderer/lib/utils'

/**
 * Сворачиваемые разделы страниц («Настройки», «Стример»).
 *
 * Развёрнутость, которую выбрал пользователь, запоминается в localStorage.
 * Раздел можно раскрыть и программно (экскурсия, переход по ссылке): такое
 * раскрытие действует до ухода со страницы и не запоминается, чтобы страница
 * при следующем открытии оставалась такой же обозримой.
 *
 * Свёрнутый раздел своё содержимое не рисует. Экскурсия раскрывает его через
 * lib/tour-focus (useTourTab): в шаге экскурсии поле tab — это id раздела.
 */

function readMap(key: string): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(key)
    const v = raw ? (JSON.parse(raw) as unknown) : null
    return v && typeof v === 'object' ? (v as Record<string, boolean>) : {}
  } catch {
    return {}
  }
}

export interface SectionsState {
  isOpen: (id: string) => boolean
  toggle: (id: string) => void
  /** Раскрыть без запоминания (экскурсия, переход по ссылке). */
  reveal: (id: string) => void
}

export function useSections(storageKey: string, defaults: Record<string, boolean> = {}): SectionsState {
  const [saved, setSaved] = useState<Record<string, boolean>>(() => readMap(storageKey))
  const [revealed, setRevealed] = useState<Record<string, boolean>>({})

  const isOpen = (id: string): boolean => revealed[id] === true || (saved[id] ?? defaults[id] ?? false)

  const toggle = (id: string): void => {
    const next = !isOpen(id)
    setRevealed((r) => (r[id] ? { ...r, [id]: false } : r))
    setSaved((s) => {
      const m = { ...s, [id]: next }
      try {
        localStorage.setItem(storageKey, JSON.stringify(m))
      } catch {
        /* хранилище недоступно — состояние живёт до перезапуска */
      }
      return m
    })
  }

  // Стабильная ссылка: её удобно передавать в useTourTab и эффекты.
  const reveal = useCallback((id: string): void => {
    setRevealed((r) => (r[id] ? r : { ...r, [id]: true }))
  }, [])

  return { isOpen, toggle, reveal }
}

/** Заголовок группы, которая всегда на виду. */
export const SectionHeading: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
  <div className={cn('px-1 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/80', className)}>{children}</div>
)

export const CollapsibleSection: React.FC<{
  id: string
  state: SectionsState
  title: string
  /** Что внутри — одной строкой, видно и в свёрнутом виде. */
  summary: string
  icon?: React.ReactNode
  /** data-tour раздела. */
  tour?: string
  children: React.ReactNode
}> = ({ id, state, title, summary, icon, tour, children }) => {
  const open = state.isOpen(id)
  return (
    <section data-section={id} data-tour={tour} className="space-y-3">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => state.toggle(id)}
        className={cn(
          'group flex w-full cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors',
          open ? 'border-border/70 bg-card/20' : 'border-border bg-card/40 hover:border-primary/30 hover:bg-card/70'
        )}
      >
        {icon && (
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.06] text-muted-foreground transition-colors group-hover:text-foreground">
            {icon}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-foreground">{title}</span>
          <span className="block truncate text-[11.5px] text-muted-foreground">{summary}</span>
        </span>
        <span className="shrink-0 text-[11px] text-muted-foreground transition-colors group-hover:text-foreground">
          {open ? 'Скрыть' : 'Показать'}
        </span>
        <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform duration-200', open && 'rotate-180')} />
      </button>
      {open && <div className="space-y-4">{children}</div>}
    </section>
  )
}
