import React, { useEffect, useState } from 'react'
import { AreaChart, Area, ResponsiveContainer, Tooltip } from 'recharts'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useZapretStore } from '@renderer/store/zapret-store'
import { useTgwsStore } from '@renderer/store/tgws-store'
import { useIncyStore } from '@renderer/store/incy-store'
import { systemGetNetworkSpeed } from '@renderer/utils/ipc'

interface TrafficPoint {
  time: string
  rx: number
  tx: number
}

const POINTS = 24

export function formatSpeed(kbps: number): string {
  if (kbps >= 1024) return `${(kbps / 1024).toFixed(1).replace('.', ',')} МБ/с`
  return `${kbps.toFixed(0)} КБ/с`
}

/**
 * График трафика на главной. Опрос раз в 2,5 с и только пока окно видно и
 * работает хотя бы одна служба; без анимаций перерисовки графика.
 */
const LiveTrafficMonitor: React.FC<{ className?: string }> = ({ className }) => {
  const zapret = useZapretStore((s) => s.status)
  const tgws = useTgwsStore((s) => s.status)
  const incy = useIncyStore((s) => s.status)
  const { resolvedTheme } = useTheme()
  const rxColor = resolvedTheme === 'light' ? '#0e9a5a' : '#4ce896'
  const txColor = resolvedTheme === 'light' ? '#3b6fe0' : '#5b8cff'

  const isAnyRunning = zapret.state === 'running' || tgws.state === 'running' || incy.state === 'running'
  const [data, setData] = useState<TrafficPoint[]>(() =>
    Array.from({ length: POINTS }, (_, i) => ({ time: `${i}`, rx: 0, tx: 0 }))
  )
  const [currentRx, setCurrentRx] = useState(0)
  const [currentTx, setCurrentTx] = useState(0)

  useEffect(() => {
    let mounted = true
    if (!isAnyRunning) {
      setCurrentRx(0)
      setCurrentTx(0)
      return
    }
    const poll = async (): Promise<void> => {
      // Свёрнутое окно ничего не опрашивает — это запуск netstat в main.
      if (document.visibilityState === 'hidden') return
      try {
        const speed = await systemGetNetworkSpeed()
        if (!mounted) return
        const rx = speed.rxKbps || 0
        const tx = speed.txKbps || 0
        setCurrentRx(rx)
        setCurrentTx(tx)
        setData((prev) => [...prev.slice(1), { time: '', rx, tx }])
      } catch {
        /* ignore */
      }
    }
    void poll()
    const interval = setInterval(() => void poll(), 2500)
    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [isAnyRunning])

  return (
    <div className={`rounded-2xl border border-border bg-card p-4 ${className ?? ''}`}>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-foreground">Трафик</div>
          <div className="text-[11px] text-muted-foreground">
            {isAnyRunning ? 'Скорость сети сейчас' : 'Службы выключены'}
          </div>
        </div>
        <div className="flex items-center gap-4 text-sm font-semibold tabular-nums">
          <span className="flex items-center gap-1" style={{ color: rxColor }}>
            <ArrowDown className="size-4" />
            {formatSpeed(currentRx)}
          </span>
          <span className="flex items-center gap-1" style={{ color: txColor }}>
            <ArrowUp className="size-4" />
            {formatSpeed(currentTx)}
          </span>
        </div>
      </div>

      <div className="mt-2 h-24 w-full">
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
      </div>
    </div>
  )
}

export default LiveTrafficMonitor
