import React, { useId, useState } from 'react'
import { cn } from '@renderer/lib/utils'

interface Props {
  /** Основной ряд (рисуется с заливкой). */
  a: number[]
  /** Второй ряд (тонкая линия), необязательный. */
  b?: number[]
  colorA?: string
  colorB?: string
  /** Нижняя граница шкалы, чтобы шум не выглядел горами. */
  floor?: number
  className?: string
  /** Наведение: индекс точки или null — для подписи значений рядом. */
  onHover?: (index: number | null) => void
}

const W = 200
const H = 40

function line(vals: number[], max: number): string {
  const n = vals.length
  if (n < 2) return ''
  return vals
    .map((v, i) => {
      const x = (i / (n - 1)) * W
      const y = H - 2 - (Math.max(0, v) / max) * (H - 6)
      return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`
    })
    .join(' ')
}

/**
 * Мини-график без библиотек: SVG на всю ширину контейнера, без анимации
 * перерисовки. Цвета — токены темы. При наведении показывает вертикальную
 * метку и сообщает индекс точки.
 */
export const Sparkline: React.FC<Props> = ({
  a,
  b,
  colorA = 'var(--primary)',
  colorB = 'var(--st-info)',
  floor = 64,
  className,
  onHover
}) => {
  const gid = useId().replace(/:/g, '')
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(floor, ...a, ...(b ?? []))
  const pa = line(a, max)
  const pb = b ? line(b, max) : ''
  const n = a.length
  const set = (i: number | null): void => {
    setHover(i)
    onHover?.(i)
  }
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className={cn('block h-full w-full overflow-visible', className)}
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        const i = Math.round(((e.clientX - r.left) / Math.max(1, r.width)) * (n - 1))
        set(Math.min(n - 1, Math.max(0, i)))
      }}
      onMouseLeave={() => set(null)}
    >
      <defs>
        <linearGradient id={`lzsp${gid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={colorA} stopOpacity={0.32} />
          <stop offset="100%" stopColor={colorA} stopOpacity={0} />
        </linearGradient>
      </defs>
      {pa && <path d={`${pa} L${W} ${H} L0 ${H} Z`} fill={`url(#lzsp${gid})`} />}
      {pb && <path d={pb} fill="none" stroke={colorB} strokeWidth={1.4} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />}
      {pa && <path d={pa} fill="none" stroke={colorA} strokeWidth={1.8} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />}
      {hover !== null && n > 1 && (
        <line
          x1={(hover / (n - 1)) * W}
          x2={(hover / (n - 1)) * W}
          y1={0}
          y2={H}
          stroke="var(--foreground)"
          strokeOpacity={0.35}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  )
}

export default Sparkline
