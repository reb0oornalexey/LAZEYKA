import React, { useEffect, useState } from 'react'
import { Power } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { TONE_VAR, type LzTone } from '@renderer/components/lz'
import { pingBars } from './signal'

const TICKS = 44
/** Шкала — не полный круг: снизу разрыв, как у стрелочного прибора. */
const SWEEP = 280
const START = -SWEEP / 2

interface Props {
  tone: LzTone
  /** Пинг до узла — сколько делений шкалы горит, пока VPN подключён. */
  pingMs: number | null
  /** Кнопка — главное действие раздела: подключить или отключить. */
  label: string
  onPress: () => void
  disabled?: boolean
  size?: number
}

/** Дуга шкалы (без нижнего разрыва) — по ней бежит пунктир «подключение…». */
function arcPath(c: number, r: number): string {
  const pt = (deg: number): string => {
    const a = ((deg - 90) * Math.PI) / 180
    return `${(c + r * Math.cos(a)).toFixed(2)} ${(c + r * Math.sin(a)).toFixed(2)}`
  }
  return `M ${pt(START)} A ${r} ${r} 0 1 1 ${pt(START + SWEEP)}`
}

/**
 * Прибор подключения INCY: шкала-циферблат вокруг крупной клавиши питания.
 * Выключено — шкала матовая. Подключение — по шкале бежит пунктир. Подключено —
 * шкала горит цветом темы, и горящих делений столько, сколько позволяет пинг
 * (сила сигнала). Ошибка — красная кромка. Текста внутри нет: состояние
 * словами стоит рядом крупным заголовком.
 */
export const ConnectDial: React.FC<Props> = ({ tone, pingMs, label, onPress, disabled, size = 148 }) => {
  const [drawn, setDrawn] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setDrawn(true))
    return () => cancelAnimationFrame(id)
  }, [])

  const on = tone === 'on'
  const busy = tone === 'busy'
  const err = tone === 'error'
  // Пинг ещё не замерен — шкала горит целиком: подключение есть, а сила неизвестна.
  const lit = on ? (pingMs == null ? TICKS : Math.round((pingBars(pingMs) / 5) * TICKS)) : err ? TICKS : 0
  const c = size / 2
  const rOut = c - 4
  const rIn = c - 14
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
          const major = i % 5 === 0
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
        className={cn(
          'absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full outline-none ring-2 ring-inset transition-[background-color,color,box-shadow,transform] duration-300',
          'focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary/60 active:scale-[0.97] disabled:cursor-wait',
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

export default ConnectDial
