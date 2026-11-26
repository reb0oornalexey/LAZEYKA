import React, { useState } from 'react'
import { Popover } from 'radix-ui'
import { toast } from 'sonner'
import { Check, ChevronDown, FilePlus2, Play, Trash2 } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { SOUND_KINDS, addCustomSound, allSounds, playSound, removeCustomSound, type SoundCategory } from '@renderer/lib/sound'

/**
 * Выбор звука категории: кнопка с названием и выпадающий список по группам
 * (Мягкие / Игровые / Технологичные / Тихие / Из файлов / Свои). У каждого
 * пункта «▶» — прослушать, не выбирая. Внизу — «Свой файл…».
 */
export function SoundPicker({
  category,
  value,
  disabled,
  onChange
}: {
  category: SoundCategory
  value: string
  disabled?: boolean
  onChange: (id: string) => void
}): React.ReactElement {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const sounds = allSounds()
  const current = sounds.find((s) => s.id === value)
  // «Сигналы» по смыслу — предупреждение, поэтому слушаем вариант «ошибка».
  const ok = category !== 'alerts'

  const addOwn = async (): Promise<void> => {
    setBusy(true)
    try {
      const def = await addCustomSound()
      if (def) {
        onChange(def.id)
        playSound(def.id, ok, category, true)
        toast.success(`Свой звук «${def.name}» добавлен`)
      }
    } catch (e) {
      toast.error('Звук не добавлен', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="flex h-8 w-44 shrink-0 cursor-pointer items-center justify-between gap-2 rounded-lg border border-border bg-background/60 px-2.5 text-xs text-foreground transition-colors hover:border-foreground/30 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className="truncate">{current?.name ?? 'Звон (стандартный)'}</span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="end"
          sideOffset={6}
          collisionPadding={12}
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            const root = e.currentTarget as HTMLElement | null
            requestAnimationFrame(() => root?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' }))
          }}
          className="z-[190] w-72 rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-2xl outline-none"
        >
          <div className="max-h-72 overflow-y-auto pr-0.5">
            {SOUND_KINDS.map((k) => {
              const items = sounds.filter((s) => s.kind === k.id)
              if (!items.length) return null
              return (
                <div key={k.id} className="pb-1">
                  <div className="px-2 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{k.title}</div>
                  {items.map((s) => {
                    const active = s.id === value
                    return (
                      <div key={s.id} data-active={active} className={cn('group flex items-center gap-1 rounded-md pr-1', active ? 'bg-primary/15' : 'hover:bg-foreground/[0.06]')}>
                        <button
                          type="button"
                          title="Прослушать"
                          aria-label={`Прослушать «${s.name}»`}
                          className="cursor-pointer rounded-md p-1.5 text-muted-foreground hover:text-primary"
                          onClick={() => playSound(s.id, ok, category, true)}
                        >
                          <Play className="size-3" />
                        </button>
                        <button
                          type="button"
                          className={cn('min-w-0 flex-1 cursor-pointer truncate py-1 text-left text-xs', active ? 'font-semibold text-foreground' : 'text-foreground/90')}
                          onClick={() => {
                            onChange(s.id)
                            setOpen(false)
                          }}
                        >
                          {s.name}
                        </button>
                        {active && <Check className="size-3.5 shrink-0 text-primary" />}
                        {s.kind === 'custom' && (
                          <button
                            type="button"
                            title="Удалить свой звук"
                            aria-label={`Удалить «${s.name}»`}
                            className="cursor-pointer rounded-md p-1 text-muted-foreground opacity-60 hover:text-st-err-text hover:opacity-100"
                            onClick={() =>
                              void removeCustomSound(s.id)
                                .then(() => toast(`Звук «${s.name}» удалён`))
                                .catch((e: unknown) => toast.error('Не удалось удалить', { description: e instanceof Error ? e.message : String(e) }))
                            }
                          >
                            <Trash2 className="size-3" />
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
          <div className="mt-1 border-t border-border/60 pt-1">
            <button
              type="button"
              disabled={busy}
              onClick={() => void addOwn()}
              className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-foreground hover:bg-foreground/[0.06] disabled:opacity-50"
            >
              <FilePlus2 className="size-3.5 text-muted-foreground" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span>Свой файл…</span>
                <span className="text-[10px] text-muted-foreground">mp3, wav, ogg, m4a · до 2 МБ и 5 с · хранится только на этом компьютере</span>
              </span>
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
