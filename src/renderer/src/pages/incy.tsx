import React, { useEffect, useState, useMemo, useRef } from 'react'
import { toast } from 'sonner'
import {
  Power,
  RefreshCw,
  Plus,
  Search,
  Server,
  Settings as SettingsIcon,
  Star,
  Activity,
  Lock,
  Wifi,
  BarChart2,
  Terminal,
  Link as LinkIcon,
  Copy,
  Trash2,
  Sliders,
  Clock,
  Download,
  Cpu,
  RotateCcw,
  ChevronDown,
  CheckCircle2,
  HelpCircle,
  Send,
  Split,
  Globe2,
  ShieldOff
} from 'lucide-react'
import BasePage from '@renderer/components/base/base-page'
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Badge } from '@renderer/components/ui/badge'
import { Switch } from '@renderer/components/ui/switch'
import { Label } from '@renderer/components/ui/label'
import {
  incyGetNodes,
  incySaveNodes,
  incyGetSubscription,
  incyGetSettings,
  incySaveSettings,
  incyImportInput,
  incyRefreshSubscription,
  incyGetStatus,
  incyConnect,
  incyDisconnect,
  incySelectNode,
  incySetConnectionMode,
  incySetRoutingMode,
  incyPingNode,
  incyGetLogs,
  incyClearLogs,
  incyGetStats,
  incyResetStats,
  incyExportBackup,
  incyPickBackup,
  incyApplyBackup,
  incyBackupLink,
  incyApplyRoutingProfile,
  incyDeleteRoutingProfile,
  incyCaptureRoutingProfile,
  incyGeoCategories,
  incyCheckGeoUpdate,
  type GeoCategoryInfo,
  type GeoUpdateInfo,
  type IncyBackupPreview,
  type IncyBackupParts,
  type IncyNode,
  type IncySubscription,
  type IncySettings,
  type IncyStatus,
  type IncyStats
} from '@renderer/utils/ipc'
import { useIncyStore } from '@renderer/store/incy-store'
import { cn, POWER_ON_BANNER_STYLE } from '@renderer/lib/utils'

function getFlagEmoji(name: string): string {
  const n = name.toLowerCase()
  if (n.includes('🇳🇱') || n.includes('нидерланд') || n.includes('.nl') || n.includes('nl-')) return '🇳🇱'
  if (n.includes('🇩🇪') || n.includes('германи') || n.includes('.de') || n.includes('de-') || n.includes('франкфурт')) return '🇩🇪'
  if (n.includes('🇷🇺') || n.includes('росси') || n.includes('.ru') || n.includes('ru-') || n.includes('москв')) return '🇷🇺'
  if (n.includes('🇸🇪') || n.includes('швеци') || n.includes('.se') || n.includes('se-') || n.includes('стокгольм')) return '🇸🇪'
  if (n.includes('🇫🇷') || n.includes('франци') || n.includes('.fr') || n.includes('fr-')) return '🇫🇷'
  if (n.includes('🇬🇧') || n.includes('англи') || n.includes('.gb') || n.includes('.uk')) return '🇬🇧'
  if (n.includes('🇺🇸') || n.includes('сша') || n.includes('.us')) return '🇺🇸'
  if (n.includes('🇸🇬') || n.includes('сингапур') || n.includes('.sg')) return '🇸🇬'
  if (n.includes('🇯🇵') || n.includes('япони') || n.includes('.jp')) return '🇯🇵'
  if (n.includes('🇰🇿') || n.includes('казахстан') || n.includes('.kz')) return '🇰🇿'
  if (n.includes('🇪🇺') || n.includes('авто') || n.includes('smart')) return '🇪🇺'
  return '🌐'
}

/**
 * Strips a leading emoji / flag prefix from provider-supplied labels.
 *
 * The previous pattern (`/^[\uD83C-\uDBFF\uDC00-\uDFFF\s]+/`) matched raw
 * surrogate halves as if they were standalone characters, so it also ate any
 * non-BMP character that happened to start the string \u2014 a server named with
 * CJK extension characters would come back mangled. Matching actual Unicode
 * properties under the `u` flag targets emoji, regional-indicator flag pairs,
 * variation selectors and ZWJ joiners only.
 */
const LEADING_EMOJI = /^[\p{Extended_Pictographic}\p{Regional_Indicator}\uFE0F\u200D\s]+/u

function stripLeadingEmoji(value: string): string {
  return value.replace(LEADING_EMOJI, '').trim()
}

function cleanServerName(name: string): string {
  return stripLeadingEmoji(name)
}

/**
 * Render a node's latency, telling apart the two very different meanings of a
 * null reading.
 *
 * `latencyMs === null` covers both "we never checked" and "we checked and the
 * server did not answer". Showing `n/a` for both made a freshly launched app
 * look like every server was dead. The measurement timestamp is what separates
 * them: no timestamp means no attempt was ever made.
 */
function formatLatency(node: { latencyMs: number | null; latencyAt?: number }): {
  text: string
  measured: boolean
  unreachable: boolean
} {
  if (node.latencyMs !== null) {
    return { text: `${node.latencyMs} мс`, measured: true, unreachable: false }
  }
  if (node.latencyAt) {
    return { text: 'n/a', measured: true, unreachable: true }
  }
  return { text: '—', measured: false, unreachable: false }
}

/**
 * Colour for the latency dot. An unmeasured node gets a neutral dot: a red one
 * claims the server is down, which we have no basis for before the first ping.
 */
function latencyDotClass(
  node: { latencyMs: number | null; latencyAt?: number },
  strong = false
): string {
  const good = strong ? 'bg-emerald-500' : 'bg-emerald-400'
  const mid = strong ? 'bg-amber-500' : 'bg-amber-400'
  const bad = strong ? 'bg-rose-500' : 'bg-rose-400'
  if (node.latencyMs === null) {
    return node.latencyAt ? bad : 'bg-muted-foreground/40'
  }
  if (node.latencyMs < 100) return good
  if (node.latencyMs < 250) return mid
  return bad
}

/** Quality bucket, shared by every latency renderer below. */
function latencyTier(ms: number | null): 'good' | 'mid' | 'bad' | 'none' {
  if (ms === null) return 'none'
  if (ms < 100) return 'good'
  if (ms < 250) return 'mid'
  return 'bad'
}

/**
 * Latency badge honouring the "Отображение пинга" setting.
 *
 * The four modes were saved to disk and shown in Settings but nothing read
 * them — every list rendered the number regardless. They exist because a wall
 * of three-digit numbers is hard to scan: a bar or a row of dots reads as
 * "good / so-so / bad" at a glance, which is the only question most people ask
 * of a server list.
 */
