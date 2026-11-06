import { useState } from 'react'
import { Send, Star, X } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'
import { openExternalUrl } from '@renderer/utils/ipc'

/** Подписка, которую рекомендует автор LAZEYKA (реферальная ссылка). */
export const VELVET_URL = 'https://t.me/velvet?start=oKvatLLM'

const DISMISS_KEY = 'lazeyka.velvetHintDismissed'

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * Рекомендация автора — Velvet.
 *
 * - `card`: блок с текстом и кнопкой (FAQ, пустая вкладка INCY без подписки);
 * - `hint`: одна неброская строка для тех, у кого подписка уже есть; её можно
 *   закрыть крестиком, и она больше не появится.
 */
export default function VelvetRecommendation({
  variant = 'card',
  className
}: {
  variant?: 'card' | 'hint'
  className?: string
}): React.ReactElement | null {
  const [dismissed, setDismissed] = useState(readDismissed)

  if (variant === 'hint') {
    if (dismissed) return null
    return (
      <div className={cn('flex items-center gap-2 text-[11px] text-muted-foreground', className)}>
        <Star className="size-3 shrink-0 text-primary/70" />
        <span className="min-w-0 flex-1 truncate">
          Ищете запасной VPN? Автор LAZEYKA уже год пользуется{' '}
          <button
            type="button"
            className="cursor-pointer font-semibold text-primary underline-offset-2 hover:underline"
            onClick={() => void openExternalUrl(VELVET_URL)}
          >
            Velvet
          </button>
        </span>
        <button
          type="button"
          title="Скрыть"
          className="cursor-pointer rounded-md p-0.5 text-muted-foreground/70 hover:bg-foreground/[0.06] hover:text-foreground"
          onClick={() => {
            try {
              localStorage.setItem(DISMISS_KEY, '1')
            } catch {
              /* noop */
            }
            setDismissed(true)
          }}
        >
          <X className="size-3" />
        </button>
      </div>
    )
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-3 rounded-xl border border-primary/30 bg-primary/[0.06] px-3.5 py-3', className)}>
      <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
        <Star className="size-4" />
      </div>
      <div className="min-w-[12rem] flex-1">
        <div className="text-xs font-bold text-foreground">Рекомендация от автора — Velvet</div>
        <div className="text-[11px] leading-relaxed text-muted-foreground">
          Пользуюсь уже год — работает стабильно и быстро. Подписка добавляется в LAZEYKA одной ссылкой.
        </div>
      </div>
      <Button size="sm" className="text-xs" onClick={() => void openExternalUrl(VELVET_URL)}>
        <Send className="size-3.5" />
        Открыть в Telegram
      </Button>
    </div>
  )
}
