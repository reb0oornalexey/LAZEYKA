import { appLabel } from '@renderer/utils/per-app'
import { Hint } from '@renderer/components/prematch/hint'
import ConnectionsPanel from '@renderer/components/incy/connections-panel'
import { OpsIconButton, OpsSplitButton, OpsStatusLine, useIncyOps, type ScopeOption } from '@renderer/components/incy/ping-ops-control'
import type { OpScope, OpSnapshot } from '@renderer/utils/incy-ops-api'
import { chainExitCheck, chainGet, chainProbe, type ChainInfo } from '@renderer/utils/incy-extra-api'
import NodeChainCard from '@renderer/components/incy/node-chain-card'
import { SubIcon } from '@renderer/components/incy/sub-icon'
import RouteMemoryCard from '@renderer/components/incy/route-memory-card'
import { SubscriptionProviderInfo, NodeProviderFragmentNote } from '@renderer/components/incy/provider-info'
import { WindowedRows } from '@renderer/components/incy/windowed-rows'
import { IncyConsole, BusyLine, type ConnMode, type RouteMode } from '@renderer/components/incy/incy-console'
import { SubscriptionTile, SubAnnouncements, SubLinks } from '@renderer/components/incy/subscription-tile'
import { AutoSelectTile } from '@renderer/components/incy/auto-select-tile'
import { SpeedTile } from '@renderer/components/incy/speed-tile'
import { VelvetOffer } from '@renderer/components/incy/velvet-offer'
import { SignalBars, ProtocolTag, subUsage, daysText, gb } from '@renderer/components/incy/signal'
import { LzPanel, LzSectionHead, Segmented, StatChip, EmptyState, type LzTone, type SegmentedItem } from '@renderer/components/lz'
import TrafficChip from '@renderer/components/home/traffic-chip'
import { useLiveTraffic } from '@renderer/components/home/use-live-traffic'
import {
  IgnoreProviderSettingsRow,
  SecureServerLookupRow,
  VerboseCoreLogRow,
  MtuPicker,
  ExcludedRoutesEditor,
  KillSwitchResetRow,
  DraftField,
  validPackets,
  validRange,
  MixedPortField,
  ExtraBypassEditor,
  SniffingRow,
  QuicBlockRow,
  ApplyNote
} from '@renderer/components/incy/tunnel-extras'
import React, { useEffect, useState, useMemo, useRef, memo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTourTab } from '@renderer/lib/tour-focus'
import { toast } from 'sonner'
import {
  Power,
  RefreshCw,
  Plus,
  Search,
  Server,
  Settings as SettingsIcon,
  Activity,
  Lock,
  Wifi,
  BarChart2,
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
  Split,
  Globe2,
  ShieldOff,
  QrCode,
  FileUp,
  Gamepad2,
  Monitor,
  FolderOpen,
  X,
  Globe,
  ArrowRight,
  ShieldAlert,
  Zap
} from 'lucide-react'
import BasePage from '@renderer/components/base/base-page'
import SplitTunnelingCard from '@renderer/components/split-tunneling-card'
import { WarpCard } from '@renderer/components/warp-card'
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Badge } from '@renderer/components/ui/badge'
import { Switch } from '@renderer/components/ui/switch'
import { Label } from '@renderer/components/ui/label'
import {
  incyGetNodes,
  incyRemoveNode,
  incyClearManualNodes,
  incyGetSubscription,
  incyGetSettings,
  incyPatchSettings,
  incyImportInput,
  incyGetSubscriptions,
  incyGetHwidHeaders,
  incyRemoveSubscription,
  incyGetStatus,
  incyConnect,
  incyDisconnect,
  incySelectNode,
  incySetConnectionMode,
  incySetRoutingMode,
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
  dialogPickImageFile,
  dialogPickWireGuardConf,
  clipboardReadImage,
  systemCaptureScreens,
  type GeoCategoryInfo,
  type GeoUpdateInfo,
  type IncyHwidHeaders,
  type IncyBackupPreview,
  type IncyBackupParts,
  type IncyNode,
  type IncySubscription,
  type IncySettings,
  type IncyStatus,
  type IncyStats
} from '@renderer/utils/ipc'
import { incyUpdateSingBoxNow } from '@renderer/utils/ipc'
import { decodeQrFromDataUrl } from '@renderer/utils/qr-scanner'
import { useIncyStore } from '@renderer/store/incy-store'
import { cn, POWER_ON_BANNER_STYLE } from '@renderer/lib/utils'
import { getFlagEmoji } from '@renderer/lib/country-flag'

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
  if (typeof node.latencyMs === 'number' && Number.isFinite(node.latencyMs)) {
    return { text: `${node.latencyMs} мс`, measured: true, unreachable: false }
  }
  if (node.latencyAt) {
    return { text: 'нет ответа', measured: true, unreachable: true }
  }
  return { text: '—', measured: false, unreachable: false }
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
}> = ({ node, display = 'numbers' }) => {
  const info = formatLatency(node)
  const tier = info.unreachable ? 'bad' : info.measured ? latencyTier(node.latencyMs) : 'none'

  const textClass =
    tier === 'good'
      ? 'text-st-ok-text'
      : tier === 'mid'
        ? 'text-st-warn-text'
        : tier === 'bad'
          ? 'text-st-err-text'
          : 'text-muted-foreground'

  const fillClass =
    tier === 'good'
      ? 'bg-st-ok'
      : tier === 'mid'
        ? 'bg-st-warn'
        : tier === 'bad'
          ? 'bg-st-err'
          : 'bg-muted-foreground/30'

  // 0 ms → full bar, 400 ms and worse → empty. Linear in between.
  const pct =
    node.latencyMs === null ? 0 : Math.max(6, Math.round(100 - Math.min(node.latencyMs, 400) / 4))
  // Four dots: one lit per 100 ms band still under the measured value.
  const litDots = node.latencyMs === null ? 0 : Math.max(1, 4 - Math.floor(Math.min(node.latencyMs, 399) / 100))

  const label = (
    <span className={cn('min-w-[3.6rem] text-right text-[12px] font-semibold tabular-nums', textClass)}>{info.text}</span>
  )

  if (display === 'dots') {
    return (
      <span title={info.text} className="flex items-center gap-[3px] px-1.5 py-1" aria-label={`Задержка: ${info.text}`}>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={cn('size-1.5 rounded-full', i < litDots ? fillClass : 'bg-foreground/12')} />
        ))}
      </span>
    )
  }

  if (display === 'bar' || display === 'both') {
    return (
      <span title={info.text} className="flex items-center gap-2 px-1 py-1" aria-label={`Задержка: ${info.text}`}>
        <span className="h-1.5 w-12 overflow-hidden rounded-full bg-foreground/10">
          <span className={cn('block h-full rounded-full', fillClass)} style={{ width: `${pct}%` }} />
        </span>
        {display === 'both' && label}
      </span>
    )
  }

  // «Цифры»: число и деления силы сигнала рядом.
  return (
    <span className="flex items-center gap-2 px-1 py-1" aria-label={`Задержка: ${info.text}`}>
      <SignalBars ms={node.latencyMs} unreachable={info.unreachable} height={13} />
      {label}
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
    className="ml-2 inline-flex items-center rounded-full border border-st-warn/40 bg-st-warn/10 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-st-warn-text align-middle cursor-help"
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
      <div className="h-full bg-st-ok" style={{ width: `${sentPct}%` }} />
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
        <div className="flex items-start gap-2 p-3 rounded-xl border border-st-warn/40 bg-st-warn/10 text-[11px] text-st-warn-text">
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
                  <span className="h-1.5 w-1.5 rounded-full bg-st-ok" /> Отправлено
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
                  <span className="h-1.5 w-1.5 rounded-full bg-st-ok" /> Отправлено
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
        subscription: Boolean(res.subscriptionTitles?.length || res.subscriptionTitle),
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
                    label:
                      (preview.subscriptionTitles?.length ?? 0) > 1 ? 'Подписки' : 'Подписка',
                    // Перечисляем все: восстановление заменит список целиком,
                    // и человек должен видеть, что именно приедет.
                    detail:
                      preview.subscriptionTitles?.join(', ') ||
                      preview.subscriptionTitle ||
                      'нет в файле',
                    available: Boolean(
                      preview.subscriptionTitles?.length || preview.subscriptionTitle
                    )
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
/**
 * Отправка идентификатора устройства провайдеру подписки.
 *
 * Панели вроде Remnawave ограничивают число устройств на одну подписку и
 * узнают их по заголовку `x-hwid`. Если у провайдера это включено, а клиент
 * заголовок не шлёт, подписка не загружается вовсе — поэтому выключатель здесь
 * не украшение: от него зависит, работает ли VPN.
 *
 * Когда провайдер требует HWID, переключатель заблокирован во включённом
 * положении: выбора в этот момент всё равно нет, и притворяться, что он есть,
 * значило бы предлагать способ сломать себе подписку.
 */
const HwidCard: React.FC<{
  settings: IncySettings
  subscriptions: IncySubscription[]
  onUpdate: (patch: Partial<IncySettings>) => void | Promise<void>
}> = ({ settings, subscriptions, onUpdate }) => {
  const [headers, setHeaders] = useState<IncyHwidHeaders | null>(null)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    incyGetHwidHeaders().then(setHeaders).catch(() => {})
  }, [])

  const required = subscriptions.some((s) => s.hwidRequired)
  const limitReached = subscriptions.filter((s) => s.hwidLimitReached)
  const enabled = settings.sendHwid !== false

  return (
    <div className="space-y-2 pt-2 border-t border-border/50">
      <div className="flex items-center justify-between">
        <div className="flex flex-col min-w-0">
          <Label className="text-sm">Отправлять HWID</Label>
          <span className="text-xs text-muted-foreground">
            {required
              ? 'Задано провайдером подписки'
              : 'Нужно провайдерам, которые ограничивают число устройств на подписку'}
          </span>
        </div>
        <Switch
          checked={required ? true : enabled}
          disabled={required}
          onCheckedChange={(v) => onUpdate({ sendHwid: v })}
        />
      </div>

      {limitReached.length > 0 && (
        <div className="p-2.5 rounded-xl border border-st-warn/40 bg-st-warn/10 text-[11px] leading-relaxed text-st-warn-text">
          Лимит устройств исчерпан у подписки «{limitReached[0].title}». Удалите лишнее устройство
          в личном кабинете провайдера — иначе подписка перестанет обновляться.
        </div>
      )}

      <button
        type="button"
        onClick={() => setShown((v) => !v)}
        className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors"
      >
        {shown ? 'Скрыть, что отправляется' : 'Показать, что отправляется'}
      </button>

      {shown && (
        <div className="p-2.5 rounded-xl border border-border/60 bg-card/40 space-y-1 font-mono text-[10px] text-muted-foreground select-text">
          {headers ? (
            Object.entries(headers).map(([k, v]) => (
              <div key={k} className="truncate">
                <span className="text-foreground/70">{k}:</span> {v}
              </div>
            ))
          ) : (
            <div>Читаем идентификатор устройства…</div>
          )}
          <div className="pt-1.5 font-sans text-[11px] leading-relaxed">
            Идентификатор — это необратимый хэш от системного номера установки Windows: провайдер
            видит устройство как одно и то же, но восстановить из него что-либо о вас нельзя. Имя
            компьютера отправляется, чтобы вы узнали свою машину в списке устройств у провайдера.
          </div>
        </div>
      )}
    </div>
  )
}

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
    t === 'direct' ? 'bg-st-ok' : t === 'proxy' ? 'bg-primary' : 'bg-st-err'

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
          <div className="flex items-start gap-2 p-2.5 rounded-lg border border-st-warn/40 bg-st-warn/10 text-[11px] text-st-warn-text">
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
      ? 'border-st-warn/40 text-st-warn-text bg-st-warn/10'
      : 'border-st-ok/40 text-st-ok-text bg-st-ok/10'

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
                  ? 'border-primary/60 bg-primary/10 '
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
          <p className="text-[11px] text-st-warn-text">
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


const nodeKey = (n: IncyNode): string => n.id

/** Обработчики строки сервера; объект один на всё время жизни страницы. */
interface ServerRowActions {
  select: (id: string) => void
  connect: (id: string) => void
  disconnect: () => void
  remove: (node: IncyNode) => void
  /** Проверить пинг одного сервера (через общий менеджер). */
  ping: (id: string) => void
}

/**
 * Строка сервера на вкладке «Сервера».
 *
 * Отдельный memo-компонент: во время замера пинга и подключения страница
 * перерисовывается часто, а строк в подписке бывает несколько сотен. Строка
 * перерисовывается, только когда меняется её узел или её флаги.
 */
