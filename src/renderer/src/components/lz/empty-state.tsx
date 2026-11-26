import React from 'react'
import { cn } from '@renderer/lib/utils'

interface Props {
  icon: React.ReactNode
  title: string
  text?: string
  /** Одно действие, которое убирает пустоту (кнопка). */
  action?: React.ReactNode
  compact?: boolean
  className?: string
}

/**
 * Пустое состояние — приглашение к действию, а не грусть: значок в пунктирном
 * круге, что здесь будет, и одна кнопка, которая это делает.
 */
export const EmptyState: React.FC<Props> = ({ icon, title, text, action, compact, className }) => (
  <div className={cn('flex flex-col items-center text-center', compact ? 'gap-1.5 py-4' : 'gap-2 py-8', className)}>
    <div
      className={cn(
        'flex items-center justify-center rounded-full border border-dashed border-foreground/20 text-muted-foreground',
        compact ? 'size-10 [&_svg]:size-4' : 'size-14 [&_svg]:size-5'
      )}
    >
      {icon}
    </div>
    <div className="text-[13.5px] font-semibold text-foreground">{title}</div>
    {text && <div className="max-w-[46ch] text-[12px] leading-snug text-muted-foreground">{text}</div>}
    {action && <div className="mt-1.5">{action}</div>}
  </div>
)

export default EmptyState
