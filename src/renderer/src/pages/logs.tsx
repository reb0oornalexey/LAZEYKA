import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso'
import { useLogsStore, formatLogTime } from '@renderer/store/logs-store'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { MapPin, Trash2 } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import BasePage from '@renderer/components/base/base-page'

const sourceColor: Record<CoreSource, string> = {
  tgws: 'text-sky-700 dark:text-sky-400 font-semibold',
  zapret: 'text-indigo-400 font-semibold',
  app: 'text-muted-foreground'
}

const sourceLabels: Record<'all' | CoreSource, string> = {
  all: 'все каналы',
  tgws: 'telegram',
  zapret: 'zapret',
  app: 'система'
}

const Logs: React.FC = () => {
  const clearLogs = useLogsStore((s) => s.clear)
  const [logs, setLogs] = useState<ControllerLog[]>(() => useLogsStore.getState().logs)
  const [filter, setFilter] = useState('')
  const [sourceFilter, setSourceFilter] = useState<CoreSource | 'all'>('all')
  const [trace, setTrace] = useState(true)
  const traceRef = useRef(trace)
  const virtuosoRef = useRef<VirtuosoHandle>(null)

  const filteredLogs = useMemo(() => {
    const fl = filter.toLowerCase()
    return logs.filter((log) => {
      if (sourceFilter !== 'all' && log.source !== sourceFilter) return false
      if (!fl) return true
      return log.payload.toLowerCase().includes(fl) || log.type.toLowerCase().includes(fl)
    })
  }, [logs, filter, sourceFilter])

  const toggleTrace = useCallback(() => {
    setTrace((prev) => {
      const next = !prev
      traceRef.current = next
      if (next) setLogs([...useLogsStore.getState().logs])
      return next
    })
  }, [])

  useEffect(() => {
    if (!trace) return
    virtuosoRef.current?.scrollToIndex({
      index: filteredLogs.length - 1,
      behavior: 'smooth',
      align: 'end'
    })
  }, [filteredLogs, trace])

  useEffect(() => {
    return useLogsStore.subscribe((state) => {
      if (traceRef.current) setLogs([...state.logs])
    })
  }, [])

  return (
    <BasePage
      title="Консоль логов (Cyber Terminal)"
      contentClassName="flex flex-col"
      header={
        <button
          type="button"
          title="Очистить логи"
          aria-label="Очистить логи"
          className="cursor-pointer p-1.5 rounded-xl text-muted-foreground hover:text-rose-700 dark:hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
          onClick={() => {
            clearLogs()
            setLogs([])
          }}
        >
          <Trash2 className="size-4" />
        </button>
      }
    >
      <div className="flex flex-col h-full px-4 pb-4">
        <div className="py-2.5 flex items-center gap-2">
          <Input
            className="h-8.5 text-xs font-mono bg-card/60 border-border/70 rounded-xl"
            value={filter}
            placeholder="Поиск по тексту или уровню..."
            onChange={(e) => setFilter(e.target.value)}
          />
          {(['all', 'tgws', 'zapret', 'app'] as const).map((s) => (
            <Button
              key={s}
              size="sm"
              variant={sourceFilter === s ? 'default' : 'outline'}
              onClick={() => setSourceFilter(s)}
              className={cn(
                'h-8 text-xs font-mono rounded-xl cursor-pointer transition-all uppercase',
                sourceFilter === s
                  ? 'bg-primary text-primary-foreground shadow-[0_0_12px_rgba(99,102,241,0.3)] font-bold'
                  : 'border-border/70 hover:bg-foreground/[0.04]'
              )}
            >
              {sourceLabels[s]}
            </Button>
          ))}
          <Button
            size="icon-sm"
            className={cn(
              'h-8 w-8 rounded-xl cursor-pointer transition-all',
              trace
                ? 'bg-primary text-primary-foreground shadow-[0_0_12px_rgba(99,102,241,0.3)]'
                : 'border-border/70 hover:bg-foreground/[0.04]'
            )}
            variant={trace ? 'default' : 'outline'}
            title="Автоскролл за новыми событиями"
            onClick={toggleTrace}
          >
            <MapPin className="size-3.5" />
          </Button>
        </div>

        <div className="flex-1 min-h-0 font-mono text-xs rounded-2xl border border-border/60 bg-black/40 backdrop-blur-xl p-2 overflow-hidden shadow-inner">
          <Virtuoso
            ref={virtuosoRef}
            data={filteredLogs}
            initialTopMostItemIndex={filteredLogs.length - 1}
            followOutput={trace}
            itemContent={(_i, log) => (
              <div className="px-3 py-1 flex gap-2.5 items-baseline hover:bg-foreground/[0.04] rounded-lg transition-colors leading-relaxed">
                <span className="text-muted-foreground/60 shrink-0 text-[11px]">{formatLogTime(log.time)}</span>
                <span className={cn('shrink-0 text-[11px] uppercase tracking-wider', sourceColor[log.source])}>
                  [{log.source}]
                </span>
                <span
                  className={cn(
                    'shrink-0 text-[11px] font-bold uppercase',
                    log.type === 'error' && 'text-rose-700 dark:text-rose-400',
                    log.type === 'warn' && 'text-amber-700 dark:text-amber-400',
                    log.type === 'info' && 'text-emerald-700/80 dark:text-emerald-400/80'
                  )}
                >
                  {log.type}
                </span>
                <span className="break-all whitespace-pre-wrap text-foreground/90">{log.payload}</span>
              </div>
            )}
          />
        </div>
      </div>
    </BasePage>
  )
}

export default Logs
