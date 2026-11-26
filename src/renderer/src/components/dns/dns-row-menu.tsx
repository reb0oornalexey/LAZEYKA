import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MoreHorizontal } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'

export interface RowMenuItem {
  key: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  /** Подсказка: что произойдёт. */
  hint?: string
  danger?: boolean
  /** Тонкая черта над пунктом: отделяет группу действий. */
  separated?: boolean
  onClick: () => void
}

/** Маленькое меню «⋯» у строки DNS: редкие действия, чтобы не загромождать строку. */
export function DnsRowMenu({
  items,
  tour
}: {
  items: RowMenuItem[]
  tour?: string
}): React.JSX.Element {
  // Меню рисуется поверх страницы (портал): карточка списка обрезает всё, что выходит за её край.
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)
  const open = pos !== null
  const box = useRef<HTMLDivElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  const setOpen = (v: boolean | ((x: boolean) => boolean)): void => {
    const next = typeof v === 'function' ? v(open) : v
    if (!next || !box.current) return setPos(null)
    const r = box.current.getBoundingClientRect()
    setPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) })
  }

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node
      if (!box.current?.contains(t) && !pop.current?.contains(t)) setPos(null)
    }
    const close = (): void => setPos(null)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setPos(null)
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', close)
    document.addEventListener('scroll', close, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', close)
      document.removeEventListener('scroll', close, true)
    }
  }, [open])

  // Пустое меню всё равно занимает своё место: значки в строках не съезжают.
  if (items.length === 0) return <span aria-hidden className="size-7 shrink-0" />
  return (
    <div ref={box} className="relative flex" data-tour={tour}>
      <Button
        size="icon-sm"
        variant="ghost"
        className="size-7 rounded-lg bg-clip-border p-0"
        title="Ещё"
        aria-label="Ещё"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <MoreHorizontal className="size-3.5" />
      </Button>
      {pos &&
        createPortal(
          <div
            ref={pop}
            role="menu"
            style={{ top: pos.top, right: pos.right }}
            className="fixed z-[90] min-w-[13rem] overflow-hidden rounded-xl border border-border bg-background p-1 shadow-xl"
          >
            {items.map((it) => (
              <button
                key={it.key}
                type="button"
                role="menuitem"
                title={it.hint}
                onClick={() => {
                  setOpen(false)
                  it.onClick()
                }}
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-foreground/[0.06]',
                  it.danger ? 'text-st-err-text' : 'text-foreground',
                  it.separated &&
                    'relative mt-1 before:absolute before:inset-x-1 before:-top-0.5 before:h-px before:bg-border'
                )}
              >
                <it.icon className="size-3.5 shrink-0" />
                {it.label}
              </button>
            ))}
          </div>,
          document.body
        )}
    </div>
  )
}
