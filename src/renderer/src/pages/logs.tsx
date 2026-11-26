import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso'
import { useLogsStore, formatLogTime } from '@renderer/store/logs-store'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Activity, ArrowDownToLine, ClipboardCopy, Cpu, Download, Gamepad2, Globe, Loader2, Lock, ScrollText, Search, Send, Trash2, X } from 'lucide-react'
import { EmptyState, LiveNumber, LzHero, LzPanel, Segmented, Sparkline, StatChip, type LzTone } from '@renderer/components/lz'
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
  tgws: 'text-st-info-text',
  zapret: 'text-primary',
  app: 'text-muted-foreground',
  incy: 'text-st-ok-text',
  exitlag: 'text-st-warn-text'
}

const SOURCES: { id: CoreSource; label: string; icon: React.ReactNode }[] = [
  { id: 'zapret', label: 'Zapret', icon: <Lock /> },
  { id: 'tgws', label: 'Telegram', icon: <Send /> },
  { id: 'incy', label: 'INCY', icon: <Globe /> },
  { id: 'exitlag', label: 'ExitLag', icon: <Gamepad2 /> },
  { id: 'app', label: 'Система', icon: <Cpu /> }
]
const SOURCE_NAME: Record<CoreSource, string> = { zapret: 'zapret', tgws: 'telegram', incy: 'incy', exitlag: 'exitlag', app: 'система' }

type Level = 'all' | 'problems' | 'error'
const LEVELS: { id: Level; label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'problems', label: 'С проблемами' },
  { id: 'error', label: 'Только ошибки' }
]

