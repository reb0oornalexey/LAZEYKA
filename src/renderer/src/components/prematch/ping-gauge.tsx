import React, { useEffect, useState } from 'react'
import { cn } from '@renderer/lib/utils'
import { LiveNumber } from '@renderer/components/lz'
import '@renderer/components/lz/lz.css'

/*
 * Прибор «Перед каткой»: стрелочная шкала пинга 0–200 мс. Горит дуга до текущего
 * значения, цвет — качество связи (до 60 мс — цвет темы, до 120 — жёлтый, дальше —
 * красный), три зоны отмечены делениями. Проверка идёт — по шкале бежит пунктир.
 * Значения нет — матовая шкала и прочерк. Только отображение.
 */

const MAX = 200
const SWEEP = 240
const START = -SWEEP / 2
const TICKS = 25

type Mode = 'value' | 'busy' | 'idle'

interface Props {
  ms: number | null
  mode: Mode
  /** Подпись под числом: «сейчас», «средний». */
  caption: string
  /** Потеря пакета на последнем замере. */
  lost?: boolean
  size?: number
}

function pt(c: number, r: number, deg: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180
  return [c + r * Math.cos(a), c + r * Math.sin(a)]
}

function arc(c: number, r: number, from: number, to: number): string {
  const [x0, y0] = pt(c, r, from)
  const [x1, y1] = pt(c, r, to)
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`
}

export const PingGauge: React.FC<Props> = ({ ms, mode, caption, lost, size = 136 }) => {
  const [drawn, setDrawn] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setDrawn(true))
    return () => cancelAnimationFrame(id)
  }, [])

  const c = size / 2
  const r = c - 12
  const v = ms == null ? 0 : Math.min(MAX, Math.max(0, ms))
  const frac = drawn && mode === 'value' && ms != null ? Math.max(0.03, v / MAX) : 0
  const color = lost ? 'var(--st-err)' : v < 60 ? 'var(--primary)' : v < 120 ? 'var(--st-warn)' : 'var(--st-err)'
  const full = arc(c, r, START, START + SWEEP)
  const len = (Math.PI * r * SWEEP) / 180

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      {mode === 'value' && ms != null && v < 60 && !lost && (
        <div
          aria-hidden
          className="lz-breathe pointer-events-none absolute inset-[16%] rounded-full"
          style={{ background: 'radial-gradient(circle, color-mix(in oklab, var(--primary) 26%, transparent), transparent 70%)' }}
        />
      )}
      <svg aria-hidden className="absolute inset-0 overflow-visible" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {Array.from({ length: TICKS }, (_, i) => {
          const deg = START + (SWEEP / (TICKS - 1)) * i
          const at = (i / (TICKS - 1)) * MAX
          const major = i % 6 === 0
          const [x0, y0] = pt(c, r + 6, deg)
          const [x1, y1] = pt(c, r + (major ? 11 : 9), deg)
          const lit = mode === 'value' && ms != null && at <= v
          return (
            <line
              key={i}
              x1={x0}
              y1={y0}
              x2={x1}
              y2={y1}
              stroke={lit ? color : 'var(--foreground)'}
              strokeOpacity={lit ? 0.8 : major ? 0.25 : 0.12}
              strokeWidth={major ? 1.6 : 1}
              strokeLinecap="round"
              className="lz-arc"
            />
          )
        })}
        <path d={full} fill="none" stroke="var(--foreground)" strokeOpacity={0.1} strokeWidth={8} strokeLinecap="round" />
        {mode === 'busy' ? (
          <path d={full} fill="none" stroke="var(--primary)" strokeWidth={4} strokeLinecap="round" className="lz-arc lz-arc-busy" />
        ) : (
          <path
            d={full}
            fill="none"
            stroke={color}
            strokeWidth={8}
            strokeLinecap="round"
            className="lz-arc"
            style={{
              strokeDasharray: len,
              strokeDashoffset: len * (1 - frac),
              opacity: frac > 0 ? 1 : 0,
              filter: `drop-shadow(0 0 5px color-mix(in oklab, ${color} 50%, transparent))`
            }}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center pt-1 text-center">
        <span
          className={cn(
            'text-[34px] leading-none font-extrabold tabular-nums',
            mode === 'value' && ms != null ? 'text-[color:var(--text-title)]' : 'text-muted-foreground/60'
          )}
        >
          {mode === 'value' && ms != null ? <LiveNumber value={ms} /> : lost ? '×' : '—'}
        </span>
        <span className="mt-1 text-[11px] text-muted-foreground">{lost && mode === 'value' && ms == null ? 'потеря' : caption}</span>
      </div>
    </div>
  )
}

export default PingGauge
