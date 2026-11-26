import React, { useMemo } from 'react'

export interface ChartData {
  avg: (number | null)[]
  max: (number | null)[]
  lost: number[]
}

/** Сжать серию замеров до maxPoints точек: среднее, максимум и число потерь в каждой. */
export function bucketize(samples: (number | null)[], maxPoints = 300): ChartData {
  const size = Math.max(1, Math.ceil(samples.length / maxPoints))
  const out: ChartData = { avg: [], max: [], lost: [] }
  for (let i = 0; i < samples.length; i += size) {
    const part = samples.slice(i, i + size)
    const ok = part.filter((v): v is number => v != null)
    out.avg.push(ok.length ? Math.round(ok.reduce((a, b) => a + b, 0) / ok.length) : null)
    out.max.push(ok.length ? Math.max(...ok) : null)
    out.lost.push(part.length - ok.length)
  }
  return out
}

const W = 600
const H = 150
const PAD = { l: 38, r: 8, t: 8, b: 14 }

/** Шкала по оси Y: «круглый» максимум и три линии сетки. */
export function niceScale(maxVal: number): { top: number; ticks: number[] } {
  const raw = Math.max(40, maxVal * 1.1)
  const step = raw <= 80 ? 20 : raw <= 200 ? 50 : raw <= 500 ? 100 : 250
  const top = Math.ceil(raw / step) * step
  const ticks: number[] = []
  for (let v = 0; v <= top; v += step) ticks.push(v)
  return { top, ticks }
}

/**
 * График пинга на SVG, без библиотек. Линия — среднее, тонкая линия выше —
 * максимум в точке, красные полоски — потерянные пакеты, пунктир — обычный пинг.
 */
export const PingChart: React.FC<{ data: ChartData; baselineMs?: number | null; className?: string }> = ({ data, baselineMs, className }) => {
  const g = useMemo(() => {
    const n = data.avg.length
    const maxVal = Math.max(0, ...data.max.map((v) => v ?? 0), baselineMs ?? 0)
    const { top, ticks } = niceScale(maxVal)
    const iw = W - PAD.l - PAD.r
    const ih = H - PAD.t - PAD.b
    const x = (i: number): number => PAD.l + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw)
    const y = (v: number): number => PAD.t + ih - (Math.min(v, top) / top) * ih
    const poly = (arr: (number | null)[]): string => {
      let d = ''
      let pen = false
      arr.forEach((v, i) => {
        if (v == null) {
          pen = false
          return
        }
        d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`
        pen = true
      })
      return d
    }
    const barW = Math.max(1.5, Math.min(6, iw / Math.max(n, 1)))
    const lostBars = data.lost.map((c, i) => (c > 0 ? { x: x(i) - barW / 2, w: barW } : null)).filter((b): b is { x: number; w: number } => b !== null)
    return { top, ticks, avgPath: poly(data.avg), maxPath: poly(data.max), lostBars, y, ih }
  }, [data, baselineMs])

  if (data.avg.length === 0) {
    return <div className={className}><div className="flex h-[150px] items-center justify-center text-xs text-muted-foreground">Ждём первые замеры…</div></div>
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={className} role="img" aria-label="График пинга">
      {g.ticks.map((t) => (
        <g key={t}>
          <line x1={PAD.l} x2={W - PAD.r} y1={g.y(t)} y2={g.y(t)} className="stroke-border" strokeWidth={1} />
          <text x={PAD.l - 4} y={g.y(t) + 3} textAnchor="end" className="fill-muted-foreground" fontSize={9}>
            {t}
          </text>
        </g>
      ))}
      {g.lostBars.map((b, i) => (
        <rect key={i} x={b.x} y={PAD.t} width={b.w} height={g.ih} className="fill-st-err" opacity={0.35} />
      ))}
      {baselineMs != null && (
        <line x1={PAD.l} x2={W - PAD.r} y1={g.y(baselineMs)} y2={g.y(baselineMs)} className="stroke-muted-foreground" strokeWidth={1} strokeDasharray="4 3" />
      )}
      <path d={g.maxPath} fill="none" className="stroke-primary" strokeOpacity={0.3} strokeWidth={1} />
      <path d={g.avgPath} fill="none" className="stroke-primary" strokeWidth={1.6} strokeLinejoin="round" />
      <text x={PAD.l} y={H - 2} className="fill-muted-foreground" fontSize={9}>
        мс
      </text>
    </svg>
  )
}
