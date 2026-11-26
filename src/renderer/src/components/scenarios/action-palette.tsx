import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Search, X } from 'lucide-react'
import type { FullScenario } from '@renderer/lib/scenario-extra'
import { cn } from '@renderer/lib/utils'
import { ACTIONS, GROUPS, getValue, type ActionId } from './actions'

interface Props {
  s: FullScenario
  onPick: (id: ActionId) => void
  onClose: () => void
}

/**
 * Палитра действий: группы с крупными значками и поиск. Уже добавленные
 * действия отмечены; нажатие на такое ведёт к его шагу.
 */
export const ActionPalette: React.FC<Props> = ({ s, onPick, onClose }) => {
  const [q, setQ] = useState('')
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.focus(), [])

  const found = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return ACTIONS
    return ACTIONS.filter((a) => `${a.title} ${a.desc} ${a.keywords}`.toLowerCase().includes(t))
  }, [q])

  return (
    <div data-tour="scenario-palette" className="sc-sheet-in absolute inset-0 z-10 flex flex-col bg-[color:var(--popover)]">
      <div className="flex shrink-0 items-center gap-2 px-5 pb-3 pt-5">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && found[0]) onPick(found[0].id)
            }}
            placeholder="Что сделать? Например: VPN, Discord, DNS"
            aria-label="Найти действие"
            className="h-10 w-full rounded-xl border border-foreground/[0.1] bg-foreground/[0.04] pl-9 pr-3 text-[13.5px] text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/50"
          />
        </div>
        <button
          type="button"
          aria-label="Закрыть выбор действия"
          onClick={onClose}
          className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-xl text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-5">
        {GROUPS.map((g) => {
          const items = found.filter((a) => a.group === g.id)
          if (!items.length) return null
          return (
            <section key={g.id}>
              <div className="mb-2 text-[12px] font-semibold text-muted-foreground">{g.title}</div>
              <div className="grid grid-cols-2 gap-2">
                {items.map((a) => {
                  const added = getValue(s, a.id) !== 'keep'
                  const Icon = a.icon
                  const first = q.trim() !== '' && a.id === found[0]?.id
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => onPick(a.id)}
                      className={cn(
                        'group flex min-w-0 cursor-pointer items-center gap-3 rounded-2xl border p-3 text-left transition-colors',
                        added
                          ? 'border-primary/30 bg-primary/[0.06]'
                          : first
                            ? 'border-primary/45 bg-foreground/[0.05]'
                            : 'border-foreground/[0.08] bg-foreground/[0.03] hover:border-primary/40 hover:bg-foreground/[0.05]'
                      )}
                    >
                      <span
                        className={cn(
                          'flex size-10 shrink-0 items-center justify-center rounded-xl transition-colors [&_svg]:size-5',
                          added ? 'bg-primary/15 text-primary' : 'bg-foreground/[0.06] text-foreground/80 group-hover:bg-primary/12 group-hover:text-primary'
                        )}
                      >
                        <Icon />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5 text-[13.5px] font-bold text-foreground">
                          <span className="truncate">{a.title}</span>
                          {added && <Check className="size-3.5 shrink-0 text-primary" strokeWidth={3} />}
                        </span>
                        <span className="line-clamp-2 text-[11.5px] leading-snug text-muted-foreground">
                          {added ? 'Уже в сценарии — перейти к шагу' : a.desc}
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </section>
          )
        })}
        {found.length === 0 && (
          <div className="py-10 text-center text-[13px] text-muted-foreground">
            Такого действия нет. Сценарий умеет: {ACTIONS.map((a) => a.title).join(', ')}.
          </div>
        )}
      </div>
    </div>
  )
}

export default ActionPalette
