import React, { useState, useEffect } from 'react'
import { toast } from 'sonner'
import BasePage from '@renderer/components/base/base-page'
import AutoSelectCard from '@renderer/components/auto-select-card'
import ValveRegionsCard from '@renderer/components/valve-regions-card'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import {
  ArrowRight,
  Copy,
  Gauge,
  Globe,
  Loader2,
  MapPin,
  RefreshCw,
  Route,
  Server,
  Settings2,
  ShieldCheck,
  ShieldPlus,
  Sparkles,
  Stethoscope,
  Target,
  Trophy,
  Zap
} from 'lucide-react'
import { EmptyState, LzHero, LzPanel, LzSectionHead, Segmented, StatChip, type LzTone, type SegmentedItem } from '@renderer/components/lz'
import { Rows, SettingsGroup, SwitchRow } from '@renderer/components/settings/setting-row'
import { ProtocolTag } from '@renderer/components/incy/signal'
import RouteRace from '@renderer/components/optimizer/route-race'
import { useTourTab } from '@renderer/lib/tour-focus'
import { useNavigate } from 'react-router-dom'
import { cn, POWER_ON_BANNER_STYLE } from '@renderer/lib/utils'
import { useIncyStore } from '@renderer/store/incy-store'
import {
  incyGetSettings,
  incyPatchSettings,
  incyGetNodes,
  incyConnect,
  incyDisconnect,
  incySelectNode,
  incyPingGameServer,
  zapretAddGameServerIp,
  optimizerTrace,
  optimizerBufferbloat,
  type TraceResult,
  type BufferbloatResult,
  type IncySettings,
  type IncyNode,
  type GamePingResult,
  type RoutePathStats,
  type RouteOptimizerProgress
} from '@renderer/utils/ipc'

function cleanServerName(name: string): string {
  return name.replace(/^\[.*?\]\s*/, '').trim() || name
}

/** Пинг, джиттер и потери одной строкой. Потери > 0 и большой джиттер подсвечиваются. */
function StatTriple({
  stats,
  fallbackPing,
  highlight,
  compact
}: {
  stats?: RoutePathStats
  fallbackPing?: number | null
  highlight?: boolean
  /** Внутри чипа: без крупного шрифта. */
  compact?: boolean
}): React.ReactElement {
  const ping = stats?.pingMs ?? fallbackPing ?? null
  if (ping == null) return <span className="text-[13px] font-semibold text-muted-foreground">—</span>
  const approx = stats?.method === 'estimate' ? '≈' : ''
  return (
    <span className="inline-flex items-baseline gap-2 tabular-nums">
      <span className={cn(compact ? 'text-[13.5px] font-semibold' : 'text-[16px] font-extrabold', highlight ? 'text-primary' : 'text-foreground')}>
        {approx}
        {ping}
        <span className="ml-0.5 text-[11px] font-normal text-muted-foreground">мс</span>
      </span>
      {stats && stats.jitterMs != null && (
        <span className={cn('text-[11px]', stats.jitterMs > 8 ? 'text-st-warn-text' : 'text-muted-foreground')} title="Джиттер (разброс)">
          ±{stats.jitterMs}
        </span>
      )}
      {stats && stats.lossPct != null && stats.method !== 'estimate' && (
        <span className={cn('text-[11px]', stats.lossPct > 0 ? 'text-st-err-text' : 'text-muted-foreground')} title="Потери">
          {stats.lossPct}%
        </span>
      )}
      {stats?.method === 'icmp' && !compact && <span className="text-[10px] text-muted-foreground">ICMP</span>}
    </span>
  )
}

type OptTab = 'nodes' | 'path' | 'valve' | 'settings'
const OPT_TABS: SegmentedItem<OptTab>[] = [
  { id: 'nodes', label: 'Узлы', icon: Server, title: 'Пинг до сервера через каждый узел подписки' },
  { id: 'path', label: 'Путь', icon: Route, title: 'Трассировка и пинг под нагрузкой: где набирается задержка' },
  { id: 'valve', label: 'Регионы Valve', icon: Globe, title: 'Пинг до датацентров Valve и блокировка лишних регионов' },
  { id: 'settings', label: 'Настройки', icon: Settings2, title: 'Автоподключение, Zapret и автовыбор узла' }
]

