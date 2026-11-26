import React from 'react'
import { cn } from '@renderer/lib/utils'

/**
 * Баллы проверки стратегии делениями: одно деление — один проверенный сайт.
 * Все открылись — деления цвета темы, часть — жёлтые, ни одного — одно красное.
 * Без результата — пунктирная пустая шкала («не проверялась»).
 */
export const ScoreCells: React.FC<{
  ok: number | null
  total: number | null
  /** Стратегия не работает сейчас — деления приглушены. */
  dim?: boolean
  size?: 'sm' | 'md'
  className?: string
  title?: string
}> = ({ ok, total, dim, size = 'sm', className, title }) => {
  const has = ok !== null && total !== null && total > 0
  const cells = has ? total! : 10
  const all = has && ok === total
  const none = has && ok === 0
  return (
    <span
      title={title ?? (has ? `Открылось ${ok} из ${total} сайтов` : 'Ещё не проверялась')}
      className={cn('flex items-center', size === 'md' ? 'gap-[3px]' : 'gap-[2px]', className)}
    >
      {Array.from({ length: cells }, (_, i) => {
        const filled = has && (none ? i === 0 : i < ok!)
        return (
          <span
            key={i}
            className={cn(
              'rounded-full transition-colors duration-500',
              size === 'md' ? 'h-2 flex-1' : 'h-[5px] w-[5px]',
              !has
                ? 'border border-dashed border-foreground/20'
                : filled
                  ? none
                    ? 'bg-st-err'
                    : all
                      ? 'bg-primary'
                      : 'bg-st-warn'
                  : 'bg-foreground/10',
              filled && dim && 'opacity-55'
            )}
            style={{ transitionDelay: `${i * 30}ms` }}
          />
        )
      })}
    </span>
  )
}

export default ScoreCells
