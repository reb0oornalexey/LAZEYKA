import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import BasePage from '@renderer/components/base/base-page'
import { Button } from '@renderer/components/ui/button'
import RescueDialog from '@renderer/components/rescue-dialog'
import { AppVersionButton } from '@renderer/components/changelog-dialog'
import ZapretIcon from '@renderer/components/zapret-icon'
import { TelegramBrandIcon as TelegramIcon } from '@renderer/components/service-icons'
import NetSpeedDialog from '@renderer/components/net-speed-dialog'
import { LiveNumber, LzHero, LzPanel, ServiceTile, StatChip, StatusRing, type LzTone } from '@renderer/components/lz'
import SiteStrip, { type SiteSummary } from '@renderer/components/home/site-strip'
import UpdatesButton, { type UpdateItem } from '@renderer/components/home/updates-button'
import TrafficChip from '@renderer/components/home/traffic-chip'
import { PingMeter, ProxyPath, StrategyScore } from '@renderer/components/home/service-live'
import { useLiveTraffic } from '@renderer/components/home/use-live-traffic'
import { useTgwsStore } from '@renderer/store/tgws-store'
import { useZapretStore } from '@renderer/store/zapret-store'
import { useZapretTestStore } from '@renderer/store/zapret-test-store'
import { useIncyStore } from '@renderer/store/incy-store'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import {
  tgwsStart,
  tgwsStop,
  tgwsRestart,
  zapretStart,
  zapretStop,
  zapretRestart,
  zapretCheckUpdate,
  tgwsCheckUpdate,
  incyConnect,
  incyDisconnect,
  incyGetNodes,
  incyGetSubscription,
  zapretGetStrategyTestResults,
  getAppVersion,
  appCheckUpdateNow,

  type IncyNode,
  type ZapretUpdateInfo,
  type TgwsUpdateInfo,
  type StrategyTestReport
} from '@renderer/utils/ipc'
import { POWER_ON_BANNER_STYLE, formatInstalledVersion, cn } from '@renderer/lib/utils'
import {
  ChevronRight,
  Gauge,
  Globe,
  Headset,
  Layers,
  Loader2,
  Package,
  Plus,
  Power,
  RotateCw,
  Route,
  ScrollText,
  Server,
  ShieldAlert,
  Stethoscope,
  Target,
  Timer,
  Wand2,
  Zap,
  Sparkles
} from 'lucide-react'

/** «1 ч 24 мин», «12 мин», «меньше минуты». */
function formatUptime(ms: number): string {
  const min = Math.floor(ms / 60000)
  if (min < 1) return 'меньше минуты'
  const h = Math.floor(min / 60)
  const m = min % 60
  return h > 0 ? `${h} ч ${m} мин` : `${m} мин`
}

/** Коротко для строки статуса плитки: «1 ч 24 мин» → «1 ч 24 мин», «меньше минуты» → «< 1 мин». */
function shortUptime(ms: number): string {
  const s = formatUptime(ms)
  return s === 'меньше минуты' ? 'только что' : s
}

type Tone = 'on' | 'busy' | 'off' | 'error'