/**
 * Оптимизатор маршрута Faceit / CS2 — отдельная вкладка (раньше жил внутри
 * ExitLag). Замер: A2S-запросы к игровому серверу напрямую и через каждый
 * быстрый узел подписки; лучший узел — по пингу, джиттеру и потерям.
 */
export default function OptimizerPage(): React.ReactElement {
  const navigate = useNavigate()
  const status = useIncyStore((s) => s.status)
  const isConnected = status.state === 'running'

  const [settings, setSettings] = useState<IncySettings | null>(null)
  const [nodes, setNodes] = useState<IncyNode[]>([])

  // Game server / Faceit ping
  const [gameServerTarget, setGameServerTarget] = useState('')
  const [measuringGamePing, setMeasuringGamePing] = useState(false)
  const [gamePingResult, setGamePingResult] = useState<GamePingResult | null>(null)
  const [optimizerProgress, setOptimizerProgress] = useState<RouteOptimizerProgress | null>(null)

  useEffect(() => {
    const onProgress = (_e: unknown, p: RouteOptimizerProgress): void => setOptimizerProgress(p)
    window.electron.ipcRenderer.on('exitlag:optimizerProgress', onProgress)
    return (): void => {
      window.electron.ipcRenderer.removeAllListeners('exitlag:optimizerProgress')
    }
  }, [])
  const [selectingNodeId, setSelectingNodeId] = useState<string | null>(null)
  const [tab, setTab] = useState<OptTab>('nodes')
  useTourTab<OptTab>('/optimizer', setTab)

  // ---- Диагностика пути: трассировка и пинг под нагрузкой ----
  const [trace, setTrace] = useState<TraceResult | null>(null)
  const [tracing, setTracing] = useState(false)
  const [bloat, setBloat] = useState<BufferbloatResult | null>(null)
  const [bloating, setBloating] = useState(false)
  const runTrace = async (): Promise<void> => {
    const target = gameServerTarget.trim()
    if (!target) {
      toast.error('Вставьте адрес сервера (connect IP:порт) — трассировка идёт до него')
      return
    }
    setTracing(true)
    try {
      setTrace(await optimizerTrace(target))
    } catch (e: any) {
      toast.error('Трассировка не удалась', { description: e?.message || String(e) })
    } finally {
      setTracing(false)
    }
  }
  const runBloat = async (): Promise<void> => {
    setBloating(true)
    try {
      setBloat(await optimizerBufferbloat(trace?.reached ? trace.targetIp : undefined))
    } catch (e: any) {
      toast.error('Проверка не удалась', { description: e?.message || String(e) })
    } finally {
      setBloating(false)
    }
  }

  useEffect(() => {
    void Promise.all([incyGetSettings(), incyGetNodes()])
      .then(([s, n]) => {
        setSettings(s)
        setNodes(n)
      })
      .catch(() => void 0)
  }, [])

  const handleUpdateSettings = async (patch: Partial<IncySettings>): Promise<void> => {
    if (!settings) return
    setSettings({ ...settings, ...patch })
    try {
      const res = await incyPatchSettings(patch)
      setSettings(res.settings)
    } catch (e: any) {
      toast.error('Не удалось сохранить настройки', { description: e?.message || String(e) })
    }
  }

  /** IP сервера (без connect и порта) → наш список на вкладке Zapret. */
  const [addingToZapret, setAddingToZapret] = useState(false)
  const addTargetToZapret = async (target: string): Promise<void> => {
    if (!target.trim()) {
      toast.error('Введите IP-адрес или строку подключения сервера Faceit / CS2')
      return
    }
    setAddingToZapret(true)
    try {
      const r = await zapretAddGameServerIp(target)
      if (!r.ip) {
        toast.error('Не нашёл IP в строке', { description: 'Вставьте строку «connect IP:порт» из комнаты матча.' })
        return
      }
      if (r.added) {
        toast.success(`IP ${r.ip} добавлен в список Zapret`, {
          description:
            (r.restarted
              ? 'Zapret перезапущен, чтобы применить список. '
              : r.running
                ? ''
                : 'Список применится при следующем запуске Zapret. ') +
            'Чтобы сравнить узлы, нажмите «Замерить пинг».'
        })
      } else {
        toast.info(`IP ${r.ip} уже в списке Zapret`, { description: 'Чтобы сравнить узлы, нажмите «Замерить пинг».' })
      }
    } catch (e: any) {
      toast.error('Не удалось добавить IP в список Zapret', { description: e?.message || String(e) })
    } finally {
      setAddingToZapret(false)
    }
  }

  const handleMeasureGamePing = async (targetOverride?: string): Promise<void> => {
    // Второй замер поверх идущего сбрасывал прогресс первого.
    if (measuringGamePing) return
    const targetToMeasure = (targetOverride || gameServerTarget).trim()
    if (!targetToMeasure) {
      toast.error('Введите IP-адрес или строку подключения сервера Faceit / CS2')
      return
    }
    setMeasuringGamePing(true)
    setOptimizerProgress({ done: 0, total: 1, stage: 'Подготовка' })
    try {
      // Замер только меряет: в Zapret сервер попадает при вставке адреса
      // (или кнопкой «В Zapret»), а не при каждом замере.
      const res = await incyPingGameServer(targetToMeasure)
      setGamePingResult(res)
      const best = res.nodes.find((n) => n.isBest)
      // Автоподключение выбирает лучший из РАЗРЕШЁННЫХ узлов — он может не
      // совпадать с общим лучшим, если тот исключён правилами автовыбора.
      const connected = res.autoConnectedNodeId
        ? res.nodes.find((n) => n.nodeId === res.autoConnectedNodeId)
        : undefined
      toast.success(
        connected
          ? `Подключено: ${cleanServerName(connected.nodeName)} — ${connected.totalPing} мс`
          : best
            ? `Лучший маршрут: ${cleanServerName(best.nodeName)} — ${best.totalPing} мс`
            : 'Замер выполнен: ни один узел не быстрее прямого подключения',
        { style: POWER_ON_BANNER_STYLE }
      )
    } catch (err: any) {
      toast.error('Ошибка замера пинга до игрового сервера', {
        description: err?.message || String(err)
      })
    } finally {
      setMeasuringGamePing(false)
      setOptimizerProgress(null)
    }
  }

  const handlePasteGameServerFromClipboard = async (): Promise<void> => {
    try {
      const text = await navigator.clipboard.readText()
      if (text && text.trim()) {
        const val = text.trim()
        setGameServerTarget(val)
        // Вставка только добавляет сервер в Zapret (если это включено) —
        // замер запускается отдельно кнопкой «Замерить пинг».
        if (settings?.optimizerAddToZapret !== false) {
          void addTargetToZapret(val)
        } else {
          toast.info('Адрес вставлен', { description: 'Нажмите «Замерить пинг», чтобы сравнить узлы.' })
        }
      } else {
        toast.info('Буфер обмена пуст')
      }
    } catch {
      toast.error('Не удалось прочитать буфер обмена')
    }
  }

  const handleSelectNodeAndConnect = async (nodeId: string): Promise<void> => {
    setSelectingNodeId(nodeId)
    try {
      await incySelectNode(nodeId)
      if (!isConnected) {
        await incyConnect(nodeId)
      } else {
        await incyDisconnect()
        await incyConnect(nodeId)
      }
      const node = nodes.find((n) => n.id === nodeId)
      toast.success(`Подключено через: ${node ? cleanServerName(node.name) : 'выбранный сервер'}`, {
        style: POWER_ON_BANNER_STYLE
      })
    } catch (err: any) {
      toast.error('Ошибка выбора узла', { description: err?.message || String(err) })
    } finally {
      setSelectingNodeId(null)
    }
  }

  const res = gamePingResult
  const bestNode = res?.nodes.find((n) => n.isBest) ?? null
  const bestMs = bestNode ? (bestNode.path?.pingMs ?? bestNode.totalPing ?? null) : null
  const directMs = res ? (res.direct?.pingMs ?? res.directPing ?? null) : null
  const bestIsCurrent = Boolean(bestNode && isConnected && status.activeNodeId === bestNode.nodeId)
  const activeNode = nodes.find((n) => n.id === status.activeNodeId)
  const heroTone: LzTone = measuringGamePing ? 'busy' : res ? 'on' : 'off'
  const heroTitle = measuringGamePing
    ? 'Замеряю пути до сервера…'
    : !res
      ? 'Найдите быстрый путь до сервера'
      : bestNode
        ? `Быстрее через ${cleanServerName(bestNode.nodeName)}`
        : 'Напрямую быстрее всего'
  const heroText = measuringGamePing
    ? `${optimizerProgress?.stage ?? 'Подготовка'}. Ход замера пишется во вкладку «Логи».`
    : !res
      ? 'Скопируйте строку connect IP:порт из комнаты Faceit или консоли CS2 и нажмите «Замерить пинг»: по 20 игровых запросов напрямую и через каждый быстрый узел.'
      : bestNode
        ? `${bestMs ?? bestNode.totalPing} мс против ${directMs ?? '—'} мс напрямую${typeof bestNode.savingMs === 'number' && bestNode.savingMs > 0 && !res.directViaTunnel ? `, на ${bestNode.savingMs} мс быстрее` : ''}.`
        : 'Ни один узел не дал пинг ниже прямого подключения. Для этой игры VPN не нужен.'

  return (
    <BasePage title="Оптимизатор маршрута">
      <div className="mx-auto flex w-full max-w-[1080px] flex-col lz-page-gap lz-page-x pb-5">
        <LzHero
          data-tour="optimizer-console"
          tone={heroTone}
          visual={<RouteRace bestMs={bestMs} directMs={directMs} measuring={measuringGamePing} progress={optimizerProgress} />}
          title={<span className="line-clamp-2" data-sensitive={bestNode ? 'node' : undefined}>{heroTitle}</span>}
          text={heroText}
          extra={
            <div className="mt-1 flex w-full flex-wrap items-center gap-2">
              <div className="relative min-w-[260px] flex-1">
                <Input
                  data-sensitive="ip"
                  value={gameServerTarget}
                  onChange={(e) => setGameServerTarget(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void addTargetToZapret(gameServerTarget)
                  }}
                  placeholder="connect 162.19.141.22:27015 или 162.19.141.22"
                  className="h-9 rounded-xl border-foreground/[0.1] bg-foreground/[0.035] pr-24 text-[13px] tabular-nums"
                />
                <Button
                  size="sm"
                  variant="ghost"
                  type="button"
                  onClick={() => void handlePasteGameServerFromClipboard()}
                  className="absolute top-1 right-1 h-7 gap-1 rounded-lg px-2 text-[11.5px] text-primary hover:bg-primary/10"
                >
                  <Copy className="size-3" /> Вставить
                </Button>
              </div>
              <Button
                size="sm"
                type="button"
                variant="outline"
                onClick={() => void addTargetToZapret(gameServerTarget)}
                disabled={addingToZapret || !gameServerTarget.trim()}
                className="h-9 shrink-0 gap-1.5 rounded-xl text-xs"
                title="Добавить IP сервера в список Zapret (без замера)"
              >
                {addingToZapret ? <RefreshCw className="size-3.5 animate-spin" /> : <ShieldPlus className="size-3.5" />}
                В Zapret
              </Button>
            </div>
          }
          actions={
            <>
              <Button
                size="lg"
                type="button"
                onClick={() => void handleMeasureGamePing()}
                disabled={measuringGamePing || !gameServerTarget.trim()}
                className="h-11 rounded-xl px-5 text-[14px]"
              >
                {measuringGamePing ? <Loader2 className="size-4 animate-spin" /> : <Zap className="size-4" />}
                {measuringGamePing ? 'Замеряю…' : res ? 'Замерить ещё раз' : 'Замерить пинг'}
              </Button>
              {bestNode && !measuringGamePing && (
                <Button
                  variant="outline"
                  size="lg"
                  onClick={() => void handleSelectNodeAndConnect(bestNode.nodeId)}
                  disabled={selectingNodeId === bestNode.nodeId || bestIsCurrent}
                  className="h-10 rounded-xl px-5 text-[13px]"
                >
                  {selectingNodeId === bestNode.nodeId ? <RefreshCw className="size-4 animate-spin" /> : <Trophy className="size-4" />}
                  {bestIsCurrent ? 'Лучший подключён' : 'Подключить лучший'}
                </Button>
              )}
            </>
          }
          footer={
            <div className="flex flex-wrap items-stretch gap-2">
              <StatChip
                icon={<MapPin />}
                tone={res ? 'on' : 'off'}
                label="Сервер"
                value={res ? `${res.geo.city ? `${res.geo.city}, ` : ''}${res.geo.country || res.targetIp}` : 'не замерен'}
                aside={
                  res ? (
                    <span data-sensitive="ip" className="shrink-0 rounded-md bg-foreground/[0.06] px-1.5 py-0.5 text-[11px] tabular-nums text-muted-foreground">
                      {res.targetIp}:{res.targetPort}
                    </span>
                  ) : undefined
                }
                className="min-w-[220px] flex-1"
              />
              <StatChip
                icon={<Route />}
                label={res?.directViaTunnel ? 'Напрямую (через VPN)' : 'Напрямую'}
                value={res ? <StatTriple stats={res.direct} fallbackPing={res.directPing} compact /> : '—'}
              />
              <StatChip
                icon={<Sparkles />}
                tone={settings?.routeAutoConnectBest ? 'on' : 'off'}
                label="Автоподключение"
                value={settings?.routeAutoConnectBest ? 'к лучшему узлу' : 'только подсказка'}
                title="Изменить в «Настройках» оптимизатора"
                onClick={() => setTab('settings')}
              />
              <StatChip
                icon={<ShieldCheck />}
                tone={isConnected ? 'on' : 'off'}
                label="VPN INCY"
                value={isConnected ? 'подключён' : 'выключен'}
                aside={
                  isConnected && activeNode ? (
                    <span data-sensitive="node" className="max-w-[130px] shrink truncate rounded-md bg-primary/12 px-1.5 py-0.5 text-[11px] font-semibold text-primary">
                      {cleanServerName(activeNode.name)}
                    </span>
                  ) : undefined
                }
                title="Открыть INCY"
                onClick={() => navigate('/incy')}
              />
            </div>
          }
        />

        <div className="flex shrink-0 flex-wrap items-center gap-3">
          <Segmented
            items={OPT_TABS.map((t) => ({ ...t, label: t.id === 'nodes' && res ? `Узлы ${res.nodes.length}` : t.label }))}
            value={tab}
            onChange={setTab}
            aria-label="Разделы оптимизатора"
            data-tour="optimizer-tabs"
            className="w-[560px]"
          />
          <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">{OPT_TABS.find((t) => t.id === tab)?.title}</span>
        </div>

        {tab === 'nodes' && (
          <LzPanel className="select-text px-2 pt-3 pb-2">
            <LzSectionHead
              className="px-3 pb-2"
              title="Узлы до сервера"
              hint="Сортировка по итоговой оценке: пинг + 2×джиттер + 5 мс за каждый % потерь. «Нативный UDP» — пакеты игры идут по UDP без повторной отправки, это лучше для игр."
              sub={
                res && typeof res.measuredNodes === 'number'
                  ? `Проверено ${res.measuredNodes} из ${res.totalNodes}, самые быстрые до вас`
                  : 'Пинг, разброс и потери через каждый быстрый узел подписки'
              }
            />
            {(res?.warnings ?? []).map((w) => (
              <div key={w} className="mx-2 mb-2 rounded-xl border border-st-warn/35 bg-st-warn/10 px-3 py-2 text-[12px] leading-relaxed text-st-warn-text">
                {w}
              </div>
            ))}
            {!res ? (
              <EmptyState
                icon={<Target />}
                title={measuringGamePing ? 'Замеряю пути…' : 'Здесь появятся узлы'}
                text={
                  measuringGamePing
                    ? optimizerProgress?.stage
                    : 'Вставьте адрес сервера вверху и нажмите «Замерить пинг». Список отсортируется от быстрого к медленному.'
                }
              />
            ) : res.nodes.length === 0 ? (
              <EmptyState icon={<Target />} title="Нет узлов для замера" text="Обновите подписку на вкладке INCY." />
            ) : (
              <div className="max-h-[420px] space-y-1 overflow-y-auto pr-1">
                {res.nodes.map((n) => {
                  const isCurrentActive = status.state === 'running' && status.activeNodeId === n.nodeId
                  const estimated = n.path?.method === 'estimate'
                  return (
                    <div
                      key={n.nodeId}
                      className={cn(
                        'relative flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border py-2.5 pr-3 pl-3 text-xs transition-colors',
                        n.isBest ? 'border-primary/40 bg-primary/[0.09]' : 'border-transparent hover:border-foreground/[0.08] hover:bg-foreground/[0.03]'
                      )}
                    >
                      {n.isBest && <span aria-hidden className="pointer-events-none absolute inset-y-2.5 left-0 w-[3px] rounded-r-full bg-primary" />}
                      <span
                        aria-hidden
                        className={cn(
                          'flex size-9 shrink-0 items-center justify-center rounded-xl [&_svg]:size-[18px]',
                          n.isBest ? 'bg-primary/15 text-primary' : 'bg-foreground/[0.05] text-muted-foreground'
                        )}
                      >
                        {n.isBest ? <Trophy /> : <Server />}
                      </span>
                      <div className="min-w-[14rem] flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span data-sensitive="node" className={cn('truncate text-[13.5px] font-semibold', n.isBest ? 'text-primary' : 'text-foreground')}>
                            {cleanServerName(n.nodeName)}
                          </span>
                          <ProtocolTag protocol={n.protocol} />
                          {n.isBest && <span className="rounded-md bg-primary px-1.5 py-px text-[10.5px] font-bold text-primary-foreground">лучший</span>}
                          {n.udpTransport === 'udp' ? (
                            <MiniTag tone="ok" title="Пакеты игры идут по UDP напрямую — без задержек на повторную отправку">
                              нативный UDP
                            </MiniTag>
                          ) : n.udpTransport === 'tcp' ? (
                            <MiniTag title="UDP игры едет внутри TCP: при потерях на линии пакеты ждут повторной отправки — скачки пинга">UDP в TCP</MiniTag>
                          ) : null}
                          {isCurrentActive && <MiniTag tone="primary">подключён</MiniTag>}
                          {estimated && <MiniTag tone="warn">оценка</MiniTag>}
                          {n.autoAllowed === false && <MiniTag title="Узел исключён из автовыбора — вручную подключиться можно">не для автовыбора</MiniTag>}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-muted-foreground">
                          <span>
                            ПК → узел: <b className="font-semibold text-foreground tabular-nums">{n.userToNodePing ?? '—'} мс</b>
                          </span>
                          {n.path && n.path.method === 'a2s' && (
                            <span className="tabular-nums">
                              ответов {n.path.received} из {n.path.sent}
                            </span>
                          )}
                          {typeof n.savingMs === 'number' && n.savingMs > 0 && !res.directViaTunnel && (
                            <span className="font-semibold text-primary">
                              на {n.savingMs} мс быстрее прямого{estimated ? ' (оценка)' : ''}
                            </span>
                          )}
                          {n.error && <span className="text-st-err-text">{n.error}</span>}
                          {!n.error && n.path?.method === 'failed' && <span className="text-st-err-text">сервер не ответил через этот узел</span>}
                        </div>
                      </div>
                      <div className="ml-auto flex shrink-0 items-center gap-3">
                        <StatTriple stats={n.path} fallbackPing={n.totalPing} highlight={n.isBest} />
                        <Button
                          size="sm"
                          variant={n.isBest ? 'default' : 'outline'}
                          onClick={() => void handleSelectNodeAndConnect(n.nodeId)}
                          disabled={selectingNodeId === n.nodeId || isCurrentActive}
                          className="h-8 w-[7.25rem] rounded-lg text-xs"
                        >
                          {selectingNodeId === n.nodeId ? <RefreshCw className="size-3.5 animate-spin" /> : isCurrentActive ? 'Подключён' : 'Подключить'}
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </LzPanel>
        )}

        {tab === 'path' && (
          <LzPanel className="space-y-3 p-4">
            <LzSectionHead
              title="Откуда берётся пинг"
              hint="Если на «близком» сервере пинг выше, чем должен быть (например, 63 мс вместо 25 на московском Faceit), трассировка покажет, на каком участке пути он набирается, а проверка под нагрузкой — не виноваты ли роутер и скачивания в домашней сети. Всё меряется мимо VPN."
              sub="Трассировка до сервера и пинг под нагрузкой, мимо VPN"
              right={
                <>
                  <Button size="sm" variant="outline" className="h-8 gap-1.5 rounded-lg text-xs" onClick={() => void runTrace()} disabled={tracing}>
                    {tracing ? <RefreshCw className="size-3.5 animate-spin" /> : <Route className="size-3.5" />}
                    Трассировка до сервера
                  </Button>
                  <Button size="sm" variant="outline" className="h-8 gap-1.5 rounded-lg text-xs" onClick={() => void runBloat()} disabled={bloating}>
                    {bloating ? <RefreshCw className="size-3.5 animate-spin" /> : <Gauge className="size-3.5" />}
                    {bloating ? 'Нагружаю канал ~15 с…' : 'Пинг под нагрузкой'}
                  </Button>
                </>
              }
            />

            {!trace && !bloat && (
              <EmptyState
                compact
                icon={<Route />}
                title="Пока ничего не измерено"
                text="Трассировка идёт до адреса из поля вверху. Пинг под нагрузкой скачает немного данных, чтобы проверить домашнюю сеть."
              />
            )}

            {trace && (
              <div className="select-text space-y-2 rounded-xl border border-foreground/[0.08] bg-foreground/[0.03] p-3">
                <div className="text-[12px] text-muted-foreground">
                  До <span data-sensitive="ip">{trace.targetIp}</span>
                  {trace.reached ? '' : ' (сервер на пинг не отвечает)'}, узлов: {trace.hops.length}
                  {trace.viaPhysical ? ', в обход VPN' : ''}
                </div>
                <div className="space-y-0.5 text-[12px] tabular-nums">
                  <div className="grid grid-cols-[2rem_1fr_4.5rem_4rem_4rem] gap-2 pb-1 text-[11px] text-muted-foreground">
                    <span>№</span>
                    <span>Адрес</span>
                    <span className="text-right">Пинг</span>
                    <span className="text-right">Прирост</span>
                    <span className="text-right">Потери</span>
                  </div>
                  {trace.hops.map((h) => {
                    const jump = trace.biggestJump?.hop === h.hop && (trace.biggestJump?.deltaMs ?? 0) >= 10
                    return (
                      <div
                        key={h.hop}
                        className={cn('grid grid-cols-[2rem_1fr_4.5rem_4rem_4rem] gap-2 rounded-md px-0.5', jump && 'bg-st-warn/10 font-bold text-st-warn-text')}
                      >
                        <span className="text-muted-foreground">{h.hop}</span>
                        <span data-sensitive="ip" className="truncate">
                          {h.ip ?? '* * *'}
                          {h.isPrivate ? ' (дом)' : ''}
                        </span>
                        <span className="text-right">{h.avgMs != null ? `${h.avgMs} мс` : '—'}</span>
                        <span className="text-right">{h.deltaMs != null && h.deltaMs > 0 ? `+${h.deltaMs}` : ''}</span>
                        <span className={cn('text-right', (h.lossPct ?? 0) > 0 && 'text-muted-foreground')}>{h.lossPct != null ? `${h.lossPct}%` : ''}</span>
                      </div>
                    )
                  })}
                </div>
                <ul className="space-y-1 text-[12px] leading-relaxed">
                  {trace.verdict.map((v) => (
                    <li key={v} className="flex gap-2">
                      <span aria-hidden className="mt-[7px] size-1.5 shrink-0 rounded-full bg-primary" />
                      {v}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {bloat && (
              <div className="select-text flex flex-wrap items-center gap-4 rounded-xl border border-foreground/[0.08] bg-foreground/[0.03] p-3">
                <span
                  className={cn(
                    'flex size-12 shrink-0 items-center justify-center rounded-xl text-[22px] font-extrabold',
                    bloat.grade === 'A' || bloat.grade === 'B'
                      ? 'bg-st-ok/12 text-st-ok-text'
                      : bloat.grade === 'unknown'
                        ? 'bg-foreground/[0.05] text-muted-foreground'
                        : 'bg-st-warn/12 text-st-warn-text'
                  )}
                  title="Оценка домашней сети под нагрузкой"
                >
                  {bloat.grade === 'unknown' ? '—' : bloat.grade}
                </span>
                <div className="min-w-[16rem] flex-1 space-y-1">
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[12px] tabular-nums text-muted-foreground">
                    <span>
                      в покое <b className="text-foreground">{bloat.idle.avgMs ?? '—'} мс</b>
                    </span>
                    <span>
                      под нагрузкой <b className="text-foreground">{bloat.loaded.avgMs ?? '—'} мс</b> (макс {bloat.loaded.maxMs ?? '—'}, потери {bloat.loaded.lossPct}%)
                    </span>
                    {bloat.downloadMbps != null && <span>скачивание {bloat.downloadMbps} Мбит/с</span>}
                  </div>
                  <p className="text-[12.5px] leading-relaxed">{bloat.verdict}</p>
                </div>
              </div>
            )}

            <details className="group rounded-xl border border-foreground/[0.08] bg-foreground/[0.025] px-3 py-2 text-[12px] leading-relaxed text-muted-foreground">
              <summary className="cursor-pointer list-none font-semibold text-foreground marker:hidden">
                Что реально снижает пинг и убирает потери
                <span className="ml-1 text-muted-foreground group-open:hidden">— показать</span>
              </summary>
              <ul className="mt-2 space-y-1">
                <li>Кабель вместо Wi-Fi и никаких скачиваний в сети во время матча (проверка выше).</li>
                <li>
                  VPN помогает, только если путь провайдера до сервера хуже, чем через узел. Для московских серверов берите узел в России,
                  для европейских — в ближайшей к серверу стране. Узел далеко от сервера пинг только добавит.
                </li>
                <li>
                  Для игр выбирайте узлы с пометкой «нативный UDP» (Hysteria2, WireGuard). У VLESS/Trojan пакеты игры едут внутри TCP, и
                  любая потеря на линии превращается в скачок пинга.
                </li>
                <li>Включайте VPN только для игры — режим ExitLag, чтобы остальной трафик не делил с ней канал.</li>
              </ul>
            </details>

            <button
              type="button"
              onClick={() => navigate('/diagnostics')}
              className="flex w-full cursor-pointer items-center gap-3 rounded-xl border border-foreground/[0.08] bg-foreground/[0.03] px-3 py-2.5 text-left transition-colors hover:border-primary/40"
            >
              <Stethoscope className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 text-[12.5px]">
                <span className="font-semibold text-foreground">Проверка сайтов, утечек и Wi-Fi</span>
                <span className="text-muted-foreground"> — в разделе «Диагностика»</span>
              </span>
              <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
            </button>
          </LzPanel>
        )}

        {tab === 'valve' && <ValveRegionsCard />}

        {tab === 'settings' && (
          <>
            <SettingsGroup title="Адрес сервера и Zapret" hint="Что делает оптимизатор, когда вы вставляете адрес сервера.">
              <Rows>
                <SwitchRow
                  id="opt-add-zapret"
                  data-tour="optimizer-add-zapret"
                  icon={<ShieldPlus />}
                  title="Добавлять IP сервера в Zapret при вставке"
                  desc="«Вставить» или Enter кладёт IP — без connect и порта — в список Zapret. Замер при этом не запускается."
                  hint="Работающий Zapret перезапустится на пару секунд, чтобы применить список. Пинг меряется отдельно кнопкой «Замерить пинг»."
                  checked={settings?.optimizerAddToZapret !== false}
                  onChange={(v) => void handleUpdateSettings({ optimizerAddToZapret: v })}
                />
              </Rows>
            </SettingsGroup>
            <AutoSelectCard settings={settings} nodes={nodes} onPatch={handleUpdateSettings} />
          </>
        )}
      </div>
    </BasePage>
  )
}

const MiniTag: React.FC<{ children: React.ReactNode; tone?: 'ok' | 'warn' | 'primary'; title?: string }> = ({ children, tone, title }) => (
  <span
    title={title}
    className={cn(
      'inline-flex items-center rounded-md border px-1.5 py-px text-[10.5px] font-semibold leading-tight',
      tone === 'ok' && 'border-st-ok/35 bg-st-ok/10 text-st-ok-text',
      tone === 'warn' && 'border-st-warn/35 bg-st-warn/10 text-st-warn-text',
      tone === 'primary' && 'border-primary/35 bg-primary/10 text-primary',
      !tone && 'border-foreground/[0.1] bg-foreground/[0.05] text-muted-foreground'
    )}
  >
    {children}
  </span>
)
