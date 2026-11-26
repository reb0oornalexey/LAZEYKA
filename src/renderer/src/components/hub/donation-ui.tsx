import React from 'react'
import { Crown, Flame, Gem, Heart, Star, Zap, type LucideIcon } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { isTopLevel, levelHex, levelRange, money, type DonBadge, type DonLevel, type DonStyle } from '@renderer/utils/hub-donations-api'

/** Значки у ника (стиль от автора). */
export const BADGE_ICON: Record<DonBadge, LucideIcon> = {
  crown: Crown,
  star: Star,
  fire: Flame,
  diamond: Gem,
  heart: Heart,
  bolt: Zap
}

/**
 * Общие части сбора пожертвований: полоса прогресса, ник в цвете уровня и подпись уровней.
 * Цвет ника смешивается с цветом текста темы, поэтому читается и в тёмной, и в светлой теме.
 */

/** Стиль ника в цвете уровня; у самого высокого уровня — лёгкое свечение. */
export function chipStyle(hex: string, glow: boolean): React.CSSProperties {
  return {
    color: `color-mix(in oklab, ${hex} 70%, var(--foreground))`,
    backgroundColor: `color-mix(in oklab, ${hex} 15%, transparent)`,
    borderColor: `color-mix(in oklab, ${hex} 45%, transparent)`,
    boxShadow: glow ? `0 0 14px -3px color-mix(in oklab, ${hex} 70%, transparent), inset 0 0 8px -4px ${hex}` : undefined
  }
}

const MUTED: React.CSSProperties = { color: 'var(--muted-foreground)', borderColor: 'var(--border)', backgroundColor: 'transparent' }

export const DonorChip: React.FC<{
  nick: string
  levels: DonLevel[]
  level: number
  amount?: string
  size?: 'sm' | 'md'
  title?: string
  /** Свечение вручную (иначе — у самого высокого уровня). */
  glow?: boolean
  /** Личный стиль ника от автора: цвет, эмодзи, значок, свечение — поверх цвета уровня. */
  st?: DonStyle
  className?: string
}> = ({ nick, levels, level, amount, size = 'md', title, glow, st, className }) => {
  const l = levels[level]
  const top = glow ?? (st?.glow || isTopLevel(levels, level))
  const hex = st?.color ? levelHex(st.color) : l ? levelHex(l.color) : null
  const style = hex ? chipStyle(hex, top) : MUTED
  const Badge = st?.badge ? BADGE_ICON[st.badge] : null
  return (
    <span
      title={title ?? (l ? `${nick} · ${l.name}` : nick)}
      style={style}
      className={cn(
        'inline-flex max-w-full items-center gap-1 truncate rounded-full border font-semibold',
        size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs',
        className
      )}
    >
      {Badge ? (
        <Badge aria-hidden className={cn('shrink-0', size === 'sm' ? 'size-3' : 'size-3.5', st?.badge === 'heart' || st?.badge === 'star' ? 'fill-current' : '')} />
      ) : (
        top && <span aria-hidden className="text-[10px]">★</span>
      )}
      {st?.emoji && (
        <span aria-hidden className="shrink-0 leading-none">
          {st.emoji}
        </span>
      )}
      <span className="truncate">{nick}</span>
      {amount && <span className="font-mono text-[10.5px] font-medium opacity-75">{amount}</span>}
    </span>
  )
}

/**
 * Полоса «собрано из цели». variant='accent' — заливка градиентом акцента программы;
 * variant='levels' — полоса из отрезков в цветах уровней (сколько дал каждый уровень).
 */
export const DonProgress: React.FC<{
  raised: number
  goal: number
  levels?: DonLevel[]
  byLevel?: number[]
  below?: number
  variant?: 'accent' | 'levels'
  size?: 'md' | 'lg'
  className?: string
}> = ({ raised, goal, levels = [], byLevel = [], below = 0, variant = 'accent', size = 'md', className }) => {
  const pct = goal > 0 ? Math.min(100, (raised / goal) * 100) : 0
  const scale = goal > 0 ? Math.min(1, goal / Math.max(raised, goal)) : 0
  const segs: { w: number; color: string; key: string }[] = []
  if (variant === 'levels' && goal > 0) {
    if (below > 0) segs.push({ key: 'below', w: (below / goal) * 100 * scale, color: 'color-mix(in oklab, var(--muted-foreground) 55%, transparent)' })
    byLevel.forEach((v, i) => {
      if (v > 0) segs.push({ key: String(i), w: (v / goal) * 100 * scale, color: levelHex(levels[i]?.color) })
    })
  }
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      className={cn('relative w-full overflow-hidden rounded-full bg-foreground/[0.07] ring-1 ring-inset ring-border/60', size === 'lg' ? 'h-4' : 'h-2.5', className)}
    >
      {variant === 'levels' ? (
        <div className="flex h-full" style={{ width: `${pct}%` }}>
          {segs.map((s) => (
            <div key={s.key} className="h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${(s.w / Math.max(pct, 0.0001)) * 100}%`, background: s.color }} />
          ))}
        </div>
      ) : (
        <div
          className="h-full rounded-full bg-gradient-to-r from-primary/70 via-primary to-primary transition-[width] duration-700 ease-out"
          style={{ width: `${pct}%`, boxShadow: '0 0 12px -2px color-mix(in oklab, var(--primary) 60%, transparent)' }}
        />
      )}
      {/* лёгкий блик сверху полосы */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-1/2 rounded-t-full bg-white/10" />
    </div>
  )
}

/** Подпись уровней: цветная точка, название, диапазон. */
export const LevelLegend: React.FC<{ levels: DonLevel[]; cur?: string; className?: string }> = ({ levels, cur = '₽', className }) => (
  <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-muted-foreground', className)}>
    {levels.map((l, i) => (
      <span key={i} className="inline-flex items-center gap-1.5">
        <span className="size-2 rounded-full" style={{ background: levelHex(l.color), boxShadow: isTopLevel(levels, i) ? `0 0 6px ${levelHex(l.color)}` : undefined }} />
        <span className="font-medium text-foreground/80">{l.name}</span>
        <span className="font-mono">
          {levelRange(levels, i)} {cur}
        </span>
      </span>
    ))}
  </div>
)

export { money }
