import React, { useEffect, useRef, useState } from 'react'
import { Gauge, ArrowDown, ArrowUp, Activity, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'
import {
  incySpeedTest,
  type IncyNode,
  type IncySpeedTestProgress,
  type IncySpeedTestResult
} from '@renderer/utils/ipc'

interface Props {
  node: IncyNode | null
  /** Чистое имя узла для подписи (без флага в начале). */
  label: string
}

const PHASE_LABEL: Record<IncySpeedTestProgress['phase'], string> = {
  connect: 'Подключаюсь к серверу…',
  ping: 'Замеряю задержку…',
  download: 'Скачивание…',
  upload: 'Отдача…',
  done: 'Готово',
  error: 'Ошибка'
}

function fmt(v: number | null | undefined): string {
  if (v == null) return '—'
  return v >= 100 ? String(Math.round(v)) : v.toFixed(1)
}

/**
 * Тест скорости через выбранный сервер. Идёт через отдельное временное ядро,
 * поэтому работающий VPN не рвётся, и проверить можно любой сервер.
 */
const SpeedTestCard: React.FC<Props> = ({ node, label }) => {
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<IncySpeedTestProgress | null>(null)
  const [result, setResult] = useState<IncySpeedTestResult | null>(null)
  const nodeRef = useRef<string | null>(null)

  useEffect(() => {
    const listener = (_e: unknown, p: IncySpeedTestProgress): void => {
      if (p.nodeId === nodeRef.current) setProgress(p)
    }
    window.electron.ipcRenderer.on('incy:speedTestProgress', listener)
    return () => {
      window.electron.ipcRenderer.removeListener('incy:speedTestProgress', listener)
    }
  }, [])

  // Результат относится к конкретному серверу — при смене сервера прячем его.
  useEffect(() => {
    if (!running) {
      setResult(null)
      setProgress(null)
    }
  }, [node?.id])

  const start = async (): Promise<void> => {
    if (!node || running) return
    nodeRef.current = node.id
    setRunning(true)
    setResult(null)
    setProgress({ nodeId: node.id, phase: 'connect' })
    try {
      const r = await incySpeedTest(node.id)
      setResult(r)
      if (r.error) toast.error('Тест скорости не удался', { description: r.error })
    } catch (e) {
      toast.error('Тест скорости не удался', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setRunning(false)
      setProgress(null)
    }
  }

  const live = running ? progress : null
  const ping = result?.pingMs ?? live?.pingMs ?? null
  const down = result ? result.downloadMbps : live?.phase === 'download' ? live.mbps : live?.downloadMbps
  const up = result ? result.uploadMbps : live?.phase === 'upload' ? live.mbps : null

  const tiles = [
    { key: 'ping', icon: Activity, title: 'Задержка', value: ping == null ? '—' : String(Math.round(ping)), unit: 'мс', active: live?.phase === 'ping' },
    { key: 'down', icon: ArrowDown, title: 'Скачивание', value: fmt(down), unit: 'Мбит/с', active: live?.phase === 'download' },
    { key: 'up', icon: ArrowUp, title: 'Отдача', value: fmt(up), unit: 'Мбит/с', active: live?.phase === 'upload' }
  ]

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Gauge className="h-4 w-4 text-primary" />
            Тест скорости
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {node ? `Через сервер «${label}». VPN при этом не отключается.` : 'Сначала выберите сервер.'}
          </p>
        </div>
        <Button size="sm" className="h-8 shrink-0 gap-1.5 text-xs" disabled={!node || running} onClick={() => void start()}>
          {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Gauge className="h-3.5 w-3.5" />}
          {running ? PHASE_LABEL[progress?.phase ?? 'connect'] : result ? 'Ещё раз' : 'Проверить'}
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {tiles.map((t) => (
          <div
            key={t.key}
            className={cn(
              'rounded-lg border px-3 py-2 transition-colors',
              t.active ? 'border-primary/50 bg-primary/10' : 'border-border bg-background/40'
            )}
          >
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <t.icon className="h-3 w-3" />
              {t.title}
            </div>
            <div className="mt-0.5 font-mono text-lg font-bold tabular-nums">
              {t.value}
              <span className="ml-1 text-[11px] font-medium text-muted-foreground">{t.value === '—' ? '' : t.unit}</span>
            </div>
          </div>
        ))}
      </div>

      <p className="text-[11px] text-muted-foreground">
        Замер через speed.cloudflare.com, около 20 секунд. Расходует до 70 МБ трафика подписки.
        {result && !result.error ? ` Скачано ${result.downloadedMB} МБ.` : ''}
      </p>
    </div>
  )
}

export default SpeedTestCard
