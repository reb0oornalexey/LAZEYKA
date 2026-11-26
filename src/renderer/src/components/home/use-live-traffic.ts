import { useEffect, useState } from 'react'
import { systemGetNetworkSpeed } from '@renderer/utils/ipc'

const POINTS = 24

export interface LiveTraffic {
  rx: number[]
  tx: number[]
  currentRx: number
  currentTx: number
}

/**
 * Скорость сети для главной — то же поведение, что у прежнего LiveTrafficMonitor:
 * опрос раз в 2,5 с, только пока работает хотя бы одна служба и окно видно;
 * при выключении всех служб опрос останавливается.
 */
export function useLiveTraffic(active: boolean): LiveTraffic {
  // Копим до 24 последних точек; пока их мало, график растянут на всю ширину.
  const [rx, setRx] = useState<number[]>([])
  const [tx, setTx] = useState<number[]>([])
  const [currentRx, setCurrentRx] = useState(0)
  const [currentTx, setCurrentTx] = useState(0)

  useEffect(() => {
    let mounted = true
    if (!active) {
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
        const r = speed.rxKbps || 0
        const t = speed.txKbps || 0
        setCurrentRx(r)
        setCurrentTx(t)
        setRx((p) => [...p, r].slice(-POINTS))
        setTx((p) => [...p, t].slice(-POINTS))
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
  }, [active])

  return { rx, tx, currentRx, currentTx }
}
