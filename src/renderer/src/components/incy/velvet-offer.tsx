import React, { useState } from 'react'
import { Send, Star, X } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { LzPanel } from '@renderer/components/lz'
import { VELVET_URL } from '@renderer/components/velvet-recommendation'
import { openExternalUrl } from '@renderer/utils/ipc'
import { cn } from '@renderer/lib/utils'

/** Тот же ключ, что у строки-подсказки в velvet-recommendation: скрыли там — скрыто и здесь. */
// В 2.0 ключ новый: подсказку из 1.x могли закрыть раньше, а новую карточку должны увидеть все хотя бы раз.
const DISMISS_KEY = 'lazeyka.velvetOffer2Dismissed'

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * Рекомендация автора (Velvet) в разделе INCY — подача языка «Сигнал».
 *
 * Свой акцент — голубой (`st-info`), а не цвет темы: так карточка отличается
 * от служебных панелей и не спорит с кнопкой подключения, но не кричит.
 * Тексты те же, что в velvet-recommendation.tsx, меняется только вид.
 *
 * - `full` — когда подписки нет: карточка-предложение рядом с «Добавить подписку».
 *   Не закрывается: это ответ на вопрос «где взять VPN».
 * - `slim` — когда подписка есть: одна строка-карточка, можно скрыть крестиком
 *   (как прежнюю подсказку, тем же ключом).
 */
export const VelvetOffer: React.FC<{ variant: 'full' | 'slim'; className?: string }> = ({ variant, className }) => {
  // Широкая полка (вкладка «Сервера»): текст слева, кнопка справа; узкая плитка — столбиком.

  const [dismissed, setDismissed] = useState(readDismissed)
  if (variant === 'slim' && dismissed) return null

  const open = (): void => void openExternalUrl(VELVET_URL)
  const badge = (
    <span
      aria-hidden
      className={cn(
        'relative flex shrink-0 items-center justify-center rounded-xl bg-st-info/12 text-st-info-text',
        variant === 'full' ? 'size-10' : 'size-8'
      )}
    >
      <Star className={variant === 'full' ? 'size-[18px]' : 'size-4'} />
    </span>
  )

  if (variant === 'full') {
    return (
      <LzPanel data-tour="incy-velvet" className={cn('@container flex flex-col gap-3 border-st-info/30 p-4', className)}>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ background: 'radial-gradient(110% 80% at 100% 0%, color-mix(in oklab, var(--st-info) 13%, transparent), transparent 70%)' }}
        />
        <div className="flex flex-1 flex-col gap-3 @[640px]:flex-row @[640px]:items-center">
        <div className="flex flex-1 items-start gap-3">
          {badge}
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-bold text-[color:var(--text-title)]">Рекомендация от автора — Velvet</div>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
              Пользуюсь уже год — работает стабильно и быстро. Подписка добавляется в LAZEYKA одной ссылкой.
            </p>
          </div>
        </div>
        <Button size="sm" variant="outline" className="h-9 shrink-0 gap-1.5 self-start rounded-xl border-st-info/40 text-xs hover:bg-st-info/10 @[640px]:self-center" onClick={open}>
          <Send className="size-3.5 text-st-info-text" />
          Открыть в Telegram
        </Button>
        </div>
      </LzPanel>
    )
  }

  return (
    <LzPanel data-tour="incy-velvet" className={cn('flex items-center gap-3 px-3 py-2.5', className)}>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 w-1/3"
        style={{ background: 'linear-gradient(90deg, color-mix(in oklab, var(--st-info) 10%, transparent), transparent)' }}
      />
      {badge}
      <div className="min-w-0 flex-1 text-[12.5px] leading-snug">
        <span className="text-muted-foreground">Ищете запасной VPN? Автор LAZEYKA уже год пользуется </span>
        <span className="font-semibold text-foreground">Velvet</span>
      </div>
      <Button size="sm" variant="outline" className="h-8 shrink-0 gap-1.5 rounded-xl border-st-info/40 text-xs hover:bg-st-info/10" onClick={open}>
        <Send className="size-3.5 text-st-info-text" />
        Открыть в Telegram
      </Button>
      <button
        type="button"
        title="Скрыть"
        aria-label="Скрыть рекомендацию"
        className="shrink-0 cursor-pointer rounded-lg p-1 text-muted-foreground/70 hover:bg-foreground/[0.06] hover:text-foreground"
        onClick={() => {
          try {
            localStorage.setItem(DISMISS_KEY, '1')
          } catch {
            /* noop */
          }
          setDismissed(true)
        }}
      >
        <X className="size-3.5" />
      </button>
    </LzPanel>
  )
}

export default VelvetOffer
