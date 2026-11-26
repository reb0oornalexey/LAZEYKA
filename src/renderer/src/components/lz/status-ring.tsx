import React, { useEffect, useState } from 'react'
import { cn } from '@renderer/lib/utils'
import { TONE_VAR, type LzTone } from './tone'

export interface RingSegment {
  key: string
  label: string
  tone: LzTone
  /** Значок-«бусина» на середине дуги: какая служба за этой дугой. */
  icon?: React.ReactNode
}

interface Props {
  segments: RingSegment[]
  /** Подсвеченный сегмент (например, при наведении на плитку службы). */
  active?: string | null
  /** Цвет ореола; без него ореола нет. */
  halo?: LzTone | null
  /** Ореол «дышит» (только когда что-то работает). */
  pulse?: boolean
  size?: number
  /** Расходящиеся круги «сигнала» за кольцом (статичные, тонкие). */
  waves?: boolean
  className?: string
  children?: React.ReactNode
}

const VB = 160
const C = VB / 2
const R = 60
const GAP = 18 // градусов между сегментами (с учётом скруглённых концов)
const TICKS = 72
/** Поворот: первая дуга — слева сверху, вторая — справа сверху, третья — снизу (как плитки: слева направо). */
const ROT = -120

function polar(deg: number, r = R): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180
  return [C + r * Math.cos(a), C + r * Math.sin(a)]
}

function arcPath(from: number, to: number): string {
  const [x0, y0] = polar(from)
  const [x1, y1] = polar(to)
  const large = to - from > 180 ? 1 : 0
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${R} ${R} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`
}

/**
 * Кольцо состояния: по одной дуге на службу, в том же порядке, что и плитки.
 * Горит — работает, бегущий пунктир — в процессе, красная — ошибка, только
 * дорожка — выключено. Дуги дорисовываются при открытии (одно движение на экран).
 */
export const StatusRing: React.FC<Props> = ({ segments, active, halo, pulse, size = 156, waves, className, children }) => {
  const [drawn, setDrawn] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setDrawn(true))
    return () => cancelAnimationFrame(id)
  }, [])

  const n = Math.max(1, segments.length)
  const span = 360 / n
  const len = (Math.PI * R * (span - GAP)) / 180

  return (
    <div className={cn('relative shrink-0', className)} style={{ width: size, height: size }}>
      {waves && (
        <svg aria-hidden className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 overflow-visible" width={size} height={size}>
          {[1.55, 2.25, 3.05, 3.95].map((k, i) => (
            <circle
              key={k}
              cx={size / 2}
              cy={size / 2}
              r={(size / 2) * k}
              fill="none"
              stroke={halo ? TONE_VAR[halo] : 'var(--foreground)'}
              strokeOpacity={(halo ? 0.2 : 0.07) - i * (halo ? 0.04 : 0.012)}
              strokeWidth={1}
              strokeDasharray={i % 2 ? '2 6' : undefined}
            />
          ))}
        </svg>
      )}
      {halo && (
        <div
          aria-hidden
          className={cn('pointer-events-none absolute -inset-5 rounded-full', pulse && 'lz-breathe')}
          style={{
            background: `radial-gradient(closest-side, color-mix(in oklab, ${TONE_VAR[halo]} 30%, transparent), color-mix(in oklab, ${TONE_VAR[halo]} 8%, transparent) 62%, transparent)`
          }}
        />
      )}
      <svg viewBox={`0 0 ${VB} ${VB}`} className="absolute inset-0 size-full" role="img" aria-label={segments.map((s) => `${s.label}: ${toneWord(s.tone)}`).join(', ')}>
        {/* Шкала-«циферблат» снаружи: горят деления под работающими дугами. */}
        {Array.from({ length: TICKS }, (_, t) => {
          const deg = (t / TICKS) * 360
          const rel = (((deg - ROT) % 360) + 360) % 360
          const seg = segments[Math.floor(rel / span)]
          const inArc = rel % span > GAP / 2 && rel % span < span - GAP / 2
          const lit = !!seg && inArc && seg.tone !== 'off' && seg.tone !== 'busy'
          const major = t % 6 === 0
          const [x0, y0] = polar(deg, R + 11)
          const [x1, y1] = polar(deg, R + (major ? 17 : 14))
          return (
            <line
              key={t}
              x1={x0}
              y1={y0}
              x2={x1}
              y2={y1}
              stroke={lit ? TONE_VAR[seg.tone] : 'var(--foreground)'}
              strokeOpacity={lit ? (active && active !== seg.key ? 0.3 : 0.75) : major ? 0.22 : 0.12}
              strokeWidth={major ? 1.4 : 1}
              strokeLinecap="round"
              className="lz-arc"
            />
          )
        })}
        <circle cx={C} cy={C} r={R - 13} fill="none" stroke="var(--foreground)" strokeOpacity={0.07} strokeWidth={1} />
        {segments.map((s, i) => {
          const from = ROT + i * span + GAP / 2
          const to = ROT + (i + 1) * span - GAP / 2
          const d = arcPath(from, to)
          const lit = s.tone !== 'off'
          const isActive = active === s.key
          const dimmed = !!active && !isActive
          return (
            <g key={s.key}>
              <title>{`${s.label}: ${toneWord(s.tone)}`}</title>
              <path d={d} fill="none" stroke="var(--foreground)" strokeOpacity={isActive ? 0.2 : 0.1} strokeWidth={9} strokeLinecap="round" className="lz-arc" />
              {lit && (
                <path
                  d={d}
                  fill="none"
                  stroke={TONE_VAR[s.tone]}
                  strokeWidth={s.tone === 'busy' ? 5 : isActive ? 11 : 9}
                  strokeLinecap="round"
                  className={cn('lz-arc', s.tone === 'busy' && 'lz-arc-busy')}
                  style={
                    s.tone === 'busy'
                      ? { opacity: dimmed ? 0.4 : 1 }
                      : {
                          strokeDasharray: len,
                          strokeDashoffset: drawn ? 0 : len,
                          opacity: dimmed ? 0.4 : 1,
                          transitionDelay: drawn ? `${i * 120}ms` : undefined,
                          filter: s.tone === 'on' ? `drop-shadow(0 0 5px color-mix(in oklab, ${TONE_VAR.on} 55%, transparent))` : undefined
                        }
                  }
                />
              )}
            </g>
          )
        })}
      </svg>
      {segments.map((s, i) => {
        if (!s.icon) return null
        const [x, y] = polar(ROT + (i + 0.5) * span)
        const lit = s.tone === 'on'
        return (
          <span
            key={s.key}
            aria-hidden
            className={cn(
              'lz-arc absolute flex size-[24px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 bg-[color:var(--popover)] [&_svg]:size-3',
              lit ? 'border-primary text-primary' : s.tone === 'error' ? 'border-st-err text-st-err-text' : 'border-foreground/15 text-muted-foreground opacity-80 grayscale',
              active === s.key && 'scale-110'
            )}
            style={{ left: `${(x / VB) * 100}%`, top: `${(y / VB) * 100}%`, transition: 'transform .2s ease, border-color .35s ease' }}
          >
            {s.icon}
          </span>
        )
      })}
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  )
}

function toneWord(t: LzTone): string {
  return t === 'on' ? 'работает' : t === 'busy' ? 'запускается' : t === 'error' ? 'ошибка' : t === 'warn' ? 'нужно внимание' : 'выключен'
}

export default StatusRing
