import React, { useEffect, useState } from 'react'
import { Power } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { TONE_VAR, type LzTone } from '@renderer/components/lz'

const TICKS = 40
/** Шкала — не полный круг: снизу разрыв, как у стрелочного прибора. */
const SWEEP = 280
const START = -SWEEP / 2

interface Props {
  tone: LzTone
  /**
   * Доля сайтов, открывшихся на последней проверке выбранной стратегии (0…1).
   * null — стратегию ещё не проверяли: у работающего Zapret шкала горит целиком.
   */
  level: number | null
  label: string
  onPress: () => void
  disabled?: boolean
  size?: number
}

function arcPath(c: number, r: number): string {
  const pt = (deg: number): string => {
    const a = ((deg - 90) * Math.PI) / 180
    return `${(c + r * Math.cos(a)).toFixed(2)} ${(c + r * Math.sin(a)).toFixed(2)}`
  }
  return `M ${pt(START)} A ${r} ${r} 0 1 1 ${pt(START + SWEEP)}`
}

/**
 * Прибор Zapret: шкала вокруг клавиши питания. Деления шкалы — это баллы
 * последней проверки выбранной стратегии: открылось 8 из 10 сайтов — горит
 * 8/10 шкалы. Выключено — матовая шкала (без света, это выбор человека).
 * Запуск или самопроверка — по шкале бежит пунктир. Ошибка — красная шкала.
 */
export const ZapretDial: React.FC<Props> = ({ tone, level, label, onPress, disabled, size = 128 }) => {
  const [drawn, setDrawn] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setDrawn(true))
    return () => cancelAnimationFrame(id)
  }, [])

  const on = tone === 'on'
  const busy = tone === 'busy'
  const err = tone === 'error'
  const lit = on ? Math.round((level ?? 1) * TICKS) : err ? TICKS : 0
  const c = size / 2
  const rOut = c - 4
  const rIn = c - 13
  const key = Math.round(size * 0.56)
  const color = TONE_VAR[tone]

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      {on && (
        <div
          aria-hidden
          className="lz-breathe pointer-events-none absolute inset-[14%] rounded-full"
          style={{ background: 'radial-gradient(circle, color-mix(in oklab, var(--primary) 34%, transparent), transparent 70%)' }}
        />
      )}
      <svg aria-hidden className="absolute inset-0 overflow-visible" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {Array.from({ length: TICKS }, (_, i) => {
          const deg = START + (SWEEP / (TICKS - 1)) * i
          const a = ((deg - 90) * Math.PI) / 180
          // Крупное деление — граница «сайта»: 40 делений на 10 проверяемых сайтов.
          const major = i % 4 === 0
          const r0 = major ? rIn - 2 : rIn
          const isLit = drawn && i < lit
          return (
            <line
              key={i}
              x1={c + r0 * Math.cos(a)}
              y1={c + r0 * Math.sin(a)}
              x2={c + rOut * Math.cos(a)}
              y2={c + rOut * Math.sin(a)}
              strokeLinecap="round"
              strokeWidth={major ? 2.4 : 1.6}
              className="transition-[stroke,stroke-opacity] duration-500"
              style={{
                stroke: isLit ? color : 'var(--foreground)',
                strokeOpacity: isLit ? (err ? 0.55 : 1) : 0.14,
                transitionDelay: isLit ? `${i * 14}ms` : '0ms'
              }}
            />
          )
        })}
        {busy && (
          <path
            d={arcPath(c, (rIn + rOut) / 2)}
            fill="none"
            stroke="var(--primary)"
            strokeWidth={rOut - rIn}
            strokeLinecap="butt"
            pathLength={100}
            className="lz-arc-busy"
            style={{ strokeOpacity: 0.85 }}
          />
        )}
      </svg>

      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-busy={busy}
        aria-label={label}
        title={label}
        disabled={disabled}
        onClick={onPress}
        data-tour="zapret-power"
        className={cn(
          'absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full outline-none ring-2 ring-inset transition-[background-color,color,box-shadow,transform] duration-300',
          'focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary/60 active:scale-[0.97] disabled:cursor-not-allowed',
          on
            ? 'bg-primary text-primary-foreground ring-transparent'
            : busy
              ? 'bg-primary/10 text-primary ring-primary/50'
              : err
                ? 'bg-st-err/10 text-st-err-text ring-st-err/55 hover:bg-st-err/15'
                : 'bg-foreground/[0.05] text-muted-foreground ring-foreground/15 hover:bg-primary/10 hover:text-primary hover:ring-primary/60'
        )}
        style={{
          width: key,
          height: key,
          boxShadow: on
            ? '0 0 0 6px color-mix(in oklab, var(--primary) 16%, transparent), 0 10px 34px color-mix(in oklab, var(--primary) 45%, transparent)'
            : undefined
        }}
      >
        <Power className={cn(busy && 'animate-pulse')} style={{ width: key * 0.36, height: key * 0.36 }} strokeWidth={2.3} />
      </button>
    </div>
  )
}

export default ZapretDial
