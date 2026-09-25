import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso'
import { useLogsStore, formatLogTime } from '@renderer/store/logs-store'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { MapPin, Trash2, ClipboardCopy, Download } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import BasePage from '@renderer/components/base/base-page'
import { toast } from 'sonner'
import { zapretStatus, tgwsStatus, incyGetStatus, incyGetSettings, getAppVersion } from '@renderer/utils/ipc'

/**
 * Отчёт уходит в чат поддержки — секреты из него убираются: MTProto-секрет
 * TgWsProxy (по нему к прокси может подключиться кто угодно), UUID/пароли
 * узлов из ссылок vless://, trojan:// и т.п.
 */
function redact(text: string): string {
  return text
    .replace(/(--secret\s+)[0-9a-f]{32}/gi, '$1********')
    .replace(/(secret=)(?:dd|ee)?[0-9a-f]{32}[0-9a-f]*/gi, '$1********')
    .replace(/(Secret:\s*)[0-9a-f]{32}/gi, '$1********')
    .replace(/\b(vless|vmess|trojan|ss|hysteria2|hy2|tuic):\/\/[^\s"'<>]+/gi, '$1://********')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '********-uuid')
}

const sourceColor: Record<CoreSource, string> = {
  tgws: 'text-sky-700 dark:text-sky-400 font-semibold',
  zapret: 'text-indigo-400 font-semibold',
  app: 'text-muted-foreground',
  incy: 'text-emerald-600 dark:text-emerald-400 font-semibold',
  exitlag: 'text-amber-600 dark:text-amber-400 font-semibold'
}

const sourceLabels: Record<'all' | CoreSource, string> = {
  all: 'все каналы',
  tgws: 'telegram',
  zapret: 'zapret',
  app: 'система',
  incy: 'incy',
  exitlag: 'exitlag'
}

async function generateDiagnosticReport(): Promise<string> {
  const lines: string[] = []

  lines.push('# 📋 Диагностический отчёт LAZEYKA')
  lines.push(`**Дата:** ${new Date().toLocaleString('ru-RU')}`)
  lines.push(`**LAZEYKA:** ${await getAppVersion().catch(() => '?')}`)
  lines.push(`**ОС:** ${navigator.userAgent.match(/Windows NT [\d.]+/)?.[0] ?? navigator.platform}`)
  lines.push(`**User-Agent:** ${navigator.userAgent}`)
  lines.push('')

  // Gather statuses
  try {
    const status = await zapretStatus()
    lines.push('## Zapret')
    lines.push(`- Состояние: ${status?.state ?? 'неизвестно'}`)
    if (status?.lastError) lines.push(`- Ошибка: ${status.lastError}`)
    lines.push('')
  } catch { lines.push('## Zapret\n- Не удалось получить статус\n') }

  try {
    const status = await tgwsStatus()
    lines.push('## TgWsProxy')
    lines.push(`- Состояние: ${status?.state ?? 'неизвестно'}`)
    if (status?.lastError) lines.push(`- Ошибка: ${status.lastError}`)
    lines.push('')
  } catch { lines.push('## TgWsProxy\n- Не удалось получить статус\n') }

  try {
    const incyStatus = await incyGetStatus()
    lines.push('## INCY')
    lines.push(`- Состояние: ${incyStatus?.state ?? 'неизвестно'}`)
    lines.push(`- Режим подключения: ${incyStatus?.connectionMode ?? 'неизвестно'}`)
    lines.push(
      `- ExitLag в этой сессии: ${incyStatus?.exitLagActive ? `да (${(incyStatus.exitLagApps ?? []).join(', ')})` : 'нет'}`
    )
    lines.push(`- Выбранный узел: ${incyStatus?.selectedNodeId ?? 'нет'}`)
    lines.push(`- Активный узел: ${incyStatus?.activeNodeId ?? 'нет'}`)
    if (incyStatus?.lastError) lines.push(`- Ошибка: ${incyStatus.lastError}`)
    lines.push('')
  } catch { lines.push('## INCY\n- Не удалось получить статус\n') }

  try {
    const settings = await incyGetSettings()
    lines.push('## Настройки INCY')
    lines.push(`- Режим: ${settings?.routingMode ?? 'неизвестно'}`)
    lines.push(`- Per-App: ${settings?.perAppProxy ? `вкл (${settings.perAppMode}, ${(settings.perAppProcesses ?? []).join(', ')})` : 'выкл'}`)
    lines.push(`- DNS: ${settings?.vpnDns ?? 'неизвестно'}`)
    lines.push(`- Мультиплекс: ${settings?.multiplexing ? 'вкл' : 'выкл'}`)
    lines.push('')
  } catch { lines.push('## Настройки INCY\n- Не удалось получить настройки\n') }

  // Recent logs
  const allLogs = useLogsStore.getState().logs
  const lastLogs = allLogs.slice(-100)
  lines.push('## Последние 100 записей логов')
  lines.push('```')
  for (const log of lastLogs) {
    const ts = formatLogTime(log.time)
    lines.push(`${ts} [${log.type}] [${log.source}] ${log.payload}`)
  }
  lines.push('```')

  return redact(lines.join('\n'))
}

const Logs: React.FC = () => {
  const clearLogs = useLogsStore((s) => s.clear)
  const [logs, setLogs] = useState<ControllerLog[]>(() => useLogsStore.getState().logs)
  const [filter, setFilter] = useState('')
  const [sourceFilter, setSourceFilter] = useState<CoreSource | 'all'>('all')
  const [trace, setTrace] = useState(true)
  const traceRef = useRef(trace)
  const virtuosoRef = useRef<VirtuosoHandle>(null)
  const [generatingReport, setGeneratingReport] = useState(false)

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

  const handleGenerateReport = async (): Promise<void> => {
    setGeneratingReport(true)
    try {
      const report = await generateDiagnosticReport()
      await navigator.clipboard.writeText(report)
      toast.success('Отчёт скопирован в буфер обмена', {
        description: 'Вставьте его в чат поддержки (Ctrl+V)'
      })
    } catch (err: any) {
      toast.error('Не удалось создать отчёт', { description: err?.message || String(err) })
    } finally {
      setGeneratingReport(false)
    }
  }

  const handleSaveReport = async (): Promise<void> => {
    setGeneratingReport(true)
    try {
      const report = await generateDiagnosticReport()
      const blob = new Blob([report], { type: 'text/markdown' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `lazeyka-report-${Date.now()}.md`
      a.click()
      URL.revokeObjectURL(url)
      toast.success('Отчёт сохранён в файл')
    } catch (err: any) {
      toast.error('Не удалось сохранить отчёт', { description: err?.message || String(err) })
    } finally {
      setGeneratingReport(false)
    }
  }

  return (
    <BasePage
      title="Консоль логов"
      contentClassName="flex flex-col"
      header={
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            title="Скопировать отчёт для поддержки"
            aria-label="Скопировать отчёт для поддержки"
            className="cursor-pointer p-1.5 rounded-xl text-muted-foreground hover:text-emerald-700 dark:hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors"
            onClick={() => { void handleGenerateReport() }}
            disabled={generatingReport}
          >
            <ClipboardCopy className={cn('size-4', generatingReport && 'animate-spin')} />
          </button>
          <button
            type="button"
            title="Сохранить отчёт в файл"
            aria-label="Сохранить отчёт в файл"
            className="cursor-pointer p-1.5 rounded-xl text-muted-foreground hover:text-sky-700 dark:hover:text-sky-400 hover:bg-sky-500/10 transition-colors"
            onClick={() => { void handleSaveReport() }}
            disabled={generatingReport}
          >
            <Download className="size-4" />
          </button>
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
        </div>
      }
    >
      <div className="flex flex-col h-full px-4 pb-4">
        <div className="py-2.5 flex items-center gap-2 flex-wrap">
          <Input
            className="h-8.5 text-xs font-mono bg-card/60 border-border/70 rounded-xl flex-1 min-w-[150px]"
            value={filter}
            placeholder="Поиск по тексту или уровню..."
            onChange={(e) => setFilter(e.target.value)}
          />
          {(['all', 'tgws', 'zapret', 'incy', 'exitlag', 'app'] as const).map((s) => (
            <Button
              key={s}
              size="sm"
              variant={sourceFilter === s ? 'default' : 'outline'}
              onClick={() => setSourceFilter(s)}
              className={cn(
                'h-8 text-xs font-mono rounded-xl cursor-pointer transition-all uppercase',
                sourceFilter === s
                  ? 'bg-primary text-primary-foreground font-bold'
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
                ? 'bg-primary text-primary-foreground '
                : 'border-border/70 hover:bg-foreground/[0.04]'
            )}
            variant={trace ? 'default' : 'outline'}
            title="Автоскролл за новыми событиями"
            onClick={toggleTrace}
          >
            <MapPin className="size-3.5" />
          </Button>
        </div>

        {/* Report banner */}
        <div className="mb-2 flex items-center gap-2 bg-primary/5 border border-primary/20 rounded-xl px-3 py-2">
          <ClipboardCopy className="size-4 text-primary shrink-0" />
          <span className="text-xs text-foreground/80">
            Нажмите <strong>📋</strong> в правом верхнем углу — отчёт со всеми логами и статусами будет скопирован в буфер обмена для поддержки.
          </span>
        </div>

        <div className="flex-1 min-h-0 font-mono text-xs rounded-2xl border border-border/60 bg-black/40 p-2 overflow-hidden shadow-inner">
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