/** Сколько записей пришло за каждую из последних 30 минут (для мини-графика). */
function perMinute(logs: ControllerLog[], now: number): { all: number[]; bad: number[] } {
  const all = new Array(30).fill(0)
  const bad = new Array(30).fill(0)
  for (const l of logs) {
    const k = 29 - Math.floor((now - l.time) / 60000)
    if (k < 0 || k > 29) continue
    all[k]++
    if (l.type === 'error' || l.type === 'warn') bad[k]++
  }
  return { all, bad }
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
  const [level, setLevel] = useState<Level>('all')
  const [trace, setTrace] = useState(true)
  const traceRef = useRef(trace)
  const virtuosoRef = useRef<VirtuosoHandle>(null)
  const [generatingReport, setGeneratingReport] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  const filteredLogs = useMemo(() => {
    const fl = filter.toLowerCase()
    return logs.filter((log) => {
      if (sourceFilter !== 'all' && log.source !== sourceFilter) return false
      if (level === 'error' && log.type !== 'error') return false
      if (level === 'problems' && log.type !== 'error' && log.type !== 'warn') return false
      if (!fl) return true
      return log.payload.toLowerCase().includes(fl) || log.type.toLowerCase().includes(fl)
    })
  }, [logs, filter, sourceFilter, level])

  // Счётчики по каналам: всего и ошибок (по всему журналу, без учёта поиска).
  const counts = useMemo(() => {
    const c = {} as Record<CoreSource, { n: number; err: number; warn: number }>
    for (const s of SOURCES) c[s.id] = { n: 0, err: 0, warn: 0 }
    for (const l of logs) {
      const x = c[l.source]
      if (!x) continue
      x.n++
      if (l.type === 'error') x.err++
      else if (l.type === 'warn') x.warn++
    }
    return c
  }, [logs])
  const errors = SOURCES.reduce((n, s) => n + counts[s.id].err, 0)
  const lastError = useMemo(() => [...logs].reverse().find((l) => l.type === 'error'), [logs])

  // Мини-график активности: пересчитывается с новыми записями и раз в минуту, пока страница открыта.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000)
    return () => clearInterval(t)
  }, [])
  const activity = useMemo(() => perMinute(logs, now), [logs, now])

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

  const tone: LzTone = errors ? 'warn' : 'on'
  const title = logs.length === 0 ? 'Журнал пуст' : errors ? `Ошибок в журнале: ${errors}` : 'Ошибок нет'
  const text =
    logs.length === 0
      ? 'Здесь появятся сообщения Zapret, Telegram-прокси, INCY, ExitLag и самой программы. Хранятся последние 500 записей этого запуска.'
      : errors && lastError
        ? `Последняя — ${formatLogTime(lastError.time)}, ${SOURCE_NAME[lastError.source]}. Если что-то не работает, отправьте отчёт: в нём логи и состояние служб, ключи и ссылки скрыты.`
        : 'Если что-то не работает, скопируйте отчёт для поддержки: в нём логи и состояние служб, ключи и ссылки скрыты.'

  return (
    <BasePage
      title="Логи"
      contentClassName="flex flex-col"
      header={
        <Button
          variant="outline"
          size="sm"
          className="mr-1 h-8 rounded-lg text-xs"
          title="Очистить журнал этого запуска"
          onClick={() => {
            clearLogs()
            setLogs([])
          }}
        >
          <Trash2 className="size-3.5" /> Очистить
        </Button>
      }
    >
      <div className="mx-auto flex h-full w-full max-w-[1080px] flex-col lz-page-gap lz-page-x pb-5">
        <LzHero
          data-tour="logs-hero"
          tone={tone}
          className="shrink-0"
          visual={
            <div className="flex size-[88px] shrink-0 flex-col items-center justify-center rounded-full border border-foreground/[0.08] bg-foreground/[0.03]">
              <ScrollText className={cn('mb-0.5 size-4', errors ? 'text-st-warn-text' : 'text-primary')} />
              <LiveNumber value={logs.length} className="text-[24px] font-extrabold text-[color:var(--text-title)]" />
              <span className="text-[10px] text-muted-foreground">записей</span>
            </div>
          }
          title={title}
          text={text}
          actions={
            <>
              <Button size="lg" className="h-11 rounded-xl px-5 text-[14px]" disabled={generatingReport} onClick={() => void handleGenerateReport()} title="Логи и состояние служб в буфер обмена, для чата поддержки">
                {generatingReport ? <Loader2 className="size-4 animate-spin" /> : <ClipboardCopy className="size-4" />}
                Скопировать отчёт
              </Button>
              <Button variant="outline" className="h-10 rounded-xl" disabled={generatingReport} onClick={() => void handleSaveReport()}>
                <Download className="size-4" /> Сохранить в файл
              </Button>
            </>
          }
          footer={
            <div className="flex flex-wrap gap-2">
              <StatChip
                icon={<Activity />}
                tone={errors ? 'warn' : logs.length ? 'on' : 'off'}
                label="За 30 минут"
                value={`${activity.all.reduce((a, b) => a + b, 0)} записей`}
                title={`За последние 30 минут: ${activity.all.reduce((a, b) => a + b, 0)} записей, из них предупреждений и ошибок ${activity.bad.reduce((a, b) => a + b, 0)}`}
                aside={
                  <div className="h-8 w-[120px]">
                    <Sparkline a={activity.all} b={activity.bad} colorB="var(--st-warn)" floor={4} className="h-full w-full" />
                  </div>
                }
                className="min-w-[320px] flex-[2]"
              />
              {SOURCES.map((s) => {
                const c = counts[s.id]
                const on = sourceFilter === s.id
                return (
                  <StatChip
                    key={s.id}
                    icon={s.icon}
                    tone={c.err ? 'error' : c.warn ? 'warn' : c.n ? 'on' : 'off'}
                    label={s.label}
                    value={String(c.n)}
                    aside={
                      c.err ? (
                        <span className="rounded-md bg-st-err/15 px-1.5 py-px text-[10.5px] font-bold text-st-err-text tabular-nums" title={`Ошибок: ${c.err}`}>
                          {c.err}
                        </span>
                      ) : undefined
                    }
                    title={on ? 'Показать все каналы' : `Показать только ${s.label}`}
                    onClick={() => setSourceFilter(on ? 'all' : s.id)}
                    className={cn('min-w-[104px] flex-1', on && 'border-primary/50 bg-primary/10')}
                  />
                )
              })}
            </div>
          }
        />

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input className="h-9 rounded-xl pl-8 text-xs" value={filter} placeholder="Поиск по тексту или уровню" onChange={(e) => setFilter(e.target.value)} aria-label="Поиск по журналу" />
          </div>
          <Segmented items={LEVELS} value={level} onChange={setLevel} aria-label="Уровень" size="sm" className="w-[340px]" />
          {sourceFilter !== 'all' && (
            <Button size="sm" variant="ghost" className="h-9 rounded-xl text-xs" onClick={() => setSourceFilter('all')} title="Показать все каналы">
              <X className="size-3.5" /> {SOURCES.find((s) => s.id === sourceFilter)?.label}
            </Button>
          )}
          <Button
            size="sm"
            variant={trace ? 'default' : 'outline'}
            className="h-9 rounded-xl text-xs"
            title="Прокручивать к новым записям"
            aria-pressed={trace}
            onClick={toggleTrace}
          >
            <ArrowDownToLine className="size-3.5" /> {trace ? 'За новыми' : 'Пауза'}
          </Button>
        </div>

        <LzPanel data-sensitive="ip" className="min-h-[260px] flex-1 p-1.5 text-xs">
          {filteredLogs.length === 0 ? (
            <EmptyState
              icon={<ScrollText />}
              title={logs.length ? 'Под фильтр ничего не попало' : 'Записей пока нет'}
              text={logs.length ? 'Сбросьте поиск, уровень или канал.' : 'Включите Zapret, VPN или Telegram-прокси — их сообщения появятся здесь.'}
              action={
                logs.length ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setFilter('')
                      setLevel('all')
                      setSourceFilter('all')
                    }}
                  >
                    Сбросить фильтры
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <Virtuoso
              ref={virtuosoRef}
              data={filteredLogs}
              className="custom-scrollbar"
              initialTopMostItemIndex={filteredLogs.length - 1}
              followOutput={trace}
              itemContent={(_i, log) => (
                <div
                  className={cn(
                    'flex items-baseline gap-2.5 rounded-lg px-3 py-1 font-mono leading-relaxed transition-colors hover:bg-foreground/[0.04]',
                    log.type === 'error' && 'bg-st-err/[0.06]'
                  )}
                >
                  <span className="shrink-0 text-[11px] text-muted-foreground/70 tabular-nums">{formatLogTime(log.time)}</span>
                  <span className={cn('w-[68px] shrink-0 truncate text-[11px] font-semibold', sourceColor[log.source])}>{SOURCE_NAME[log.source]}</span>
                  <span
                    className={cn(
                      'w-[44px] shrink-0 text-[11px] font-bold',
                      log.type === 'error' ? 'text-st-err-text' : log.type === 'warn' ? 'text-st-warn-text' : 'text-muted-foreground/70'
                    )}
                  >
                    {log.type}
                  </span>
                  <span className="break-all whitespace-pre-wrap text-foreground/90">{log.payload}</span>
                </div>
              )}
            />
          )}
        </LzPanel>
      </div>
    </BasePage>
  )
}

export default Logs
