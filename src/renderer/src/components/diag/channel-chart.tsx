import React from 'react'
import type { ChannelStat, WifiBand } from '@renderer/utils/diag-api'

const BAND_TITLE: Record<WifiBand, string> = { '2.4': '2,4 ГГц', '5': '5 ГГц', '6': '6 ГГц' }

/** Столбики загруженности каналов одного диапазона; ваш канал выделен. */
const BandChart: React.FC<{ band: WifiBand; stats: ChannelStat[] }> = ({ band, stats }) => {
  const max = Math.max(1, ...stats.map((s) => s.count))
  const slot = band === '2.4' ? 30 : 34
  const W = Math.max(300, stats.length * slot + 20)
  const H = 110
  const base = 90
  const barH = 60
  return (
    <div className="overflow-x-auto">
      <div className="mb-1 text-[11px] font-medium text-muted-foreground">{BAND_TITLE[band]}</div>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Загруженность каналов ${BAND_TITLE[band]}`}>
        <line x1="6" x2={W - 6} y1={base} y2={base} className="stroke-border" />
        {stats.map((s, i) => {
          const x = 10 + i * slot
          const h = (s.count / max) * barH
          return (
            <g key={s.channel}>
              <rect x={x} y={base - h} width={slot - 8} height={Math.max(h, s.count ? 2 : 0)} rx="2" className={s.own ? 'fill-primary' : 'fill-muted-foreground/50'} />
              {s.count > 0 && (
                <text x={x + (slot - 8) / 2} y={base - h - 4} textAnchor="middle" className="fill-foreground text-[10px]">
                  {s.count}
                </text>
              )}
              <text x={x + (slot - 8) / 2} y={base + 13} textAnchor="middle" className={s.own ? 'fill-primary text-[10px] font-bold' : 'fill-muted-foreground text-[10px]'}>
                {s.channel}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

export const ChannelChart: React.FC<{ stats: ChannelStat[] }> = ({ stats }) => {
  const bands = (['2.4', '5', '6'] as WifiBand[]).filter((b) => stats.some((s) => s.band === b && (b === '2.4' || s.count > 0)))
  return (
    <div className="space-y-2">
      <div className="grid gap-3 sm:grid-cols-2">
        {bands.map((b) => (
          <BandChart key={b} band={b} stats={stats.filter((s) => s.band === b)} />
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">Число над столбиком — сколько сетей на канале. Ваш канал выделен цветом.</p>
    </div>
  )
}