/** «Нужно действие» внизу модуля: пунктирная кнопка во всю ширину. */
const ActionHint: React.FC<{ icon: React.ReactNode; text: string; onClick: () => void }> = ({ icon, text, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="flex w-full cursor-pointer items-center gap-2 rounded-xl border border-dashed border-primary/40 bg-primary/[0.06] px-3 py-2 text-left text-[12px] font-semibold text-foreground transition-colors hover:border-primary/70 hover:bg-primary/10"
  >
    <span className="flex shrink-0 text-primary [&_svg]:size-3.5">{icon}</span>
    <span className="flex-1">{text}</span>
    <ChevronRight className="size-3.5 text-muted-foreground" />
  </button>
)

/*
 * Главная LAZEYKA 2.0 в языке «Сигнал» (components/lz, описание — design-language.md).
 * Логика служб, проверок и обновлений та же, что была в 1.x: меняется только вид.
 */
const Home: React.FC = () => {
  const navigate = useNavigate()
  const tgws = useTgwsStore((s) => s.status)
  const zapret = useZapretStore((s) => s.status)
  const incy = useIncyStore((s) => s.status)
  const isZapretTesting = useZapretTestStore((s) => s.isRunning)
  const { appConfig } = useAppConfig()
  const zapretStrategy = appConfig?.zapret?.activeStrategy

  // ---- Узлы INCY (имя и пинг активного узла) ----
  const [nodes, setNodes] = useState<IncyNode[]>([])
  useEffect(() => {
    incyGetNodes()
      .then(setNodes)
      .catch(() => setNodes([]))
  }, [incy.activeNodeId, incy.selectedNodeId])
  const incyNode = useMemo(
    () => nodes.find((n) => n.id === (incy.activeNodeId || incy.selectedNodeId)) ?? null,
    [nodes, incy.activeNodeId, incy.selectedNodeId]
  )

  // ---- Обновления Zapret и TgWsProxy ----
  const [zapretUpdate, setZapretUpdate] = useState<ZapretUpdateInfo | null>(null)
  const [tgwsUpdate, setTgwsUpdate] = useState<TgwsUpdateInfo | null>(null)
  const [zapretSessionDismissed, setZapretSessionDismissed] = useState(false)
  const [tgwsSessionDismissed, setTgwsSessionDismissed] = useState(false)
  useEffect(() => {
    zapretCheckUpdate(false).then(setZapretUpdate).catch(() => setZapretUpdate(null))
    tgwsCheckUpdate(false).then(setTgwsUpdate).catch(() => setTgwsUpdate(null))
  }, [])
  const showZapretBanner =
    !!zapretUpdate && zapretUpdate.hasUpdate && !zapretUpdate.dismissed && !!zapretUpdate.assetUrl && !zapretSessionDismissed
  const showTgwsBanner =
    !!tgwsUpdate && tgwsUpdate.hasUpdate && !tgwsUpdate.dismissed && !!tgwsUpdate.assetUrl && !tgwsSessionDismissed

  // ---- Переключатели служб ----
  const [pending, setPending] = useState<Record<string, boolean | undefined>>({})
  const withPending = async (key: string, next: boolean, fn: () => Promise<void>): Promise<void> => {
    setPending((p) => ({ ...p, [key]: next }))
    try {
      await fn()
    } finally {
      setPending((p) => ({ ...p, [key]: undefined }))
    }
  }

  const toggleTgws = (next: boolean): Promise<void> =>
    withPending('tgws', next, async () => {
      try {
        if (next) await tgwsStart()
        else await tgwsStop()
      } catch (e) {
        toast.error(next ? 'Не удалось запустить Telegram' : 'Не удалось остановить Telegram', {
          description: e instanceof Error ? e.message : String(e)
        })
      }
    })

  const toggleZapret = (next: boolean): Promise<void> =>
    withPending('zapret', next, async () => {
      if (next && !zapretStrategy) {
        navigate('/zapret', { state: { autoStart: true } })
        return
      }
      try {
        if (next) await zapretStart()
        else await zapretStop()
      } catch (e) {
        toast.error(next ? 'Не удалось запустить Zapret' : 'Не удалось остановить Zapret', {
          description: e instanceof Error ? e.message : String(e)
        })
      }
    })

  const toggleIncy = (next: boolean): Promise<void> =>
    withPending('incy', next, async () => {
      if (next && nodes.length === 0) {
        navigate('/incy')
        toast.info('Сначала добавьте подписку или сервер на вкладке INCY')
        return
      }
      try {
        if (next) await incyConnect()
        else await incyDisconnect()
      } catch (e) {
        toast.error(next ? 'Не удалось подключить VPN' : 'Не удалось отключить VPN', {
          description: e instanceof Error ? e.message : String(e)
        })
      }
    })

  // ---- Статусы ----
  const tgwsOn = tgws.state === 'running'
  const zapretOn = zapret.state === 'running'
  const incyOn = incy.state === 'running'
  const tgwsBusy = pending.tgws !== undefined || tgws.state === 'starting' || tgws.state === 'stopping'
  // Автозапуск ждёт сеть или повторяет запуск: переключатель показывает «включено» и позволяет отменить.
  const zapretWaiting = zapret.state === 'starting' && (zapret.phase === 'waiting' || zapret.phase === 'retrying')
  const zapretBusy = pending.zapret !== undefined || zapret.state === 'starting' || zapret.state === 'stopping'
  const incyBusy = pending.incy !== undefined || incy.state === 'connecting'
  const toneOf = (on: boolean, busy: boolean, err: boolean): Tone => (busy ? 'busy' : on ? 'on' : err ? 'error' : 'off')

  const isLinux = window.api.platform === 'linux'
  const totalServices = 3
  const runningCount = [tgwsOn, zapretOn, incyOn].filter(Boolean).length
  const startedAts = [
    tgwsOn ? tgws.startedAt : undefined,
    zapretOn ? zapret.startedAt : undefined,
    incyOn ? incy.connectedAt : undefined
  ].filter((x): x is number => typeof x === 'number')
  const since = startedAts.length ? Math.min(...startedAts) : null

  // Время работы — раз в 30 с: минуты от этого не меняются, а лишних
  // перерисовок главной нет.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!since) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [since])

  const incyMode = isLinux
    ? (incy.connectionMode === 'tun' ? 'TUN' : incy.connectionMode === 'system_proxy' ? 'Системный прокси' : 'Только прокси')
    : incy.exitLagActive
      ? `ExitLag · ${incy.exitLagApps?.length ?? 0} прил.`
      : incy.routingMode === 'global'
        ? 'Весь трафик'
        : 'Обход РФ'

  // ---- Общие действия ----
  const [diagOpen, setDiagOpen] = useState(false)
  const [speedOpen, setSpeedOpen] = useState(false)
  const [appVersion, setAppVersion] = useState<string | null>(null)
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  // Подписка на исходе (срок ≤ 3 дн. или трафика < 10 %) — заметно на главной.
  const [subWarn, setSubWarn] = useState<string | null>(null)
  useEffect(() => {
    getAppVersion().then(setAppVersion).catch(() => setAppVersion(null))
    incyGetSubscription()
      .then((s) => {
        if (!s) return
        const parts: string[] = []
        if (typeof s.expireAt === 'number') {
          const days = Math.ceil((s.expireAt - Date.now()) / 86_400_000)
          if (days <= 0) parts.push('срок истёк')
          else if (days <= 3) parts.push(`осталось ${days} дн.`)
        }
        if (s.totalBytes && s.usedBytes != null && (s.totalBytes - s.usedBytes) / s.totalBytes < 0.1) {
          const left = Math.max(0, s.totalBytes - s.usedBytes) / 1024 ** 3
          parts.push(left <= 0 ? 'трафик закончился' : `трафика осталось ${left.toFixed(1)} ГБ`)
        }
        if (parts.length) setSubWarn(`Подписка «${s.title}»: ${parts.join(', ')}`)
      })
      .catch(() => void 0)
  }, [])

  const handleCheckUpdate = async (): Promise<void> => {
    if (checkingUpdate) return
    setCheckingUpdate(true)
    try {
      const info = await appCheckUpdateNow()
      if (info.hasUpdate && info.assetUrl) {
        toast.success(`Доступна версия ${info.latest}`, { description: 'Окно обновления сейчас откроется.' })
      } else if (info.hasUpdate) {
        toast.warning(`Версия ${info.latest} вышла, но установщик к релизу не приложен`, {
          description: 'Скачайте её вручную со страницы релизов.'
        })
      } else {
        toast.success(`Установлена последняя версия — ${info.installed}`)
      }
    } catch (e: unknown) {
      toast.error('Не удалось проверить обновления', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setCheckingUpdate(false)
    }
  }

  const [reloading, setReloading] = useState(false)
  const handleReloadAll = async (): Promise<void> => {
    if (reloading) return
    setReloading(true)
    try {
      const tasks: (() => Promise<unknown>)[] = []
      if (zapret.state === 'running' || zapret.state === 'error') tasks.push(zapretRestart)
      if (incy.state === 'running' || incy.state === 'error') {
        tasks.push(async () => {
          const result = await incyConnect(incy.activeNodeId ?? undefined)
          if (result.state !== 'running') throw new Error(result.lastError || 'INCY не подключился')
        })
      }
      if (tgws.state === 'running' || tgws.state === 'error') tasks.push(tgwsRestart)
      if (tasks.length === 0) {
        toast.info('Нет запущенных служб для перезапуска')
        return
      }
      const failed: unknown[] = []
      for (const restart of tasks) {
        try {
          await restart()
        } catch (error) {
          failed.push(error)
        }
      }
      if (failed.length === 0) {
        toast.success('Службы перезапущены', { style: POWER_ON_BANNER_STYLE })
      } else {
        const reason = failed[0]
        toast.error(
          failed.length === tasks.length ? 'Службы не перезапустились' : 'Перезапустились не все службы',
          { description: reason instanceof Error ? reason.message : String(reason) }
        )
      }
    } catch (e) {
      toast.error('Не удалось перезапустить службы', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setReloading(false)
    }
  }

  const [startingAll, setStartingAll] = useState(false)
  const handleStartAll = async (): Promise<void> => {
    if (startingAll) return
    setStartingAll(true)
    try {
      const tasks: Promise<void>[] = []
      if (!zapretOn && zapretStrategy && !isZapretTesting) tasks.push(toggleZapret(true))
      if (!tgwsOn) tasks.push(toggleTgws(true))
      if (!incyOn && nodes.length > 0) tasks.push(toggleIncy(true))
      await Promise.allSettled(tasks)
    } finally {
      setStartingAll(false)
    }
  }

  // ---- Шапка статуса ----
  // Выключенная служба — это выбор человека, а не поломка: жёлтый цвет и значок-предупреждение
  // только при настоящей ошибке. Если что-то включено — шапка спокойная и говорит, что именно работает.
  const onNames = [zapretOn && 'Zapret', tgwsOn && 'Telegram', incyOn && 'VPN'].filter(Boolean) as string[]
  const offNames = [!zapretOn && 'Zapret', !tgwsOn && 'Telegram', !incyOn && 'VPN'].filter(Boolean) as string[]
  const errNames = [zapret.state === 'error' && 'Zapret', tgws.state === 'error' && 'Telegram', incy.state === 'error' && 'VPN'].filter(
    Boolean
  ) as string[]
  const joinRu = (xs: string[]): string => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} и ${xs[xs.length - 1]}`)
  const hero = errNames.length
    ? {
        tone: 'part' as const,
        title: errNames.length === 1 ? `${errNames[0]} не запустился` : `Не запустились: ${joinRu(errNames)}`
      }
    : runningCount === totalServices
      ? { tone: 'on' as const, title: 'Всё включено' }
      : runningCount > 0
        ? { tone: 'on' as const, title: `${onNames.length === 1 ? 'Работает' : 'Работают'} ${joinRu(onNames)}` }
        : { tone: 'off' as const, title: 'Всё выключено' }
  const heroText = errNames.length
    ? 'Подробности — в карточке службы ниже. Помогает «Перезагрузить службы» или «Проверить и исправить».'
    : runningCount === totalServices
      ? `${joinRu(onNames)} включены${since ? ` · ${formatUptime(now - since)} без перерыва` : ''}`
      : runningCount > 0
        ? `${since ? `${formatUptime(now - since)} без перерыва · ` : ''}${joinRu(offNames)} ${offNames.length === 1 ? 'выключен' : 'выключены'} — включите, если нужно`
        : 'Включите нужные службы переключателями ниже или всё сразу.'

  // ---- Новое для вида 2.0 (только из уже известных данных) ----
  // Наведение на плитку подсвечивает её дугу в кольце.
  const [hot, setHot] = useState<string | null>(null)
  const [sites, setSites] = useState<SiteSummary | null>(null)
  const traffic = useLiveTraffic(tgwsOn || zapretOn || incyOn)

  const [stoppingAll, setStoppingAll] = useState(false)
  const handleStopAll = async (): Promise<void> => {
    if (stoppingAll) return
    setStoppingAll(true)
    try {
      const tasks: Promise<void>[] = []
      if (zapretOn && !isZapretTesting) tasks.push(toggleZapret(false))
      if (tgwsOn) tasks.push(toggleTgws(false))
      if (incyOn) tasks.push(toggleIncy(false))
      await Promise.allSettled(tasks)
    } finally {
      setStoppingAll(false)
    }
  }

  const zapretTone = toneOf(zapretOn, zapretBusy, zapret.state === 'error')
  const tgwsTone = toneOf(tgwsOn, tgwsBusy, tgws.state === 'error')
  const incyTone = toneOf(incyOn, incyBusy, incy.state === 'error')
  const anyBusy = zapretBusy || tgwsBusy || incyBusy
  const heroTone: LzTone = errNames.length ? 'warn' : runningCount > 0 ? 'on' : anyBusy ? 'busy' : 'off'

  const updates: UpdateItem[] = []
  if (!isLinux && showZapretBanner && zapretUpdate)
    updates.push({
      key: 'zapret',
      title: `Zapret — v${zapretUpdate.latest}`,
      subtitle: formatInstalledVersion(zapretUpdate.installed),
      onDetails: () => navigate('/zapret', { state: { openUpdate: true } }),
      onDismiss: () => setZapretSessionDismissed(true)
    })
  if (showTgwsBanner && tgwsUpdate)
    updates.push({
      key: 'tgws',
      title: `TgWsProxy — v${tgwsUpdate.latest}`,
      subtitle: formatInstalledVersion(tgwsUpdate.installed),
      onDetails: () => navigate('/telegram', { state: { openUpdate: true } }),
      onDismiss: () => setTgwsSessionDismissed(true)
    })

  // Пинг узла для модуля VPN (известен и при выключенном VPN, если узел проверяли).
  const nodePing = incyNode && typeof incyNode.latencyMs === 'number' && incyNode.latencyMs > 0 ? incyNode.latencyMs : null
  // Баллы последней проверки выбранной стратегии — один запрос при открытии и после теста, без опросов.
  const [strategyReport, setStrategyReport] = useState<StrategyTestReport | null>(null)
  useEffect(() => {
    if (isZapretTesting) return
    zapretGetStrategyTestResults()
      .then(setStrategyReport)
      .catch(() => setStrategyReport(null))
  }, [isZapretTesting])
  const strategyScore = (zapretStrategy && strategyReport?.results?.[zapretStrategy]) || null

  const ping = incyOn && incyNode && typeof incyNode.latencyMs === 'number' && incyNode.latencyMs > 0 ? incyNode.latencyMs : null

  // Главная кнопка: «Включить всё» → «Включить остальное» → «Выключить всё».
  const mainAction =
    runningCount === totalServices ? (
      <Button
        variant="outline"
        size="lg"
        onClick={() => void handleStopAll()}
        disabled={stoppingAll || anyBusy}
        title="Выключить работающие службы"
        className="h-11 rounded-xl px-5 text-[14px]"
      >
        {stoppingAll ? <Loader2 className="size-4 animate-spin" /> : <Power className="size-4" />}
        Выключить всё
      </Button>
    ) : (
      <Button
        size="lg"
        onClick={() => void handleStartAll()}
        disabled={startingAll}
        title={runningCount > 0 ? `Включить и остальное: ${offNames.join(', ')}` : 'Включить доступные службы'}
        className="h-11 rounded-xl px-5 text-[14px]"
      >
        {startingAll ? <Loader2 className="size-4 animate-spin" /> : <Power className="size-4" />}
        {runningCount > 0 ? 'Включить остальное' : 'Включить всё'}
      </Button>
    )

  const tools = [
    {
      icon: <Gauge />,
      title: 'Скорость интернета',
      sub: incyOn ? 'Через подключённый VPN' : 'Напрямую, без VPN',
      onClick: () => setSpeedOpen(true)
    },
    ...(!isLinux ? [{ icon: <Target />, title: 'Пинг до Faceit', sub: 'Лучший узел для матча', onClick: () => navigate('/optimizer') }] : []),
    {
      icon: <Zap />,
      title: 'Сменить узел',
      sub: nodes.length ? `Серверов в подписке: ${nodes.length}` : 'Добавить подписку',
      onClick: () => navigate('/incy')
    },
    { icon: <ScrollText />, title: 'Логи и отчёт', sub: 'Если что-то не работает', onClick: () => navigate('/logs') }
  ]

  return (
    <BasePage
      title="Главная"
      header={
        <>
          {!isLinux && <UpdatesButton items={updates} checking={checkingUpdate} onCheckApp={() => void handleCheckUpdate()} />}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleReloadAll()}
            disabled={reloading}
            title="Перезапустить работающие службы"
            className="mr-1 h-8 shrink-0 rounded-lg px-2 text-xs"
          >
            <RotateCw className={cn('size-3.5', reloading && 'animate-spin')} />
            {reloading ? 'Перезапуск…' : 'Перезагрузить службы'}
          </Button>
        </>
      }
    >
      <div className="mx-auto flex w-full max-w-[1080px] flex-col lz-page-gap lz-page-x pb-5">
        {/* Пульт: кольцо служб, состояние словами, одно главное действие, живые показатели */}
        <LzHero
          data-tour="home-status"
          tone={heroTone}
          visual={
            <StatusRing
              size={150}
              waves
              active={hot}
              halo={heroTone === 'off' ? null : heroTone === 'warn' ? 'warn' : 'on'}
              pulse={heroTone === 'on'}
              segments={[
                { key: 'zapret', label: 'Zapret', tone: zapretTone, icon: <ZapretIcon /> },
                { key: 'tgws', label: 'Telegram', tone: tgwsTone, icon: <TelegramIcon /> },
                { key: 'incy', label: 'VPN', tone: incyTone, icon: <Globe /> }
              ]}
            >
              <div className="flex items-baseline gap-1 leading-none">
                <LiveNumber value={runningCount} className="text-[38px] font-extrabold tracking-tight text-[color:var(--text-title)]" />
                <span className="text-[13px] font-semibold text-muted-foreground">из {totalServices}</span>
              </div>
              <div className="mt-1 text-[10.5px] font-medium text-muted-foreground">
                {runningCount === 1 ? 'служба' : 'службы'} {runningCount === 1 ? 'работает' : 'работают'}
              </div>
            </StatusRing>
          }
          title={hero.title}
          text={heroText}
          extra={
            <>
              <button
                type="button"
                onClick={() => setDiagOpen(true)}
                data-tour="home-rescue"
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-md text-[12px] font-medium text-muted-foreground transition-colors hover:text-primary"
              >
                <Stethoscope className="size-3.5" />
                Ничего не открывается? Проверить и исправить
              </button>
            </>
          }
          actions={mainAction}
          footer={
            <div className="flex flex-wrap items-stretch gap-2">
              <StatChip
                icon={<Timer />}
                tone={since ? 'on' : 'off'}
                label="Без перерыва"
                value={since ? formatUptime(now - since) : 'пока ничего не включено'}
              />
              {incyOn && incyNode ? (
                <StatChip
                  icon={<Globe />}
                  tone="on"
                  label="Узел VPN"
                  value={incyNode.name}
                  sensitive="node"
                  title={`${incyNode.name} — сменить узел`}
                  onClick={() => navigate('/incy')}
                  className="max-w-[260px]"
                  aside={
                    ping !== null ? (
                      <span className="shrink-0 rounded-md bg-primary/12 px-1.5 py-0.5 text-[11.5px] font-bold tabular-nums text-primary">{ping} мс</span>
                    ) : undefined
                  }
                />
              ) : (
                <StatChip
                  icon={<Globe />}
                  tone="off"
                  label="Режим VPN"
                  value={incyMode}
                  onClick={() => navigate('/incy')}
                  title="Открыть INCY"
                />
              )}
              <StatChip
                icon={<Stethoscope />}
                tone={!sites || sites.checked === 0 ? 'off' : sites.bad > 0 ? 'warn' : 'on'}
                label="Сайты"
                value={
                  !sites || sites.checked === 0 ? (
                    'не проверялись'
                  ) : (
                    <>
                      <LiveNumber value={sites.ok} /> из {sites.total} открываются{sites.partial > 0 ? ` · ${sites.partial} частично` : ''}
                    </>
                  )
                }
              />
              <TrafficChip t={traffic} active={tgwsOn || zapretOn || incyOn} className="min-w-[280px] flex-1" />
            </div>
          }
        />

        {/* Службы — модули в том же порядке, что дуги кольца */}
        <div className="grid grid-cols-1 gap-3 @min-[610px]:grid-cols-2 @min-[850px]:grid-cols-3">
          <ServiceTile
            icon={<ZapretIcon />}
            title="Zapret"
            tone={zapretTone}
            statusText={
              zapretBusy
                ? zapret.state === 'starting' && zapret.phase === 'verifying'
                  ? 'Проверяю…'
                  : zapret.state === 'starting' && zapret.phase === 'waiting'
                    ? 'Жду сеть…'
                    : zapret.state === 'starting' && zapret.phase === 'retrying'
                      ? 'Повторный запуск…'
                      : (pending.zapret ?? zapret.state === 'starting')
                        ? 'Запуск…'
                        : 'Остановка…'
                : zapretOn
                  ? 'Работает'
                  : zapret.state === 'error'
                    ? 'Ошибка'
                    : 'Выключен'
            }
            uptime={zapretOn && zapret.startedAt ? shortUptime(now - zapret.startedAt) : undefined}
            checked={pending.zapret ?? (zapretOn || zapretWaiting)}
            onToggle={(v) => void toggleZapret(v)}
            disabled={isZapretTesting}
            cancelable={zapretWaiting}
            live={zapretStrategy ? <StrategyScore result={strategyScore} on={zapretOn} testing={isZapretTesting} /> : undefined}
            chips={[
              ...(zapretStrategy
                ? [{ icon: <Layers />, label: 'Стратегия', value: isLinux ? zapretStrategy.replace(/-/g, ' ').toUpperCase() : zapretStrategy.replace(/\.bat$/i, '') }]
                : []),
              { icon: <Package />, label: 'Версия', value: `Zapret ${appConfig?.zapret?.installedVersion ?? zapretUpdate?.installed ?? 'встроенный'}` }
            ]}
            note={
              isZapretTesting
                ? 'Идёт тестирование стратегий — кнопка включения заблокирована'
                : zapret.state === 'error'
                  ? zapret.lastError
                  : zapret.state === 'starting' && zapret.detail
                    ? zapret.detail
                    : undefined
            }
            footer={
              !zapretStrategy && !zapretOn ? (
                <ActionHint icon={<Wand2 />} text="Выбрать или подобрать стратегию" onClick={() => navigate('/zapret')} />
              ) : undefined
            }
            onOpen={() => navigate('/zapret')}
            onHoverChange={(h) => setHot(h ? 'zapret' : null)}
          />
          <ServiceTile
            icon={<TelegramIcon />}
            title="Telegram"
            tone={tgwsTone}
            statusText={
              tgwsBusy
                ? (pending.tgws ?? tgws.state === 'starting')
                  ? 'Запуск…'
                  : 'Остановка…'
                : tgwsOn
                  ? 'Работает'
                  : tgws.state === 'error'
                    ? 'Ошибка'
                    : 'Выключен'
            }
            uptime={tgwsOn && tgws.startedAt ? shortUptime(now - tgws.startedAt) : undefined}
            checked={pending.tgws ?? tgwsOn}
            onToggle={(v) => void toggleTgws(v)}
            live={<ProxyPath port={appConfig?.tgws?.port || 1443} on={tgwsOn} />}
            chips={[
              {
                icon: <Package />,
                label: 'Версия',
                value: `TgWsProxy ${tgwsUpdate?.installed ?? appConfig?.tgws?.installedVersion ?? 'встроенный'}`
              }
            ]}
            note={tgws.state === 'error' ? tgws.lastError : undefined}
            onOpen={() => navigate('/telegram')}
            onHoverChange={(h) => setHot(h ? 'tgws' : null)}
          />
          <ServiceTile
            icon={<Globe />}
            title="INCY VPN"
            tone={incyTone}
            statusText={
              incyBusy
                ? (pending.incy ?? true)
                  ? 'Подключение…'
                  : 'Отключение…'
                : incyOn
                  ? 'Подключено'
                  : incy.state === 'error'
                    ? 'Ошибка'
                    : 'Отключено'
            }
            uptime={incyOn && incy.connectedAt ? shortUptime(now - incy.connectedAt) : undefined}
            checked={pending.incy ?? incyOn}
            onToggle={(v) => void toggleIncy(v)}
            live={nodes.length ? <PingMeter node={incyNode?.name ?? null} ping={nodePing} on={incyOn} /> : undefined}
            chips={[
              { icon: <Route />, label: 'Режим', value: incyMode },
              ...(nodes.length ? [{ icon: <Server />, label: 'Серверов', value: `Серверов: ${nodes.length}` }] : [])
            ]}
            note={incy.state === 'error' ? incy.lastError : undefined}
            footer={
              subWarn ? (
                <button
                  type="button"
                  onClick={() => navigate('/incy')}
                  title={`${subWarn} — продлите, чтобы VPN не отключился`}
                  className="flex w-full cursor-pointer items-center gap-2 rounded-xl border border-st-warn/45 bg-st-warn/10 px-3 py-2 text-left text-[11.5px] font-semibold leading-snug text-st-warn-text"
                >
                  <ShieldAlert className="size-3.5 shrink-0" />
                  <span className="line-clamp-2 flex-1">{subWarn.replace(/^Подписка «[^»]*»: /, 'Подписка: ')} — продлите</span>
                  <ChevronRight className="size-3.5 shrink-0" />
                </button>
              ) : nodes.length === 0 ? (
                <ActionHint icon={<Plus />} text="Добавить подписку или сервер" onClick={() => navigate('/incy')} />
              ) : undefined
            }
            onOpen={() => navigate('/incy')}
            onHoverChange={(h) => setHot(h ? 'incy' : null)}
          />
        </div>

        <SiteStrip onSummary={setSites} />

        {/* Инструменты — одна полоса, а не четыре отдельные карточки */}
        <LzPanel className="grid grid-cols-2 lg:grid-cols-4">
          {tools.map((a, i) => (
            <button
              key={a.title}
              type="button"
              onClick={a.onClick}
              className={cn(
                'group flex min-w-0 cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-foreground/[0.04]',
                i > 0 && 'lg:border-l lg:border-foreground/[0.07]',
                i % 2 === 1 && 'border-l border-foreground/[0.07]',
                i > 1 && 'border-t border-foreground/[0.07] lg:border-t-0'
              )}
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary [&_svg]:size-4">{a.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold text-foreground">{a.title}</span>
                <span className="block truncate text-[11px] text-muted-foreground">{a.sub}</span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </button>
          ))}
        </LzPanel>

        <RescueDialog open={diagOpen} onClose={() => setDiagOpen(false)} />
        <NetSpeedDialog open={speedOpen} onClose={() => setSpeedOpen(false)} vpnOn={incyOn} />

        {/* Версия, обновления, поддержка */}
        <div className="ml-auto flex w-fit items-center justify-end gap-1 rounded-xl border border-border/50 bg-card/75 p-0.5 text-[11.5px] font-medium text-foreground/85 backdrop-blur-md">
          {appVersion && (
            <AppVersionButton className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 tabular-nums transition-colors hover:bg-accent hover:text-foreground hover:no-underline">
              <Sparkles className="size-3" />
              LAZEYKA v{appVersion}
            </AppVersionButton>
          )}
          <button
            type="button"
            onClick={() => navigate('/support')}
            title="Автор и поддержка: отчёт о проблеме или идея прямо из программы"
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 transition-colors hover:bg-accent hover:text-foreground"
          >
            <Headset className="size-3" />
            Поддержка
          </button>
        </div>
      </div>
    </BasePage>
  )
}

export default Home
