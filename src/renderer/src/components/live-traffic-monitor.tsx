import React, { useEffect, useState } from 'react'
import { AreaChart, Area, ResponsiveContainer, Tooltip } from 'recharts'
import { Activity, ShieldCheck, ArrowDown, ArrowUp } from 'lucide-react'
import { useZapretStore } from '@renderer/store/zapret-store'
import { useTgwsStore } from '@renderer/store/tgws-store'
import { useIncyStore } from '@renderer/store/incy-store'
import { systemGetNetworkSpeed } from '@renderer/utils/ipc'

interface TrafficPoint {
  time: string
  rx: number
  tx: number
}

const LiveTrafficMonitor: React.FC = () => {
  const zapret = useZapretStore((s) => s.status)
  const tgws = useTgwsStore((s) => s.status)
  const incy = useIncyStore((s) => s.status)

  const isAnyRunning = zapret.state === 'running' || tgws.state === 'running' || incy.state === 'running'
  const [data, setData] = useState<TrafficPoint[]>(() =>
    Array.from({ length: 15 }, (_, i) => ({ time: `${i}s`, rx: 0, tx: 0 }))
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
      if (document.visibilityState === 'hidden' || !isAnyRunning) return
      try {
        const speed = await systemGetNetworkSpeed()
        if (!mounted) return
        const rx = speed.rxKbps || 0
        const tx = speed.txKbps || 0

        setCurrentRx(rx)
        setCurrentTx(tx)

        setData((prev) => {
          const next = [...prev.slice(1), { time: '', rx, tx }]
          return next
        })
      } catch { /* ignore */ }
    }

    void poll()
    const interval = setInterval(() => { void poll() }, 2500)

    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [isAnyRunning])

  const formatSpeed = (kbps: number): string => {
    if (kbps >= 1024) {
      return `${(kbps / 1024).toFixed(1)} МБ/с`
    }
    return `${kbps.toFixed(0)} КБ/с`
  }

  return (
    <div className="rounded-2xl cyber-card p-4 transition-all duration-300 relative overflow-hidden">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-primary/10 border border-primary/20 text-primary">
            <Activity className="size-4 animate-pulse" />
          </div>
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-foreground font-mono">
              Сетевая телеметрия
            </div>
            <div className="text-[10px] text-muted-foreground">
              {isAnyRunning ? 'Прямой перехват активен' : 'Ожидание запуска служб'}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400 font-mono text-[11px] font-semibold">
            <ArrowDown className="size-3" />
            <span>{formatSpeed(currentRx)}</span>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-sky-500/10 border border-sky-500/20 text-sky-700 dark:text-sky-400 font-mono text-[11px] font-semibold">
            <ArrowUp className="size-3" />
            <span>{formatSpeed(currentTx)}</span>
          </div>
          {isAnyRunning && (
            <div className="flex items-center gap-1.5 text-[11px] font-mono font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-500/15 px-2.5 py-1 rounded-xl border border-emerald-500/30 shadow-[0_0_12px_rgba(16,185,129,0.25)]">
              <ShieldCheck className="size-3.5 text-emerald-700 dark:text-emerald-400" />
              <span>Защита</span>
            </div>
          )}
        </div>
      </div>

      <div className="h-16 w-full mt-1">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="rxGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10b981" stopOpacity={0.45} />
                <stop offset="100%" stopColor="#10b981" stopOpacity={0.0} />
              </linearGradient>
              <linearGradient id="txGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#38bdf8" stopOpacity={0.0} />
              </linearGradient>
            </defs>
            <Tooltip
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  return (
                    <div className="rounded-xl border border-border/80 bg-popover/95 backdrop-blur-xl px-3 py-1.5 text-[11px] font-mono shadow-xl space-y-0.5">
                      <div className="text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
                        <ArrowDown className="size-3" /> Входящий: {formatSpeed(payload[0]?.value as number || 0)}
                      </div>
                      <div className="text-sky-700 dark:text-sky-400 flex items-center gap-1">
                        <ArrowUp className="size-3" /> Исходящий: {formatSpeed(payload[1]?.value as number || 0)}
                      </div>
                    </div>
                  )
                }
                return null
              }}
            />
            <Area
              type="monotone"
              dataKey="rx"
              stroke="#10b981"
              fillOpacity={1}
              fill="url(#rxGrad)"
              strokeWidth={2}
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="tx"
              stroke="#38bdf8"
              fillOpacity={1}
              fill="url(#txGrad)"
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
