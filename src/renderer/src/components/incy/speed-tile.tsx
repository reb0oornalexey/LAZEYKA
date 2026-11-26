import React, { useCallback, useState } from 'react'
import { ArrowDown, ArrowUp, Gauge } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Hint } from '@renderer/components/prematch/hint'
import { LzPanel } from '@renderer/components/lz'
import NetSpeedDialog from '@renderer/components/net-speed-dialog'
import { cn } from '@renderer/lib/utils'
import type { IncyNode, NetSpeedResult } from '@renderer/utils/ipc'

const LAST_KEY = 'lazeyka.incy.lastSpeed'

interface LastSpeed {
  at: number
  down: number | null
  up: number | null
  ping: number | null
  /** Через какой сервер мерили; пусто — текущее подключение или напрямую. */
  via: string
  error?: string
}

function readLast(): LastSpeed | null {
  try {
    const v = JSON.parse(localStorage.getItem(LAST_KEY) ?? 'null') as LastSpeed | null
    return v && typeof v.at === 'number' ? v : null
  } catch {
    return null
  }
}

function fmt(v: number | null): string {
  if (v == null) return '—'
  return (v >= 100 ? String(Math.round(v)) : v.toFixed(1)).replace('.', ',')
}

function ago(at: number): string {
  const min = Math.round((Date.now() - at) / 60000)
  if (min < 1) return 'только что'
  if (min < 60) return `${min} мин назад`
  const h = Math.round(min / 60)
  if (h < 24) return `${h} ч назад`
  return `${Math.round(h / 24)} дн. назад`
}

/**
 * Тест скорости на Главной INCY: итог последнего замера крупно и одна кнопка.
 * Само окно замера — то же, что на главной программы (NetSpeedDialog).
 */
export const SpeedTile: React.FC<{
  nodes: IncyNode[]
  vpnOn: boolean
  initialNodeId: string | null
  /** Чистое имя узла по id — для подписи «через …». */
  nodeLabel: (id: string) => string
  className?: string
}> = ({ nodes, vpnOn, initialNodeId, nodeLabel, className }) => {
  const [open, setOpen] = useState(false)
  const [last, setLast] = useState<LastSpeed | null>(readLast)

  const onResult = useCallback(
    (r: NetSpeedResult, nodeId: string): void => {
      const v: LastSpeed = {
        at: Date.now(),
        down: r.downloadMbps,
        up: r.uploadMbps,
        ping: r.pingMs,
        via: nodeId ? nodeLabel(nodeId) : r.viaVpn ? 'текущее подключение' : 'напрямую',
        error: r.error
      }
      setLast(v)
      try {
        localStorage.setItem(LAST_KEY, JSON.stringify(v))
      } catch {
        /* noop */
      }
    },
    [nodeLabel]
  )
  const close = useCallback(() => setOpen(false), [])
  const ok = last && !last.error && last.down != null

  return (
    <LzPanel data-tour="incy-speed" className={cn('flex flex-col gap-2.5 p-4', className)}>
      <div className="flex items-center gap-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-foreground/[0.06] text-muted-foreground [&_svg]:size-[17px]">
          <Gauge />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[14px] font-bold text-[color:var(--text-title)]">
            Тест скорости
            <Hint text="Замер через любой сервер подписки или текущее подключение: Яндекс, Speedtest или Cloudflare. Без серверов — проверка интернета напрямую." />
          </div>
          <div className="truncate text-[11.5px] text-muted-foreground">{last ? `последний — ${ago(last.at)}` : 'ещё не проверяли'}</div>
        </div>
      </div>

      <div className="rounded-xl border border-foreground/[0.07] bg-foreground/[0.03] px-3 py-2.5">
        {ok ? (
          <>
            <div className="flex items-baseline gap-1.5">
              <ArrowDown className="size-4 self-center text-primary" />
              <span className="text-[26px] leading-none font-extrabold tabular-nums text-[color:var(--text-title)]">{fmt(last.down)}</span>
              <span className="text-[12px] text-muted-foreground">Мбит/с</span>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-muted-foreground">
              <span className="flex items-center gap-1 tabular-nums">
                <ArrowUp className="size-3.5 text-st-info-text" />
                {fmt(last.up)} Мбит/с
              </span>
              {last.ping != null && <span className="tabular-nums">пинг {Math.round(last.ping)} мс</span>}
            </div>
            <div data-sensitive="node" className="mt-0.5 truncate text-[11.5px] text-muted-foreground" title={`через ${last.via}`}>
              через {last.via}
            </div>
          </>
        ) : last?.error ? (
          <div className="text-[12px] leading-snug text-st-err-text">Замер не получился: {last.error}</div>
        ) : (
          <div className="text-[12px] leading-snug text-muted-foreground">
            {nodes.length
              ? 'Проверьте, какую скорость даёт узел, до того как на нём играть или смотреть видео.'
              : 'Серверов пока нет — можно проверить интернет напрямую. Добавьте подписку, чтобы мерить через VPN.'}
          </div>
        )}
      </div>

      <Button size="sm" variant="outline" className="mt-auto h-9 gap-1.5 rounded-xl text-xs" onClick={() => setOpen(true)}>
        <Gauge className="size-3.5" />
        {last ? 'Проверить ещё раз' : 'Проверить скорость'}
      </Button>
      <NetSpeedDialog open={open} onClose={close} vpnOn={vpnOn} nodes={nodes} initialNodeId={initialNodeId} onResult={onResult} />
    </LzPanel>
  )
}

export default SpeedTile
