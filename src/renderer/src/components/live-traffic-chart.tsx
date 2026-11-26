import { AreaChart, Area, ResponsiveContainer, Tooltip } from 'recharts'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { formatSpeed, type TrafficPoint } from '@renderer/components/live-traffic-monitor'

/** График трафика на главной. Отдельный файл, чтобы recharts грузился лениво. */
export default function LiveTrafficChart({
  data,
  rxColor,
  txColor
}: {
  data: TrafficPoint[]
  rxColor: string
  txColor: string
}): React.ReactElement {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="rxGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={rxColor} stopOpacity={0.3} />
            <stop offset="100%" stopColor={rxColor} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Tooltip
          cursor={{ stroke: 'var(--border)' }}
          content={({ active, payload }) =>
            active && payload && payload.length ? (
              <div className="space-y-0.5 rounded-lg border border-border bg-popover px-3 py-1.5 text-[11px] font-medium tabular-nums shadow-lg">
                <div className="flex items-center gap-1" style={{ color: rxColor }}>
                  <ArrowDown className="size-3" /> Входящий: {formatSpeed((payload[0]?.value as number) || 0)}
                </div>
                <div className="flex items-center gap-1" style={{ color: txColor }}>
                  <ArrowUp className="size-3" /> Исходящий: {formatSpeed((payload[1]?.value as number) || 0)}
                </div>
              </div>
            ) : null
          }
        />
        <Area
          type="monotone"
          dataKey="rx"
          stroke={rxColor}
          fill="url(#rxGrad)"
          fillOpacity={1}
          strokeWidth={2}
          isAnimationActive={false}
        />
        <Area
          type="monotone"
          dataKey="tx"
          stroke={txColor}
          fill="transparent"
          strokeWidth={1.5}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
