import React, { useState } from 'react'
import { Popover } from 'radix-ui'
import { RefreshCw, Sparkles, X } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'

export interface UpdateItem {
  key: string
  title: string
  subtitle: string
  onDetails: () => void
  onDismiss: () => void
}

interface Props {
  items: UpdateItem[]
  checking: boolean
  onCheckApp: () => void
}

/**
 * Обновления в шапке главной. Нет обновлений компонентов — обычная кнопка
 * «Проверить обновления» (LAZEYKA). Есть — заметный чип «Обновления 2»,
 * по нажатию список: у каждого «Подробнее» и «×» (скрыть до перезапуска),
 * внизу — проверка новой версии LAZEYKA.
 */
export const UpdatesButton: React.FC<Props> = ({ items, checking, onCheckApp }) => {
  const [open, setOpen] = useState(false)

  if (items.length === 0) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={onCheckApp}
        disabled={checking}
        title="Проверить, вышла ли новая версия LAZEYKA"
        className="h-8 rounded-lg text-xs"
      >
        <RefreshCw className={cn('size-3.5', checking && 'animate-spin')} />
        {checking ? 'Проверяем…' : 'Проверить обновления'}
      </Button>
    )
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button
          variant="outline"
          size="sm"
          data-tour="home-updates"
          title="Есть обновления компонентов — показать"
          className="h-8 gap-1.5 rounded-lg border-primary/45 text-xs"
        >
          <Sparkles className="size-3.5 text-primary" />
          Обновления
          <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[10.5px] font-bold text-primary-foreground tabular-nums">
            {items.length}
          </span>
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          collisionPadding={12}
          className="z-[190] w-[380px] rounded-2xl border border-border bg-popover p-1.5 text-popover-foreground shadow-2xl outline-none"
        >
          {items.map((u) => (
            <div key={u.key} className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 hover:bg-accent/60">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary">
                <Sparkles className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold">{u.title}</span>
                <span className="block truncate text-[11px] text-muted-foreground">{u.subtitle}</span>
              </span>
              <Button
                size="sm"
                className="h-7 rounded-lg text-xs"
                onClick={() => {
                  setOpen(false)
                  u.onDetails()
                }}
              >
                Подробнее
              </Button>
              <Button variant="ghost" size="icon" className="size-7 rounded-lg" onClick={u.onDismiss} title="Скрыть до перезапуска программы" aria-label="Скрыть">
                <X className="size-3.5" />
              </Button>
            </div>
          ))}
          <div className="my-1 h-px bg-border" />
          <button
            type="button"
            onClick={onCheckApp}
            disabled={checking}
            className="flex w-full cursor-pointer items-center gap-2 rounded-xl px-2.5 py-2 text-left text-xs font-medium text-muted-foreground hover:bg-accent/60 hover:text-foreground disabled:opacity-60"
          >
            <RefreshCw className={cn('size-3.5', checking && 'animate-spin')} />
            {checking ? 'Проверяем…' : 'Проверить, вышла ли новая версия LAZEYKA'}
          </button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

export default UpdatesButton
