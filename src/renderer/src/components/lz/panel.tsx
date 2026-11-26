import React from 'react'
import { cn } from '@renderer/lib/utils'
import { Hint } from '@renderer/components/prematch/hint'
import { glowBackground, type LzTone } from './tone'

type DivProps = React.HTMLAttributes<HTMLDivElement> & { [k: `data-${string}`]: string | undefined }

interface PanelProps extends DivProps {
  /** Состояние подсвечивает панель сверху мягким светом. off — без света. */
  tone?: LzTone
  /** Сила света, % (по умолчанию 14). */
  glow?: number
  /** Главная панель раздела — ui-glow (свечение за курсором в стиле «стекло/неон»). */
  hero?: boolean
}

/**
 * Поверхность «Сигнала». Берёт вид карточек из «Оформления» (ui-card / ui-glow:
 * обычная, приподнятая, стекло, контур, неон, плоская) и прозрачность панелей
 * (через --card). Свет состояния — отдельный слой absolute, поэтому он виден
 * в любом стиле карточек, даже там, где фон карточки переопределён.
 */
export const LzPanel = React.forwardRef<HTMLDivElement, PanelProps>(
  ({ tone = 'off', glow = 14, hero, className, children, ...rest }, ref) => {
    const bg = glowBackground(tone, glow)
    return (
      <div
        ref={ref}
        {...rest}
        className={cn(
          hero ? 'ui-glow' : 'ui-card',
          'relative overflow-hidden border border-border bg-card',
          hero ? 'rounded-[calc(var(--radius)+10px)]' : 'rounded-2xl',
          className
        )}
      >
        {bg && <div aria-hidden className="pointer-events-none absolute inset-0 transition-opacity duration-500" style={{ background: bg }} />}
        {children}
      </div>
    )
  }
)
LzPanel.displayName = 'LzPanel'

interface SectionProps {
  title: React.ReactNode
  hint?: string
  /** Короткое пояснение под заголовком (необязательно). */
  sub?: React.ReactNode
  /** Справа: статус проверки, кнопки. */
  right?: React.ReactNode
  className?: string
}

/** Заголовок секции: название обычным регистром + «i» + действия справа. Без надписей капсом. */
export const LzSectionHead: React.FC<SectionProps> = ({ title, hint, sub, right, className }) => (
  <div className={cn('flex min-h-8 items-center justify-between gap-3', className)}>
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 text-[14px] font-bold text-[color:var(--text-title)]">
        {title}
        {hint && <Hint text={hint} />}
      </div>
      {sub && <div className="truncate text-[11.5px] text-muted-foreground">{sub}</div>}
    </div>
    {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
  </div>
)

export default LzPanel
