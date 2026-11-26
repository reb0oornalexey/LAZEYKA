import React, { useState } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { LiveNumber, Sparkline } from '@renderer/components/lz'
import { formatSpeed } from '@renderer/components/live-traffic-monitor'
import { cn } from '@renderer/lib/utils'
import type { LiveTraffic } from './use-live-traffic'

/**
 * Живой трафик в нижней полосе пульта: входящий (цвет темы, с заливкой) и
 * исходящий (голубая линия). При наведении на график — значения в этой точке.
 */
export const TrafficChip: React.FC<{ t: LiveTraffic; active: boolean; className?: string }> = ({ t, active, className }) => {
  const [hover, setHover] = useState<number | null>(null)
  const rx = hover !== null ? (t.rx[hover] ?? 0) : t.currentRx
  const tx = hover !== null ? (t.tx[hover] ?? 0) : t.currentTx
  const a = t.rx.length >= 2 ? t.rx : [0, 0]
  const b = t.tx.length >= 2 ? t.tx : [0, 0]
  return (
    <div
      className={cn(
        'flex min-w-0 items-center gap-3 rounded-xl border border-foreground/[0.08] bg-foreground/[0.035] py-1.5 pr-2 pl-3',
        className
      )}
      title={active ? 'Скорость сети сейчас. Наведите на график, чтобы увидеть значение в прошлой точке.' : 'График оживает, когда включена хотя бы одна служба'}
    >
      <div className="shrink-0">
        <div className="text-[11px] leading-tight text-muted-foreground">{hover !== null ? 'Трафик в этой точке' : 'Трафик'}</div>
        {!active ? (
          <div className="text-[13px] font-semibold leading-snug text-muted-foreground">ждёт включения</div>
        ) : (
        <div className="flex items-center gap-2.5 text-[13px] font-semibold leading-snug">
          <span className="flex items-center gap-0.5 text-primary">
            <ArrowDown className="size-3.5" />
            <LiveNumber value={formatSpeed(rx)} />
          </span>
          <span className="flex items-center gap-0.5 text-st-info-text">
            <ArrowUp className="size-3.5" />
            <LiveNumber value={formatSpeed(tx)} />
          </span>
        </div>
        )}
      </div>
      <div className={cn('h-9 min-w-[90px] flex-1', !active && 'opacity-40')}>
        <Sparkline a={a} b={b} colorB="var(--st-info)" onHover={active && t.rx.length >= 2 ? setHover : undefined} />
      </div>
    </div>
  )
}

export default TrafficChip