const ServerRow = memo(function ServerRow({
  node,
  isNodeActive,
  isNodeSelected,
  isPinging,
  pingDisplay,
  settings,
  isManual,
  actions
}: {
  node: IncyNode
  isNodeActive: boolean
  isNodeSelected: boolean
  isPinging: boolean
  pingDisplay: IncySettings['pingDisplay'] | undefined
  settings: IncySettings | null
  isManual: boolean
  actions: ServerRowActions
}): React.ReactElement {
  const flag = getFlagEmoji(node.name)
  const cleanName = cleanServerName(node.name)

  return (
    <div
      className={cn(
        'group relative flex items-center gap-2 overflow-hidden rounded-xl border py-1.5 pr-1.5 pl-2 transition-[background-color,border-color] duration-200',
        isNodeActive
          ? 'border-primary/50 bg-primary/[0.11]'
          : isNodeSelected
            ? 'border-primary/30 bg-primary/[0.05]'
            : 'border-foreground/[0.07] bg-foreground/[0.025] hover:border-foreground/[0.14] hover:bg-foreground/[0.05]'
      )}
    >
      {/* Полоса сигнала слева: горит у подключённого, тлеет у выбранного. */}
      <span
        aria-hidden
        className={cn(
          'absolute inset-y-2 left-0 w-[3px] rounded-r-full transition-colors',
          isNodeActive ? 'bg-primary' : isNodeSelected ? 'bg-primary/55' : 'bg-transparent'
        )}
        style={isNodeActive ? { boxShadow: '0 0 10px var(--primary)' } : undefined}
      />
      <button
        type="button"
        onClick={() => actions.select(node.id)}
        title={isNodeSelected ? 'Выбранный узел' : 'Выбрать этот узел'}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-lg py-0.5 pl-1 text-left"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.05] text-[20px] leading-none select-none">
          {flag || <Globe className="size-4 text-muted-foreground" />}
        </span>
        <span className="min-w-0">
          <span className="flex min-w-0 items-center gap-2">
            <span data-sensitive="node" className="truncate text-[13px] font-semibold text-foreground">
              {cleanName}
            </span>
            <ProtocolTag protocol={node.protocol} json={Boolean(node.rawJson)} />
            <NodeProviderFragmentNote node={node} settings={settings} />
          </span>
          <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">
            {node.description ? <span data-sensitive="node">{node.description}</span> : <span data-sensitive="ip">{`${node.server}:${node.port}`}</span>}
          </span>
        </span>
      </button>

      <div className="flex shrink-0 items-center gap-1.5">
        {isPinging ? (
          <span className="flex min-w-[5.5rem] items-center justify-end gap-1.5 px-1 text-[11.5px] text-primary">
            <span className="size-3 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
            замер
          </span>
        ) : (
          <button
            type="button"
            onClick={() => actions.ping(node.id)}
            title="Проверить пинг этого сервера"
            className="cursor-pointer rounded-lg transition-colors hover:bg-foreground/[0.06]"
          >
            <LatencyBadge node={node} display={pingDisplay} strong />
          </button>
        )}

        <Button
          size="sm"
          variant={isNodeActive ? 'default' : 'outline'}
          onClick={() => {
            if (isNodeActive) {
              actions.disconnect()
            } else {
              actions.connect(node.id)
            }
          }}
          title={isNodeActive ? 'Отключить VPN' : 'Подключиться к этому узлу'}
          className={cn('h-8 min-w-[104px] gap-1.5 rounded-lg text-xs', !isNodeActive && 'opacity-80 group-hover:opacity-100')}
        >
          <Power className="size-3.5" />
          {isNodeActive ? 'Подключён' : 'Подключить'}
        </Button>

        {isManual && (
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation()
              actions.remove(node)
            }}
            title="Удалить сервер"
            className="h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  )
})

/**
 * Секунды с начала подключения/отключения. Свой таймер у маленького
 * компонента: раньше тик перерисовывал всю страницу INCY вместе со списком.
 * Компонент монтируется в начале ожидания, поэтому отсчёт идёт от монтирования.
 */
function useElapsedSeconds(): number {
  const [started] = useState(() => Date.now())
  const [sec, setSec] = useState(0)
  useEffect(() => {
    const id = setInterval(() => {
      setSec(Math.floor((Date.now() - started) / 1000))
    }, 250)
    return () => clearInterval(id)
  }, [started])
  return sec
}

const BusySeconds: React.FC = () => {
  const sec = useElapsedSeconds()
  if (sec <= 0) return null
  return <span className="text-[10px] font-mono tabular-nums text-primary/80">{sec} с</span>
}

/**
 * Rough phase hint driven by elapsed time. The engine does not report
 * sub-steps, but the durations are known and stable: config generation and
 * `sing-box check` land well under a second, core startup is verified at
 * ~0.8 s, and anything past ~8 s means the server itself is not answering.
 * Saying so is far more useful than a static "please wait".
 */
const BusyHint: React.FC<{ disconnecting: boolean }> = ({ disconnecting }) => {
  const sec = useElapsedSeconds()
  return (
    <>
      {disconnecting
        ? 'Останавливаем туннель и снимаем системный прокси…'
        : sec < 1
          ? 'Собираем конфигурацию и проверяем её ядром…'
          : sec < 3
            ? 'Запускаем ядро и поднимаем туннель…'
            : sec < 8
              ? 'Ожидаем ответ сервера…'
              : 'Сервер не отвечает — возможно, узел недоступен. Можно выбрать другой.'}
    </>
  )
}

/**
 * Guards the launch ping sweep so it runs once per app session rather than on
 * every visit to the INCY tab. Module scope, not a ref: the page unmounts when
 * the user navigates away, and a ref would reset with it.
 */
let launchPingDone = false

export default function IncyPage(): React.ReactElement {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<
    'main' | 'servers' | 'routing' | 'settings' | 'stats'
  >('main')
  useTourTab<'main' | 'servers' | 'routing' | 'settings' | 'stats'>('/incy', setActiveTab)
  const [nodes, setNodes] = useState<IncyNode[]>([])
  /** «Текущая» подписка — та, которой принадлежит выбранный сервер. */
  const [subscription, setSubscription] = useState<IncySubscription | null>(null)
  /** Все подписки пользователя; на вкладке «Сервера» у каждой своя карточка. */
  const [subscriptions, setSubscriptions] = useState<IncySubscription[]>([])
  /** Какие карточки подписок свёрнуты: с пятью провайдерами список иначе не читается. */
  const [collapsedSubs, setCollapsedSubs] = useState<Set<string>>(new Set())
  const [removingSub, setRemovingSub] = useState<IncySubscription | null>(null)
  const [settings, setSettings] = useState<IncySettings | null>(null)
  const storeStatus = useIncyStore((s) => s.status)
  const [status, setStatus] = useState<IncyStatus>(storeStatus)
  const [stats, setStats] = useState<IncyStats | null>(null)

  useEffect(() => {
    setStatus(storeStatus)
  }, [storeStatus])

  const [inputUrl, setInputUrl] = useState('')
  const [loadingImport, setLoadingImport] = useState(false)
  const [coreMemory, setCoreMemory] = useState<CoreMemoryUsage | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [protocolFilter, setProtocolFilter] = useState<'all' | 'vless' | 'hysteria2' | 'wireguard'>('all')
  // «Только рабочие»: серверы, ответившие на последний замер пинга.
  const [onlyWorking, setOnlyWorking] = useState(false)
  const [showServerSelectModal, setShowServerSelectModal] = useState(false)
  const [showQrModal, setShowQrModal] = useState(false)
  // Окна выбора узла и QR закрываются по Esc.
  useEffect(() => {
    if (!showServerSelectModal && !showQrModal) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      setShowServerSelectModal(false)
      setShowQrModal(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showServerSelectModal, showQrModal])
  /** Блок Cloudflare WARP на «Серверах»: свёрнут, пока есть другие серверы (выбор запоминается). */
  const [warpOpen, setWarpOpen] = useState(() => {
    try {
      return localStorage.getItem('lazeyka.incy.warpOpen') === '1'
    } catch {
      return false
    }
  })
  const setWarpOpenSaved = (v: boolean): void => {
    setWarpOpen(v)
    try {
      localStorage.setItem('lazeyka.incy.warpOpen', v ? '1' : '0')
    } catch {
      /* noop */
    }
  }
  const [scanningQr, setScanningQr] = useState(false)

  /**
   * «Проверить пинг» и «Обновить подписки» идут в главном процессе через общий менеджер (его же видит пульт
   * с телефона). Сюда приходит ход: полученные числа сразу показываются в строках, а после каждой обновлённой
   * подписки и в конце действия списки перечитываются с диска.
   */
  const lastOpRef = useRef<{ seq: number; done: number; running: boolean } | null>(null)
  /**
   * Последние замеры пинга в этом окне (id → результат). Список серверов перечитывается с диска при
   * каждой смене состояния VPN и после выбора сервера; если на диске замер старше (или его ещё нет —
   * проверка идёт), берём наш. Иначе выбор/подключение во время проверки «сбрасывал» все пинги.
   */
  const pingMemoRef = useRef<Map<string, { latencyMs: number | null; at: number }>>(new Map())
  const withPingMemo = (list: IncyNode[]): IncyNode[] => {
    const memo = pingMemoRef.current
    if (memo.size === 0) return list
    const now = Date.now()
    let changed = false
    const out = list.map((n) => {
      const r = memo.get(n.id)
      if (!r || now - r.at > 15 * 60_000) return n
      if ((n.latencyAt ?? 0) >= r.at) return n
      changed = true
      return { ...n, latencyMs: r.latencyMs, latencyAt: r.at }
    })
    return changed ? out : list
  }
  const reloadLists = async (): Promise<void> => {
    const [n, subs, cur] = await Promise.all([incyGetNodes(), incyGetSubscriptions(), incyGetSubscription()])
    setNodes(withPingMemo(n))
    setSubscriptions(subs)
    setSubscription(cur)
  }
  const handleOpsSnapshot = (snap: OpSnapshot): void => {
    const v = snap.view
    if (v?.running && v.kind === 'ping') {
      const res = snap.results
      for (const [id, r] of Object.entries(res)) pingMemoRef.current.set(id, r)
      setNodes((prev) => {
        let changed = false
        const next = prev.map((n) => {
          const r = res[n.id]
          if (!r || (n.latencyAt === r.at && n.latencyMs === r.latencyMs)) return n
          changed = true
          return { ...n, latencyMs: r.latencyMs, latencyAt: r.at }
        })
        return changed ? next : prev
      })
    }
    const before = lastOpRef.current
    lastOpRef.current = v ? { seq: v.seq, done: v.done, running: v.running } : null
    if (!v) return
    const finishedNow = Boolean(before && before.seq === v.seq && before.running && !v.running)
    const refreshStep = v.kind === 'refresh' && v.running && v.done > 0 && (!before || before.seq !== v.seq || before.done !== v.done)
    if (finishedNow || refreshStep) void reloadLists().catch(() => void 0)
  }
  const ops = useIncyOps(handleOpsSnapshot)
  const opView = ops.running
  const testingPings = opView?.kind === 'ping'
  const loadingRefresh = opView?.kind === 'refresh'
  const refreshingSubId = opView?.kind === 'refresh' && opView.scope === 'sub' ? (opView.subId ?? null) : null
  const pingingNodeIds = useMemo(() => {
    const snap = ops.snap
    if (!snap?.view?.running || snap.view.kind !== 'ping') return new Set<string>()
    return new Set(snap.targetIds.filter((id) => !(id in snap.results)))
  }, [ops.snap])
  const startPing = (scope: OpScope = { type: 'all' }): void => {
    void ops.start('ping', scope)
  }

  const loadData = async (): Promise<void> => {
    try {
      const [n, s, sub, subs, st, stData] = await Promise.all([
        incyGetNodes(),
        incyGetSettings(),
        incyGetSubscription(),
        incyGetSubscriptions(),
        incyGetStatus(),
        incyGetStats()
      ])
      setNodes(withPingMemo(n))
      setSettings(s)
      setSubscriptions(subs)
      // Не затираем показанную подписку пустотой: при кратком сбое чтения
      // карточка на главной иначе моргала бы «подписки нет».
      if (sub) setSubscription(sub)
      else if (subs.length === 0) setSubscription(null)
      setStatus(st)
      setStats(stData)
    } catch { /* ignore */ }
  }

  // Подписки обновились в фоне (при запуске / по расписанию) — перечитать.
  useEffect(() => {
    const onChanged = (): void => void loadData()
    window.electron.ipcRenderer.on('incy:nodesChanged', onChanged)
    return () => {
      window.electron.ipcRenderer.removeAllListeners('incy:nodesChanged')
    }
  }, [])

  // Провайдер перенёс подписку на новый адрес (заголовок new-url / new-domain).
  useEffect(() => {
    const onMoved = (): void => {
      toast.success('Провайдер перенёс подписку на новый адрес')
      void loadData()
    }
    const offMoved = window.electron.ipcRenderer.on('incy:subscriptionMoved', onMoved)
    return () => {
      offMoved()
    }
  }, [])

  useEffect(() => {
    void loadData()
    const timer = setInterval(() => {
      if (document.visibilityState === 'hidden') return
      // Also refresh while stopped when the Statistics tab is open: the totals
      // and the weekly chart are persisted, so they are worth showing (and
      // updating after a reset) even with the tunnel down.
      // Цифры видны только на вкладке «Статистика» — только тогда и спрашиваем.
      // Пульт на «Главной» показывает трафик сессии — пока VPN подключён.
      if (activeTab === 'stats' || (activeTab === 'main' && status.state === 'running')) {
        void incyGetStats().then(setStats).catch(() => {})
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

  const handleImport = async (override?: string, fileName?: string): Promise<void> => {
    const payload = (override ?? inputUrl).trim()
    if (!payload) return
    setLoadingImport(true)
    try {
      const res = await incyImportInput(payload, fileName)
      setNodes(res.nodes)
      if (res.subscription) setSubscription(res.subscription)
      // Ссылка могла добавить новую подписку — список нужно перечитать,
      // иначе её карточка не появится до перехода по вкладкам.
      setSubscriptions(await incyGetSubscriptions().catch(() => subscriptions))
      setInputUrl('')
      toast.success(`Импортировано серверов: ${res.addedCount}`, { style: POWER_ON_BANNER_STYLE })
      startPing()
    } catch (e: any) {
      toast.error('Ошибка импорта', { description: e?.message || String(e) })
    } finally {
      setLoadingImport(false)
    }
  }

  /** Импорт .conf WireGuard / AmneziaWG из файла. */
  const handleImportConfFile = async (): Promise<void> => {
    try {
      const picked = await dialogPickWireGuardConf()
      if (!picked) return
      await handleImport(picked.text, picked.name)
    } catch (e: any) {
      toast.error('Не удалось открыть файл', { description: e?.message || String(e) })
    }
  }

  const handleScanQrFromClipboard = async (): Promise<void> => {
    setScanningQr(true)
    try {
      const dataUrl = await clipboardReadImage()
      if (!dataUrl) {
        toast.info('В буфере обмена нет изображения', {
          description: 'Скопируйте картинку с QR-кодом (например, через Win+Shift+S) и нажмите кнопку снова.'
        })
        return
      }
      const code = await decodeQrFromDataUrl(dataUrl)
      if (!code) {
        toast.error('QR-код не распознан', {
          description: 'На изображении из буфера не удалось обнаружить QR-код.'
        })
        return
      }
      setShowQrModal(false)
      setInputUrl(code)
      await handleImport(code)
    } catch (err: any) {
      toast.error('Ошибка сканирования QR-кода', { description: err?.message || String(err) })
    } finally {
      setScanningQr(false)
    }
  }

  const handleScanQrFromScreen = async (): Promise<void> => {
    setScanningQr(true)
    try {
      toast.info('Сканирование экрана...', { duration: 1500 })
      const shots = await systemCaptureScreens()
      if (!shots || shots.length === 0) {
        toast.error('Не удалось сделать снимок экрана')
        return
      }
      let code: string | null = null
      for (const shot of shots) {
        code = await decodeQrFromDataUrl(shot)
        if (code) break
      }
      if (!code) {
        toast.error('QR-код не найден на экране', {
          description: 'Убедитесь, что QR-код виден на мониторе, или скопируйте его область в буфер обмена.'
        })
        return
      }
      setShowQrModal(false)
      setInputUrl(code)
      await handleImport(code)
    } catch (err: any) {
      toast.error('Ошибка сканирования экрана', { description: err?.message || String(err) })
    } finally {
      setScanningQr(false)
    }
  }

  const handleScanQrFromFile = async (): Promise<void> => {
    setScanningQr(true)
    try {
      const dataUrl = await dialogPickImageFile()
      if (!dataUrl) return
      const code = await decodeQrFromDataUrl(dataUrl)
      if (!code) {
        toast.error('QR-код не найден в файле', {
          description: 'Попробуйте изображение с более высоким качеством.'
        })
        return
      }
      setShowQrModal(false)
      setInputUrl(code)
      await handleImport(code)
    } catch (err: any) {
      toast.error('Ошибка распознавания файла', { description: err?.message || String(err) })
    } finally {
      setScanningQr(false)
    }
  }

  // Обновление подписок («Обновить», «Обновить все», «Только эту») — кнопки OpsSplitButton/OpsIconButton:
  // действие идёт в общем менеджере (incy-ops), итог и «Пинг после обновления» — там же.

  /** Удалить подписку вместе с её серверами. Ручные узлы остаются. */
  const handleRemoveSubscription = async (sub: IncySubscription): Promise<void> => {
    try {
      const res = await incyRemoveSubscription(sub.id)
      setNodes(res.nodes)
      setSubscriptions(res.subscriptions)
      const current = await incyGetSubscription().catch(() => null)
      setSubscription(current)
      setStatus(await incyGetStatus().catch(() => status))
      toast.success(`Подписка «${sub.title}» удалена`)
    } catch (e: any) {
      toast.error('Не удалось удалить подписку', { description: e?.message || String(e) })
    } finally {
      setRemovingSub(null)
    }
  }

  /** Удалить отдельный сервер (ручной или сохранённый). */
  const handleRemoveNode = async (node: IncyNode): Promise<void> => {
    try {
      const updatedNodes = await incyRemoveNode(node.id)
      setNodes(updatedNodes)
      setStatus(await incyGetStatus().catch(() => status))
      toast.success(`Сервер «${cleanServerName(node.name)}» удалён`)
    } catch (e: any) {
      toast.error('Не удалось удалить сервер', { description: e?.message || String(e) })
    }
  }

  /** Удалить все ручные/не привязанные серверы. */
  const handleClearManualNodes = async (): Promise<void> => {
    try {
      const updatedNodes = await incyClearManualNodes()
      setNodes(updatedNodes)
      setStatus(await incyGetStatus().catch(() => status))
      toast.success('Все ручные серверы удалены')
    } catch (e: any) {
      toast.error('Не удалось очистить серверы', { description: e?.message || String(e) })
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
    // Подсвечиваем выбор сразу, не дожидаясь ответа main-процесса: пока шёл
    // IPC (а при поднятом туннеле — ещё и переподключение), строка выглядела
    // ненажатой, и по ней кликали ещё раз.
    setStatus((s) => ({ ...s, selectedNodeId: nodeId }))
    try {
      const next = await incySelectNode(nodeId)
      setStatus(next)
      setShowServerSelectModal(false)
      const target = nodes.find((n) => n.id === nodeId)
      toast.success(`Выбран сервер: ${target?.name || 'Сервер'}`)
      // «Текущая подписка» на главной — это подписка выбранного сервера.
      // Без перечитывания карточка осталась бы от прежнего провайдера.
      void incyGetSubscription()
        .then((s) => { if (s) setSubscription(s) })
        .catch(() => {})
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
    if (ops.running) return
    launchPingDone = true
    const t = setTimeout(() => startPing(), 400)
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
    setSettings({ ...settings, ...patch })
    // Только изменённые поля: полный объект, загруженный при открытии
    // страницы, затирал изменения со страницы ExitLag и из трея.
    const res = await incyPatchSettings(patch)
    setSettings(res.settings)
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
    const byPing = (a: IncyNode, b: IncyNode): number => (a.latencyMs ?? 9999) - (b.latencyMs ?? 9999)
    const byName = (a: IncyNode, b: IncyNode): number => a.name.localeCompare(b.name)
    const cmpFor = (mode: string | undefined): ((a: IncyNode, b: IncyNode) => number) | null =>
      mode === 'ping' ? byPing : mode === 'name' ? byName : null
    const own = cmpFor(settings?.sortServersBy)
    // Порядок, предложенный провайдером (`sort-order`), действует только пока
    // человек сам ничего не выбрал: «по умолчанию» — это и есть «не выбирал».
    const providerOrder = new Map(subscriptions.map((s) => [s.id, s.sortOrder] as const))
    const list = [...nodes]
    if (own) return list.sort(own)
    if (![...providerOrder.values()].some((v) => v === 'ping' || v === 'name')) return list
    // Узлы разных подписок сортируются каждый по своей: сначала группируем.
    const groups = new Map<string, IncyNode[]>()
    for (const n of list) {
      const key = n.subscriptionId ?? ''
      groups.set(key, [...(groups.get(key) ?? []), n])
    }
    const out: IncyNode[] = []
    for (const [key, items] of groups) {
      const cmp = cmpFor(key ? providerOrder.get(key) : undefined)
      out.push(...(cmp ? [...items].sort(cmp) : items))
    }
    return out
  }, [nodes, settings?.sortServersBy, subscriptions])

  const filteredNodes = useMemo(() => {
    return sortedNodes.filter((n) => {
      if (protocolFilter !== 'all' && n.protocol !== protocolFilter) return false
      if (onlyWorking && n.latencyMs === null) return false
      if (!searchQuery.trim()) return true
      const q = searchQuery.toLowerCase()
      return (
        n.name.toLowerCase().includes(q) ||
        (n.description && n.description.toLowerCase().includes(q)) ||
        n.server.toLowerCase().includes(q) ||
        n.protocol.toLowerCase().includes(q)
      )
    })
  }, [sortedNodes, protocolFilter, searchQuery, onlyWorking])
  const workingCount = useMemo(() => nodes.filter((n) => n.latencyMs !== null).length, [nodes])
  const anyMeasured = useMemo(() => nodes.some((n) => n.latencyAt || n.latencyMs !== null), [nodes])

  /**
   * Узлы, не принадлежащие ни одной существующей подписке.
   *
   * Сюда попадают и добавленные вручную ссылкой, и «осиротевшие» — те, чья
   * подписка удалена не до конца (например, старой сборкой). Показать их всё
   * равно надо: иначе рабочий сервер молча исчез бы из списка.
   */
  const manualNodes = useMemo(
    () =>
      filteredNodes.filter(
        (n) => !n.subscriptionId || !subscriptions.some((s) => s.id === n.subscriptionId)
      ),
    [filteredNodes, subscriptions]
  )

  /**
   * Объём для «Проверить пинг» / «Обновить» (меню у стрелки). Множественного выбора в списке нет —
   * вместо «выбранных» есть «найденные»: то, что осталось после поиска и фильтров.
   */
  const pingScopeOptions = useMemo<ScopeOption[]>(() => {
    const out: ScopeOption[] = [{ key: 'all', label: 'Все серверы', count: nodes.length, scope: { type: 'all' } }]
    const filtered = filteredNodes.length !== nodes.length
    out.push({
      key: 'visible',
      label: 'Только найденные',
      count: filtered ? filteredNodes.length : undefined,
      hint: filtered ? 'То, что видно после поиска и фильтров' : 'Сначала задайте поиск или фильтр',
      disabled: !filtered || filteredNodes.length === 0,
      scope: { type: 'ids', ids: filteredNodes.map((n) => n.id), label: 'найденные' }
    })
    if (subscriptions.length > 1 || (subscriptions.length === 1 && nodes.some((n) => !n.subscriptionId))) {
      for (const sub of subscriptions) {
        const count = nodes.filter((n) => n.subscriptionId === sub.id).length
        out.push({ key: `sub:${sub.id}`, label: `Подписка «${sub.title}»`, count, disabled: count === 0, scope: { type: 'sub', subId: sub.id } })
      }
      const manual = nodes.filter((n) => !n.subscriptionId).length
      if (manual > 0) out.push({ key: 'manual', label: 'Добавленные вручную', count: manual, scope: { type: 'sub', subId: null } })
    }
    const sel = nodes.find((n) => n.id === (status.selectedNodeId || ''))
    if (sel) {
      out.push({
        key: 'one',
        label: `Один: ${cleanServerName(sel.name)}`,
        hint: 'Выбранный сервер. Любой другой — щелчок по его пингу в списке',
        scope: { type: 'ids', ids: [sel.id] }
      })
    }
    return out
  }, [nodes, filteredNodes, subscriptions, status.selectedNodeId])

  const refreshScopeOptions = useMemo<ScopeOption[]>(
    () => [
      { key: 'all', label: 'Обновить все', count: subscriptions.length, scope: { type: 'all' } },
      ...subscriptions.map<ScopeOption>((sub) => ({
        key: sub.id,
        label: `Только «${sub.title}»`,
        scope: { type: 'sub', subId: sub.id }
      }))
    ],
    [subscriptions]
  )

  /** Подписки, кроме текущей — для блока «Другие провайдеры» на главной. */
  const otherSubscriptions = useMemo(
    () => subscriptions.filter((s) => s.id !== subscription?.id),
    [subscriptions, subscription?.id]
  )

  /**
   * Сделать провайдера текущим: выбрать его самый быстрый сервер.
   *
   * Без замеров пинга берётся первый — порядок в подписке обычно осмысленный.
   * Если туннель поднят, `handleSelectNode` переподключит его сам.
   */
  const handleSwitchProvider = async (sub: IncySubscription): Promise<void> => {
    const candidates = nodes.filter((n) => n.subscriptionId === sub.id)
    if (candidates.length === 0) {
      toast.info(`У подписки «${sub.title}» нет серверов`, {
        description: 'Обновите её на вкладке «Сервера».'
      })
      return
    }
    const measured = candidates.filter((n) => typeof n.latencyMs === 'number')
    const best = measured.length
      ? measured.reduce((a, b) => ((a.latencyMs ?? 1e9) <= (b.latencyMs ?? 1e9) ? a : b))
      : candidates[0]
    await handleSelectNode(best.id)
  }

  const isConnected = status.state === 'running'
  const hasError = status.state === 'error'

  /**
   * Строка сервера на вкладке «Сервера».
   *
   * Вынесена в функцию, потому что список теперь рисуется в нескольких местах:
   * внутри карточки каждой подписки и отдельно для добавленных вручную.
   * Копия разметки на каждую группу разъехалась бы при первой же правке.
   */
  /**
   * Строка сервера на вкладке «Сервера» (см. ServerRow выше). Обработчики
   * берутся из ref, поэтому их ссылки не меняются от рендера к рендеру и
   * memo-строка перерисовывается, только когда меняются её собственные данные.
   */
  const rowHandlersRef = useRef({
    select: (_id: string): void => undefined,
    connect: (_id: string): void => undefined,
    disconnect: (): void => undefined,
    remove: (_node: IncyNode): void => undefined,
    ping: (_id: string): void => undefined
  })
  rowHandlersRef.current = {
    select: (id) => void handleSelectNode(id),
    connect: (id) => void handleConnect(id),
    disconnect: () => void handleDisconnect(),
    remove: (n) => void handleRemoveNode(n),
    ping: (id) => startPing({ type: 'ids', ids: [id] })
  }
  const rowActions = useMemo<ServerRowActions>(
    () => ({
      select: (id) => rowHandlersRef.current.select(id),
      connect: (id) => rowHandlersRef.current.connect(id),
      disconnect: () => rowHandlersRef.current.disconnect(),
      remove: (n) => rowHandlersRef.current.remove(n),
      ping: (id) => rowHandlersRef.current.ping(id)
    }),
    []
  )
  const selectedRowId = status.selectedNodeId || nodes[0]?.id
  const renderServerRow = (node: IncyNode, isManual = false): React.ReactElement => (
    <ServerRow
      key={node.id}
      node={node}
      isNodeActive={isConnected && status.activeNodeId === node.id}
      isNodeSelected={selectedRowId === node.id}
      isPinging={pingingNodeIds.has(node.id)}
      pingDisplay={settings?.pingDisplay}
      settings={settings}
      isManual={isManual}
      actions={rowActions}
    />
  )
  const renderAutoRow = (node: IncyNode): React.ReactElement => renderServerRow(node)
  const renderManualRow = (node: IncyNode): React.ReactElement => renderServerRow(node, true)

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

  // Секунды ожидания считают BusySeconds/BusyHint (маленькие компоненты со своим таймером).

  // Clear the optimistic flag once the backend reports a settled state.
  useEffect(() => {
    if (status.state === 'running' || status.state === 'stopped' || status.state === 'error') {
      setPendingAction(null)
    }
  }, [status.state])

  // Живая скорость сети для пульта — только пока VPN подключён и открыта «Главная».
  const liveTraffic = useLiveTraffic(isConnected && activeTab === 'main')
  const [chain, setChain] = useState<ChainInfo | null>(null)
  const [chainChecking, setChainChecking] = useState(false)
  const checkChainTraffic = async (): Promise<void> => {
    setChainChecking(true)
    try {
      const ok = await chainProbe()
      if (ok === true) toast.success('Трафик через цепочку проходит')
      else if (ok === false) toast.error('Цепочка применена, но проверочный адрес не ответил')
      else toast.info('Проверка цепочки недоступна для текущего подключения')
    } catch (error) {
      toast.error('Не удалось проверить цепочку', { description: String(error) })
    } finally {
      setChainChecking(false)
    }
  }
  useEffect(() => {
    if (activeTab !== 'main') return
    let current = true
    void chainGet().then((value) => {
      if (current) setChain(value)
    }).catch(() => {
      if (current) setChain(null)
    })
    return () => { current = false }
  }, [activeTab, status.state, status.activeNodeId, status.selectedNodeId, status.connectedAt, status.routingMode, settings?.chainEntryNodeId])
  const previousNode = nodes.find((node) => node.id === status.previousNodeId && node.id !== activeOrSelectedNode?.id)
  const nodeTitle = (id: string | null): string => {
    const name = nodes.find((node) => node.id === id)?.name
    return name ? cleanServerName(name) : 'Узел не найден'
  }
  const [previousChecking, setPreviousChecking] = useState(false)
  const selectPrevious = async (): Promise<void> => {
    if (!previousNode || previousChecking) return
    setPreviousChecking(true)
    try {
      const check = await chainExitCheck(previousNode.id)
      if (!check.ok) {
        toast.error('Нельзя сменить выход цепочки', { description: check.reason })
        return
      }
      await handleSelectNode(previousNode.id)
    } catch (error) {
      toast.error('Не удалось проверить предыдущий узел', { description: String(error) })
    } finally {
      setPreviousChecking(false)
    }
  }
  const consoleTone: LzTone = isBusy ? 'busy' : isConnected ? 'on' : hasError ? 'error' : 'off'
  const nodeLabelById = useMemo(() => {
    const map = new Map(nodes.map((n) => [n.id, cleanServerName(n.name)] as const))
    return (id: string): string => map.get(id) ?? 'выбранный сервер'
  }, [nodes])
  const protocolItems = useMemo<SegmentedItem<'all' | 'vless' | 'hysteria2' | 'wireguard'>[]>(() => {
    const count = (p: string): number => nodes.filter((n) => n.protocol === p).length
    return [
      { id: 'all', label: `Все ${nodes.length}` },
      { id: 'vless', label: `VLESS ${count('vless')}` },
      { id: 'hysteria2', label: `Hysteria2 ${count('hysteria2')}` },
      { id: 'wireguard', label: `WARP ${count('wireguard')}` }
    ]
  }, [nodes])


  return (
    <BasePage title="INCY Proxy Engine">
      <div className="mx-auto w-full max-w-[1080px] space-y-[var(--lz-gap)] lz-page-x pb-5">
        {/* ExitLag и INCY — один туннель. Если на вкладке ExitLag включён
            белый список, «Подключить» здесь поднимает VPN только для этих
            приложений. Без явного предупреждения это выглядело как «INCY
            перестал работать». */}
        {settings?.perAppProxy &&
          settings.perAppMode !== 'bypass_only' && (
            <LzPanel tone="warn" glow={12} className="flex flex-col justify-between gap-2 border-st-warn/40 px-4 py-2.5 text-xs sm:flex-row sm:items-center">
              <div className="flex items-start gap-2 min-w-0">
                <Gamepad2 className="size-4 text-st-warn-text shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <div className="font-semibold text-foreground">Включён режим ExitLag</div>
                  <div className="text-muted-foreground truncate">
                    {(settings.perAppProcesses?.length ?? 0) > 0
                      ? `Через VPN идут только: ${(settings.perAppProcesses ?? []).map(appLabel).join(', ')}. Остальной трафик — напрямую.`
                      : 'Список приложений пуст — через VPN сейчас ничего не идёт. Добавьте приложения на вкладке ExitLag.'}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => navigate('/exitlag')}>
                  Настроить
                </Button>
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => void handleUpdateSettings({ perAppProxy: false })}
                >
                  Весь трафик через VPN
                </Button>
              </div>
            </LzPanel>
          )}
        {/* Вкладки раздела: одна строка, выбранная горит цветом темы. Справа — состояние
            VPN словами (на «Главной» его показывает пульт, там оно не дублируется). */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div
            role="tablist"
            aria-label="Разделы INCY"
            className="lz-control-surface flex flex-wrap items-center gap-1 rounded-xl border p-1"
          >
            {(
              [
                { id: 'main', label: 'Главная', icon: Power, count: 0 },
                { id: 'servers', label: 'Сервера', icon: Server, count: nodes.length },
                { id: 'routing', label: 'Маршрутизация', icon: Split, count: settings?.customRoutingRules?.length ?? 0 },
                { id: 'settings', label: 'Настройки', icon: SettingsIcon, count: 0 },
                { id: 'stats', label: 'Статистика', icon: BarChart2, count: 0 }
              ] as const
            ).map((t) => {
              const active = activeTab === t.id
              const Icon = t.icon
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  data-tour={`incy-tab-${t.id}`}
                  onClick={() => setActiveTab(t.id)}
                  className={cn(
                    'flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-semibold transition-colors',
                    active ? 'bg-primary text-primary-foreground shadow-sm' : 'lz-control-option'
                  )}
                >
                  <Icon className="size-3.5" />
                  {t.label}
                  {t.count > 0 && (
                    <span
                      className={cn(
                        'rounded-md px-1.5 text-[10.5px] leading-[1.35rem] tabular-nums',
                        active ? 'bg-primary-foreground/20' : 'bg-foreground/[0.07] text-foreground/80'
                      )}
                    >
                      {t.count}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {activeTab !== 'main' && (
            <div
              className={cn(
                'inline-flex max-w-[280px] items-center gap-2 rounded-xl border px-3 py-1.5 text-[12px] font-semibold',
                isConnected ? 'border-primary/40 bg-primary/10 text-foreground' : 'border-foreground/[0.08] bg-foreground/[0.04] text-muted-foreground'
              )}
            >
              <span className={cn('relative size-2 shrink-0 rounded-full', isConnected ? 'lz-beacon bg-primary text-primary' : hasError ? 'bg-st-err' : 'bg-muted-foreground/50')} />
              <span data-sensitive="node" className="truncate">
                {isConnected ? `Подключено: ${activeOrSelectedNode ? cleanServerName(activeOrSelectedNode.name) : 'INCY'}` : isBusy ? 'Подключение…' : 'Отключено'}
              </span>
            </div>
          )}
        </div>

        {/* TAB 1: MAIN — пульт подключения, подписка, автовыбор, скорость */}
        {activeTab === 'main' && (
          <div className="space-y-3">
            {(status.killSwitchActive || status.recovering) && status.state !== 'running' && (
              <LzPanel tone="warn" glow={12} className="flex items-start gap-3 border-st-warn/40 px-4 py-3">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-st-warn-text" />
                <div className="min-w-0 flex-1 text-xs leading-relaxed">
                  <div className="font-semibold text-foreground">
                    {status.killSwitchActive ? 'VPN оборвался — Kill Switch держит трафик' : 'VPN оборвался'}
                  </div>
                  <div className="text-muted-foreground">
                    {status.killSwitchActive
                      ? 'Сайты, которые шли через VPN, не открываются, пока соединение не восстановится. Переподключаюсь автоматически.'
                      : 'Переподключаюсь автоматически, как только сервер ответит.'}
                  </div>
                </div>
                <Button size="sm" variant="outline" className="h-7 shrink-0 text-xs" onClick={handleDisconnect}>
                  Отключить
                </Button>
              </LzPanel>
            )}

            <IncyConsole
              tone={consoleTone}
              compact={settings?.connectionStyle === 'compact'}
              title={
                isBusy
                  ? pendingAction === 'disconnect'
                    ? 'Отключение…'
                    : 'Подключение…'
                  : isConnected
                    ? 'Подключено'
                    : hasError
                      ? status.recovering
                        ? 'Переподключение…'
                        : 'Не удалось подключиться'
                      : nodes.length
                        ? 'VPN отключён'
                        : 'Нужна подписка'
              }
              text={
                isBusy ? (
                  <BusyLine>
                    <BusyHint disconnecting={pendingAction === 'disconnect'} /> <BusySeconds />
                  </BusyLine>
                ) : isConnected ? (
                  status.exitLagActive ? (
                    'Режим ExitLag: через VPN идут только выбранные приложения, остальное — напрямую.'
                  ) : (
                    <>
                      {status.connectionMode === 'tun'
                        ? 'Через VPN идёт весь компьютер, включая игры.'
                        : status.connectionMode === 'system_proxy'
                          ? 'Через VPN идут браузеры и программы, которые читают системный прокси.'
                          : 'Открыт локальный порт прокси — укажите его в нужной программе.'}{' '}
                      {status.routingMode === 'bypass-ru'
                        ? 'Российские сайты — напрямую.'
                        : status.routingMode === 'global'
                          ? 'Все сайты — через VPN.'
                          : 'Маршрут «напрямую»: трафик идёт мимо VPN.'}
                    </>
                  )
                ) : hasError ? (
                  <>
                    <span className="text-st-err-text">{status.lastError || 'Сервер не ответил.'}</span>{' '}
                    Нажмите на клавишу, чтобы попробовать снова, или смените узел.
                  </>
                ) : nodes.length ? (
                  'Нажмите на клавишу, чтобы подключиться к выбранному узлу. Режим и маршрут можно поменять и потом.'
                ) : (
                  'Добавьте ссылку на подписку от VPN-сервиса — появятся узлы для подключения.'
                )
              }
              extra={
                !isBusy && hasError && /AmneziaWG|sing-box-lx/.test(status.lastError ?? '') ? (
                  <Button
                    size="sm"
                    className="h-8 gap-1.5 rounded-xl text-xs"
                    onClick={() => {
                      const id = toast.loading('Скачиваю ядро sing-box-lx…')
                      incyUpdateSingBoxNow()
                        .then((r) =>
                          r.success
                            ? toast.success('Ядро обновлено — подключитесь ещё раз', { id, description: r.message })
                            : toast.error('Ядро не обновилось', { id, description: r.message })
                        )
                        .catch((e) => toast.error('Ядро не обновилось', { id, description: e instanceof Error ? e.message : String(e) }))
                    }}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Обновить ядро сейчас
                  </Button>
                ) : !nodes.length ? (
                  <Button size="sm" className="h-8 gap-1.5 rounded-xl text-xs" onClick={() => setActiveTab('servers')}>
                    <Plus className="h-3.5 w-3.5" />
                    Добавить подписку
                  </Button>
                ) : undefined
              }
              node={
                activeOrSelectedNode
                  ? {
                      flag: getFlagEmoji(activeOrSelectedNode.name),
                      name: cleanServerName(activeOrSelectedNode.name),
                      protocol: activeOrSelectedNode.protocol,
                      json: Boolean(activeOrSelectedNode.rawJson)
                    }
                  : null
              }
              pingMs={activeOrSelectedNode?.latencyMs ?? null}
              connectedAt={status.connectedAt}
              dialLabel={isBusy ? (pendingAction === 'disconnect' ? 'Отключение…' : 'Подключение…') : isConnected ? 'Отключить VPN' : 'Подключить VPN'}
              dialDisabled={isBusy}
              onDial={() => {
                if (isBusy) return
                if (isConnected) void handleDisconnect()
                else void handleConnect()
              }}
              onChangeNode={() => (nodes.length ? setShowServerSelectModal(true) : setActiveTab('servers'))}
              mode={status.connectionMode as ConnMode}
              systemProxyAvailable={status.systemProxyAvailable}
              tunAvailable={status.tunAvailable}
              onMode={(m) => void handleSetConnectionMode(m)}
              route={status.routingMode as RouteMode}
              onRoute={(r) => void incySetRoutingMode(r).then(setStatus)}
              footer={
                settings?.connectionStyle === 'compact' ? undefined : (
                  <div className="flex flex-wrap gap-2">
                    {activeOrSelectedNode && (
                      <StatChip
                        label="Пинг до узла"
                        tone={consoleTone === 'on' ? 'on' : undefined}
                        icon={<Activity />}
                        value={
                          pingingNodeIds.has(activeOrSelectedNode.id)
                            ? 'замер…'
                            : formatLatency(activeOrSelectedNode).text
                        }
                        aside={
                          <SignalBars
                            ms={activeOrSelectedNode.latencyMs}
                            unreachable={formatLatency(activeOrSelectedNode).unreachable}
                            on={isConnected}
                          />
                        }
                        title="Проверить пинг узла ещё раз"
                        onClick={() => startPing({ type: 'ids', ids: [activeOrSelectedNode.id] })}
                        className="min-w-[150px]"
                      />
                    )}
                    {isConnected && stats?.trafficAvailable ? (
                      <StatChip
                        label="За сессию"
                        icon={<Download />}
                        value={`↓ ${formatBytes(stats.sessionBytesReceived).replace('.', ',')}  ↑ ${formatBytes(stats.sessionBytesSent).replace('.', ',')}`}
                        title="Сколько прошло через VPN с момента подключения"
                      />
                    ) : (
                      <StatChip
                        label="Серверы"
                        icon={<Server />}
                        value={nodes.length ? (anyMeasured ? `${workingCount} из ${nodes.length} отвечают` : `${nodes.length}`) : 'пока нет'}
                        title="Открыть список серверов"
                        onClick={() => setActiveTab('servers')}
                      />
                    )}
                    {settings?.memoryMonitor && coreMemory && coreMemory.totalBytes > 0 && (
                      <StatChip
                        label="Память ядер"
                        icon={<Cpu />}
                        value={formatBytes(coreMemory.totalBytes)}
                        title={coreMemory.perProcess.map((p) => `${p.name.replace('.exe', '')}: ${formatBytes(p.bytes)}`).join('\n')}
                      />
                    )}
                    <TrafficChip t={liveTraffic} active={isConnected} className="min-w-[260px] flex-1" />
                  </div>
                )
              }
            />
            {(chain?.entryNodeId || previousNode) && (
              <LzPanel className="flex flex-wrap items-center justify-between gap-3 p-4">
                {chain?.entryNodeId && (
                  <div className="min-w-0 space-y-1">
                    <div className="text-sm font-semibold">Цепочка · {chain.active ? 'Маршрут применён' : status.state === 'connecting' ? 'Подключается' : isConnected ? 'Не применена' : 'Настроена'}</div>
                    <div className="text-xs break-words">ПК → {nodeTitle(chain.entryNodeId)} → {nodeTitle(chain.exitNodeId)}</div>
                    {chain.reason && <div className="text-xs text-st-warn-text">{chain.reason}</div>}
                  </div>
                )}
                {chain?.active && (
                  <Button size="sm" variant="outline" disabled={chainChecking || isBusy} onClick={() => void checkChainTraffic()}>
                    {chainChecking ? 'Проверяю…' : 'Проверить цепочку'}
                  </Button>
                )}
                {previousNode && (
                  <Button size="sm" variant="outline" disabled={previousChecking || isBusy} onClick={() => void selectPrevious()}>
                    {isConnected ? 'Вернуться на' : 'Выбрать предыдущий:'} {cleanServerName(previousNode.name)}
                  </Button>
                )}
              </LzPanel>
            )}

            {/* Вторая строка: подписка, автовыбор узла, тест скорости. Без серверов
                место автовыбора занимает рекомендация автора. */}
            <div className="grid gap-3 md:grid-cols-[1.3fr_1fr_1fr]">
              <SubscriptionTile
                subscription={subscription}
                nodeCount={
                  subscription
                    ? nodes.filter((n) => n.subscriptionId === subscription.id).length || nodes.length
                    : nodes.length
                }
                others={otherSubscriptions}
                othersCount={(id) => nodes.filter((n) => n.subscriptionId === id).length}
                onSwitchProvider={(sub) => void handleSwitchProvider(sub)}
                onAdd={() => setActiveTab('servers')}
                ops={ops}
                pingDisabled={nodes.length === 0}
                hintsIgnored={Boolean(settings?.ignoreProviderSettings)}
              />
              {nodes.length > 0 ? (
                <AutoSelectTile settings={settings} nodes={nodes} onPatch={(patch) => handleUpdateSettings(patch, true)} />
              ) : (
                <VelvetOffer variant="full" />
              )}
              <SpeedTile
                nodes={nodes}
                vpnOn={isConnected}
                initialNodeId={activeOrSelectedNode?.id ?? null}
                nodeLabel={nodeLabelById}
              />
            </div>

            {nodes.length > 0 && <VelvetOffer variant="slim" />}

            {/* Быстрая смена узла */}
            {showServerSelectModal && (
              <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
                onClick={() => setShowServerSelectModal(false)}
              >
                <div
                  role="dialog"
                  aria-label="Выбор узла"
                  className="flex max-h-[85vh] w-full max-w-lg flex-col gap-3 rounded-2xl border border-border bg-[color:var(--popover)] p-5 shadow-2xl"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-[15px] font-bold text-[color:var(--text-title)]">
                      Выбор узла
                      <span className="rounded-md bg-foreground/[0.07] px-1.5 text-[11px] font-semibold tabular-nums text-foreground/80">{nodes.length}</span>
                    </div>
                    <button
                      type="button"
                      aria-label="Закрыть"
                      onClick={() => setShowServerSelectModal(false)}
                      className="cursor-pointer rounded-lg p-1 text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
                    >
                      <X className="size-4" />
                    </button>
                  </div>

                  <div className="relative">
                    <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      autoFocus
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Страна, город или адрес"
                      className="h-9 pl-8 text-xs"
                    />
                  </div>

                  <div className="-mr-1 flex-1 space-y-1.5 overflow-y-auto pr-1">
                    {filteredNodes.map((node) => {
                      const isSelected = (status.selectedNodeId || nodes[0]?.id) === node.id
                      return (
                        <button
                          type="button"
                          key={node.id}
                          onClick={() => { void handleSelectNode(node.id) }}
                          className={cn(
                            'relative flex w-full cursor-pointer items-center justify-between gap-2 overflow-hidden rounded-xl border py-1.5 pr-2 pl-2 text-left transition-colors',
                            isSelected
                              ? 'border-primary/45 bg-primary/[0.09]'
                              : 'border-foreground/[0.07] bg-foreground/[0.025] hover:border-foreground/[0.14] hover:bg-foreground/[0.05]'
                          )}
                        >
                          <span aria-hidden className={cn('absolute inset-y-2 left-0 w-[3px] rounded-r-full', isSelected ? 'bg-primary' : 'bg-transparent')} />
                          <span className="flex min-w-0 items-center gap-2.5 pl-1">
                            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.05] text-[18px] leading-none">
                              {getFlagEmoji(node.name) || <Globe className="size-4 text-muted-foreground" />}
                            </span>
                            <span className="min-w-0">
                              <span data-sensitive="node" className="block truncate text-[13px] font-semibold text-foreground">
                                {cleanServerName(node.name)}
                              </span>
                              <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                                <ProtocolTag protocol={node.protocol} />
                                <span data-sensitive="ip" className="truncate">{node.server}:{node.port}</span>
                              </span>
                            </span>
                          </span>

                          <span className="flex shrink-0 items-center gap-1.5">
                            {pingingNodeIds.has(node.id) ? (
                              <span className="size-3 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
                            ) : (
                              <LatencyBadge node={node} display={settings?.pingDisplay} />
                            )}
                            {isSelected && <CheckCircle2 className="h-4 w-4 text-primary" />}
                          </span>
                        </button>
                      )
                    })}
                    {filteredNodes.length === 0 && (
                      <div className="py-6 text-center text-[12px] text-muted-foreground">Ничего не найдено</div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: SERVERS (Full Servers List) */}
        {activeTab === 'servers' && (
          <div className="space-y-3">
            {/* Добавить: ссылка, буфер, QR, файл .conf */}
            <LzPanel data-tour="incy-import" className="p-4">
              <LzSectionHead
                title="Добавить серверы"
                hint="Ссылка на подписку от VPN-сервиса (https://…), отдельный узел (vless://, ss://, hy2://…) или конфиг WireGuard / AmneziaWG. Серверы подписки обновляются сами."
                right={
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={loadingImport || scanningQr}
                      onClick={() => setShowQrModal(true)}
                      className="h-8 gap-1.5 rounded-xl text-xs"
                      title="Сканировать QR-код с экрана, из буфера или файла"
                    >
                      <QrCode className="h-3.5 w-3.5" /> QR-код
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={loadingImport}
                      onClick={() => { void handleImportConfFile() }}
                      className="h-8 gap-1.5 rounded-xl text-xs"
                      title="Импортировать конфиг WireGuard / AmneziaWG из файла .conf"
                    >
                      <FileUp className="h-3.5 w-3.5" /> Файл .conf
                    </Button>
                  </>
                }
              />
              <div className="mt-2.5 flex flex-col gap-2 sm:flex-row">
                <div className="relative flex-1">
                  <LinkIcon className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    data-sensitive="link"
                    value={inputUrl}
                    onChange={(e) => setInputUrl(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && inputUrl.trim() && !loadingImport) void handleImport()
                    }}
                    onPaste={(e) => {
                      // Однострочное поле съедает переводы строк, а .conf без них не разобрать —
                      // конфиг WireGuard импортируем сразу из буфера, минуя поле.
                      const text = e.clipboardData.getData('text')
                      if (/\[\s*interface\s*\]/i.test(text)) {
                        e.preventDefault()
                        void handleImport(text)
                      }
                    }}
                    placeholder="Ссылка на подписку (https://…), узел (vless://, ss://, hy2://) или конфиг WireGuard / AmneziaWG"
                    className="h-10 rounded-xl pl-9 text-xs"
                  />
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={loadingImport}
                  onClick={() => { void handlePasteImport() }}
                  className="h-10 shrink-0 gap-1.5 rounded-xl text-xs"
                  title="Вставить ссылку из буфера обмена и импортировать"
                >
                  <Copy className="h-3.5 w-3.5" /> Из буфера
                </Button>
                <Button
                  size="sm"
                  onClick={() => { void handleImport() }}
                  disabled={loadingImport || !inputUrl.trim()}
                  className="h-10 shrink-0 gap-1.5 rounded-xl px-4 text-xs"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {loadingImport ? 'Загрузка…' : 'Импортировать'}
                </Button>
              </div>
            </LzPanel>

            {/* WarpCard не размонтируется при сворачивании: идущая генерация ключа не прервётся. */}
            <div className={cn('relative', !(warpOpen || nodes.length === 0) && 'hidden')}>
              {nodes.length > 0 && (
                <button
                  type="button"
                  onClick={() => setWarpOpenSaved(false)}
                  className="absolute top-3.5 right-4 z-[2] flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-[12px] font-semibold text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
                >
                  <ChevronDown className="size-3.5 rotate-180" />
                  Свернуть
                </button>
              )}
              <WarpCard
                nodes={nodes}
                selectedNodeId={status.selectedNodeId}
                busy={loadingImport}
                onNodes={(all) => {
                  setNodes(all)
                  void incyGetStatus().then(setStatus).catch(() => void 0)
                  startPing()
                }}
                onImportText={(text, name) => handleImport(text, name)}
                onPickFile={handleImportConfFile}
              />
            </div>
            {!(warpOpen || nodes.length === 0) && (
              <LzPanel data-tour="incy-warp" className="flex items-center gap-3 px-4 py-2.5">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-foreground/[0.06] text-st-info-text">
                  <Zap className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-bold text-[color:var(--text-title)]">Cloudflare WARP</div>
                  <div className="truncate text-[11.5px] text-muted-foreground">Бесплатный узел от Cloudflare: свой ключ или конфиг из бота</div>
                </div>
                <Button size="sm" variant="outline" className="h-8 gap-1.5 rounded-xl text-xs" onClick={() => setWarpOpenSaved(true)}>
                  <ChevronDown className="size-3.5" />
                  Показать
                </Button>
              </LzPanel>
            )}

            <VelvetOffer variant={nodes.length ? 'slim' : 'full'} />

            {/* Поиск, фильтры, вид списка и действия — одной панелью над всеми подписками. */}
            {nodes.length > 0 && (
              <LzPanel data-tour="incy-server-tools" className="relative z-[3] space-y-2.5 overflow-visible p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Segmented
                    items={protocolItems}
                    value={protocolFilter}
                    onChange={setProtocolFilter}
                    size="sm"
                    aria-label="Протокол"
                    className="w-full sm:w-[400px]"
                  />
                  <button
                    type="button"
                    onClick={() => setOnlyWorking((v) => !v)}
                    disabled={!anyMeasured && !onlyWorking}
                    aria-pressed={onlyWorking}
                    title={anyMeasured ? 'Скрыть серверы, которые не ответили на замер' : 'Сначала замерьте пинг'}
                    className={cn(
                      'inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition-colors disabled:cursor-default disabled:opacity-50',
                      onlyWorking
                        ? 'border-primary/45 bg-primary/12 text-primary'
                        : 'border-foreground/[0.08] bg-foreground/[0.04] text-muted-foreground hover:text-foreground'
                    )}
                  >
                    <CheckCircle2 className="size-3.5" />
                    Только рабочие{anyMeasured ? ` ${workingCount}` : ''}
                  </button>
                  <div className="relative min-w-[200px] flex-1">
                    <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Страна, город, адрес или протокол"
                      className="h-9 rounded-xl pl-8 text-xs"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 border-t border-foreground/[0.07] pt-2.5">
                  <div className="flex items-center gap-1.5" data-tour="incy-sort-quick">
                    <span className="text-[11.5px] text-muted-foreground">Порядок</span>
                    <Segmented
                      items={[
                        { id: 'default', label: 'Как есть', title: 'Как прислал провайдер' },
                        { id: 'ping', label: 'Пинг', title: 'Сначала самые быстрые' },
                        { id: 'name', label: 'Имя', title: 'По алфавиту' }
                      ]}
                      value={(settings?.sortServersBy ?? 'default') as 'default' | 'ping' | 'name'}
                      onChange={(v) => void handleUpdateSettings({ sortServersBy: v }, true)}
                      size="sm"
                      aria-label="Порядок серверов"
                      className="w-[210px]"
                    />
                  </div>
                  <div className="flex items-center gap-1.5" data-tour="incy-ping-display-quick">
                    <span className="text-[11.5px] text-muted-foreground">Пинг</span>
                    <Segmented
                      items={[
                        { id: 'numbers', label: 'Цифры' },
                        { id: 'bar', label: 'Шкала' },
                        { id: 'both', label: 'Оба' },
                        { id: 'dots', label: 'Точки' }
                      ]}
                      value={(settings?.pingDisplay ?? 'numbers') as 'numbers' | 'bar' | 'both' | 'dots'}
                      onChange={(v) => void handleUpdateSettings({ pingDisplay: v }, true)}
                      size="sm"
                      aria-label="Как показывать пинг"
                      className="w-[250px]"
                    />
                  </div>
                  <div className="ml-auto flex items-center gap-1.5">
                    <OpsSplitButton
                      kind="ping"
                      ops={ops}
                      label="Проверить пинг"
                      menuTitle="Что проверить"
                      options={pingScopeOptions}
                      defaultScope={{ type: 'all' }}
                      tour="incy-ping-scope"
                    />
                    {subscriptions.length > 0 && (
                      <OpsSplitButton
                        kind="refresh"
                        ops={ops}
                        label={subscriptions.length > 1 ? 'Обновить все' : 'Обновить'}
                        menuTitle="Какие подписки обновить"
                        options={refreshScopeOptions}
                        defaultScope={{ type: 'all' }}
                        tour="incy-refresh-scope"
                      />
                    )}
                  </div>
                </div>
                <OpsStatusLine ops={ops} />
              </LzPanel>
            )}

            {/* Подписки: по панели на провайдера, каждая считает только свои серверы. */}
            {subscriptions.map((sub) => {
              const subNodes = nodes.filter((n) => n.subscriptionId === sub.id)
              const visibleNodes = filteredNodes.filter((n) => n.subscriptionId === sub.id)
              const collapsed = collapsedSubs.has(sub.id)
              const isCurrent = subscriptions.length > 1 && subscription?.id === sub.id
              const holdsActive = isConnected && subNodes.some((n) => n.id === status.activeNodeId)
              const busy = loadingRefresh && refreshingSubId === sub.id
              const u = subUsage(sub)

              return (
                <LzPanel
                  key={sub.id}
                  tone={holdsActive ? 'on' : 'off'}
                  glow={8}
                  className={cn('p-0', (isCurrent || holdsActive) && 'border-primary/35', u.low && !holdsActive && 'border-st-warn/40')}
                >
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                    <button
                      type="button"
                      onClick={() => {
                        setCollapsedSubs((prev) => {
                          const next = new Set(prev)
                          if (next.has(sub.id)) next.delete(sub.id)
                          else next.add(sub.id)
                          return next
                        })
                      }}
                      aria-expanded={!collapsed}
                      className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 text-left"
                      title={collapsed ? 'Показать серверы' : 'Свернуть'}
                    >
                      <ChevronDown
                        className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', collapsed && '-rotate-90')}
                      />
                      <SubIcon subId={sub.id} title={sub.title} />
                      <span className="min-w-0">
                        <span className="flex min-w-0 items-center gap-2">
                          <span data-sensitive="node" className="truncate text-[14px] font-bold text-[color:var(--text-title)]">
                            {sub.title}
                          </span>
                          {isCurrent && (
                            <span className="shrink-0 rounded-md bg-primary/12 px-1.5 py-px text-[10.5px] font-semibold text-primary">текущая</span>
                          )}
                        </span>
                        <span className="text-[11.5px] text-muted-foreground tabular-nums">
                          {subNodes.length} серв.
                          {visibleNodes.length !== subNodes.length ? `, найдено ${visibleNodes.length}` : ''}
                        </span>
                      </span>
                    </button>

                    {/* Остаток: дни и трафик. */}
                    <div className="flex items-center gap-2">
                      <span
                        title={sub.expireDate ? `Срок: ${sub.expireDate}` : 'Срок не указан провайдером'}
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11.5px] font-semibold tabular-nums',
                          u.daysLeft !== null && u.daysLeft <= 3
                            ? 'border-st-warn/40 bg-st-warn/10 text-st-warn-text'
                            : 'border-foreground/[0.08] bg-foreground/[0.04] text-foreground/85'
                        )}
                      >
                        <Clock className="size-3.5" />
                        {daysText(u.daysLeft, sub.expireDate)}
                      </span>
                      {u.leftBytes !== null && u.totalBytes !== null && u.usedPct !== null && (
                        <span
                          title={`Использовано ${gb(sub.usedBytes ?? 0)} из ${gb(u.totalBytes)}`}
                          className="inline-flex items-center gap-2 rounded-lg border border-foreground/[0.08] bg-foreground/[0.04] px-2 py-1 text-[11.5px] font-semibold tabular-nums"
                        >
                          <span className="h-1.5 w-14 overflow-hidden rounded-full bg-foreground/10">
                            <span
                              className={cn('block h-full rounded-full', u.usedPct >= 90 ? 'bg-st-warn' : 'bg-primary')}
                              style={{ width: `${Math.max(3, 100 - u.usedPct)}%` }}
                            />
                          </span>
                          <span className={u.usedPct >= 90 ? 'text-st-warn-text' : 'text-foreground/85'}>{gb(u.leftBytes)}</span>
                        </span>
                      )}
                    </div>

                    <div className="flex items-center">
                      {/* Только эта подписка; пока идёт — «Остановить». */}
                      <OpsIconButton
                        kind="refresh"
                        ops={ops}
                        scope={{ type: 'sub', subId: sub.id }}
                        title="Обновить только эту подписку"
                        activeHere={busy || (loadingRefresh && opView?.scope === 'all')}
                      />
                      <OpsIconButton
                        kind="ping"
                        ops={ops}
                        scope={{ type: 'sub', subId: sub.id }}
                        title="Проверить пинг серверов этой подписки"
                        disabled={subNodes.length === 0}
                        activeHere={testingPings && opView?.scope === 'sub' && opView.subId === sub.id}
                      />
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        onClick={() => setRemovingSub(sub)}
                        title="Удалить подписку и её серверы"
                        className="h-7 w-7 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  {(sub.announcements?.length || sub.webPageUrl || sub.supportUrl || sub.premiumUrl || sub.hintsText || sub.hwidRequired) && (
                    <div className="space-y-2 px-4 pb-3">
                      <SubLinks sub={sub} />
                      <SubAnnouncements items={sub.announcements} collapsible={collapsed} />
                      <SubscriptionProviderInfo sub={sub} hintsIgnored={Boolean(settings?.ignoreProviderSettings)} />
                    </div>
                  )}

                  {/* Серверы этой подписки. Свёрнутая панель их прячет —
                      иначе при пяти провайдерах до нужного не долистать. */}
                  {!collapsed && (
                    <div className="border-t border-foreground/[0.06] px-2 pt-2 pb-2">
                      {visibleNodes.length > 0 ? (
                        <WindowedRows
                          items={visibleNodes}
                          getKey={nodeKey}
                          renderItem={renderAutoRow}
                          gap={6}
                          estimate={54}
                          className="space-y-1.5"
                        />
                      ) : (
                        <div className="py-4 text-center text-[12px] text-muted-foreground">
                          {subNodes.length === 0
                            ? 'В этой подписке пока нет серверов — нажмите «Обновить».'
                            : 'В этой подписке ничего не найдено по запросу.'}
                        </div>
                      )}
                    </div>
                  )}
                </LzPanel>
              )
            })}

            {/* Серверы вне подписок: добавленные ссылкой вручную. Их не
                удаляет и не перезаписывает ни одно обновление подписки. */}
            {manualNodes.length > 0 && (
              <LzPanel className="p-0">
                <div className="px-4 py-3">
                  <LzSectionHead
                    title={`Добавлены вручную · ${manualNodes.length}`}
                    hint="Серверы, добавленные ссылкой, и оставшиеся от удалённых подписок. Обновление подписок их не трогает."
                    right={
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => { void handleClearManualNodes() }}
                        className="h-8 gap-1.5 rounded-xl text-xs text-destructive hover:text-destructive"
                        title="Удалить все серверы, добавленные вручную или оставшиеся от старых подписок"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Удалить все
                      </Button>
                    }
                  />
                </div>
                <div className="border-t border-foreground/[0.06] px-2 pt-2 pb-2">
                  <WindowedRows
                    items={manualNodes}
                    getKey={nodeKey}
                    renderItem={renderManualRow}
                    gap={6}
                    estimate={54}
                    className="space-y-1.5"
                  />
                </div>
              </LzPanel>
            )}

            {nodes.length === 0 ? (
              <LzPanel className="px-4">
                <EmptyState
                  icon={<Server />}
                  title="Серверов пока нет"
                  text="Вставьте ссылку на подписку в поле выше — серверы появятся здесь, пинг проверится сам."
                />
              </LzPanel>
            ) : (
              filteredNodes.length === 0 && (
                <div className="py-8 text-center text-[12px] text-muted-foreground">По вашему запросу ничего не найдено.</div>
              )
            )}
          </div>
        )}

        {/* TAB: ROUTING — what goes through the tunnel and what does not */}
        {activeTab === 'routing' && settings && (
          <div className="space-y-4">
            <RouteMemoryCard />
            <RoutingProfiles
              settings={settings}
              onChanged={loadData}
              onStatus={setStatus}
            />

            <GeoCategoriesCard settings={settings} onUpdate={handleUpdateSettings} />

            {/* Сайты напрямую, мимо VPN — переехали сюда из общих «Настроек». */}
            <SplitTunnelingCard />

            {/* Режим приложений настраивается на вкладке ExitLag — здесь раньше
                была её полная копия. */}
            <button
              type="button"
              onClick={() => navigate('/exitlag')}
              className="group flex w-full cursor-pointer items-center justify-between gap-3 ui-card rounded-2xl border border-border bg-card px-5 py-4 text-left transition-colors hover:border-primary/35"
            >
              <span className="flex items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-xl bg-secondary text-primary">
                  <Gamepad2 className="size-4.5" />
                </span>
                <span>
                  <span className="block text-sm font-semibold text-foreground">Режим приложений (ExitLag)</span>
                  <span className="block text-xs text-muted-foreground">
                    {settings.perAppProxy
                      ? settings.perAppMode === 'bypass_only'
                        ? `Мимо VPN: ${(settings.perAppProcesses ?? []).length} прил.`
                        : `Через VPN только: ${(settings.perAppProcesses ?? []).length} прил.`
                      : 'Выключен — через VPN идёт весь трафик'}
                  </span>
                </span>
              </span>
              <ArrowRight className="size-4 shrink-0 text-primary transition-transform group-hover:translate-x-0.5" />
            </button>

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
                                    ? 'border-st-ok/50 bg-st-ok/15 text-st-ok-text'
                                    : a === 'proxy'
                                      ? 'border-primary/50 bg-primary/15 text-primary'
                                      : 'border-st-err/50 bg-st-err/15 text-st-err-text'
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
                  <Input paste
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
                  <ApplyNote
                    tour="incy-apply-note-routing"
                    connected={isConnected}
                    killSwitch={Boolean(settings?.killSwitch)}
                  />
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* TAB 3: SETTINGS (Full INCY Options) */}
        {activeTab === 'settings' && settings && (
          <div className="space-y-4">
            <NodeChainCard
              onChanged={loadData}
              exitKey={status.activeNodeId || status.selectedNodeId || null}
              onSelectExit={handleSelectNode}
              nodes={nodes}
              pinging={pingingNodeIds}
              pingBusy={testingPings}
              onPing={(ids) => startPing({ type: 'ids', ids, label: 'узлы цепочки' })}
              onStopPing={() => void ops.stop()}
            />
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
                <div data-tour="incy-autoconnect" className="flex items-center justify-between">
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

                {window.api.platform !== 'linux' && <>
                <div data-tour="incy-killswitch" className="flex items-center justify-between">
                  <div className="flex flex-col">
                    <Label className="text-sm">
                      Kill Switch{' '}
                      <Hint text="Что гарантируется: если ядро VPN неожиданно завершилось, программа сразу поднимает блокировку, которая отклоняет всё, что шло бы через VPN, и переподключается. Пропускаются: адрес VPN-сервера, локальная сеть, loopback, российские сайты при «Раздельно». Чего нет: правил брандмауэра. Блокировка действует, пока работает LAZEYKA или ядро блокировки; при ручном отключении и при выходе из программы она снимается. В первые 1–2 секунды после обрыва и во время смены узла защиты нет." />
                    </Label>
                    <span className="text-xs text-muted-foreground">
                      Если ядро VPN неожиданно завершится, всё, что шло через VPN, блокируется до переподключения.
                      Российские сайты и локальная сеть работают. Не срабатывает при ручном отключении и выходе из
                      программы. В режиме «Системный прокси» закрываются только программы, ходящие через системный
                      прокси; в режиме «Только прокси» не действует.
                    </span>
                  </div>
                  <Switch
                    checked={settings.killSwitch}
                    onCheckedChange={(v) => handleUpdateSettings({ killSwitch: v })}
                  />
                </div>

                <KillSwitchResetRow />
                </>}

                <div data-tour="incy-reconnect-on-drop" className="flex items-center justify-between">
                  <div className="flex flex-col">
                    <Label className="text-sm">Переподключаться при обрыве</Label>
                    <span className="text-xs text-muted-foreground">
                      {settings.killSwitch
                        ? 'С Kill Switch включено всегда, иначе интернет остался бы закрытым.'
                        : 'Если ядро VPN внезапно завершилось, проверить сервер и подключиться снова: через 5 с, 15 с, 30 с, потом раз в 1–2 мин.'}
                    </span>
                  </div>
                  <Switch
                    checked={settings.killSwitch || settings.reconnectOnDrop !== false}
                    disabled={settings.killSwitch}
                    onCheckedChange={(v) => handleUpdateSettings({ reconnectOnDrop: v })}
                  />
                </div>

                <div data-tour="incy-hijack-dns" className="flex items-center justify-between">
                  <div className="flex flex-col">
                    <Label className="text-sm">Перехватывать системный DNS</Label>
                    <span className="text-xs text-muted-foreground">
                      Запросы имён сайтов от программ ядро обрабатывает само и отправляет через туннель. Выключено: запросы идут
                      как обычные соединения. Только режим TUN.
                    </span>
                  </div>
                  <Switch
                    checked={settings.hijackDns}
                    onCheckedChange={(v) => handleUpdateSettings({ hijackDns: v })}
                  />
                </div>

                <div data-tour="incy-allow-lan" className="flex items-center justify-between">
                  <div className="flex flex-col">
                    <Label className="text-sm">Открыть прокси для устройств в сети</Label>
                    <span className="text-xs text-muted-foreground">
                      Другие устройства домашней сети (телефон, приставка) смогут подключаться к локальному прокси
                      этого компьютера. Включайте вместе с логином и паролем: иначе прокси открыт всем в сети.
                      Сам доступ к локальной сети из VPN всегда разрешён.
                    </span>
                  </div>
                  <Switch
                    checked={settings.allowLan}
                    onCheckedChange={(v) => handleUpdateSettings({ allowLan: v })}
                  />
                </div>

                <div data-tour="incy-lan-via-proxy" className="flex items-center justify-between">
                  <div className="flex flex-col">
                    <Label className="text-sm">Устройства сети выходят через VPN</Label>
                    <span className="text-xs text-muted-foreground">
                      Касается только устройств, подключённых к вашему прокси (нужен переключатель выше). Выключено: их
                      трафик идёт напрямую, мимо VPN.
                    </span>
                  </div>
                  <Switch
                    checked={settings.lanViaProxy}
                    onCheckedChange={(v) => handleUpdateSettings({ lanViaProxy: v })}
                  />
                </div>

                <div data-tour="incy-block-udp" className="flex items-center justify-between">
                  <div className="flex flex-col">
                    <Label className="text-sm">Блокировать UDP</Label>
                    <span className="text-xs text-muted-foreground">
                      Отключает UDP-протоколы (QUIC, голосовые звонки, онлайн-игры). Запросы DNS при включённом перехвате
                      выше не страдают; без перехвата DNS по UDP тоже блокируется.
                    </span>
                  </div>
                  <Switch
                    checked={settings.blockUdp}
                    onCheckedChange={(v) => handleUpdateSettings({ blockUdp: v })}
                  />
                </div>

                {/* SOCKS5 Auth */}
                <div data-tour="incy-socks-auth" className="pt-2 border-t border-border/50 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col">
                      <Label className="text-sm">SOCKS5 / HTTP авторизация</Label>
                      <span className="text-xs text-muted-foreground">
                        Защита локального прокси логином и паролем. Не действует в режиме «Системный прокси»: ОС не
                        умеет передавать пароль.
                      </span>
                    </div>
                    <Switch
                      checked={settings.socksAuth}
                      onCheckedChange={(v) =>
                        handleUpdateSettings(
                          v && (!settings.socksUser?.trim() || !settings.socksPass?.trim())
                            ? {
                                socksAuth: true,
                                socksUser: `incy_${Math.random().toString(36).slice(2, 8)}`,
                                socksPass: Math.random().toString(36).slice(2, 12)
                              }
                            : { socksAuth: v }
                        )
                      }
                    />
                  </div>

                  {settings.socksAuth && (
                    <div className="p-3 rounded-lg border border-border bg-card/30 space-y-2 text-xs">
                      <div className="flex items-center gap-2">
                        <span className="w-16 text-muted-foreground">Логин:</span>
                        <Input
                          data-sensitive="link"
                          value={settings.socksUser}
                          onChange={(e) => handleUpdateSettings({ socksUser: e.target.value })}
                          className="h-7 text-xs font-mono"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-16 text-muted-foreground">Пароль:</span>
                        <Input
                          data-sensitive="link"
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

                <MixedPortField settings={settings} onUpdate={handleUpdateSettings} />

                <ExtraBypassEditor settings={settings} onUpdate={handleUpdateSettings} />

                <ApplyNote tour="incy-apply-note-connection" connected={isConnected} killSwitch={settings.killSwitch} />
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
                <div data-tour="incy-fragmentation" className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col">
                      <Label className="text-sm">Фрагментация TLS Hello</Label>
                      <span className="text-xs text-muted-foreground">
                        Дробит начало TLS-соединения, чтобы DPI провайдера не узнал сервер. Работает на обоих ядрах;
                        параметры ниже действуют на ядре Xray, sing-box дробит рукопожатие сам.
                      </span>
                    </div>
                    <Switch
                      checked={settings.fragmentation}
                      onCheckedChange={(v) => handleUpdateSettings({ fragmentation: v })}
                    />
                  </div>

                  {settings.fragmentation && (
                    <div
                      className="grid grid-cols-3 gap-2 p-2.5 rounded-lg border border-border bg-card/30"
                      title="Packets: что дробить (tlshello, число или диапазон 1-3, all). Length: размер частей в байтах. Interval: пауза между частями, мс."
                    >
                      <DraftField
                        label="Packets"
                        value={settings.fragmentationPackets}
                        validate={validPackets}
                        onCommit={(v) => void handleUpdateSettings({ fragmentationPackets: v.toLowerCase() })}
                      />
                      <DraftField
                        label="Length"
                        value={settings.fragmentationLength}
                        validate={validRange}
                        onCommit={(v) => void handleUpdateSettings({ fragmentationLength: v })}
                      />
                      <DraftField
                        label="Interval"
                        value={settings.fragmentationInterval}
                        validate={validRange}
                        onCommit={(v) => void handleUpdateSettings({ fragmentationInterval: v })}
                      />
                    </div>
                  )}
                </div>

                {/* Noises */}
                <div data-tour="incy-noises" className="space-y-2 pt-2 border-t border-border/50">
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col">
                      <Label className="text-sm">Noises (Шумовые пакеты)<NotWired label="только UDP" reason="Шум отправляется перед соединением и действует только на UDP-транспорты: Hysteria2, QUIC и XHTTP поверх HTTP/3. На обычные узлы VLESS по TCP он не влияет. Требует ядра Xray." /></Label>
                      <span className="text-xs text-muted-foreground">
                        Ложные пакеты перед соединением. Действует только на UDP-транспорты (Hysteria2, QUIC, XHTTP поверх
                        HTTP/3); на обычные VLESS-узлы по TCP не влияет.
                      </span>
                    </div>
                    <Switch
                      checked={settings.noises}
                      onCheckedChange={(v) => handleUpdateSettings({ noises: v })}
                    />
                  </div>

                  {settings.noises && (
                    <div className="grid grid-cols-3 gap-2 p-2.5 rounded-lg border border-border bg-card/30">
                      <DraftField
                        label="Type"
                        value={settings.noisesType}
                        validate={(v) => (/^(rand|str|hex)$/i.test(v) ? null : 'Допустимо: rand, str или hex')}
                        onCommit={(v) => void handleUpdateSettings({ noisesType: v.toLowerCase() })}
                      />
                      <DraftField
                        label="Packet"
                        value={settings.noisesPacket}
                        validate={(v) =>
                          settings.noisesType === 'rand' ? validRange(v) : v.trim() ? null : 'Нужны данные пакета'
                        }
                        onCommit={(v) => void handleUpdateSettings({ noisesPacket: v })}
                      />
                      <DraftField
                        label="Delay"
                        value={settings.noisesDelay}
                        validate={validRange}
                        onCommit={(v) => void handleUpdateSettings({ noisesDelay: v })}
                      />
                    </div>
                  )}
                </div>

                {/* Подсказки провайдера и защищённый поиск адреса сервера */}
                <IgnoreProviderSettingsRow settings={settings} onUpdate={handleUpdateSettings} />
                <SecureServerLookupRow settings={settings} onUpdate={handleUpdateSettings} />

                {/* Multiplexing */}
                <div data-tour="incy-multiplexing" className="space-y-2 pt-2 border-t border-border/50">
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col">
                      <Label className="text-sm">Мультиплексирование (MUX / h2mux)<NotWired label="нужен сервер" reason="Требует поддержки на стороне сервера. Если провайдер её не включил, туннель установится, но данные передаваться не будут." /></Label>
                      <span className="text-xs text-muted-foreground">
                        Объединение множества соединений в единый поток. Для узлов с flow (например, VLESS + Reality +
                        Vision) и XHTTP не включается: с ними соединение не поднялось бы.
                      </span>
                      {settings.multiplexing && activeOrSelectedNode?.flow && (
                        <span className="mt-0.5 text-[11px] text-st-warn-text">
                          Выбранный узел использует flow {activeOrSelectedNode.flow}: мультиплексирование к нему не
                          применяется (это нормально).
                        </span>
                      )}
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
                <div data-tour="incy-preferred-ip" className="space-y-1.5 pt-2 border-t border-border/50">
                  <Label className="text-xs font-semibold">
                    Предпочтительный IP{' '}
                    <Hint text="IPV4: сайты открываются по IPv4 (IPv6 закрыт, программы сами переходят на IPv4). Авто сейчас то же, что IPV4: туннель IPv6 по умолчанию не пропускает. IPV6: IPv6 пропускается через туннель и выбирается первым, но сервер должен его поддерживать. Только для DNS и режима TUN." />
                  </Label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(['IPV4', 'IPV6', 'AUTO'] as const).map((ipMode) => (
                      <Button
                        key={ipMode}
                        size="sm"
                        variant={settings.preferredIp === ipMode ? 'default' : 'outline'}
                        onClick={() => handleUpdateSettings({ preferredIp: ipMode })}
                        className="text-xs h-7"
                      >
                        {ipMode === 'AUTO' ? 'Авто (= IPV4)' : ipMode}
                      </Button>
                    ))}
                  </div>
                </div>

                <SniffingRow settings={settings} onUpdate={handleUpdateSettings} />
                <QuicBlockRow settings={settings} onUpdate={handleUpdateSettings} />

                {/* VPN DNS Selection */}
                <div data-tour="incy-vpn-dns" className="space-y-1.5 pt-2 border-t border-border/50">
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
                    <DraftField
                      value={settings.customDns || ''}
                      placeholder="Один адрес: 77.88.8.8 или https://dns.example/dns-query"
                      className="h-7 text-xs font-mono mt-1"
                      validate={(v) =>
                        /^(?:(?:https?|tls|quic|h3|tcp|udp):\/\/[^\s,]+|[0-9a-fA-F:.]+)$/.test(v)
                          ? null
                          : 'Нужен один адрес: IP (77.88.8.8) или https://…, tls://…'
                      }
                      onCommit={(v) => void handleUpdateSettings({ customDns: v })}
                    />
                  )}
                  <p className="text-[11px] text-muted-foreground">
                    Свой DNS используется и для запросов через туннель, и для сайтов напрямую: укажите один адрес.
                  </p>
                </div>
                <ApplyNote tour="incy-apply-note-tunnel" connected={isConnected} killSwitch={settings.killSwitch} />
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
                      { l: 'Выкл', h: 0 },
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

                <div data-tour="incy-update-on-launch" className="flex items-center justify-between pt-2 border-t border-border/50">
                  <div className="flex flex-col">
                    <Label className="text-sm">Обновлять при старте</Label>
                    <span className="text-xs text-muted-foreground">Обновлять подписки через 20 секунд после запуска программы</span>
                  </div>
                  <Switch
                    checked={settings.updateOnLaunch}
                    onCheckedChange={(v) => handleUpdateSettings({ updateOnLaunch: v })}
                  />
                </div>

                <div data-tour="incy-ping-on-launch" className="flex items-center justify-between">
                  <div className="flex flex-col">
                    <Label className="text-sm">Замерять пинг при запуске</Label>
                    <span className="text-xs text-muted-foreground">
                      Один раз замерять задержку всех серверов, когда после запуска впервые открыт раздел INCY
                    </span>
                  </div>
                  <Switch
                    checked={settings.pingOnLaunch}
                    onCheckedChange={(v) => handleUpdateSettings({ pingOnLaunch: v })}
                  />
                </div>

                <div data-tour="incy-ping-on-update" className="flex items-center justify-between">
                  <div className="flex flex-col">
                    <Label className="text-sm">Замерять пинг при обновлении подписки</Label>
                    <span className="text-xs text-muted-foreground">Автоматически опрашивать сервера после нажатия кнопки «Обновить»</span>
                  </div>
                  <Switch
                    checked={settings.pingOnUpdateSubscription}
                    onCheckedChange={(v) => handleUpdateSettings({ pingOnUpdateSubscription: v })}
                  />
                </div>

                <HwidCard
                  settings={settings}
                  subscriptions={subscriptions}
                  onUpdate={handleUpdateSettings}
                />

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
                <div data-tour="incy-ping-method" className="space-y-1.5">
                  <Label className="text-xs font-semibold">Способ замера</Label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                    {(['incy', 'tcp', 'http_get', 'http_head'] as const).map((proto) => (
                      <Button
                        key={proto}
                        size="sm"
                        variant={settings.pingProtocol === proto ? 'default' : 'outline'}
                        onClick={() => handleUpdateSettings({ pingProtocol: proto })}
                        className="text-xs h-7"
                      >
                        {proto === 'incy'
                          ? 'Умный'
                          : proto === 'tcp'
                            ? 'Быстрый (TCP)'
                            : proto === 'http_head'
                              ? 'Запрос HEAD'
                              : 'Запрос GET'}
                      </Button>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {settings.pingProtocol === 'incy'
                      ? 'Рекомендуется. Сначала замеряет задержку до сервера (TCP-рукопожатие), затем проверяет настоящим запросом через сам сервер: число — это задержка до сервера, но показывается только если через него реально идёт трафик. Сервер с открытым портом и упавшим VPN будет «нет ответа», а не «1 мс». Замер всех серверов — 20–30 с.'
                      : settings.pingProtocol === 'tcp'
                      ? 'Только задержка до сервера: время TCP-рукопожатия (для UDP-узлов — ICMP-пинг; если сервер его не отвечает, будет «нет ответа»). 1–2 с на весь список. Не проверяет, работает ли VPN: сервер с упавшим VPN может показать хороший пинг.'
                      : settings.pingProtocol === 'http_head'
                        ? 'Настоящий запрос HEAD к тестовому адресу через сам сервер: время до начала ответа. Число больше обычного пинга (в нём рукопожатие с сервером), зато доказывает, что трафик идёт. Запрос HEAD не скачивает тело ответа.'
                        : 'Настоящий запрос GET к тестовому адресу через сам сервер: время до первого байта ответа. Число больше обычного пинга (в нём рукопожатие с сервером), зато доказывает, что трафик идёт.'}
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

                <div data-tour="incy-ping-url" className="space-y-1.5 pt-2 border-t border-border/50">
                  <Label className="text-xs font-semibold">Тестовый адрес</Label>
                  <DraftField
                    value={settings.pingTestUrl}
                    className="h-7 text-xs font-mono"
                    validate={(v) =>
                      /^https?:\/\/[^\s/]+\S*$/i.test(v) ? null : 'Нужен адрес вида https://www.gstatic.com/generate_204'
                    }
                    onCommit={(v) => void handleUpdateSettings({ pingTestUrl: v })}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Адрес для режимов «Умный» и «Запрос»: он же проверяет узел при автопереключении и восстановлении после
                    обрыва. В режиме «Быстрый» не используется.
                  </p>
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

                <div data-tour="incy-ping-timeout" className="flex items-center justify-between pt-2 border-t border-border/50">
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
                <div data-tour="incy-udp-timeout" className="space-y-1.5">
                  <Label className="text-sm">Тайм-аут простоя UDP</Label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                    {[
                      { v: 0, l: 'Стандарт (5 мин)' },
                      { v: 120, l: '2 мин' },
                      { v: 600, l: '10 мин' },
                      { v: 1800, l: '30 мин' }
                    ].map((o) => {
                      const eff = settings.idleTimeoutSec >= 120 ? settings.idleTimeoutSec : 0
                      return (
                        <Button
                          key={o.v}
                          size="sm"
                          variant={eff === o.v ? 'default' : 'outline'}
                          onClick={() => handleUpdateSettings({ idleTimeoutSec: o.v })}
                          className="text-xs h-7"
                        >
                          {o.l}
                        </Button>
                      )
                    })}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Через сколько закрывать UDP-сессию без трафика (игры, звонки, QUIC). Если в игре или звонке рвётся
                    связь после паузы, поставьте 10–30 мин.
                  </p>
                </div>

                <div data-tour="incy-tun-stack" className="space-y-1.5 pt-2 border-t border-border/50">
                  <Label className="text-sm">Сетевой стек TUN</Label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {([
                      { v: 'mixed', l: 'Смешанный' },
                      { v: 'system', l: 'Системный' },
                      { v: 'gvisor', l: 'gVisor' }
                    ] as const).map((o) => (
                      <Button
                        key={o.v}
                        size="sm"
                        variant={(settings.tunStack ?? 'mixed') === o.v ? 'default' : 'outline'}
                        onClick={() => handleUpdateSettings({ tunStack: o.v })}
                        className="text-xs h-7"
                      >
                        {o.l}
                      </Button>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {(settings.tunStack ?? 'mixed') === 'mixed'
                      ? 'Рекомендуется. TCP через стек Windows (быстрее), UDP через gVisor (стабильнее).'
                      : settings.tunStack === 'system'
                        ? 'Всё через стек Windows: быстрее всего, но сторонний брандмауэр или антивирус может мешать.'
                        : 'Всё внутри приложения: больше нагрузка на процессор, зато работает там, где другие варианты не заработали.'}{' '}
                    Только для режима TUN.
                  </p>
                </div>

                <MtuPicker settings={settings} onUpdate={handleUpdateSettings} />

                <ExcludedRoutesEditor settings={settings} onUpdate={handleUpdateSettings} />

                <div data-tour="incy-disconnect-on-sleep" className="flex items-center justify-between pt-2 border-t border-border/50">
                  <div className="flex flex-col">
                    <Label className="text-sm">Отключать при переходе в спящий режим</Label>
                    <span className="text-xs text-muted-foreground">
                      Разрывать туннель при сне и подключать снова после пробуждения. Это отключение по вашему выбору:
                      Kill Switch в это время не блокирует трафик.
                    </span>
                  </div>
                  <Switch
                    checked={settings.disconnectOnSleep}
                    onCheckedChange={(v) => handleUpdateSettings({ disconnectOnSleep: v })}
                  />
                </div>

                <div data-tour="incy-memory-monitor" className="flex items-center justify-between pt-2 border-t border-border/50">
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

                <VerboseCoreLogRow settings={settings} onUpdate={handleUpdateSettings} />
                <ApplyNote tour="incy-apply-note-performance" connected={isConnected} killSwitch={settings.killSwitch} />
              </CardContent>
            </Card>

            {/* Бэкап — раньше отдельной вкладкой, теперь последний блок настроек. */}
            <BackupTab onRestored={loadData} />
          </div>
        )}

        {/* TAB 4: STATS */}
        {activeTab === 'stats' && <StatsTab stats={stats} isConnected={isConnected} onReset={handleResetStats} />}
        {activeTab === 'stats' && (
          <div className="mt-4">
            <ConnectionsPanel />
          </div>
        )}




        {/* MODAL: QR Code Import */}
        {showQrModal && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 animate-in fade-in duration-200"
            onClick={() => setShowQrModal(false)}
          >
            <div
              className="w-full max-w-md border border-primary/40 bg-card/95 rounded-2xl shadow-[0_0_50px_rgba(0,0,0,0.8)] overflow-hidden p-5 space-y-4 "
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <QrCode className="h-4 w-4 text-primary" />
                  <div className="text-sm font-bold text-foreground">Импорт через QR-код</div>
                </div>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => setShowQrModal(false)}
                  className="h-7 w-7"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <p className="text-xs text-muted-foreground leading-relaxed">
                Выберите удобный способ распознавания QR-кода с ссылкой на сервер или подписку:
              </p>

              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => { void handleScanQrFromScreen() }}
                  disabled={scanningQr}
                  className="w-full flex items-center gap-3 p-3 rounded-xl border border-primary/30 bg-card/50 hover:bg-primary/10 hover:border-primary transition-all text-left cursor-pointer"
                >
                  <Monitor className="h-5 w-5 text-primary shrink-0" />
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-foreground">Снимок экрана</div>
                    <div className="text-[10px] text-muted-foreground">Сканировать QR-код, открытый на вашем мониторе</div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => { void handleScanQrFromClipboard() }}
                  disabled={scanningQr}
                  className="w-full flex items-center gap-3 p-3 rounded-xl border border-primary/30 bg-card/50 hover:bg-primary/10 hover:border-primary transition-all text-left cursor-pointer"
                >
                  <Copy className="h-5 w-5 text-primary shrink-0" />
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-foreground">Из буфера обмена</div>
                    <div className="text-[10px] text-muted-foreground">Скопированное изображение (Win+Shift+S / PrtSc)</div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => { void handleScanQrFromFile() }}
                  disabled={scanningQr}
                  className="w-full flex items-center gap-3 p-3 rounded-xl border border-primary/30 bg-card/50 hover:bg-primary/10 hover:border-primary transition-all text-left cursor-pointer"
                >
                  <FolderOpen className="h-5 w-5 text-primary shrink-0" />
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-foreground">Выбрать файл изображения</div>
                    <div className="text-[10px] text-muted-foreground">Открыть PNG, JPG, WebP с вашего диска</div>
                  </div>
                </button>
              </div>

              {scanningQr && (
                <div className="text-center py-2 text-xs text-primary animate-pulse font-medium">
                  Распознавание QR-кода...
                </div>
              )}
            </div>
          </div>
        )}

        {/* Подтверждение удаления подписки. Спрашиваем всегда: вместе с ней
            исчезают все её серверы, а вернуть их можно только повторным
            импортом ссылки — которой у пользователя может уже не быть. */}
        {removingSub && (
          <div
            className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
            onClick={() => setRemovingSub(null)}
          >
            <div
              className="bg-card/95 border border-destructive/40 w-full max-w-md rounded-2xl p-5 space-y-4 shadow-[0_0_50px_rgba(0,0,0,0.8)] "
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                <Trash2 className="size-4 text-destructive" />
                Удалить подписку «{removingSub.title}»?
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Вместе с ней удалятся её серверы (
                {nodes.filter((n) => n.subscriptionId === removingSub.id).length} шт.). Остальные
                подписки и серверы, добавленные вручную, останутся на месте. Саму подписку у
                провайдера это не отменяет — её можно вернуть, снова вставив ссылку.
              </p>
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="outline" onClick={() => setRemovingSub(null)} className="text-xs h-8">
                  Отмена
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => { void handleRemoveSubscription(removingSub) }}
                  className="text-xs h-8"
                >
                  Удалить
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </BasePage>
  )
}
