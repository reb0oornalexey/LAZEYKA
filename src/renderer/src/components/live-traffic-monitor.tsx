import React, { Suspense, lazy, useEffect, useState } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useZapretStore } from '@renderer/store/zapret-store'
import { useTgwsStore } from '@renderer/store/tgws-store'
import { useIncyStore } from '@renderer/store/incy-store'
import { systemGetNetworkSpeed } from '@renderer/utils/ipc'

const LiveTrafficChart = lazy(() => import('@renderer/components/live-traffic-chart'))

export interface TrafficPoint {
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
    <div className={`ui-glow rounded-2xl border border-border bg-card p-4 ${className ?? ''}`}>
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
        {/* recharts (~600 КБ с зависимостями) грузится отдельным файлом уже после первой отрисовки главной. */}
        <Suspense fallback={null}>
          <LiveTrafficChart data={data} rxColor={rxColor} txColor={txColor} />
        </Suspense>
      </div>
    </div>
  )
}

export default LiveTrafficMonitor
