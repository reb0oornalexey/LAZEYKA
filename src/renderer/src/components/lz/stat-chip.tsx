import React from 'react'
import { cn } from '@renderer/lib/utils'
import { TONE_FILL, type LzTone } from './tone'

interface Props {
  label: string
  value: React.ReactNode
  /** Значок слева (одноцветный lucide или фирменный бренда раздела). */
  icon?: React.ReactNode
  /** Точка состояния перед подписью. */
  tone?: LzTone
  /** Дополнение справа от значения (например, пинг или мини-график). */
  aside?: React.ReactNode
  title?: string
  onClick?: () => void
  /** data-sensitive для режима стримера (node, ip…). */
  sensitive?: string
  className?: string
}

/**
 * Чип показателя: маленькая подпись сверху, значение крупнее под ней.
 * Сидит внутри панели, поэтому сам почти прозрачный — не спорит с карточкой
 * в стеклянном и контурном стилях.
 */
export const StatChip: React.FC<Props> = ({ label, value, icon, tone, aside, title, onClick, sensitive, className }) => {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      title={title}
      className={cn(
        'flex min-w-0 items-center gap-2.5 rounded-xl border border-foreground/[0.08] bg-foreground/[0.035] px-3 py-2 text-left',
        onClick && 'cursor-pointer transition-colors hover:border-primary/40 hover:bg-foreground/[0.06]',
        className
      )}
    >
      {icon && <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-4">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[11px] leading-tight text-muted-foreground">
          {tone && <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', TONE_FILL[tone])} />}
          <span className="truncate">{label}</span>
        </span>
        <span data-sensitive={sensitive} className="block break-words text-[13.5px] font-semibold leading-snug text-foreground">
          {value}
        </span>
      </span>
      {aside}
    </Tag>
  )
}

export default StatChip
