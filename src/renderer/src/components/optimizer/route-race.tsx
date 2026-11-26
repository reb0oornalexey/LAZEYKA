import React from 'react'
import { cn } from '@renderer/lib/utils'
import { LiveNumber } from '@renderer/components/lz'
import '@renderer/components/lz/lz.css'

/*
 * Прибор оптимизатора: «гонка путей». Крупно — пинг лучшего пути до сервера,
 * под ним две дорожки: через лучший узел и напрямую. Длина дорожки — пинг
 * (короче — быстрее), поэтому разница видна без чтения цифр. Во время замера
 * крупно — сколько путей проверено, по дорожкам бежит пунктир. До замера —
 * пустые матовые дорожки. Только отображение.
 */

interface Props {
  /** Пинг через лучший узел (null — ни один узел не быстрее или не замеряли). */
  bestMs: number | null
  directMs: number | null
  measuring: boolean
  progress?: { done: number; total: number } | null
  className?: string
}

const Track: React.FC<{ label: string; ms: number | null; max: number; lit: boolean; busy: boolean }> = ({ label, ms, max, lit, busy }) => {
  const pct = ms == null || max <= 0 ? 0 : Math.max(8, Math.min(100, (ms / max) * 100))
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-[11px] leading-none">
        <span className="text-muted-foreground">{label}</span>
        <span className={cn('font-semibold tabular-nums', lit ? 'text-primary' : 'text-foreground/80')}>{ms == null ? '—' : `${ms} мс`}</span>
      </div>
      <div className="relative h-1.5 overflow-hidden rounded-full bg-foreground/10">
        {busy ? (
          <span aria-hidden className="lz-rail-flow absolute inset-0 text-primary/55" />
        ) : (
          <span
            aria-hidden
            className={cn('absolute inset-y-0 left-0 rounded-full transition-[width] duration-700', lit ? 'bg-primary' : 'bg-foreground/35')}
            style={{ width: `${pct}%`, boxShadow: lit ? '0 0 8px color-mix(in oklab, var(--primary) 55%, transparent)' : undefined }}
          />
        )}
      </div>
    </div>
  )
}

export const RouteRace: React.FC<Props> = ({ bestMs, directMs, measuring, progress, className }) => {
  const max = Math.max(bestMs ?? 0, directMs ?? 0)
  const headline = measuring ? null : bestMs ?? directMs
  const bestWins = bestMs != null && (directMs == null || bestMs < directMs)
  return (
    <div className={cn('flex w-[168px] shrink-0 flex-col gap-3', className)}>
      <div className="flex items-baseline gap-1.5">
        {measuring ? (
          <span className="text-[38px] leading-none font-extrabold tabular-nums text-[color:var(--text-title)]">
            <LiveNumber value={progress ? progress.done : 0} />
            <span className="text-[18px] font-bold text-muted-foreground">/{progress?.total ?? '…'}</span>
          </span>
        ) : (
          <span className={cn('text-[38px] leading-none font-extrabold tabular-nums', headline == null ? 'text-muted-foreground/60' : 'text-[color:var(--text-title)]')}>
            {headline == null ? '—' : <LiveNumber value={headline} />}
          </span>
        )}
        <span className="text-[12px] text-muted-foreground">{measuring ? 'путей' : 'мс'}</span>
      </div>
      <Track label="через узел" ms={bestMs} max={max} lit={bestWins} busy={measuring} />
      <Track label="напрямую" ms={directMs} max={max} lit={!bestWins && directMs != null} busy={measuring} />
    </div>
  )
}

export default RouteRace