const LatencyBadge: React.FC<{
  node: { latencyMs: number | null; latencyAt?: number }
  display?: 'numbers' | 'bar' | 'both' | 'dots'
  strong?: boolean
}> = ({ node, display = 'numbers', strong = false }) => {
  const info = formatLatency(node)
  const tier = info.measured ? latencyTier(node.latencyMs) : 'none'

  const textClass =
    tier === 'good'
      ? strong
        ? 'text-emerald-700 dark:text-emerald-500 bg-emerald-500/10'
        : 'text-emerald-700 dark:text-emerald-400 bg-emerald-500/10'
      : tier === 'mid'
      ? strong
        ? 'text-amber-700 dark:text-amber-500 bg-amber-500/10'
        : 'text-amber-700 dark:text-amber-400 bg-amber-500/10'
      : tier === 'bad'
      ? strong
        ? 'text-rose-700 dark:text-rose-500 bg-rose-500/10'
        : 'text-rose-700 dark:text-rose-400 bg-rose-500/10'
      : 'text-muted-foreground bg-muted/40'

  const fillClass =
    tier === 'good'
      ? 'bg-emerald-500'
      : tier === 'mid'
      ? 'bg-amber-500'
      : tier === 'bad'
      ? 'bg-rose-500'
      : 'bg-muted-foreground/30'

  // 0 ms → full bar, 400 ms and worse → empty. Linear in between.
  const pct =
    node.latencyMs === null ? 0 : Math.max(6, Math.round(100 - Math.min(node.latencyMs, 400) / 4))
  // Four dots: one lit per 100 ms band still under the measured value.
  const litDots = node.latencyMs === null ? 0 : Math.max(1, 4 - Math.floor(Math.min(node.latencyMs, 399) / 100))

  if (display === 'dots') {
    return (
      <span
        title={info.text}
        className="flex items-center gap-[3px] px-1.5 py-0.5"
        aria-label={`Задержка: ${info.text}`}
      >
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={cn('h-1.5 w-1.5 rounded-full', i < litDots ? fillClass : 'bg-muted-foreground/20')}
          />
        ))}
      </span>
    )
  }

  if (display === 'bar' || display === 'both') {
    return (
      <span
        title={info.text}
        className="flex items-center gap-1.5 px-1 py-0.5"
        aria-label={`Задержка: ${info.text}`}
      >
        <span className="h-1.5 w-12 rounded-full bg-muted-foreground/20 overflow-hidden">
          <span className={cn('block h-full rounded-full', fillClass)} style={{ width: `${pct}%` }} />
        </span>
        {display === 'both' && (
          <span className={cn('text-[10px] font-mono px-1 py-px rounded', textClass)}>{info.text}</span>
        )}
      </span>
    )
  }

  return (
    <span
      className={cn(
        'text-[10px] font-mono px-1.5 py-0.5 rounded flex items-center gap-1',
        textClass,
        info.unreachable && 'border border-rose-500/20'
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', latencyDotClass(node, strong))} />
      {info.text}
    </span>
  )
}

/**
 * Marks a control that is saved but does not affect anything yet.
 *
 * The settings tab was modelled on INCY's, so it offers roughly fifty
 * switches — but only a subset is actually wired into the cores. A switch that
 * silently does nothing is worse than a missing one: it invites the user to
 * "fix" a connection problem by toggling something inert, and then to trust a
 * protection (Kill Switch above all) that is not there.
 *
 * `reason` says *why*, because the reasons differ and matter: some options
 * exist only in Xray, some have no equivalent in either core, some are simply
 * not implemented yet.
 */
const NotWired: React.FC<{ reason: string; label?: string }> = ({ reason, label }) => (
  <span
    title={reason}
    className="ml-2 inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-400 align-middle cursor-help"
  >
    {label ?? 'не активна'}
  </span>
)

/** Core memory reading pushed from the main process. Mirrors CoreMemoryUsage. */
interface CoreMemoryUsage {
  totalBytes: number
  perProcess: { name: string; bytes: number }[]
}

/** Bytes → "1,4 ГБ". Binary units, one decimal, Russian labels. */
function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '0 Б'
  const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${unit === 0 ? Math.round(value) : value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`
}

/** Seconds → "3 ч 07 мин" / "12 мин 05 сек" / "42 сек". */
function formatDuration(sec: number): string {
  if (!sec || sec < 0) return '0 сек'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h > 0) return `${h} ч ${String(m).padStart(2, '0')} мин`
  if (m > 0) return `${m} мин ${String(s).padStart(2, '0')} сек`
  return `${s} сек`
}

const WEEKDAYS = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ']

/** Split a `sent` / `received` pair into a two-tone proportional bar. */
const TrafficSplitBar: React.FC<{ sent: number; received: number }> = ({ sent, received }) => {
  const total = sent + received
  const sentPct = total > 0 ? (sent / total) * 100 : 50
  return (
    <div className="h-1.5 w-full rounded-full bg-muted/50 overflow-hidden flex">
      <div className="h-full bg-emerald-500" style={{ width: `${sentPct}%` }} />
      <div className="h-full bg-primary flex-1" />
    </div>
  )
}

/**
 * Statistics tab.
 *
 * Every number here now comes from `incy-stats.ts`: bytes from sing-box's
 * Clash API, duration and connection counts from the session tracker, and the
 * weekly chart from the persisted daily history. Before, the four traffic
 * fields were never written to and rendered as permanent zeroes.
 */
const StatsTab: React.FC<{
  stats: IncyStats | null
  isConnected: boolean
  onReset: (scope: 'all' | 'today') => void | Promise<void>
}> = ({ stats, isConnected, onReset }) => {
  // Last seven calendar days, oldest first, with gaps filled so the chart keeps
  // a stable shape even on days the app was never opened.
  const week = useMemo(() => {
    const byDate = new Map((stats?.history ?? []).map((d) => [d.date, d]))
    const out: { key: string; label: string; sent: number; received: number; total: number }[] = []
    for (let i = 6; i >= 0; i--) {
      const at = new Date()
      at.setDate(at.getDate() - i)
      const key = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`
      const row = byDate.get(key)
      out.push({
        key,
        label: WEEKDAYS[at.getDay()],
        sent: row?.bytesSent ?? 0,
        received: row?.bytesReceived ?? 0,
        total: (row?.bytesSent ?? 0) + (row?.bytesReceived ?? 0)
      })
    }
    return out
  }, [stats?.history])

  const peak = Math.max(1, ...week.map((d) => d.total))
  const today = week[week.length - 1]
  const totalBytes = (stats?.totalBytesSent ?? 0) + (stats?.totalBytesReceived ?? 0)

  return (
    <div className="space-y-4">
      {stats && !stats.trafficAvailable && (
        <div className="flex items-start gap-2 p-3 rounded-xl border border-amber-500/40 bg-amber-500/10 text-[11px] text-amber-800 dark:text-amber-300">
          <HelpCircle className="h-3.5 w-3.5 mt-px shrink-0" />
          <span>
            Счётчик байтов недоступен для текущего подключения — этот режим работает через ядро
            Xray, у которого нет API статистики. Время сессии и число подключений считаются.
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Card className="cyber-card">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-primary" />
                Текущая сессия
              </span>
              <Badge variant="secondary" className="text-[10px]">
                {isConnected ? 'Активна' : 'Остановлена'}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <TrafficSplitBar
              sent={stats?.sessionBytesSent ?? 0}
              received={stats?.sessionBytesReceived ?? 0}
            />
            <div className="flex items-start justify-between">
              <div>
                <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Отправлено
                </div>
                <div className="text-lg font-bold font-mono">{formatBytes(stats?.sessionBytesSent ?? 0)}</div>
              </div>
              <div className="text-right">
                <div className="text-[11px] text-muted-foreground flex items-center justify-end gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary" /> Получено
                </div>
                <div className="text-lg font-bold font-mono">
                  {formatBytes(stats?.sessionBytesReceived ?? 0)}
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between text-xs pt-1 border-t border-border/50">
              <span className="text-muted-foreground flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" /> Время подключения
              </span>
              <span className="font-mono font-bold">{formatDuration(stats?.connectedDurationSec ?? 0)}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="cyber-card">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <BarChart2 className="h-4 w-4 text-primary" />
              Всего
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <TrafficSplitBar
              sent={stats?.totalBytesSent ?? 0}
              received={stats?.totalBytesReceived ?? 0}
            />
            <div className="flex items-start justify-between">
              <div>
                <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Отправлено
                </div>
                <div className="text-lg font-bold font-mono">{formatBytes(stats?.totalBytesSent ?? 0)}</div>
              </div>
              <div className="text-right">
                <div className="text-[11px] text-muted-foreground flex items-center justify-end gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary" /> Получено
                </div>
                <div className="text-lg font-bold font-mono">
                  {formatBytes(stats?.totalBytesReceived ?? 0)}
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between text-xs pt-1 border-t border-border/50">
              <span className="text-muted-foreground flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" /> Общее время
              </span>
              <span className="font-mono font-bold">{formatDuration(stats?.totalDurationSec ?? 0)}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground flex items-center gap-1">
                <Power className="h-3.5 w-3.5" /> Подключений
              </span>
              <span className="font-mono font-bold">{stats?.connectionCount ?? 0}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="cyber-card">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2">
              <BarChart2 className="h-4 w-4 text-primary" />
              За неделю
            </span>
            <span className="text-[11px] font-normal text-muted-foreground">
              Сегодня: {formatBytes(today?.total ?? 0)}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-end justify-between gap-2 h-32 pt-2">
            {week.map((day, idx) => {
              const isToday = idx === week.length - 1
              // Minimum 3px so an empty day still reads as a day, not a gap.
              const height = day.total > 0 ? Math.max(6, Math.round((day.total / peak) * 100)) : 2
              return (
                <div key={day.key} className="flex-1 flex flex-col items-center gap-1.5 min-w-0">
                  <div
                    title={`${formatBytes(day.sent)} ↑ / ${formatBytes(day.received)} ↓`}
                    className="w-full flex flex-col justify-end"
                    style={{ height: '100%' }}
                  >
                    <div
                      className={cn(
                        'w-full rounded-t-md transition-all',
                        day.total > 0
                          ? isToday
                            ? 'bg-primary'
                            : 'bg-primary/50'
                          : 'bg-muted-foreground/20'
                      )}
                      style={{ height: `${height}%` }}
                    />
                  </div>
                  <span
                    className={cn(
                      'text-[10px] font-mono',
                      isToday ? 'text-primary font-bold' : 'text-muted-foreground'
                    )}
                  >
                    {day.label}
                  </span>
                </div>
              )
            })}
          </div>
          {totalBytes === 0 && (
            <p className="text-[11px] text-muted-foreground text-center pt-3">
              Данных пока нет — подключитесь, и трафик начнёт учитываться.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <Button variant="outline" size="sm" onClick={() => void onReset('today')} className="text-xs gap-1.5">
          <RotateCcw className="h-3.5 w-3.5" /> Сбросить за сегодня
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void onReset('all')}
          className="text-xs gap-1.5 text-destructive hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" /> Сбросить всё
        </Button>
      </div>
    </div>
  )
}

/**
 * Backup tab.
 *
 * Export now goes through a real save dialog in the main process, and — the
 * part that was simply missing — restore reads a file, shows what is in it,
 * and applies only the sections the user keeps ticked.
 */
const BackupTab: React.FC<{ onRestored: () => void | Promise<void> }> = ({ onRestored }) => {
  const [preview, setPreview] = useState<IncyBackupPreview | null>(null)
  const [parts, setParts] = useState<IncyBackupParts>({
    subscription: true,
    nodes: true,
    settings: true,
    routingRules: true
  })
  const [busy, setBusy] = useState(false)

  const handleExport = async (): Promise<void> => {
    setBusy(true)
    try {
      const res = await incyExportBackup()
      if (res.ok) toast.success(`Копия сохранена: ${res.filePath}`)
      else if (res.message !== 'Отменено') toast.error(res.message || 'Не удалось сохранить')
    } finally {
      setBusy(false)
    }
  }

  const handlePick = async (): Promise<void> => {
    setBusy(true)
    try {
      const res = await incyPickBackup()
      if (!res.ok) {
        if (res.message !== 'Отменено') toast.error(res.message || 'Файл не подошёл')
        setPreview(null)
        return
      }
      setPreview(res)
      // Pre-tick only what the file actually carries.
      setParts({
        subscription: Boolean(res.subscriptionTitle),
        nodes: (res.nodeCount ?? 0) > 0,
        settings: Boolean(res.hasSettings),
        routingRules: (res.routingRuleCount ?? 0) > 0
      })
    } finally {
      setBusy(false)
    }
  }

  const handleApply = async (): Promise<void> => {
    if (!preview?.filePath) return
    setBusy(true)
    try {
      const res = await incyApplyBackup(preview.filePath, parts)
      if (res.ok) {
        toast.success(`Восстановлено: ${res.applied.join(', ')}`)
        setPreview(null)
        await onRestored()
      } else {
        toast.error(res.message || 'Не удалось восстановить')
      }
    } finally {
      setBusy(false)
    }
  }

  const nothingSelected = !parts.subscription && !parts.nodes && !parts.settings && !parts.routingRules

  return (
    <div className="space-y-4">
      <Card className="cyber-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Download className="h-4 w-4 text-primary" />
            Создать резервную копию
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Сохранит подписку, серверы, правила маршрутизации и настройки INCY в один файл.
          </p>
          <Button size="sm" onClick={() => void handleExport()} disabled={busy} className="gap-1.5 text-xs w-full">
            <Download className="h-3.5 w-3.5" /> Экспортировать
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => {
              void incyBackupLink().then((link) => {
                navigator.clipboard.writeText(link)
                toast.success('Ссылка скопирована — её можно открыть на другом устройстве')
              })
            }}
            className="gap-1.5 text-xs w-full"
          >
            <LinkIcon className="h-3.5 w-3.5" /> Скопировать ссылку
          </Button>
        </CardContent>
      </Card>

      <Card className="cyber-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RotateCcw className="h-4 w-4 text-primary" />
            Восстановить
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Выберите файл копии. Перед применением вы увидите, что именно будет восстановлено.
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void handlePick()}
            disabled={busy}
            className="gap-1.5 text-xs w-full"
          >
            <Search className="h-3.5 w-3.5" /> Выбрать файл
          </Button>

          {preview?.ok && (
            <div className="space-y-2 pt-2 border-t border-border/50">
              <div className="text-[11px] text-muted-foreground">
                Создана{' '}
                {preview.exportedAt
                  ? new Date(preview.exportedAt).toLocaleString('ru-RU')
                  : 'неизвестно когда'}
              </div>

              {(
                [
                  {
                    key: 'subscription' as const,
                    label: 'Подписка',
                    detail: preview.subscriptionTitle || 'нет в файле',
                    available: Boolean(preview.subscriptionTitle)
                  },
                  {
                    key: 'nodes' as const,
                    label: 'Серверы',
                    detail: `${preview.nodeCount ?? 0} шт.`,
                    available: (preview.nodeCount ?? 0) > 0
                  },
                  {
                    key: 'routingRules' as const,
                    label: 'Правила маршрутизации',
                    detail: `${preview.routingRuleCount ?? 0} шт.`,
                    available: (preview.routingRuleCount ?? 0) > 0
                  },
                  {
                    key: 'settings' as const,
                    label: 'Настройки',
                    detail: preview.hasSettings ? 'есть' : 'нет в файле',
                    available: Boolean(preview.hasSettings)
                  }
                ]
              ).map((row) => (
                <div
                  key={row.key}
                  className={cn(
                    'flex items-center justify-between p-2.5 rounded-lg border border-border bg-card/40',
                    !row.available && 'opacity-50'
                  )}
                >
                  <div className="min-w-0">
                    <div className="text-xs font-semibold">{row.label}</div>
                    <div className="text-[11px] text-muted-foreground truncate">{row.detail}</div>
                  </div>
                  <Switch
                    checked={row.available && parts[row.key]}
                    disabled={!row.available}
                    onCheckedChange={(v) => setParts((p) => ({ ...p, [row.key]: v }))}
                  />
                </div>
              ))}

              <div className="flex gap-2 pt-1">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setPreview(null)}
                  className="text-xs flex-1"
                >
                  Отмена
                </Button>
                <Button
                  size="sm"
                  onClick={() => void handleApply()}
                  disabled={busy || nothingSelected}
                  className="text-xs flex-1"
                >
                  Восстановить
                </Button>
              </div>
            </div>
          )}

          <div className="flex items-start gap-2 text-[11px] text-muted-foreground pt-1">
            <HelpCircle className="h-3.5 w-3.5 mt-px shrink-0" />
            <span>
              Файл не содержит логин и пароль локального прокси — они генерируются заново на новом
              устройстве.
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

/**
 * Geo-database categories, each with its own switch.
 *
 * The routing tab used to have a single "использовать гео-базы" toggle, and
 * what those databases actually contained was invisible — you had to read
 * `incy-xray.ts` to learn that Steam goes direct and Twitch ads are forced
 * through the tunnel, and there was no way to change either. The catalogue now
 * comes from the same module the config builder reads, so the list on screen
 * is by construction the list that ships to the core.
 */
const GeoCategoriesCard: React.FC<{
  settings: IncySettings
  onUpdate: (patch: Partial<IncySettings>) => void | Promise<void>
}> = ({ settings, onUpdate }) => {
  const [catalog, setCatalog] = useState<GeoCategoryInfo[]>([])
  const [geo, setGeo] = useState<GeoUpdateInfo | null>(null)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    void incyGeoCategories().then(setCatalog).catch(() => {})
    // Cheap and cached upstream; tells the user whether these lists are even
    // on disk, which is the difference between "switched off" and "missing".
    void incyCheckGeoUpdate().then(setGeo).catch(() => {})
  }, [])

  const overrides = settings.geoCategoryOverrides ?? {}
  const enabled = (id: string): boolean => overrides[id] !== false
  const geoOn = settings.geoRoutingEnabled !== false

  const groups: { target: 'direct' | 'proxy' | 'block'; title: string; hint: string }[] = [
    { target: 'direct', title: 'Напрямую, мимо туннеля', hint: 'Быстрее и не ломает российские сервисы' },
    { target: 'proxy', title: 'Принудительно через туннель', hint: 'То, что режут провайдеры' },
    { target: 'block', title: 'Блокировать', hint: 'Запросы никуда не уходят' }
  ]

  const dotClass = (t: 'direct' | 'proxy' | 'block'): string =>
    t === 'direct' ? 'bg-emerald-500' : t === 'proxy' ? 'bg-primary' : 'bg-rose-500'

  const offCount = catalog.filter((c) => !enabled(c.id)).length
  const shown = expanded ? catalog : catalog.filter((c) => c.essential || !enabled(c.id))

  return (
    <Card className="cyber-card">
      <CardHeader className="flex flex-row items-start justify-between space-y-0 gap-3">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            <Globe2 className="h-4 w-4 text-primary" />
            Гео-списки маршрутизации
          </CardTitle>
          <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
            Курируемые базы RoscomVPN: {geo?.databases.map((d) => d.fileName).join(' + ') || 'geoip.dat + geosite.dat'}.
            Обновляются автоматически. Каждую категорию можно выключить отдельно.
          </p>
        </div>
        <Switch
          checked={geoOn}
          onCheckedChange={(v) => { void onUpdate({ geoRoutingEnabled: v }) }}
        />
      </CardHeader>

      <CardContent className={cn('space-y-3', !geoOn && 'opacity-50 pointer-events-none')}>
        {geo?.missing && (
          <div className="flex items-start gap-2 p-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 text-[11px] text-amber-800 dark:text-amber-300">
            <HelpCircle className="h-3.5 w-3.5 mt-px shrink-0" />
            <span>
              Файлы баз пока не скачаны — правила ниже не применяются. Они загрузятся сами при
              следующей проверке обновлений.
            </span>
          </div>
        )}

        {geo?.databases.map((d) => (
          <div key={d.id} className="flex items-center justify-between text-[11px]">
            <span className="font-mono text-muted-foreground">{d.fileName}</span>
            <span className="flex items-center gap-2">
              {d.sizeBytes ? (
                <span className="text-muted-foreground">{formatBytes(d.sizeBytes)}</span>
              ) : null}
              <Badge variant="secondary" className="text-[9px] px-1.5 py-0 font-mono opacity-70">
                {d.installedTag || (d.present ? 'из комплекта' : 'нет файла')}
              </Badge>
            </span>
          </div>
        ))}

        {groups.map((g) => {
          const rows = shown.filter((c) => c.target === g.target)
          if (rows.length === 0) return null
          return (
            <div key={g.target} className="space-y-1.5 pt-2 border-t border-border/40">
              <div className="flex items-center gap-2">
                <span className={cn('h-1.5 w-1.5 rounded-full', dotClass(g.target))} />
                <span className="text-xs font-bold">{g.title}</span>
                <span className="text-[10px] text-muted-foreground">— {g.hint}</span>
              </div>
              {rows.map((c) => (
                <div
                  key={c.id}
                  className={cn(
                    'flex items-center justify-between gap-3 p-2 rounded-lg border transition',
                    enabled(c.id) ? 'border-border/60 bg-card/40' : 'border-border/40 opacity-60'
                  )}
                >
                  <div className="min-w-0">
                    <div className="text-xs font-medium flex items-center gap-1.5">
                      {c.label}
                      {c.essential && (
                        <Badge variant="secondary" className="text-[9px] px-1 py-0 opacity-60">
                          базовая
                        </Badge>
                      )}
                    </div>
                    <div className="text-[10px] text-muted-foreground truncate">{c.hint}</div>
                    <div className="text-[9px] font-mono text-muted-foreground/60">{c.id}</div>
                  </div>
                  <Switch
                    checked={enabled(c.id)}
                    onCheckedChange={(v) => {
                      // Only the deviations are stored, so the defaults can
                      // change in a future release without being frozen into
                      // every existing settings file.
                      const next = { ...overrides }
                      if (v) delete next[c.id]
                      else next[c.id] = false
                      void onUpdate({ geoCategoryOverrides: next })
                    }}
                  />
                </div>
              ))}
            </div>
          )
        })}

        <div className="flex items-center justify-between pt-2 border-t border-border/40">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-[11px] text-primary hover:underline cursor-pointer"
          >
            {expanded
              ? 'Свернуть'
              : `Показать все категории (${catalog.length})${offCount > 0 ? ` · выключено: ${offCount}` : ''}`}
          </button>
          {offCount > 0 && (
            <button
              onClick={() => { void onUpdate({ geoCategoryOverrides: {} }) }}
              className="text-[11px] text-muted-foreground hover:text-foreground cursor-pointer"
            >
              Вернуть по умолчанию
            </button>
          )}
        </div>

        <p className="text-[11px] text-muted-foreground/80">
          Списки применяются на ядре Xray. Если ядро не примет какую-то категорию, набор правил сам
          сузится до базового — соединение не разорвётся.
        </p>
      </CardContent>
    </Card>
  )
}

/**
 * Named routing profiles.
 *
 * Each profile freezes a mode, the geo-database switch and the custom rule
 * list together, so "everything through the tunnel" and "split tunnelling
 * with my own exceptions" are one click apart instead of a manual rebuild of
 * the rule list.
 *
 * Activation writes the profile's three values into the settings the config
 * builder already reads, so no new shape ever reaches the core.
 */
