import React, { useEffect, useRef, useState } from 'react'
import { Activity } from 'lucide-react'
import { incyGetAppActivity, type AppActivity } from '@renderer/utils/ipc'

interface Props {
  /** Приложения из списка ExitLag. */
  apps: string[]
  /** Туннель поднят в режиме ExitLag — только тогда есть что показывать. */
  active: boolean
  mode: 'proxy_only' | 'bypass_only'
}

interface Row {
  name: string
  viaVpn: number
  direct: number
  downBps: number
  upBps: number
}

function fmtRate(bps: number): string {
  if (bps < 1024) return `${Math.round(bps)} Б/с`
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(bps < 10 * 1024 ? 1 : 0)} КБ/с`
  return `${(bps / 1024 / 1024).toFixed(1)} МБ/с`
}

/**
 * Живой индикатор ExitLag: какие приложения из списка сейчас держат
 * соединения и идут ли они через VPN. Опрашивает ядро раз в 3 секунды и
 * только пока карточка на экране.
 */
const AppActivityCard: React.FC<Props> = ({ apps, active, mode }) => {
  const [rows, setRows] = useState<Row[] | null>(null)
  const prev = useRef<Map<string, { up: number; down: number; at: number }>>(new Map())

  useEffect(() => {
    if (!active) {
      setRows(null)
      return
    }
    let stopped = false
    const want = new Set(apps.map((a) => a.toLowerCase()))
    const tick = async (): Promise<void> => {
      const list = await incyGetAppActivity().catch(() => null)
      if (stopped) return
      if (!list) {
        setRows([])
        return
      }
      const now = Date.now()
      const next: Row[] = []
      for (const a of list as AppActivity[]) {
        const key = a.name.toLowerCase()
        if (!want.has(key)) continue
        const p = prev.current.get(key)
        const dt = p ? (now - p.at) / 1000 : 0
        next.push({
          name: a.name,
          viaVpn: a.viaVpn,
          direct: a.direct,
          downBps: p && dt > 0 ? Math.max(0, (a.download - p.down) / dt) : 0,
          upBps: p && dt > 0 ? Math.max(0, (a.upload - p.up) / dt) : 0
        })
        prev.current.set(key, { up: a.upload, down: a.download, at: now })
      }
      next.sort((x, y) => y.downBps + y.upBps - (x.downBps + x.upBps))
      setRows(next)
    }
    void tick()
    const t = setInterval(() => void tick(), 3000)
    return () => {
      stopped = true
      clearInterval(t)
    }
  }, [active, apps.join('|')])

  return (
    <div className="space-y-2 rounded-xl border border-border/50 bg-background/40 p-3">
      <div className="flex items-center gap-2 text-xs font-semibold">
        <Activity className="h-3.5 w-3.5 text-primary" />
        Сейчас в сети
      </div>
      {!active ? (
        <p className="text-[11px] text-muted-foreground">Появится, когда VPN работает в режиме ExitLag.</p>
      ) : rows === null ? (
        <p className="text-[11px] text-muted-foreground">Получаю данные ядра…</p>
      ) : rows.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">Приложения из списка сейчас не выходят в сеть.</p>
      ) : (
        <div className="space-y-1">
          {rows.map((r) => {
            const expectVpn = mode === 'proxy_only'
            const ok = expectVpn ? r.direct === 0 : r.viaVpn === 0
            return (
              <div key={r.name} className="flex items-center justify-between gap-2 text-[11px]">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className={ok ? 'size-1.5 shrink-0 rounded-full bg-primary' : 'size-1.5 shrink-0 rounded-full bg-amber-500'} />
                  <span className="truncate font-mono font-semibold">{r.name}</span>
                </span>
                <span className="shrink-0 text-muted-foreground">
                  {r.viaVpn > 0 && `через VPN: ${r.viaVpn}`}
                  {r.viaVpn > 0 && r.direct > 0 && ' · '}
                  {r.direct > 0 && `напрямую: ${r.direct}`}
                  {' · '}↓ {fmtRate(r.downBps)} ↑ {fmtRate(r.upBps)}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default AppActivityCard
