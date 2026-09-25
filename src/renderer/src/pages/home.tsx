import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import BasePage from '@renderer/components/base/base-page'
import { Switch } from '@renderer/components/ui/switch'
import { Button } from '@renderer/components/ui/button'
import ZapretIcon from '@renderer/components/zapret-icon'
import TelegramIcon from '@renderer/components/telegram-icon'
import LiveTrafficMonitor from '@renderer/components/live-traffic-monitor'
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
  getAppVersion,
  appCheckUpdateNow,
  openExternalUrl,
  type IncyNode,
  type ZapretUpdateInfo,
  type TgwsUpdateInfo
} from '@renderer/utils/ipc'
import { POWER_ON_BANNER_STYLE, SUPPORT_TELEGRAM_URL, formatInstalledVersion, cn } from '@renderer/lib/utils'
import {
  ChevronRight,
  Globe,
  LifeBuoy,
  Loader2,
  Power,
  RefreshCw,
  RotateCw,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  Sparkles,
  Target,
  X,
  Zap
} from 'lucide-react'

/** «1 ч 24 мин», «12 мин», «меньше минуты». */
function formatUptime(ms: number): string {
  const min = Math.floor(ms / 60000)
  if (min < 1) return 'меньше минуты'
  const h = Math.floor(min / 60)
  const m = min % 60
  return h > 0 ? `${h} ч ${m} мин` : `${m} мин`
}

type Tone = 'on' | 'busy' | 'off' | 'error'

interface ServiceCardProps {
  icon: React.ReactNode
  title: string
  tone: Tone
  statusText: string
  checked: boolean
  onToggle: (next: boolean) => void
  disabled?: boolean
  rows: { label: string; value: string; title?: string }[]
  note?: string
  onOpen: () => void
}

/** Карточка службы на главной: иконка, статус, переключатель и детали. */
function ServiceCard({
  icon,
  title,
  tone,
  statusText,
  checked,
  onToggle,
  disabled,
  rows,
  note,
  onOpen
}: ServiceCardProps): React.ReactElement {
  return (
    <div className="flex min-w-0 flex-col rounded-2xl border border-border bg-card p-4 transition-colors hover:border-primary/35">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onOpen}
          title={`Открыть вкладку ${title}`}
          className={cn(
            'flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-secondary transition-colors',
            tone === 'on' ? 'text-primary' : tone === 'error' ? 'text-destructive' : 'text-muted-foreground'
          )}
        >
          {icon}
        </button>
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 cursor-pointer text-left">
          <div className="truncate text-[15px] font-semibold text-foreground">{title}</div>
          <div
            className={cn(
              'flex items-center gap-1.5 text-xs font-medium',
              tone === 'on'
                ? 'text-primary'
                : tone === 'busy'
                  ? 'text-amber-600 dark:text-amber-400'
                  : tone === 'error'
                    ? 'text-destructive'
                    : 'text-muted-foreground'
            )}
          >
            {tone === 'busy' ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <span
                className={cn(
                  'size-1.5 rounded-full',
                  tone === 'on' ? 'bg-primary' : tone === 'error' ? 'bg-destructive' : 'bg-muted-foreground/60'
                )}
              />
            )}
            {statusText}
          </div>
        </button>
        <Switch
          checked={checked}
          disabled={disabled || tone === 'busy'}
          onCheckedChange={onToggle}
          className="data-[size=default]:h-6 data-[size=default]:w-11 [&>span]:size-[18px]! [&>span[data-state=checked]]:translate-x-[22px]!"
        />
      </div>
      <div className="mt-3.5 divide-y divide-border rounded-xl bg-secondary px-3">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-3 py-2" title={r.title ?? r.value}>
            <span className="shrink-0 text-[12px] text-muted-foreground">{r.label}</span>
            <span className="min-w-0 truncate text-[12.5px] font-semibold text-foreground">{r.value}</span>
          </div>
        ))}
      </div>
      {note && <div className="mt-2.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">{note}</div>}
    </div>
  )
}