const RoutingProfiles: React.FC<{
  settings: IncySettings
  onChanged: () => void | Promise<void>
  onStatus: (s: IncyStatus) => void
}> = ({ settings, onChanged, onStatus }) => {
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const profiles = settings.routingProfileList ?? []
  const activeId = settings.activeRoutingProfileId ?? ''

  const modeLabel = (m: 'bypass-ru' | 'global' | 'direct'): string =>
    m === 'bypass-ru' ? 'Раздельно' : m === 'global' ? 'Глобально' : 'Напрямую'

  const modeIcon = (m: 'bypass-ru' | 'global' | 'direct'): React.ReactElement =>
    m === 'bypass-ru' ? (
      <Split className="size-4" />
    ) : m === 'global' ? (
      <Globe2 className="size-4" />
    ) : (
      <ShieldOff className="size-4" />
    )

  const modeBadgeClass = (m: 'bypass-ru' | 'global' | 'direct'): string =>
    m === 'global'
      ? 'border-primary/40 text-primary bg-primary/10'
      : m === 'bypass-ru'
      ? 'border-amber-500/40 text-amber-700 dark:text-amber-400 bg-amber-500/10'
      : 'border-emerald-500/40 text-emerald-700 dark:text-emerald-400 bg-emerald-500/10'

  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    try {
      await fn()
      await onChanged()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="cyber-card">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2">
          <Sliders className="h-4 w-4 text-primary" />
          Профили маршрутизации
        </CardTitle>
        <span className="text-[11px] text-muted-foreground font-mono">{profiles.length}</span>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Профиль запоминает режим, гео-базы и все свои правила разом. Переключение применяется
          сразу — если туннель поднят, он переподключится с новыми правилами.
        </p>

        {profiles.map((p) => {
          const active = p.id === activeId
          return (
            <div
              key={p.id}
              className={cn(
                'flex items-center gap-3 p-3 rounded-xl border transition-all',
                active
                  ? 'border-primary/60 bg-primary/10 shadow-[0_0_16px_-4px_rgba(99,102,241,0.3)]'
                  : 'border-border/60 bg-card/40 hover:bg-foreground/[0.04]'
              )}
            >
              <button
                onClick={() => {
                  if (active || busy) return
                  void run(async () => {
                    const st = await incyApplyRoutingProfile(p.id)
                    onStatus(st)
                    toast.success(`Профиль: ${p.name}`)
                  })
                }}
                disabled={busy}
                className="flex items-center gap-3 min-w-0 flex-1 text-left cursor-pointer disabled:cursor-default"
              >
                <span
                  className={cn(
                    'h-5 w-5 rounded-full border-2 shrink-0 flex items-center justify-center',
                    active ? 'border-primary bg-primary' : 'border-muted-foreground/40'
                  )}
                >
                  {active && <CheckCircle2 className="h-3.5 w-3.5 text-primary-foreground" />}
                </span>
                <span className={cn('shrink-0', active ? 'text-primary' : 'text-muted-foreground')}>
                  {modeIcon(p.mode)}
                </span>
                <span className="min-w-0">
                  <span className={cn('block text-sm font-bold', active && 'text-primary')}>
                    {p.name}
                  </span>
                  {p.description && (
                    <span className="block text-[11px] text-muted-foreground leading-relaxed mt-0.5">
                      {p.description}
                    </span>
                  )}
                  <span className="flex items-center gap-1.5 mt-1.5">
                    {/* Для встроенных профилей режим — это и есть их название,
                        бейдж просто повторял бы заголовок. У своих профилей имя
                        произвольное, поэтому режим нужно показать явно. */}
                    {!p.builtin && (
                      <Badge
                        variant="outline"
                        className={cn('text-[9px] px-1.5 py-0', modeBadgeClass(p.mode))}
                      >
                        {modeLabel(p.mode)}
                      </Badge>
                    )}
                    {p.geoRouting && (
                      <Badge variant="secondary" className="text-[9px] px-1.5 py-0 opacity-70">
                        гео-списки
                      </Badge>
                    )}
                    {p.rules.length > 0 && (
                      <Badge variant="secondary" className="text-[9px] px-1.5 py-0 opacity-70">
                        {p.rules.length} правил
                      </Badge>
                    )}
                    {p.builtin && (
                      <Badge variant="secondary" className="text-[9px] px-1.5 py-0 opacity-50">
                        встроенный
                      </Badge>
                    )}
                  </span>
                </span>
              </button>

              {!p.builtin && (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    void run(async () => {
                      await incyDeleteRoutingProfile(p.id)
                      toast.success(`Профиль «${p.name}» удалён`)
                    })
                  }}
                  className="text-muted-foreground hover:text-destructive shrink-0"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          )
        })}

        {!activeId && (
          <p className="text-[11px] text-amber-700 dark:text-amber-300/90">
            Текущие настройки изменены вручную и не совпадают ни с одним профилем — сохраните их
            как новый, чтобы вернуться к ним позже.
          </p>
        )}

        <div className="flex gap-2 pt-2 border-t border-border/40">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || !newName.trim()) return
              void run(async () => {
                await incyCaptureRoutingProfile(newName)
                toast.success(`Профиль «${newName}» сохранён`)
                setNewName('')
              })
            }}
            placeholder="Название нового профиля"
            className="text-xs"
          />
          <Button
            size="sm"
            disabled={busy || !newName.trim()}
            onClick={() => {
              void run(async () => {
                await incyCaptureRoutingProfile(newName)
                toast.success(`Профиль «${newName}» сохранён`)
                setNewName('')
              })
            }}
            className="gap-1.5 text-xs shrink-0"
          >
            <Plus className="h-3.5 w-3.5" /> Сохранить текущие
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * URL-схемы tab.
 *
 * Every command here is handled by `src/main/core/deeplink.ts` against the
 * `lazeyka://` scheme the app registers at startup. The page used to advertise
 * `incy://…` links, which belong to a different application and did nothing.
 *
 * The "Проверить" button opens the link through the OS, which is the same path
 * a shortcut or a browser takes — so the button proves the registration works
 * rather than calling the IPC directly and only pretending to.
 */