interface UpdateNoticeProps {
  title: string
  subtitle: string
  onDetails: () => void
  onDismiss: () => void
}
const UpdateNotice: React.FC<UpdateNoticeProps> = ({ title, subtitle, onDetails, onDismiss }) => (
  <div className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/10 px-4 py-2.5">
    <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
      <Sparkles className="size-4" />
    </div>
    <div className="min-w-0 flex-1">
      <div className="truncate text-sm font-semibold text-foreground">{title}</div>
      <div className="truncate text-xs text-muted-foreground">{subtitle}</div>
    </div>
    <Button size="sm" onClick={onDetails} className="h-7 rounded-lg text-xs">
      Подробнее
    </Button>
    <Button variant="ghost" size="icon" className="size-7 rounded-lg" onClick={onDismiss} title="Скрыть">
      <X className="size-3.5" />
    </Button>
  </div>
)

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
  const zapretBusy = pending.zapret !== undefined || zapret.state === 'starting' || zapret.state === 'stopping'
  const incyBusy = pending.incy !== undefined || incy.state === 'connecting'
  const toneOf = (on: boolean, busy: boolean, err: boolean): Tone => (busy ? 'busy' : on ? 'on' : err ? 'error' : 'off')

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

  const incyMode = incy.exitLagActive
    ? `ExitLag · ${incy.exitLagApps?.length ?? 0} прил.`
    : incy.routingMode === 'global'
      ? 'Весь трафик'
      : 'Обход РФ'

  // ---- Общие действия ----
  const [appVersion, setAppVersion] = useState<string | null>(null)
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  useEffect(() => {
    getAppVersion().then(setAppVersion).catch(() => setAppVersion(null))
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
      const tasks: Promise<unknown>[] = []
      if (tgws.state === 'running' || tgws.state === 'error') tasks.push(tgwsRestart())
      if (zapret.state === 'running' || zapret.state === 'error') tasks.push(zapretRestart())
      if (incy.state === 'running' || incy.state === 'error') tasks.push(incyConnect())
      if (tasks.length === 0) {
        toast.info('Нет запущенных служб для перезапуска')
        return
      }
      const results = await Promise.allSettled(tasks)
      const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[]
      if (failed.length === 0) {
        toast.success('Службы перезапущены', { style: POWER_ON_BANNER_STYLE })
      } else {
        const reason = failed[0].reason
        toast.error(
          failed.length === results.length ? 'Службы не перезапустились' : 'Перезапустились не все службы',
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
  const hero =
    runningCount === 3
      ? { tone: 'on' as const, title: 'Защита работает', icon: <ShieldCheck className="size-6" /> }
      : runningCount > 0
        ? { tone: 'part' as const, title: 'Работает частично', icon: <ShieldAlert className="size-6" /> }
        : { tone: 'off' as const, title: 'Всё выключено', icon: <ShieldOff className="size-6" /> }
  const onNames = [zapretOn && 'Zapret', tgwsOn && 'Telegram', incyOn && 'VPN'].filter(Boolean) as string[]
  const offNames = [!zapretOn && 'Zapret', !tgwsOn && 'Telegram', !incyOn && 'VPN'].filter(Boolean) as string[]
  const heroText =
    runningCount === 3
      ? `Zapret, Telegram и VPN включены${since ? ` · ${formatUptime(now - since)} без перерыва` : ''}`
      : runningCount > 0
        ? `Работает: ${onNames.join(', ')} · выключено: ${offNames.join(', ')}`
        : 'Включите нужные службы переключателями ниже или всё сразу.'

  return (
    <BasePage
      title="Главная"
      header={
        <>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleCheckUpdate()}
            disabled={checkingUpdate}
            title="Проверить, вышла ли новая версия LAZEYKA"
            className="h-8 rounded-lg text-xs"
          >
            <RefreshCw className={cn('size-3.5', checkingUpdate && 'animate-spin')} />
            {checkingUpdate ? 'Проверяем…' : 'Проверить обновления'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleReloadAll()}
            disabled={reloading}
            title="Перезапустить все работающие службы: Zapret, Telegram, VPN"
            className="mr-1 h-8 rounded-lg text-xs"
          >
            <RotateCw className={cn('size-3.5', reloading && 'animate-spin')} />
            {reloading ? 'Перезапуск…' : 'Перезагрузить службы'}
          </Button>
        </>
      }
    >
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-6 pb-6">
        {(showZapretBanner || showTgwsBanner) && (
          <div className="space-y-2">
            {showZapretBanner && zapretUpdate && (
              <UpdateNotice
                title={`Доступно обновление Zapret — v${zapretUpdate.latest}`}
                subtitle={formatInstalledVersion(zapretUpdate.installed)}
                onDetails={() => navigate('/zapret')}
                onDismiss={() => setZapretSessionDismissed(true)}
              />
            )}
            {showTgwsBanner && tgwsUpdate && (
              <UpdateNotice
                title={`Доступно обновление TgWsProxy — v${tgwsUpdate.latest}`}
                subtitle={formatInstalledVersion(tgwsUpdate.installed)}
                onDetails={() => navigate('/telegram')}
                onDismiss={() => setTgwsSessionDismissed(true)}
              />
            )}
          </div>
        )}

        {/* Общий статус */}
        <div
          className={cn(
            'flex flex-wrap items-center gap-4 rounded-2xl border p-5',
            hero.tone === 'on'
              ? 'border-primary/30 bg-gradient-to-br from-primary/[0.13] via-card to-card'
              : hero.tone === 'part'
                ? 'border-amber-500/30 bg-gradient-to-br from-amber-500/[0.10] via-card to-card'
                : 'border-border bg-card'
          )}
        >
          <div
            className={cn(
              'flex size-12 shrink-0 items-center justify-center rounded-xl',
              hero.tone === 'on'
                ? 'bg-primary/15 text-primary'
                : hero.tone === 'part'
                  ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                  : 'bg-secondary text-muted-foreground'
            )}
          >
            {hero.icon}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-bold leading-tight text-foreground">{hero.title}</h2>
            <p className="mt-1 text-[13px] text-muted-foreground">{heroText}</p>
          </div>
          {incyOn && incyNode ? (
            <div className="flex shrink-0 gap-2">
              <div className="max-w-52 rounded-xl border border-border bg-background/60 px-3 py-2">
                <div className="text-[11px] text-muted-foreground">Узел VPN</div>
                <div className="truncate text-sm font-bold text-foreground" title={incyNode.name}>
                  {incyNode.name}
                </div>
              </div>
              {typeof incyNode.latencyMs === 'number' && incyNode.latencyMs > 0 && (
                <div className="rounded-xl border border-border bg-background/60 px-3 py-2">
                  <div className="text-[11px] text-muted-foreground">Пинг</div>
                  <div className="text-sm font-bold tabular-nums text-foreground">{incyNode.latencyMs} мс</div>
                </div>
              )}
            </div>
          ) : runningCount < 3 ? (
            <Button onClick={() => void handleStartAll()} disabled={startingAll} className="shrink-0">
              {startingAll ? <Loader2 className="size-4 animate-spin" /> : <Power className="size-4" />}
              Включить всё
            </Button>
          ) : null}
        </div>

        {/* Службы */}
        <div className="grid grid-cols-1 gap-3.5 md:grid-cols-3">
          <ServiceCard
            icon={<ZapretIcon className="size-5" />}
            title="Zapret"
            tone={toneOf(zapretOn, zapretBusy, zapret.state === 'error')}
            statusText={
              zapretBusy
                ? (pending.zapret ?? zapret.state === 'starting') ? 'Запуск…' : 'Остановка…'
                : zapretOn
                  ? 'Работает'
                  : zapret.state === 'error'
                    ? 'Ошибка'
                    : 'Выключен'
            }
            checked={pending.zapret ?? zapretOn}
            onToggle={(v) => void toggleZapret(v)}
            disabled={isZapretTesting}
            rows={[
              { label: 'Стратегия', value: zapretStrategy ? zapretStrategy.replace(/\.bat$/i, '') : 'не выбрана' },
              { label: 'Версия', value: appConfig?.zapret?.installedVersion ?? zapretUpdate?.installed ?? 'встроенная' }
            ]}
            note={
              isZapretTesting
                ? 'Идёт тестирование стратегий — переключатель заблокирован'
                : zapret.state === 'error'
                  ? zapret.lastError
                  : undefined
            }
            onOpen={() => navigate('/zapret')}
          />
          <ServiceCard
            icon={<TelegramIcon className="size-5" />}
            title="Telegram"
            tone={toneOf(tgwsOn, tgwsBusy, tgws.state === 'error')}
            statusText={
              tgwsBusy
                ? (pending.tgws ?? tgws.state === 'starting') ? 'Запуск…' : 'Остановка…'
                : tgwsOn
                  ? 'Работает'
                  : tgws.state === 'error'
                    ? 'Ошибка'
                    : 'Выключен'
            }
            checked={pending.tgws ?? tgwsOn}
            onToggle={(v) => void toggleTgws(v)}
            rows={[
              { label: 'Прокси', value: `127.0.0.1:${appConfig?.tgws?.port || 1443}` },
              { label: 'Версия', value: appConfig?.tgws?.installedVersion ?? tgwsUpdate?.installed ?? 'встроенная' }
            ]}
            note={tgws.state === 'error' ? tgws.lastError : undefined}
            onOpen={() => navigate('/telegram')}
          />
          <ServiceCard
            icon={<Globe className="size-5" />}
            title="INCY VPN"
            tone={toneOf(incyOn, incyBusy, incy.state === 'error')}
            statusText={
              incyBusy
                ? (pending.incy ?? true) ? 'Подключение…' : 'Отключение…'
                : incyOn
                  ? 'Подключено'
                  : incy.state === 'error'
                    ? 'Ошибка'
                    : 'Отключено'
            }
            checked={pending.incy ?? incyOn}
            onToggle={(v) => void toggleIncy(v)}
            rows={[
              { label: 'Узел', value: incyNode?.name ?? (nodes.length ? 'не выбран' : 'нет серверов') },
              { label: 'Режим', value: incyMode }
            ]}
            note={incy.state === 'error' ? incy.lastError : undefined}
            onOpen={() => navigate('/incy')}
          />
        </div>

        <LiveTrafficMonitor />

        {/* Быстрые действия */}
        <div className="grid grid-cols-1 gap-3.5 md:grid-cols-3">
          {[
            {
              icon: <Target className="size-[18px]" />,
              title: 'Пинг до Faceit',
              sub: 'Лучший узел для матча',
              onClick: () => navigate('/optimizer')
            },
            {
              icon: <Zap className="size-[18px]" />,
              title: 'Сменить узел',
              sub: nodes.length ? `Серверов в подписке: ${nodes.length}` : 'Добавить подписку',
              onClick: () => navigate('/incy')
            },
            {
              icon: <ScrollText className="size-[18px]" />,
              title: 'Логи и отчёт',
              sub: 'Если что-то не работает',
              onClick: () => navigate('/logs')
            }
          ].map((a) => (
            <button
              key={a.title}
              type="button"
              onClick={a.onClick}
              className="group flex cursor-pointer items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left transition-colors hover:border-primary/35"
            >
              <span className="text-primary">{a.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-semibold text-foreground">{a.title}</span>
                <span className="block truncate text-[11px] text-muted-foreground">{a.sub}</span>
              </span>
              <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </button>
          ))}
        </div>

        {/* Версия, обновления, поддержка */}
        <div className="flex items-center justify-end gap-1 text-[11px] text-muted-foreground">
          {appVersion && <span className="px-2 tabular-nums">LAZEYKA v{appVersion}</span>}
          <button
            type="button"
            onClick={() => void openExternalUrl(SUPPORT_TELEGRAM_URL)}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 transition-colors hover:bg-accent hover:text-foreground"
          >
            <LifeBuoy className="size-3" />
            Поддержка
          </button>
        </div>
      </div>
    </BasePage>
  )
}

export default Home