const UrlSchemesTab: React.FC = () => {
  const groups: {
    title: string
    items: { cmd: string; desc: string; runnable?: boolean }[]
  }[] = [
    {
      title: 'Подключение',
      items: [
        { cmd: 'lazeyka://connect', desc: 'Начать VPN-соединение', runnable: true },
        { cmd: 'lazeyka://open', desc: 'То же самое (алиас)', runnable: true }
      ]
    },
    {
      title: 'Отключение',
      items: [
        { cmd: 'lazeyka://disconnect', desc: 'Остановить VPN-соединение', runnable: true },
        { cmd: 'lazeyka://close', desc: 'То же самое (алиас)', runnable: true }
      ]
    },
    {
      title: 'Переключение',
      items: [{ cmd: 'lazeyka://toggle', desc: 'Вкл/Выкл VPN', runnable: true }]
    },
    {
      title: 'Добавление конфигурации',
      items: [
        {
          cmd: 'lazeyka://import/{base64}',
          desc: 'Подписка, ссылка vless:// или целый конфиг — определяется автоматически'
        },
        { cmd: 'lazeyka://add/{url}', desc: 'Добавить конфиг по прямому URL' }
      ]
    },
    {
      title: 'Маршрутизация',
      items: [
        {
          cmd: 'lazeyka://routing/add/{base64}',
          desc: 'Добавить правила к текущим. Внутри — JSON-массив или строки вида «youtube.com proxy»'
        },
        {
          cmd: 'lazeyka://routing/oneadd/{base64}',
          desc: 'Заменить все правила на переданные'
        }
      ]
    }
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 p-3 rounded-xl border border-border bg-card/40 text-[11px] text-muted-foreground">
        <HelpCircle className="h-3.5 w-3.5 mt-px shrink-0 text-primary" />
        <span>
          Схема <span className="font-mono text-primary">lazeyka://</span> регистрируется при
          запуске приложения. Команды можно открывать из браузера, ярлыка на рабочем столе или
          любого скрипта — приложение поднимется и выполнит их.
        </span>
      </div>

      {groups.map((group) => (
        <Card key={group.title} className="cyber-card">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <LinkIcon className="h-4 w-4 text-primary" />
              {group.title}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {group.items.map((item) => (
              <div
                key={item.cmd}
                className="flex items-center justify-between gap-2 p-2.5 rounded-lg border border-border bg-card/40 text-xs"
              >
                <div className="min-w-0">
                  <div className="font-mono text-primary font-bold break-all">{item.cmd}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">{item.desc}</div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {item.runnable && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-[11px] h-7"
                      onClick={() => {
                        // Goes out through the OS, exactly like a shortcut
                        // would — if this works, the scheme is registered.
                        window.open(item.cmd, '_self')
                        toast.info(`Команда отправлена: ${item.cmd}`)
                      }}
                    >
                      Проверить
                    </Button>
                  )}
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => {
                      navigator.clipboard.writeText(item.cmd)
                      toast.success('Скопировано в буфер обмена')
                    }}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

/**
 * Guards the launch ping sweep so it runs once per app session rather than on
 * every visit to the INCY tab. Module scope, not a ref: the page unmounts when
 * the user navigates away, and a ref would reset with it.
 */
let launchPingDone = false

export default function IncyPage(): React.ReactElement {
  const [activeTab, setActiveTab] = useState<
    'main' | 'servers' | 'routing' | 'settings' | 'stats' | 'logs' | 'backup' | 'urls'
  >('main')
  const [nodes, setNodes] = useState<IncyNode[]>([])
  const [subscription, setSubscription] = useState<IncySubscription | null>(null)
  const [settings, setSettings] = useState<IncySettings | null>(null)
  const storeStatus = useIncyStore((s) => s.status)
  const [status, setStatus] = useState<IncyStatus>(storeStatus)
  const [stats, setStats] = useState<IncyStats | null>(null)
  const [logs, setLogs] = useState<string[]>([])

  useEffect(() => {
    setStatus(storeStatus)
  }, [storeStatus])

  const [inputUrl, setInputUrl] = useState('')
  const [loadingImport, setLoadingImport] = useState(false)
  const [loadingRefresh, setLoadingRefresh] = useState(false)
  const [testingPings, setTestingPings] = useState(false)
  const [pingingNodeIds, setPingingNodeIds] = useState<Set<string>>(new Set())
  const [coreMemory, setCoreMemory] = useState<CoreMemoryUsage | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [protocolFilter, setProtocolFilter] = useState<'all' | 'vless' | 'hysteria2'>('all')
  const [showServerSelectModal, setShowServerSelectModal] = useState(false)

  const logEndRef = useRef<HTMLDivElement>(null)

  const loadData = async (): Promise<void> => {
    try {
      const [n, s, sub, st, stData, lgs] = await Promise.all([
        incyGetNodes(),
        incyGetSettings(),
        incyGetSubscription(),
        incyGetStatus(),
        incyGetStats(),
        incyGetLogs()
      ])
      setNodes(n)
      setSettings(s)
      if (sub) setSubscription(sub)
      setStatus(st)
      setStats(stData)
      setLogs(lgs)
    } catch { /* ignore */ }
  }

  useEffect(() => {
    void loadData()
    const timer = setInterval(() => {
      if (document.visibilityState === 'hidden') return
      // Also refresh while stopped when the Statistics tab is open: the totals
      // and the weekly chart are persisted, so they are worth showing (and
      // updating after a reset) even with the tunnel down.
      if (status.state === 'running' || activeTab === 'stats') {
        void incyGetStats().then(setStats).catch(() => {})
      }
      if (activeTab === 'logs') {
        void incyGetLogs().then(setLogs).catch(() => {})
      }
    }, 3000)
    return () => clearInterval(timer)
  }, [activeTab, status.state])

  // "Монитор памяти": the main process measures the cores' RSS and pushes it
  // here every 5 s while the switch is on and a tunnel is up.
  useEffect(() => {
    window.electron.ipcRenderer.on('incy:memory', (_e: unknown, usage: CoreMemoryUsage) => {
      setCoreMemory(usage)
    })
    return () => {
      window.electron.ipcRenderer.removeAllListeners('incy:memory')
    }
  }, [])

  // Stale readings must not linger: once the tunnel stops or the switch is
  // turned off, no more pushes arrive and the last value would freeze on screen.
  useEffect(() => {
    if (status.state !== 'running' || !settings?.memoryMonitor) setCoreMemory(null)
  }, [status.state, settings?.memoryMonitor])

  // A `lazeyka://import/…` or `lazeyka://routing/…` link changes data behind
  // the UI's back. The main process announces it; without this the new servers
  // would only appear after switching tabs.
  useEffect(() => {
    window.electron.ipcRenderer.on('incy:dataChanged', () => {
      void loadData()
    })
    return () => {
      window.electron.ipcRenderer.removeAllListeners('incy:dataChanged')
    }
  }, [])

  /**
   * Read the clipboard and import whatever is in it, in one press.
   *
   * The import field expected a paste and then a second click, which is one
   * step too many for the usual flow: the link is copied from the provider's
   * bot and brought straight here. On failure the text still lands in the
   * field, so nothing is lost and the user can fix it by hand.
   */
  const handlePasteImport = async (): Promise<void> => {
    let text = ''
    try {
      text = (await navigator.clipboard.readText()).trim()
    } catch {
      toast.error('Не удалось прочитать буфер обмена', {
        description: 'Вставьте ссылку в поле вручную (Ctrl+V).'
      })
      return
    }
    if (!text) {
      toast.info('Буфер обмена пуст')
      return
    }
    setInputUrl(text)
    await handleImport(text)
  }

  const handleImport = async (override?: string): Promise<void> => {
    const payload = (override ?? inputUrl).trim()
    if (!payload) return
    setLoadingImport(true)
    try {
      const res = await incyImportInput(payload)
      setNodes(res.nodes)
      if (res.subscription) setSubscription(res.subscription)
      setInputUrl('')
      toast.success(`Импортировано серверов: ${res.addedCount}`, { style: POWER_ON_BANNER_STYLE })
      void handlePingAll(res.nodes)
    } catch (e: any) {
      toast.error('Ошибка импорта', { description: e?.message || String(e) })
    } finally {
      setLoadingImport(false)
    }
  }

  const handleRefreshSubscription = async (): Promise<void> => {
    setLoadingRefresh(true)
    try {
      const res = await incyRefreshSubscription()
      setNodes(res.nodes)
      if (res.subscription) setSubscription(res.subscription)
      toast.success('Подписка успешно обновлена', { style: POWER_ON_BANNER_STYLE })
      if (settings?.pingOnUpdateSubscription) {
        void handlePingAll(res.nodes)
      }
    } catch (e: any) {
      toast.error('Не удалось обновить подписку', { description: e?.message || String(e) })
    } finally {
      setLoadingRefresh(false)
    }
  }

  const handleConnect = async (nodeId?: string): Promise<void> => {
    const targetId = nodeId || status.selectedNodeId || nodes[0]?.id
    if (!targetId) {
      toast.info('Сначала добавьте подписку или сервера на вкладке «Сервера»')
      return
    }
    // Flip the button into its busy look before the IPC round trip, so the
    // press registers visually straight away.
    setPendingAction('connect')
    try {
      const next = await incyConnect(targetId)
      setStatus(next)
      toast.success('INCY подключен', { style: POWER_ON_BANNER_STYLE })
    } catch (e: any) {
      toast.error('Ошибка подключения', { description: e?.message || String(e) })
    } finally {
      setPendingAction(null)
    }
  }

  const handleDisconnect = async (): Promise<void> => {
    setPendingAction('disconnect')
    try {
      const next = await incyDisconnect()
      setStatus(next)
      toast.success('INCY отключен')
    } catch (e: any) {
      toast.error('Ошибка отключения', { description: e?.message || String(e) })
    } finally {
      setPendingAction(null)
    }
  }

  const handleSelectNode = async (nodeId: string): Promise<void> => {
    try {
      const next = await incySelectNode(nodeId)
      setStatus(next)
      setShowServerSelectModal(false)
      const target = nodes.find((n) => n.id === nodeId)
      toast.success(`Выбран сервер: ${target?.name || 'Сервер'}`)
      if (status.state === 'running') {
        void handleConnect(nodeId)
      }
    } catch { /* ignore */ }
  }

  const handleSetConnectionMode = async (mode: 'tun' | 'system_proxy' | 'only_proxy'): Promise<void> => {
    try {
      const next = await incySetConnectionMode(mode)
      setStatus(next)
      const label = mode === 'tun' ? 'TUN Режим' : mode === 'system_proxy' ? 'Системный прокси' : 'Только прокси'
      toast.success(`Режим соединения: ${label}`)
    } catch { /* ignore */ }
  }

  useEffect(() => {
    if (settings?.disableFontSmoothing) {
      document.documentElement.classList.add('no-font-smoothing')
    } else {
      document.documentElement.classList.remove('no-font-smoothing')
    }
  }, [settings?.disableFontSmoothing])

  const handlePingAll = async (targetNodes = nodes): Promise<void> => {
    if (!targetNodes.length || testingPings) return
    setTestingPings(true)
    const allIds = new Set(targetNodes.map((n) => n.id))
    setPingingNodeIds(allIds)
    const updated = [...targetNodes]
    try {
      let idx = 0
      const worker = async (): Promise<void> => {
        while (idx < updated.length) {
          const cur = idx++
          const node = updated[cur]
          const lat = await incyPingNode(node, (settings?.pingTimeoutSec || 3) * 1000)
          updated[cur] = { ...node, latencyMs: lat }
          setNodes([...updated])
          setPingingNodeIds((prev) => {
            const next = new Set(prev)
            next.delete(node.id)
            return next
          })
        }
      }
      await Promise.all(Array.from({ length: 5 }, worker))
      await incySaveNodes(updated)
      toast.success('Замер задержки серверов завершён')
    } catch { /* ignore */ } finally {
      setPingingNodeIds(new Set())
      setTestingPings(false)
    }
  }

  /**
   * Measure latency once after launch.
   *
   * `pingOnLaunch` shipped enabled but was never implemented, so the server
   * list opened with no readings at all. Combined with dropping stale
   * cross-session pings, that left every node showing a dash until the user
   * found the ping button. Sweeping once on the first visit gives real numbers
   * without ever showing yesterday's.
   *
   * Only runs when nothing has been measured yet, so it never fights a sweep
   * the user started themselves.
   */
  useEffect(() => {
    if (launchPingDone) return
    if (!settings || settings.pingOnLaunch === false) return
    if (nodes.length === 0) return
    if (nodes.some((n) => n.latencyMs !== null)) return
    launchPingDone = true
    const t = setTimeout(() => { void handlePingAll(nodes) }, 400)
    return () => clearTimeout(t)
    // Depends only on "are there nodes yet" and the setting — re-running on
    // every `nodes` identity change would restart the sweep as its own results
    // come in.
  }, [nodes.length, settings?.pingOnLaunch])

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
    const container = document.querySelector('main')
    if (container) container.scrollTo({ top: 0, behavior: 'instant' })
  }, [activeTab])

  /**
   * `silent` suppresses the confirmation toast. Routing rules are edited in
   * bursts — toggling four of them would otherwise stack four identical
   * "settings saved" toasts over the list being edited.
   */
  const handleUpdateSettings = async (
    patch: Partial<IncySettings>,
    silent = false
  ): Promise<void> => {
    if (!settings) return
    const next = { ...settings, ...patch }
    setSettings(next)
    await incySaveSettings(next)
    if (patch.connectionStyle) {
      window.scrollTo({ top: 0, behavior: 'instant' })
      const container = document.querySelector('main')
      if (container) container.scrollTo({ top: 0, behavior: 'instant' })
    }
    if (!silent) toast.success('Настройки INCY сохранены')
  }

  // ---- Custom routing rules ------------------------------------------------
  const [newRuleValue, setNewRuleValue] = useState('')
  const [newRuleAction, setNewRuleAction] = useState<'direct' | 'proxy' | 'block'>('direct')

  const addRoutingRule = async (): Promise<void> => {
    const value = newRuleValue.trim().toLowerCase()
    if (!value || !settings) return
    const existing = settings.customRoutingRules ?? []
    if (existing.some((r) => r.value.toLowerCase() === value)) {
      toast.info('Такое правило уже есть')
      return
    }
    await handleUpdateSettings({
      customRoutingRules: [
        ...existing,
        { id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, value, action: newRuleAction, enabled: true }
      ]
    }, true)
    setNewRuleValue('')
  }

  const updateRoutingRule = async (
    id: string,
    patch: Partial<{ action: 'direct' | 'proxy' | 'block'; enabled: boolean }>
  ): Promise<void> => {
    if (!settings) return
    await handleUpdateSettings({
      customRoutingRules: (settings.customRoutingRules ?? []).map((r) =>
        r.id === id ? { ...r, ...patch } : r
      )
    }, true)
  }

  const removeRoutingRule = async (id: string): Promise<void> => {
    if (!settings) return
    await handleUpdateSettings({
      customRoutingRules: (settings.customRoutingRules ?? []).filter((r) => r.id !== id)
    }, true)
  }

  const handleCopyLogs = (): void => {
    navigator.clipboard.writeText(logs.join('\n'))
    toast.success('Логи скопированы в буфер обмена')
  }

  const handleClearLogs = async (): Promise<void> => {
    await incyClearLogs()
    setLogs([])
    toast.success('Логи очищены')
  }

  const handleExportLogs = (): void => {
    const blob = new Blob([logs.join('\n')], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `incy-logs-${Date.now()}.txt`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('Файл логов сохранён')
  }

  const handleResetStats = async (scope: 'all' | 'today' = 'all'): Promise<void> => {
    const res = await incyResetStats(scope)
    setStats(res)
    toast.success(scope === 'today' ? 'Статистика за сегодня сброшена' : 'Статистика сброшена')
  }

  const handleResetSocksAuth = (): void => {
    const user = `incy_${Math.random().toString(36).slice(2, 8)}`
    const pass = Math.random().toString(36).slice(2, 12)
    void handleUpdateSettings({ socksUser: user, socksPass: pass })
    toast.success('Сгенерированы новые логин и пароль SOCKS5')
  }

  const activeOrSelectedNode = useMemo(() => {
    const targetId = status.activeNodeId || status.selectedNodeId || nodes[0]?.id
    return nodes.find((n) => n.id === targetId) || nodes[0] || null
  }, [nodes, status.activeNodeId, status.selectedNodeId])

  const sortedNodes = useMemo(() => {
    const list = [...nodes]
    if (settings?.sortServersBy === 'ping') {
      list.sort((a, b) => (a.latencyMs ?? 9999) - (b.latencyMs ?? 9999))
    } else if (settings?.sortServersBy === 'name') {
      list.sort((a, b) => a.name.localeCompare(b.name))
    }
    return list
  }, [nodes, settings?.sortServersBy])

  const filteredNodes = useMemo(() => {
    return sortedNodes.filter((n) => {
      if (protocolFilter !== 'all' && n.protocol !== protocolFilter) return false
      if (!searchQuery.trim()) return true
      const q = searchQuery.toLowerCase()
      return (
        n.name.toLowerCase().includes(q) ||
        (n.description && n.description.toLowerCase().includes(q)) ||
        n.server.toLowerCase().includes(q) ||
        n.protocol.toLowerCase().includes(q)
      )
    })
  }, [sortedNodes, protocolFilter, searchQuery])

  const isConnected = status.state === 'running'
  const hasError = status.state === 'error'

  /**
   * Local "busy" flag.
   *
   * The backend now broadcasts `connecting`, but the click→IPC→broadcast round
   * trip still leaves a visible gap where the button would look unchanged.
   * Flipping this optimistically on click closes that gap; the backend state
   * takes over as soon as it arrives.
   */
  const [pendingAction, setPendingAction] = useState<null | 'connect' | 'disconnect'>(null)
  const isBusy = pendingAction !== null || status.state === 'connecting'

  // Seconds spent waiting. Reset whenever the busy phase starts or ends.
  const [busySeconds, setBusySeconds] = useState(0)
  useEffect(() => {
    if (!isBusy) {
      setBusySeconds(0)
      return
    }
    const started = Date.now()
    const id = setInterval(() => {
      setBusySeconds(Math.floor((Date.now() - started) / 1000))
    }, 250)
    return () => clearInterval(id)
  }, [isBusy])

  // Clear the optimistic flag once the backend reports a settled state.
  useEffect(() => {
    if (status.state === 'running' || status.state === 'stopped' || status.state === 'error') {
      setPendingAction(null)
    }
  }, [status.state])

  const busyLabel = pendingAction === 'disconnect' ? 'Отключение' : 'Подключение'

  /**
   * Rough phase hint driven by elapsed time. The engine does not report
   * sub-steps, but the durations are known and stable: config generation and
   * `sing-box check` land well under a second, core startup is verified at
   * ~0.8 s, and anything past ~8 s means the server itself is not answering.
   * Saying so is far more useful than a static "please wait".
   */
  const busyHint =
    pendingAction === 'disconnect'
      ? 'Останавливаем туннель и снимаем системный прокси…'
      : busySeconds < 1
        ? 'Собираем конфигурацию и проверяем её ядром…'
        : busySeconds < 3
          ? 'Запускаем ядро и поднимаем туннель…'
          : busySeconds < 8
            ? 'Ожидаем ответ сервера…'
            : 'Сервер не отвечает — возможно, узел недоступен. Можно выбрать другой.'

  return (
    <BasePage title="INCY Proxy Engine">
      <div className="px-4 pb-6 space-y-4">
        {/* Navigation Tabs Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/40 pb-3">
          <div className="flex flex-wrap items-center gap-1 bg-card/60 backdrop-blur-xl p-1 rounded-xl border border-border/60">
            <Button
              size="sm"
              variant={activeTab === 'main' ? 'default' : 'ghost'}
              onClick={() => setActiveTab('main')}
              className={cn(
                'gap-1.5 text-xs h-7.5 rounded-lg font-semibold transition-all',
                activeTab === 'main' && 'bg-primary text-primary-foreground shadow-[0_0_12px_rgba(99,102,241,0.3)]'
              )}
            >
              <Power className="size-3.5" />
              Главная
            </Button>
            <Button
              size="sm"
              variant={activeTab === 'servers' ? 'default' : 'ghost'}
              onClick={() => setActiveTab('servers')}
              className={cn(
                'gap-1.5 text-xs h-7.5 rounded-lg font-semibold transition-all',
                activeTab === 'servers' && 'bg-primary text-primary-foreground shadow-[0_0_12px_rgba(99,102,241,0.3)]'
              )}
            >
              <Server className="size-3.5" />
              Сервера
              {nodes.length > 0 && (
                <Badge variant="secondary" className="px-1.5 py-0 text-[10px] ml-1 font-mono">
                  {nodes.length}
                </Badge>
              )}
            </Button>
            <Button
              size="sm"
              variant={activeTab === 'routing' ? 'default' : 'ghost'}
              onClick={() => setActiveTab('routing')}
              className={cn(
                'gap-1.5 text-xs h-7.5 rounded-lg font-semibold transition-all',
                activeTab === 'routing' && 'bg-primary text-primary-foreground shadow-[0_0_12px_rgba(99,102,241,0.3)]'
              )}
            >
              <Split className="size-3.5" />
              Маршрутизация
              {(settings?.customRoutingRules?.length ?? 0) > 0 && (
                <Badge variant="secondary" className="px-1.5 py-0 text-[10px] ml-1 font-mono">
                  {settings?.customRoutingRules?.length}
                </Badge>
              )}
            </Button>
            <Button
              size="sm"
              variant={activeTab === 'settings' ? 'default' : 'ghost'}
              onClick={() => setActiveTab('settings')}
              className={cn(
                'gap-1.5 text-xs h-7.5 rounded-lg font-semibold transition-all',
                activeTab === 'settings' && 'bg-primary text-primary-foreground shadow-[0_0_12px_rgba(99,102,241,0.3)]'
              )}
            >
              <SettingsIcon className="size-3.5" />
              Настройки
            </Button>
            <Button
              size="sm"
              variant={activeTab === 'stats' ? 'default' : 'ghost'}
              onClick={() => setActiveTab('stats')}
              className={cn(
                'gap-1.5 text-xs h-7.5 rounded-lg font-semibold transition-all',
                activeTab === 'stats' && 'bg-primary text-primary-foreground shadow-[0_0_12px_rgba(99,102,241,0.3)]'
              )}
            >
              <BarChart2 className="size-3.5" />
              Статистика
            </Button>
            <Button
              size="sm"
              variant={activeTab === 'logs' ? 'default' : 'ghost'}
              onClick={() => setActiveTab('logs')}
              className={cn(
                'gap-1.5 text-xs h-7.5 rounded-lg font-semibold transition-all',
                activeTab === 'logs' && 'bg-primary text-primary-foreground shadow-[0_0_12px_rgba(99,102,241,0.3)]'
              )}
            >
              <Terminal className="size-3.5" />
              Логи
            </Button>
            <Button
              size="sm"
              variant={activeTab === 'backup' ? 'default' : 'ghost'}
              onClick={() => setActiveTab('backup')}
              className={cn(
                'gap-1.5 text-xs h-7.5 rounded-lg font-semibold transition-all',
                activeTab === 'backup' && 'bg-primary text-primary-foreground shadow-[0_0_12px_rgba(99,102,241,0.3)]'
              )}
            >
              <Download className="size-3.5" />
              Бэкап
            </Button>
            <Button
              size="sm"
              variant={activeTab === 'urls' ? 'default' : 'ghost'}
              onClick={() => setActiveTab('urls')}
              className={cn(
                'gap-1.5 text-xs h-7.5 rounded-lg font-semibold transition-all',
                activeTab === 'urls' && 'bg-primary text-primary-foreground shadow-[0_0_12px_rgba(99,102,241,0.3)]'
              )}
            >
              <LinkIcon className="size-3.5" />
              URL-схемы
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <div
              className={cn(
                'inline-flex items-center gap-2 text-xs font-mono font-semibold py-1 px-3 rounded-full border transition-all duration-300',
                isConnected
                  ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-700 dark:text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.25)]'
                  : 'bg-card/60 border-border/60 text-muted-foreground'
              )}
            >
              <span
                className={cn(
                  'size-2 rounded-full',
                  isConnected ? 'bg-emerald-400 shadow-[0_0_8px_#34d399] animate-pulse' : 'bg-zinc-600'
                )}
              />
              <span className="truncate max-w-[180px]">
                {isConnected ? `Подключено: ${activeOrSelectedNode?.name || 'INCY'}` : 'Отключено'}
              </span>
            </div>
          </div>
        </div>

        {/* TAB 1: MAIN (Complete INCY Home Replica) */}
        {activeTab === 'main' && (
          <div className="space-y-4 max-w-2xl mx-auto py-2">
            {settings?.memoryMonitor && coreMemory && coreMemory.totalBytes > 0 && (
              <div className="flex items-center justify-between px-3 py-1.5 rounded-lg border border-border bg-card/40 text-[11px]">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Cpu className="h-3.5 w-3.5 text-primary" />
                  Память ядер
                </span>
                <span className="flex items-center gap-2 font-mono">
                  {coreMemory.perProcess.map((p) => (
                    <span key={p.name} className="text-muted-foreground">
                      {p.name.replace('.exe', '')} {formatBytes(p.bytes)}
                    </span>
                  ))}
                  <span className="font-bold text-foreground">{formatBytes(coreMemory.totalBytes)}</span>
                </span>
              </div>
            )}
            {settings?.connectionStyle === 'compact' ? (
              /* COMPACT STYLE */
              <div className="space-y-3">
                <Card className={cn(
                  'border transition-all duration-300 shadow-md',
                  isConnected
                    ? 'border-emerald-500/50 bg-gradient-to-r from-emerald-950/30 via-card/90 to-card/90'
                    : 'border-primary/30 bg-card/60'
                )}>
                  <CardContent className="p-4 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3.5 min-w-0">
                      <Button
                        size="icon"
                        onClick={() => {
                          if (isConnected) void handleDisconnect()
                          else void handleConnect()
                        }}
                        className={cn(
                          'h-12 w-12 rounded-full shrink-0 shadow-lg transition-all duration-200',
                          isConnected
                            ? 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-emerald-500/30 ring-4 ring-emerald-500/20'
                            : 'bg-primary hover:bg-primary/90 text-white shadow-primary/30 ring-4 ring-primary/20'
                        )}
                      >
                        <Power className={cn('h-5 w-5', isConnected && 'animate-pulse')} />
                      </Button>

                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-foreground">
                            {isConnected ? 'VPN ПОДКЛЮЧЕН' : 'VPN ОТКЛЮЧЕН'}
                          </span>
                          <Badge
                            variant={isConnected ? 'default' : 'secondary'}
                            className={cn(
                              'text-[10px] px-1.5 py-0 font-mono font-bold uppercase',
                              isConnected && 'bg-emerald-500 text-white'
                            )}
                          >
                            {status.connectionMode.toUpperCase()}
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground truncate mt-0.5">
                          {activeOrSelectedNode
                            ? `${getFlagEmoji(activeOrSelectedNode.name)} ${cleanServerName(activeOrSelectedNode.name)}`
                            : 'Сервер не выбран'}
                        </div>
                      </div>
                    </div>

                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setShowServerSelectModal(true)}
                      className="text-xs h-8 gap-1.5 shrink-0 border-primary/40 hover:bg-primary/10"
                    >
                      <Server className="h-3.5 w-3.5 text-primary" /> Выбрать сервер
                    </Button>
                  </CardContent>
                </Card>

                {/* Quick Controls Row */}
                <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl border border-border/80 bg-card/40 backdrop-blur-md">
                  {/* Connection Mode (TUN / Sys Proxy / Only Proxy) */}
                  <div className="flex items-center gap-1 bg-background/80 p-0.5 rounded-lg border border-border/50">
                    <button
                      onClick={() => void handleSetConnectionMode('tun')}
                      className={cn(
                        'px-3 py-1 rounded text-xs font-semibold transition-all',
                        status.connectionMode === 'tun' ? 'bg-primary text-white font-bold shadow-sm' : 'text-muted-foreground hover:text-foreground'
                      )}
                    >
                      TUN
                    </button>
                    <button
                      onClick={() => void handleSetConnectionMode('system_proxy')}
                      className={cn(
                        'px-3 py-1 rounded text-xs font-semibold transition-all',
                        status.connectionMode === 'system_proxy' ? 'bg-primary text-white font-bold shadow-sm' : 'text-muted-foreground hover:text-foreground'
                      )}
                    >
                      Системный прокси
                    </button>
                    <button
                      onClick={() => void handleSetConnectionMode('only_proxy')}
                      className={cn(
                        'px-3 py-1 rounded text-xs font-semibold transition-all',
                        status.connectionMode === 'only_proxy' ? 'bg-primary text-white font-bold shadow-sm' : 'text-muted-foreground hover:text-foreground'
                      )}
                    >
                      Только прокси
                    </button>
                  </div>

                  {/* Routing Mode */}
                  <div className="flex items-center gap-1 bg-background/80 p-0.5 rounded-lg border border-border/50">
                    <button
                      onClick={() => incySetRoutingMode('bypass-ru').then(setStatus)}
                      className={cn(
                        'px-3 py-1 rounded text-xs font-semibold transition-all',
                        status.routingMode === 'bypass-ru' ? 'bg-primary text-primary-foreground font-bold shadow-sm' : 'text-muted-foreground hover:text-foreground'
                      )}
                    >
                      🇷🇺 Обход РФ
                    </button>
                    <button
                      onClick={() => incySetRoutingMode('global').then(setStatus)}
                      className={cn(
                        'px-3 py-1 rounded text-xs font-semibold transition-all',
                        status.routingMode === 'global' ? 'bg-primary text-primary-foreground font-bold shadow-sm' : 'text-muted-foreground hover:text-foreground'
                      )}
                    >
                      🌐 Global
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              /* CLASSIC STYLE */
              <>
                {/* Mode Switcher Buttons (TUN / Системный прокси / Только прокси) */}
                <div className="flex justify-center">
                  <div className="inline-flex p-1 rounded-xl border border-primary/30 bg-primary/10 backdrop-blur-md gap-1">
                    <button
                      onClick={() => { void handleSetConnectionMode('tun') }}
                      className={cn(
                        'px-4 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200',
                        status.connectionMode === 'tun'
                          ? 'bg-primary text-white shadow-md shadow-primary/30 font-bold'
                          : 'text-primary hover:text-white hover:bg-primary/20'
                      )}
                    >
                      TUN
                    </button>
                    <button
                      onClick={() => { void handleSetConnectionMode('system_proxy') }}
                      className={cn(
                        'px-4 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200',
                        status.connectionMode === 'system_proxy'
                          ? 'bg-primary text-white shadow-md shadow-primary/30 font-bold'
                          : 'text-primary hover:text-white hover:bg-primary/20'
                      )}
                    >
                      Системный прокси
                    </button>
                    <button
                      onClick={() => { void handleSetConnectionMode('only_proxy') }}
                      className={cn(
                        'px-4 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200',
                        status.connectionMode === 'only_proxy'
                          ? 'bg-primary text-white shadow-md shadow-primary/30 font-bold'
                          : 'text-primary hover:text-white hover:bg-primary/20'
                      )}
                    >
                      Только прокси
                    </button>
                  </div>
                </div>

                {/* Big Power Button.
                    The button used to have exactly two looks — connected or
                    not — and stayed inert for the second or two a connect
                    takes, so pressing it felt like nothing happened. It now
                    reflects the real `connecting` / `error` states, spins a
                    ring while it works, and counts the seconds so a slow
                    server is visibly slow rather than indistinguishable from
                    a freeze. */}
                <div className="flex flex-col items-center justify-center py-4 space-y-4">
                  <div className="relative flex items-center justify-center">
                    {/* Rotating progress ring — only while busy. */}
                    {isBusy && (
                      <span
                        aria-hidden
                        className="absolute size-[10.5rem] rounded-full border-4 border-transparent border-t-primary border-r-primary/40 animate-spin"
                        style={{ animationDuration: '1.1s' }}
                      />
                    )}
                    <button
                      onClick={() => {
                        if (isBusy) return
                        if (isConnected) {
                          void handleDisconnect()
                        } else {
                          void handleConnect()
                        }
                      }}
                      disabled={isBusy}
                      aria-busy={isBusy}
                      className={cn(
                        'w-36 h-36 rounded-full flex flex-col items-center justify-center gap-1.5 transition-all duration-300 shadow-2xl border-4 relative',
                        isBusy && 'cursor-wait border-primary/70 bg-primary/10 text-primary',
                        !isBusy && isConnected &&
                          'bg-emerald-500/20 border-emerald-500 text-emerald-600 dark:text-emerald-400 shadow-emerald-500/25 hover:scale-105',
                        !isBusy && !isConnected && hasError &&
                          'bg-rose-500/10 border-rose-500/60 text-rose-600 dark:text-rose-400 hover:scale-105',
                        !isBusy && !isConnected && !hasError &&
                          'bg-card/80 border-primary/40 text-muted-foreground hover:border-primary hover:text-primary hover:scale-105'
                      )}
                    >
                      <Power
                        className={cn(
                          'h-12 w-12 transition-transform',
                          isBusy && 'animate-pulse',
                          isConnected && !isBusy && 'animate-pulse'
                        )}
                      />
                      <span className="text-[11px] font-bold uppercase tracking-wider">
                        {isBusy
                          ? busyLabel
                          : isConnected
                            ? 'Отключить'
                            : 'Подключить'}
                      </span>
                      {/* Seconds elapsed — the difference between "slow" and
                          "hung" is knowing the clock is still ticking. */}
                      {isBusy && busySeconds > 0 && (
                        <span className="text-[10px] font-mono tabular-nums text-primary/80">
                          {busySeconds} с
                        </span>
                      )}
                    </button>
                  </div>

                  <div className="text-center space-y-1">
                    <div
                      className={cn(
                        'text-sm font-semibold',
                        isBusy && 'text-primary',
                        !isBusy && isConnected && 'text-emerald-600 dark:text-emerald-400',
                        !isBusy && !isConnected && hasError && 'text-rose-600 dark:text-rose-400',
                        !isBusy && !isConnected && !hasError && 'text-muted-foreground'
                      )}
                    >
                      {isBusy
                        ? busyHint
                        : isConnected
                          ? 'Подключено к VPN'
                          : hasError
                            ? 'Не удалось подключиться'
                            : 'Нажмите для подключения'}
                    </div>
                    {!isBusy && hasError && status.lastError && (
                      <div className="text-[11px] text-muted-foreground max-w-sm mx-auto leading-relaxed">
                        {status.lastError}
                      </div>
                    )}
                  </div>

                  {/* Quick Split / Global mode selector */}
                  <div className="flex items-center gap-2 p-1 rounded-xl border border-border bg-card/40">
                    <Button
                      size="sm"
                      variant={status.routingMode === 'bypass-ru' ? 'default' : 'ghost'}
                      onClick={() => incySetRoutingMode('bypass-ru').then(setStatus)}
                      className="text-xs h-7 gap-1"
                    >
                      🇷🇺 Обход РФ сайтов (Split)
                    </Button>
                    <Button
                      size="sm"
                      variant={status.routingMode === 'global' ? 'default' : 'ghost'}
                      onClick={() => incySetRoutingMode('global').then(setStatus)}
                      className="text-xs h-7 gap-1"
                    >
                      🌐 Весь трафик (Global)
                    </Button>
                  </div>
                </div>
              </>
            )}

            {/* ТЕКУЩАЯ ПОДПИСКА (Subscription Card) */}
            <div className="space-y-2">
              <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Текущая подписка
              </div>

              {subscription ? (
                <Card className="border-primary/40 bg-gradient-to-br from-card/90 via-card/60 to-primary/10 shadow-md">
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <Star className="h-4 w-4 text-amber-700 dark:text-amber-400 fill-amber-400 shrink-0" />
                        <div className="font-bold text-sm text-foreground truncate">
                          {subscription.title}
                        </div>
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-mono bg-primary/20 text-primary">
                          {nodes.length}
                        </Badge>
                      </div>

                      <div className="flex items-center gap-1">
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          onClick={() => { void handleRefreshSubscription() }}
                          disabled={loadingRefresh}
                          title="Обновить подписку"
                          className="h-7 w-7"
                        >
                          <RefreshCw className={cn('h-3.5 w-3.5', loadingRefresh && 'animate-spin')} />
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          onClick={() => { void handlePingAll() }}
                          disabled={testingPings}
                          title="Замерить пинг всех серверов"
                          className="h-7 w-7"
                        >
                          <Activity className={cn('h-3.5 w-3.5', testingPings && 'animate-pulse text-amber-700 dark:text-amber-500')} />
                        </Button>
                      </div>
                    </div>

                    {/* Progress bar */}
                    {subscription.usedBytes !== null && subscription.totalBytes !== null && (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>
                            {subscription.expireDate ? `Срок: ${subscription.expireDate}` : 'Активна'}
                          </span>
                          <span className="font-mono text-primary">
                            {(subscription.usedBytes / (1024 * 1024 * 1024)).toFixed(2)} ГБ /{' '}
                            {(subscription.totalBytes / (1024 * 1024 * 1024)).toFixed(2)} ГБ
                          </span>
                        </div>
                        <div className="w-full bg-secondary/80 h-2 rounded-full overflow-hidden">
                          <div
                            className="bg-primary h-full transition-all duration-500 shadow-sm"
                            style={{
                              width: `${Math.min(
                                100,
                                Math.round((subscription.usedBytes / subscription.totalBytes) * 100)
                              )}%`
                            }}
                          />
                        </div>
                      </div>
                    )}

                    {/* Action Buttons if provider metadata exists */}
                    {(subscription.webPageUrl || subscription.supportUrl || subscription.premiumUrl) && (
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        {subscription.webPageUrl && (
                          <Button
                            size="sm"
                            variant="secondary"
                            className="text-xs h-7 gap-1.5 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30"
                            onClick={() => window.open(subscription.webPageUrl, '_blank')}
                          >
                            <Send className="h-3 w-3" /> Канал / Сайт
                          </Button>
                        )}
                        {subscription.supportUrl && (
                          <Button
                            size="sm"
                            variant="secondary"
                            className="text-xs h-7 gap-1.5 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30"
                            onClick={() => window.open(subscription.supportUrl, '_blank')}
                          >
                            <HelpCircle className="h-3 w-3" /> Поддержка
                          </Button>
                        )}
                        {subscription.premiumUrl && (
                          <Button
                            size="sm"
                            variant="secondary"
                            className="text-xs h-7 gap-1.5 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30"
                            onClick={() => window.open(subscription.premiumUrl, '_blank')}
                          >
                            <Star className="h-3 w-3 text-amber-700 dark:text-amber-400" /> Продлить
                          </Button>
                        )}
                      </div>
                    )}

                    {/* Объявления провайдера.
                        Раньше этот блок висел ОТДЕЛЬНОЙ карточкой над «Текущей
                        подпиской», хотя приходит он тем же ответом подписки и
                        описывает именно её — из-за этого выглядел как чужое
                        системное уведомление. Теперь это секция внутри
                        карточки, отделённая линией: тот же источник данных —
                        то же место в интерфейсе. */}
                    {subscription.announcements && subscription.announcements.length > 0 && (
                      <div className="pt-3 mt-1 border-t border-border/50 space-y-1.5">
                        {subscription.announcements.map((ann, idx) => {
                          let emoji = 'ℹ️'
                          if (ann.includes('📶') || ann.includes('LTE')) emoji = '📶'
                          else if (ann.includes('⚠️') || ann.includes('Глушат')) emoji = '⚠️'
                          else if (ann.includes('⛔') || ann.includes('Перестало')) emoji = '⛔'
                          else if (ann.includes('🆔') || ann.includes('⏱️')) emoji = '🆔'

                          const cleanText = stripLeadingEmoji(ann)
                          return (
                            <div
                              key={idx}
                              className="flex items-start gap-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-200/90"
                            >
                              <span className="shrink-0">{emoji}</span>
                              <span>{cleanText || ann}</span>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ) : (
                <div className="p-4 rounded-xl border border-dashed border-border bg-card/30 text-center space-y-2">
                  <div className="text-xs text-muted-foreground">Подписка пока не добавлена</div>
                  <Button size="sm" onClick={() => setActiveTab('servers')} className="text-xs h-7 gap-1">
                    <Plus className="h-3.5 w-3.5" /> Добавить подписку
                  </Button>
                </div>
              )}
            </div>

            {/* SELECTED SERVER CARD (Directly on Main Screen!) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Выбранный сервер
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowServerSelectModal(true)}
                  className="text-xs h-6 text-primary hover:text-primary"
                >
                  Сменить сервер ▾
                </Button>
              </div>

              {activeOrSelectedNode ? (
                <div
                  onClick={() => setShowServerSelectModal(true)}
                  className={cn(
                    'flex items-center justify-between p-3.5 rounded-xl border cursor-pointer transition-all duration-200 hover:border-primary/60 shadow-sm',
                    isConnected
                      ? 'border-emerald-500/60 bg-emerald-950/20'
                      : 'border-primary/40 bg-card/60 hover:bg-card/90'
                  )}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-2xl shrink-0 select-none">
                      {getFlagEmoji(activeOrSelectedNode.name)}
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-foreground truncate">
                          {cleanServerName(activeOrSelectedNode.name)}
                        </span>
                        <Badge
                          variant="outline"
                          className={cn(
                            'text-[9px] px-1.5 py-0 font-mono uppercase',
                            activeOrSelectedNode.protocol === 'hysteria2'
                              ? 'border-amber-500/40 text-amber-700 dark:text-amber-400 bg-amber-500/10'
                              : 'border-primary/40 text-primary bg-primary/10'
                          )}
                        >
                          {activeOrSelectedNode.protocol === 'hysteria2' ? 'HYS2' : activeOrSelectedNode.protocol}
                        </Badge>
                        {activeOrSelectedNode.rawJson && (
                          <Badge variant="secondary" className="text-[9px] px-1 py-0 font-mono opacity-70">
                            JSON
                          </Badge>
                        )}
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                        {activeOrSelectedNode.description || `${activeOrSelectedNode.server}:${activeOrSelectedNode.port}`}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {pingingNodeIds.has(activeOrSelectedNode.id) ? (
                      <div className="px-2 py-0.5 flex items-center justify-center">
                        <div className="h-3 w-3 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
                      </div>
                    ) : (
                      <LatencyBadge node={activeOrSelectedNode} display={settings?.pingDisplay} />
                    )}
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  </div>
                </div>
              ) : (
                <div className="text-xs text-muted-foreground p-3 rounded-xl border border-border text-center">
                  Серверы не найдены. Импортируйте подписку на вкладке «Сервера».
                </div>
              )}
            </div>

            {/* Quick Switch Server Modal */}
            {showServerSelectModal && (
              <div
                className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4"
                onClick={() => setShowServerSelectModal(false)}
              >
                <div
                  className="bg-card/95 border border-primary/30 w-full max-w-lg rounded-2xl p-4.5 space-y-3 max-h-[85vh] flex flex-col shadow-[0_0_50px_rgba(0,0,0,0.8)] backdrop-blur-2xl"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center justify-between border-b border-border/40 pb-2.5">
                    <div className="font-bold text-sm text-foreground flex items-center gap-2">
                      <Server className="size-4 text-primary" /> Выбор сервера ({nodes.length})
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setShowServerSelectModal(false)}
                      className="text-xs h-7 rounded-lg"
                    >
                      Закрыть
                    </Button>
                  </div>

                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Быстрый поиск серверов..."
                      className="pl-8 text-xs h-8"
                    />
                  </div>

                  <div className="overflow-y-auto space-y-1.5 flex-1 pr-1">
                    {filteredNodes.map((node) => {
                      const isSelected = (status.selectedNodeId || nodes[0]?.id) === node.id
                      return (
                        <div
                          key={node.id}
                          onClick={() => { void handleSelectNode(node.id) }}
                          className={cn(
                            'flex items-center justify-between p-2.5 rounded-xl border cursor-pointer transition-all',
                            isSelected
                              ? 'border-primary bg-primary/15'
                              : 'border-border/60 bg-card/40 hover:bg-card/80'
                          )}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span className="text-lg">{getFlagEmoji(node.name)}</span>
                            <div className="min-w-0">
                              <div className="text-xs font-semibold text-foreground truncate">
                                {cleanServerName(node.name)}
                              </div>
                              <div className="text-[10px] text-muted-foreground truncate">
                                {node.protocol.toUpperCase()} • {node.server}:{node.port}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            {pingingNodeIds.has(node.id) ? (
                              <div className="px-2 py-0.5 flex items-center justify-center">
                                <div className="h-3 w-3 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
                              </div>
                            ) : (
                              <LatencyBadge node={node} display={settings?.pingDisplay} />
                            )}
                            {isSelected && <CheckCircle2 className="h-4 w-4 text-primary" />}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: SERVERS (Full Servers List) */}
        {activeTab === 'servers' && (
          <div className="space-y-4">
            {/* Import Bar */}
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                value={inputUrl}
                onChange={(e) => setInputUrl(e.target.value)}
                placeholder="Вставьте ссылку на подписку (https://...) или узел (vless://, ss://, hy2://)"
                className="text-xs font-mono"
              />
              {/* Вставка из буфера — типичный сценарий: ссылку скопировали в
                  боте провайдера и приносят сюда. Кнопка сразу запускает
                  импорт, чтобы не заставлять нажимать ещё раз. */}
              <Button
                size="sm"
                variant="outline"
                disabled={loadingImport}
                onClick={() => { void handlePasteImport() }}
                className="gap-1.5 text-xs shrink-0"
              >
                <Copy className="h-3.5 w-3.5" /> Из буфера
              </Button>
              <Button
                size="sm"
                onClick={() => { void handleImport() }}
                disabled={loadingImport || !inputUrl.trim()}
                className="gap-1.5 text-xs shrink-0"
              >
                <Plus className="h-3.5 w-3.5" />
                {loadingImport ? 'Загрузка...' : 'Импортировать'}
              </Button>
            </div>

            {/* Subscription Card on Servers Tab */}
            {subscription && (
              <Card className="border-primary/40 bg-gradient-to-br from-card/90 via-card/60 to-primary/10 shadow-md">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <Star className="h-4 w-4 text-amber-700 dark:text-amber-400 fill-amber-400 shrink-0" />
                      <div className="font-bold text-sm text-foreground truncate">
                        {subscription.title}
                      </div>
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-mono bg-primary/20 text-primary">
                        {nodes.length}
                      </Badge>
                    </div>

                    <div className="flex items-center gap-1">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        onClick={() => { void handleRefreshSubscription() }}
                        disabled={loadingRefresh}
                        title="Обновить подписку"
                        className="h-7 w-7"
                      >
                        <RefreshCw className={cn('h-3.5 w-3.5', loadingRefresh && 'animate-spin')} />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        onClick={() => { void handlePingAll() }}
                        disabled={testingPings}
                        title="Замерить пинг всех серверов"
                        className="h-7 w-7"
                      >
                        <Activity className={cn('h-3.5 w-3.5', testingPings && 'animate-pulse text-amber-700 dark:text-amber-500')} />
                      </Button>
                    </div>
                  </div>

                  {/* Progress bar */}
                  {subscription.usedBytes !== null && subscription.totalBytes !== null && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>
                          {subscription.expireDate ? `Срок: ${subscription.expireDate}` : 'Активна'}
                        </span>
                        <span className="font-mono text-primary">
                          {(subscription.usedBytes / (1024 * 1024 * 1024)).toFixed(2)} ГБ /{' '}
                          {(subscription.totalBytes / (1024 * 1024 * 1024)).toFixed(2)} ГБ
                        </span>
                      </div>
                      <div className="w-full bg-secondary/80 h-2 rounded-full overflow-hidden">
                        <div
                          className="bg-primary h-full transition-all duration-500 shadow-sm"
                          style={{
                            width: `${Math.min(
                              100,
                              Math.round((subscription.usedBytes / subscription.totalBytes) * 100)
                            )}%`
                          }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Те же объявления, что и на главной — тот же вид: отделены
                      линией, эмодзи вынесено в отдельную колонку, а не оставлено
                      внутри текста. Раньше здесь была вторая, непохожая
                      вёрстка, и один и тот же текст выглядел по-разному на двух
                      вкладках. */}
                  {subscription.announcements && subscription.announcements.length > 0 && (
                    <div className="pt-3 mt-1 border-t border-border/50 space-y-1.5">
                      {subscription.announcements.map((ann, idx) => {
                        let emoji = 'ℹ️'
                        if (ann.includes('📶') || ann.includes('LTE')) emoji = '📶'
                        else if (ann.includes('⚠️') || ann.includes('Глушат')) emoji = '⚠️'
                        else if (ann.includes('⛔') || ann.includes('Перестало')) emoji = '⛔'
                        else if (ann.includes('🆔') || ann.includes('⏱️')) emoji = '🆔'

                        const cleanText = stripLeadingEmoji(ann)
                        return (
                          <div
                            key={idx}
                            className="flex items-start gap-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-200/90"
                          >
                            <span className="shrink-0">{emoji}</span>
                            <span>{cleanText || ann}</span>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Filter Pills and Search */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-2 pt-1">
              <div className="flex items-center gap-1.5 w-full sm:w-auto">
                <Button
                  size="sm"
                  variant={protocolFilter === 'all' ? 'default' : 'outline'}
                  onClick={() => setProtocolFilter('all')}
                  className="text-xs h-7"
                >
                  Все ({nodes.length})
                </Button>
                <Button
                  size="sm"
                  variant={protocolFilter === 'vless' ? 'default' : 'outline'}
                  onClick={() => setProtocolFilter('vless')}
                  className="text-xs h-7"
                >
                  VLESS ({nodes.filter((n) => n.protocol === 'vless').length})
                </Button>
                <Button
                  size="sm"
                  variant={protocolFilter === 'hysteria2' ? 'default' : 'outline'}
                  onClick={() => setProtocolFilter('hysteria2')}
                  className="text-xs h-7"
                >
                  ⚡ Hysteria2 ({nodes.filter((n) => n.protocol === 'hysteria2').length})
                </Button>
              </div>

              <div className="relative w-full sm:w-64">
                <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Поиск серверов..."
                  className="pl-8 text-xs h-7.5"
                />
              </div>
            </div>

            {/* Server List */}
            <div className="space-y-2">
              {filteredNodes.length > 0 ? (
                filteredNodes.map((node) => {
                  const isNodeActive = isConnected && status.activeNodeId === node.id
                  const isNodeSelected = (status.selectedNodeId || nodes[0]?.id) === node.id
                  const flag = getFlagEmoji(node.name)
                  const cleanName = cleanServerName(node.name)

                  return (
                    <div
                      key={node.id}
                      className={cn(
                        'flex items-center justify-between p-3 rounded-xl border transition-all duration-200',
                        isNodeActive
                          ? 'border-emerald-500/60 bg-emerald-500/10 shadow-sm'
                          : isNodeSelected
                          ? 'border-primary/60 bg-primary/10'
                          : 'border-border bg-card/40 hover:bg-card/70'
                      )}
                    >
                      <div
                        onClick={() => { void handleSelectNode(node.id) }}
                        className="flex items-center gap-3 min-w-0 cursor-pointer flex-1"
                      >
                        <span className="text-xl shrink-0 select-none">{flag}</span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-foreground truncate">
                              {cleanName}
                            </span>
                            <Badge
                              variant="outline"
                              className={cn(
                                'text-[9px] px-1.5 py-0 font-mono uppercase',
                                node.protocol === 'hysteria2' && 'border-amber-500/40 text-amber-700 dark:text-amber-400 bg-amber-500/10'
                              )}
                            >
                              {node.protocol === 'hysteria2' ? 'HYS2' : node.protocol}
                            </Badge>
                            {node.rawJson && (
                              <Badge variant="secondary" className="text-[9px] px-1 py-0 font-mono opacity-70">
                                JSON
                              </Badge>
                            )}
                          </div>
                          <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                            {node.description || `${node.server}:${node.port}`}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {pingingNodeIds.has(node.id) ? (
                          <div className="px-2 py-0.5 flex items-center justify-center">
                            <div className="h-3 w-3 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
                          </div>
                        ) : (
                          <LatencyBadge node={node} display={settings?.pingDisplay} strong />
                        )}

                        <Button
                          size="sm"
                          variant={isNodeActive ? 'default' : 'outline'}
                          onClick={() => {
                            if (isNodeActive) {
                              void handleDisconnect()
                            } else {
                              void handleConnect(node.id)
                            }
                          }}
                          className={cn(
                            'text-xs h-7 min-w-[90px]',
                            isNodeActive && 'bg-emerald-500 hover:bg-emerald-600 text-white'
                          )}
                        >
                          {isNodeActive ? 'Активен' : 'Подключить'}
                        </Button>
                      </div>
                    </div>
                  )
                })
              ) : (
                <div className="text-center py-10 text-xs text-muted-foreground">
                  {nodes.length === 0
                    ? 'Серверов пока нет. Вставьте ссылку на подписку сверху.'
                    : 'По вашему запросу ничего не найдено.'}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB: ROUTING — what goes through the tunnel and what does not */}
        {activeTab === 'routing' && settings && (
          <div className="space-y-4">
            <RoutingProfiles
              settings={settings}
              onChanged={loadData}
              onStatus={setStatus}
            />

            <GeoCategoriesCard settings={settings} onUpdate={handleUpdateSettings} />

            <Card className="cyber-card">
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <CardTitle className="flex items-center gap-2">
                  <Sliders className="h-4 w-4 text-primary" />
                  Свои правила
                </CardTitle>
                <span className="text-[11px] text-muted-foreground font-mono">
                  {settings.customRoutingRules?.length ?? 0}
                </span>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Применяются раньше всех встроенных списков — ваш выбор всегда главнее.
                  Можно указать домен (<span className="font-mono">example.com</span>),
                  адрес или подсеть (<span className="font-mono">1.2.3.4/24</span>).
                </p>

                {(settings.customRoutingRules?.length ?? 0) > 0 ? (
                  <div className="space-y-2">
                    {settings.customRoutingRules.map((rule) => (
                      <div
                        key={rule.id}
                        className={cn(
                          'flex items-center gap-2 p-2.5 rounded-xl border bg-card/40 transition',
                          rule.enabled ? 'border-border/70' : 'border-border/40 opacity-55'
                        )}
                      >
                        <Switch
                          checked={rule.enabled}
                          onCheckedChange={(v) => { void updateRoutingRule(rule.id, { enabled: v }) }}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="font-mono text-xs font-medium text-foreground truncate">
                            {rule.value}
                          </div>
                          {rule.comment && (
                            <div className="text-[10px] text-muted-foreground truncate">{rule.comment}</div>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {(['direct', 'proxy', 'block'] as const).map((a) => (
                            <button
                              key={a}
                              onClick={() => { void updateRoutingRule(rule.id, { action: a }) }}
                              className={cn(
                                'px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wide border transition cursor-pointer',
                                rule.action === a
                                  ? a === 'direct'
                                    ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                                    : a === 'proxy'
                                      ? 'border-primary/50 bg-primary/15 text-primary'
                                      : 'border-rose-500/50 bg-rose-500/15 text-rose-700 dark:text-rose-400'
                                  : 'border-border/50 text-muted-foreground hover:bg-foreground/[0.05]'
                              )}
                            >
                              {a === 'direct' ? 'напрямую' : a === 'proxy' ? 'туннель' : 'блок'}
                            </button>
                          ))}
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            onClick={() => { void removeRoutingRule(rule.id) }}
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground py-2">Правил пока нет.</div>
                )}

                <div className="flex flex-col sm:flex-row gap-2 pt-1 border-t border-border/40">
                  <Input
                    value={newRuleValue}
                    onChange={(e) => setNewRuleValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void addRoutingRule() }}
                    placeholder="Домен или подсеть"
                    className="text-xs font-mono"
                  />
                  <div className="flex items-center gap-1 shrink-0">
                    {(['direct', 'proxy', 'block'] as const).map((a) => (
                      <button
                        key={a}
                        onClick={() => setNewRuleAction(a)}
                        className={cn(
                          'px-2.5 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wide border transition cursor-pointer',
                          newRuleAction === a
                            ? 'border-primary/50 bg-primary/15 text-primary'
                            : 'border-border/50 text-muted-foreground hover:bg-foreground/[0.05]'
                        )}
                      >
                        {a === 'direct' ? 'напрямую' : a === 'proxy' ? 'туннель' : 'блок'}
                      </button>
                    ))}
                    <Button
                      size="sm"
                      onClick={() => { void addRoutingRule() }}
                      disabled={!newRuleValue.trim()}
                      className="gap-1.5 text-xs shrink-0"
                    >
                      <Plus className="h-3.5 w-3.5" /> Добавить
                    </Button>
                  </div>
                </div>

                {isConnected && (
                  <p className="text-[11px] text-amber-700 dark:text-amber-300/90 pt-1">
                    Изменения применятся после переподключения.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* TAB 3: SETTINGS (Full INCY Options) */}
        {activeTab === 'settings' && settings && (
          <div className="space-y-4">
            {/* Оформление */}
            <Card className="cyber-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Sliders className="h-4 w-4 text-primary" />
                  Оформление
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Стиль подключения</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      size="sm"
                      variant={settings.connectionStyle === 'classic' ? 'default' : 'outline'}
                      onClick={() => handleUpdateSettings({ connectionStyle: 'classic' })}
                      className="text-xs h-8"
                    >
                      Классический
                    </Button>
                    <Button
                      size="sm"
                      variant={settings.connectionStyle === 'compact' ? 'default' : 'outline'}
                      onClick={() => handleUpdateSettings({ connectionStyle: 'compact' })}
                      className="text-xs h-8"
                    >
                      Компактный
                    </Button>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-border/50">
                  <div className="flex flex-col">
                    <Label className="text-sm">Отключить сглаживание шрифтов</Label>
                    <span className="text-xs text-muted-foreground">Отрисовка текста без субпиксельного сглаживания</span>
                  </div>
                  <Switch
                    checked={settings.disableFontSmoothing}
                    onCheckedChange={(v) => handleUpdateSettings({ disableFontSmoothing: v })}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Соединение */}
            <Card className="cyber-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Wifi className="h-4 w-4 text-primary" />
                  Соединение
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex flex-col">
                    <Label className="text-sm">Автоподключение</Label>
                    <span className="text-xs text-muted-foreground">
                      Подключаться автоматически при старте приложения
                    </span>
                  </div>
                  <Switch
                    checked={settings.autoConnect}
                    onCheckedChange={(v) => handleUpdateSettings({ autoConnect: v })}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex flex-col">
                    <Label className="text-sm">Kill Switch<NotWired reason="Требует правил системного брандмауэра Windows — в приложении пока не реализовано. Сейчас при обрыве туннеля трафик пойдёт напрямую." /></Label>
                    <span className="text-xs text-muted-foreground">
                      Блокировать трафик при отключении VPN для защиты IP
                    </span>
                  </div>
                  <Switch
                    checked={settings.killSwitch}
                    onCheckedChange={(v) => handleUpdateSettings({ killSwitch: v })}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex flex-col">
                    <Label className="text-sm">Перехватывать системный DNS</Label>
                    <span className="text-xs text-muted-foreground">
                      Направлять DNS-запросы ОС через тоннель
                    </span>
                  </div>
                  <Switch
                    checked={settings.hijackDns}
                    onCheckedChange={(v) => handleUpdateSettings({ hijackDns: v })}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex flex-col">
                    <Label className="text-sm">Разрешить LAN подключения</Label>
                    <span className="text-xs text-muted-foreground">
                      Исключить локальную сеть из VPN тоннеля
                    </span>
                  </div>
                  <Switch
                    checked={settings.allowLan}
                    onCheckedChange={(v) => handleUpdateSettings({ allowLan: v })}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex flex-col">
                    <Label className="text-sm">LAN через прокси</Label>
                    <span className="text-xs text-muted-foreground">Направить локальный трафик через VPN прокси</span>
                  </div>
                  <Switch
                    checked={settings.lanViaProxy}
                    onCheckedChange={(v) => handleUpdateSettings({ lanViaProxy: v })}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex flex-col">
                    <Label className="text-sm">Блокировать UDP</Label>
                    <span className="text-xs text-muted-foreground">
                      Отключает UDP-протоколы (QUIC, голосовые звонки, онлайн-игры)
                    </span>
                  </div>
                  <Switch
                    checked={settings.blockUdp}
                    onCheckedChange={(v) => handleUpdateSettings({ blockUdp: v })}
                  />
                </div>

                {/* SOCKS5 Auth */}
                <div className="pt-2 border-t border-border/50 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col">
                      <Label className="text-sm">SOCKS5 / HTTP авторизация</Label>
                      <span className="text-xs text-muted-foreground">
                        Защита локального прокси логином и паролем
                      </span>
                    </div>
                    <Switch
                      checked={settings.socksAuth}
                      onCheckedChange={(v) => handleUpdateSettings({ socksAuth: v })}
                    />
                  </div>

                  {settings.socksAuth && (
                    <div className="p-3 rounded-lg border border-border bg-card/30 space-y-2 text-xs">
                      <div className="flex items-center gap-2">
                        <span className="w-16 text-muted-foreground">Логин:</span>
                        <Input
                          value={settings.socksUser}
                          onChange={(e) => handleUpdateSettings({ socksUser: e.target.value })}
                          className="h-7 text-xs font-mono"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-16 text-muted-foreground">Пароль:</span>
                        <Input
                          value={settings.socksPass}
                          onChange={(e) => handleUpdateSettings({ socksPass: e.target.value })}
                          className="h-7 text-xs font-mono"
                        />
                      </div>
                      <Button size="sm" variant="ghost" onClick={handleResetSocksAuth} className="text-xs h-6 gap-1">
                        <RotateCcw className="h-3 w-3" /> Сгенерировать новый логин/пароль
                      </Button>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-border/50">
                  <Label className="text-sm">Локальный Mixed порт (SOCKS5 + HTTP)</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      value={settings.mixedPort}
                      onChange={(e) => handleUpdateSettings({ mixedPort: Number(e.target.value) || 20808 })}
                      className="w-24 h-7 text-xs font-mono"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Туннель и DPI */}
            <Card className="cyber-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Lock className="h-4 w-4 text-primary" />
                  Туннель и обход блокировок
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Fragmentation */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col">
                      <Label className="text-sm">Фрагментация TLS Hello<NotWired label="только Xray" reason="Работает только на ядре Xray. Узлы из JSON-подписки обслуживает sing-box, где фрагментации нет — для них переключатель не действует." /></Label>
                      <span className="text-xs text-muted-foreground">
                        Разбиение пакетов ClientHello для эффективного обхода ТСПУ/DPI
                      </span>
                    </div>
                    <Switch
                      checked={settings.fragmentation}
                      onCheckedChange={(v) => handleUpdateSettings({ fragmentation: v })}
                    />
                  </div>

                  {settings.fragmentation && (
                    <div className="grid grid-cols-3 gap-2 p-2.5 rounded-lg border border-border bg-card/30">
                      <div>
                        <Label className="text-[10px] text-muted-foreground">Packets</Label>
                        <Input
                          value={settings.fragmentationPackets}
                          onChange={(e) => handleUpdateSettings({ fragmentationPackets: e.target.value })}
                          className="h-6 text-xs font-mono mt-0.5"
                        />
                      </div>
                      <div>
                        <Label className="text-[10px] text-muted-foreground">Length</Label>
                        <Input
                          value={settings.fragmentationLength}
                          onChange={(e) => handleUpdateSettings({ fragmentationLength: e.target.value })}
                          className="h-6 text-xs font-mono mt-0.5"
                        />
                      </div>
                      <div>
                        <Label className="text-[10px] text-muted-foreground">Interval</Label>
                        <Input
                          value={settings.fragmentationInterval}
                          onChange={(e) => handleUpdateSettings({ fragmentationInterval: e.target.value })}
                          className="h-6 text-xs font-mono mt-0.5"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Noises */}
                <div className="space-y-2 pt-2 border-t border-border/50">
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col">
                      <Label className="text-sm">Noises (Шумовые пакеты)<NotWired label="только Xray" reason="Работает только на ядре Xray. Узлы из JSON-подписки обслуживает sing-box, где шумовых пакетов нет — для них переключатель не действует." /></Label>
                      <span className="text-xs text-muted-foreground">
                        Отправка ложных данных перед полезной нагрузкой
                      </span>
                    </div>
                    <Switch
                      checked={settings.noises}
                      onCheckedChange={(v) => handleUpdateSettings({ noises: v })}
                    />
                  </div>

                  {settings.noises && (
                    <div className="grid grid-cols-3 gap-2 p-2.5 rounded-lg border border-border bg-card/30">
                      <div>
                        <Label className="text-[10px] text-muted-foreground">Type</Label>
                        <Input
                          value={settings.noisesType}
                          onChange={(e) => handleUpdateSettings({ noisesType: e.target.value })}
                          className="h-6 text-xs font-mono mt-0.5"
                        />
                      </div>
                      <div>
                        <Label className="text-[10px] text-muted-foreground">Packet</Label>
                        <Input
                          value={settings.noisesPacket}
                          onChange={(e) => handleUpdateSettings({ noisesPacket: e.target.value })}
                          className="h-6 text-xs font-mono mt-0.5"
                        />
                      </div>
                      <div>
                        <Label className="text-[10px] text-muted-foreground">Delay</Label>
                        <Input
                          value={settings.noisesDelay}
                          onChange={(e) => handleUpdateSettings({ noisesDelay: e.target.value })}
                          className="h-6 text-xs font-mono mt-0.5"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Multiplexing */}
                <div className="space-y-2 pt-2 border-t border-border/50">
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col">
                      <Label className="text-sm">Мультиплексирование (MUX / h2mux)<NotWired label="нужен сервер" reason="Требует поддержки на стороне сервера. Если провайдер её не включил, туннель установится, но данные передаваться не будут." /></Label>
                      <span className="text-xs text-muted-foreground">
                        Объединение множества соединений в единый поток
                      </span>
                    </div>
                    <Switch
                      checked={settings.multiplexing}
                      onCheckedChange={(v) => handleUpdateSettings({ multiplexing: v })}
                    />
                  </div>

                  {settings.multiplexing && (
                    <div className="grid grid-cols-2 gap-2 p-2.5 rounded-lg border border-border bg-card/30">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs">Concurrency:</Label>
                        <div className="flex items-center gap-1.5">
                          <Button
                            size="icon-sm"
                            variant="outline"
                            onClick={() => handleUpdateSettings({ muxConcurrency: Math.max(1, settings.muxConcurrency - 1) })}
                          >
                            -
                          </Button>
                          <span className="text-xs font-mono font-bold w-5 text-center">{settings.muxConcurrency}</span>
                          <Button
                            size="icon-sm"
                            variant="outline"
                            onClick={() => handleUpdateSettings({ muxConcurrency: Math.min(32, settings.muxConcurrency + 1) })}
                          >
                            +
                          </Button>
                        </div>
                      </div>

                      <div className="flex items-center justify-between">
                        <Label className="text-xs">XUDP Concurrency:</Label>
                        <div className="flex items-center gap-1.5">
                          <Button
                            size="icon-sm"
                            variant="outline"
                            onClick={() => handleUpdateSettings({ xudpConcurrency: Math.max(1, settings.xudpConcurrency - 1) })}
                          >
                            -
                          </Button>
                          <span className="text-xs font-mono font-bold w-5 text-center">{settings.xudpConcurrency}</span>
                          <Button
                            size="icon-sm"
                            variant="outline"
                            onClick={() => handleUpdateSettings({ xudpConcurrency: Math.min(64, settings.xudpConcurrency + 1) })}
                          >
                            +
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Preferred IP */}
                <div className="space-y-1.5 pt-2 border-t border-border/50">
                  <Label className="text-xs font-semibold">Предпочтительный IP</Label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(['IPV4', 'IPV6', 'AUTO'] as const).map((ipMode) => (
                      <Button
                        key={ipMode}
                        size="sm"
                        variant={settings.preferredIp === ipMode ? 'default' : 'outline'}
                        onClick={() => handleUpdateSettings({ preferredIp: ipMode })}
                        className="text-xs h-7"
                      >
                        {ipMode}
                      </Button>
                    ))}
                  </div>
                </div>

                {/* VPN DNS Selection */}
                <div className="space-y-1.5 pt-2 border-t border-border/50">
                  <Label className="text-xs font-semibold">VPN DNS сервер</Label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                    {(['Cloudflare + Google', 'Google DNS', 'Cloudflare DNS', 'Quad9', 'Xbox DNS', 'Custom'] as const).map((dns) => (
                      <Button
                        key={dns}
                        size="sm"
                        variant={settings.vpnDns === dns ? 'default' : 'outline'}
                        onClick={() => handleUpdateSettings({ vpnDns: dns })}
                        className="text-xs h-7"
                      >
                        {dns}
                      </Button>
                    ))}
                  </div>
                  {settings.vpnDns === 'Custom' && (
                    <Input
                      value={settings.customDns || ''}
                      onChange={(e) => handleUpdateSettings({ customDns: e.target.value })}
                      placeholder="Введите IP DNS через запятую (напр. 77.88.8.8, 1.1.1.1)"
                      className="h-7 text-xs font-mono mt-1"
                    />
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Подписки */}
            <Card className="cyber-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <RefreshCw className="h-4 w-4 text-primary" />
                  Подписки и автообновление
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Интервал автообновления</Label>
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-1">
                    {[
                      { l: '30 мин', h: 0.5 },
                      { l: '1 час', h: 1 },
                      { l: '2 часа', h: 2 },
                      { l: '6 часов', h: 6 },
                      { l: '12 ч', h: 12 },
                      { l: '24 ч', h: 24 }
                    ].map((item) => (
                      <Button
                        key={item.h}
                        size="sm"
                        variant={settings.autoUpdateIntervalHours === item.h ? 'default' : 'outline'}
                        onClick={() => handleUpdateSettings({ autoUpdateIntervalHours: item.h })}
                        className="text-xs h-7"
                      >
                        {item.l}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-border/50">
                  <div className="flex flex-col">
                    <Label className="text-sm">Обновлять при старте</Label>
                    <span className="text-xs text-muted-foreground">Проверять новые сервера при запуске</span>
                  </div>
                  <Switch
                    checked={settings.updateOnLaunch}
                    onCheckedChange={(v) => handleUpdateSettings({ updateOnLaunch: v })}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex flex-col">
                    <Label className="text-sm">Замерять пинг при запуске</Label>
                    <span className="text-xs text-muted-foreground">Тестировать задержку всех узлов</span>
                  </div>
                  <Switch
                    checked={settings.pingOnLaunch}
                    onCheckedChange={(v) => handleUpdateSettings({ pingOnLaunch: v })}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex flex-col">
                    <Label className="text-sm">Замерять пинг при обновлении подписки</Label>
                    <span className="text-xs text-muted-foreground">Автоматически опрашивать сервера после нажатия кнопки «Обновить»</span>
                  </div>
                  <Switch
                    checked={settings.pingOnUpdateSubscription}
                    onCheckedChange={(v) => handleUpdateSettings({ pingOnUpdateSubscription: v })}
                  />
                </div>

                {/* Сортировка */}
                <div className="space-y-1.5 pt-2 border-t border-border/50">
                  <Label className="text-xs font-semibold">Сортировка серверов</Label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {[
                      { id: 'default', label: 'По умолчанию' },
                      { id: 'ping', label: 'По пингу' },
                      { id: 'name', label: 'По имени' }
                    ].map((st) => (
                      <Button
                        key={st.id}
                        size="sm"
                        variant={settings.sortServersBy === st.id ? 'default' : 'outline'}
                        onClick={() => handleUpdateSettings({ sortServersBy: st.id as any })}
                        className="text-xs h-7"
                      >
                        {st.label}
                      </Button>
                    ))}
                  </div>
                </div>

                {/* Уведомление об истечении подписки */}
                <div className="pt-2 border-t border-border/50 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col">
                      <Label className="text-sm">Уведомление об истечении</Label>
                      <span className="text-xs text-muted-foreground">
                        Предупреждать, когда подписка подходит к концу
                      </span>
                    </div>
                    <Switch
                      checked={settings.expireNotifyDays > 0}
                      onCheckedChange={(v) => handleUpdateSettings({ expireNotifyDays: v ? 3 : 0 })}
                    />
                  </div>
                  {settings.expireNotifyDays > 0 && (
                    <div className="flex items-center gap-1.5">
                      {[1, 3, 5, 7].map((d) => (
                        <Button
                          key={d}
                          size="sm"
                          variant={settings.expireNotifyDays === d ? 'default' : 'outline'}
                          onClick={() => handleUpdateSettings({ expireNotifyDays: d })}
                          className="text-xs h-7 w-9"
                        >
                          {d}
                        </Button>
                      ))}
                      <span className="text-[11px] text-muted-foreground ml-1">
                        Уведомлять за (дней)
                      </span>
                    </div>
                  )}
                  {subscription?.expireDate && (
                    <p className="text-[11px] text-muted-foreground">
                      Текущая подписка действует до {subscription.expireDate}.
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Настройки пинга */}
            <Card className="cyber-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="h-4 w-4 text-primary" />
                  Настройки пинга
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Протокол пинга</Label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                    {(['incy', 'tcp', 'http_get', 'http_head'] as const).map((proto) => (
                      <Button
                        key={proto}
                        size="sm"
                        variant={settings.pingProtocol === proto ? 'default' : 'outline'}
                        onClick={() => handleUpdateSettings({ pingProtocol: proto })}
                        className="text-xs h-7 uppercase font-mono"
                      >
                        {proto === 'incy' ? 'LAZEYKA' : proto}
                      </Button>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {settings.pingProtocol === 'incy'
                      ? 'TCP-рукопожатие с портом сервера, а для Hysteria2 — настоящее QUIC-подключение через ядро.'
                      : settings.pingProtocol === 'tcp'
                      ? 'Только TCP-рукопожатие. Самый быстрый способ, но Hysteria2-серверы без TCP покажут n/a.'
                      : 'Настоящий запрос по тестовому URL через сам сервер. Медленнее, зато проверяет, что трафик реально идёт.'}
                  </p>
                </div>

                <div className="space-y-1.5 pt-2 border-t border-border/50">
                  <Label className="text-xs font-semibold">Отображение пинга</Label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                    {(
                      [
                        { id: 'numbers', label: 'Цифры' },
                        { id: 'bar', label: 'Шкала' },
                        { id: 'both', label: 'Оба' },
                        { id: 'dots', label: 'Точки' }
                      ] as const
                    ).map((mode) => (
                      <Button
                        key={mode.id}
                        size="sm"
                        variant={settings.pingDisplay === mode.id ? 'default' : 'outline'}
                        onClick={() => handleUpdateSettings({ pingDisplay: mode.id })}
                        className="text-xs h-7"
                      >
                        {mode.label}
                      </Button>
                    ))}
                  </div>
                  <div className="flex items-center gap-3 pt-1">
                    <span className="text-[11px] text-muted-foreground">Пример:</span>
                    <LatencyBadge
                      node={{ latencyMs: 48, latencyAt: Date.now() }}
                      display={settings.pingDisplay}
                    />
                    <LatencyBadge
                      node={{ latencyMs: 180, latencyAt: Date.now() }}
                      display={settings.pingDisplay}
                    />
                    <LatencyBadge
                      node={{ latencyMs: 340, latencyAt: Date.now() }}
                      display={settings.pingDisplay}
                    />
                  </div>
                </div>

                <div className="space-y-1.5 pt-2 border-t border-border/50">
                  <Label className="text-xs font-semibold">Тестовый URL</Label>
                  <Input
                    value={settings.pingTestUrl}
                    onChange={(e) => handleUpdateSettings({ pingTestUrl: e.target.value })}
                    className="h-7 text-xs font-mono"
                  />
                  <div className="flex gap-1.5 pt-1">
                    {[
                      { name: 'Google 204', url: 'https://www.gstatic.com/generate_204' },
                      { name: 'Cloudflare', url: 'https://cp.cloudflare.com/generate_204' },
                      { name: 'Apple', url: 'https://captive.apple.com/hotspot-detect.html' }
                    ].map((preset) => (
                      <Button
                        key={preset.name}
                        size="sm"
                        variant="ghost"
                        onClick={() => handleUpdateSettings({ pingTestUrl: preset.url })}
                        className="text-[11px] h-6 text-muted-foreground"
                      >
                        {preset.name}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-border/50">
                  <div className="flex flex-col">
                    <Label className="text-sm">Таймаут пинга</Label>
                    <span className="text-xs text-muted-foreground">Максимальное время ожидания ответа</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="icon-sm"
                      variant="outline"
                      onClick={() => handleUpdateSettings({ pingTimeoutSec: Math.max(1, settings.pingTimeoutSec - 1) })}
                    >
                      -
                    </Button>
                    <span className="text-xs font-mono font-bold w-6 text-center">{settings.pingTimeoutSec}s</span>
                    <Button
                      size="icon-sm"
                      variant="outline"
                      onClick={() => handleUpdateSettings({ pingTimeoutSec: Math.min(10, settings.pingTimeoutSec + 1) })}
                    >
                      +
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Производительность */}
            <Card className="cyber-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Cpu className="h-4 w-4 text-primary" />
                  Производительность и соединения
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex flex-col">
                    <Label className="text-sm">Тайм-аут простоя<NotWired reason="Не применяется: подстановка этого значения в ядро рвала длинные UDP-сессии (звонки, игры). Используется штатный таймаут sing-box — 5 минут." /></Label>
                    <span className="text-xs text-muted-foreground">Закрывать неактивные соединения через</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="icon-sm"
                      variant="outline"
                      onClick={() => handleUpdateSettings({ idleTimeoutSec: Math.max(10, settings.idleTimeoutSec - 10) })}
                    >
                      -
                    </Button>
                    <span className="text-xs font-mono font-bold w-10 text-center">{settings.idleTimeoutSec}s</span>
                    <Button
                      size="icon-sm"
                      variant="outline"
                      onClick={() => handleUpdateSettings({ idleTimeoutSec: Math.min(300, settings.idleTimeoutSec + 10) })}
                    >
                      +
                    </Button>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex flex-col">
                    <Label className="text-sm">Макс. TCP соединений<NotWired reason="Ни sing-box, ни Xray не позволяют ограничить число соединений — эквивалента этой настройке в ядрах нет." /></Label>
                    <span className="text-xs text-muted-foreground">Лимит параллельных TCP потоков</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="icon-sm"
                      variant="outline"
                      onClick={() => handleUpdateSettings({ maxTcpConnections: Math.max(32, settings.maxTcpConnections - 32) })}
                    >
                      -
                    </Button>
                    <span className="text-xs font-mono font-bold w-10 text-center">{settings.maxTcpConnections}</span>
                    <Button
                      size="icon-sm"
                      variant="outline"
                      onClick={() => handleUpdateSettings({ maxTcpConnections: Math.min(1024, settings.maxTcpConnections + 32) })}
                    >
                      +
                    </Button>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex flex-col">
                    <Label className="text-sm">Макс. UDP соединений<NotWired reason="Ни sing-box, ни Xray не позволяют ограничить число соединений — эквивалента этой настройке в ядрах нет." /></Label>
                    <span className="text-xs text-muted-foreground">Лимит параллельных UDP потоков</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="icon-sm"
                      variant="outline"
                      onClick={() => handleUpdateSettings({ maxUdpConnections: Math.max(16, settings.maxUdpConnections - 16) })}
                    >
                      -
                    </Button>
                    <span className="text-xs font-mono font-bold w-10 text-center">{settings.maxUdpConnections}</span>
                    <Button
                      size="icon-sm"
                      variant="outline"
                      onClick={() => handleUpdateSettings({ maxUdpConnections: Math.min(512, settings.maxUdpConnections + 16) })}
                    >
                      +
                    </Button>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-border/50">
                  <div className="flex flex-col">
                    <Label className="text-sm">Отключать при переходе в спящий режим</Label>
                    <span className="text-xs text-muted-foreground">Автоматически разрывать туннель при сне</span>
                  </div>
                  <Switch
                    checked={settings.disconnectOnSleep}
                    onCheckedChange={(v) => handleUpdateSettings({ disconnectOnSleep: v })}
                  />
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-border/50">
                  <div className="flex flex-col">
                    <Label className="text-sm">Монитор памяти</Label>
                    <span className="text-xs text-muted-foreground">
                      Показывать расход памяти ядрами на главном экране
                    </span>
                  </div>
                  <Switch
                    checked={settings.memoryMonitor}
                    onCheckedChange={(v) => handleUpdateSettings({ memoryMonitor: v })}
                  />
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* TAB 4: STATS */}
        {activeTab === 'stats' && <StatsTab stats={stats} isConnected={isConnected} onReset={handleResetStats} />}

        {/* TAB 5: LOGS */}
        {activeTab === 'logs' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs text-muted-foreground">
                Логи туннеля sing-box / INCY в реальном времени:
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={handleExportLogs} className="gap-1.5 text-xs h-7">
                  <Download className="h-3 w-3" /> Экспорт
                </Button>
                <Button size="sm" variant="outline" onClick={handleCopyLogs} className="gap-1.5 text-xs h-7">
                  <Copy className="h-3 w-3" /> Копировать
                </Button>
                <Button size="sm" variant="ghost" onClick={handleClearLogs} className="gap-1.5 text-xs h-7 text-destructive">
                  <Trash2 className="h-3 w-3" /> Очистить
                </Button>
              </div>
            </div>

            <div className="p-3 rounded-xl border border-border bg-zinc-950 text-zinc-300 font-mono text-[11px] h-96 overflow-y-auto space-y-1 select-text">
              {logs.length > 0 ? (
                logs.map((line, idx) => (
                  <div key={idx} className="leading-relaxed break-all">
                    {line}
                  </div>
                ))
              ) : (
                <div className="text-center py-20 text-zinc-600">
                  Подключитесь к серверу для начала записи логов
                </div>
              )}
              <div ref={logEndRef} />
            </div>
          </div>
        )}

        {/* TAB 6: BACKUP */}
        {activeTab === 'backup' && <BackupTab onRestored={loadData} />}

        {/* TAB 7: URL SCHEMES */}
        {activeTab === 'urls' && <UrlSchemesTab />}
      </div>
    </BasePage>
  )
}
