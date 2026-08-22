import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import NumberFlow from '@number-flow/react'
import BasePage from '@renderer/components/base/base-page'
import { Spinner } from '@renderer/components/ui/spinner'
import { CharacterMorph } from '@renderer/components/ui/character-morph'
import { useTgwsStore } from '@renderer/store/tgws-store'
import { useZapretStore } from '@renderer/store/zapret-store'
import { useZapretTestStore } from '@renderer/store/zapret-test-store'
import { useIncyStore } from '@renderer/store/incy-store'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import {
  tgwsStart, tgwsStop, tgwsRestart,
  zapretStart, zapretStop, zapretRestart,
  zapretCheckUpdate, tgwsCheckUpdate,
  incyConnect,
  getAppVersion,
  openExternalUrl,
  type ZapretUpdateInfo, type TgwsUpdateInfo
} from '@renderer/utils/ipc'
import { Button } from '@renderer/components/ui/button'
import {
  POWER_ON_BANNER_STYLE,
  SUPPORT_TELEGRAM_URL,
  formatInstalledVersion
} from '@renderer/lib/utils'
import LiveTrafficMonitor from '@renderer/components/live-traffic-monitor'
import { RotateCw, Sparkles, X, LifeBuoy } from 'lucide-react'
import Power from '@renderer/assets/on_icon.svg'
import Pause from '@renderer/assets/pause_icon.svg'

interface PowerToggleProps {
  label: string
  status: CoreStatus
  onToggle: (next: boolean) => Promise<void> | void
  version?: string
  /**
   * Что писать, когда версия неизвестна.
   *
   * Версия ядра появляется в конфиге только после того, как его обновили
   * через LAZEYKA: у бинарника из установщика отметки нет. Пустое место на
   * этом месте читалось как «что-то отвалилось», хотя ядро работает.
   */
  versionFallback?: string
  disabled?: boolean
  disabledReason?: string
  subtitle?: React.ReactNode
  onSubtitleClick?: () => void
}

const PowerToggle: React.FC<PowerToggleProps> = ({
  label, status, onToggle, version, versionFallback, disabled = false, disabledReason, subtitle,
  onSubtitleClick
}) => {
  const { t } = useTranslation()
  const [pending, setPending] = useState<null | boolean>(null)
  const isSelected = pending ?? status.state === 'running'
  const ipcLoading = status.state === 'starting' || status.state === 'stopping'
  const loading = ipcLoading || pending !== null
  const loadingDirection: 'connecting' | 'disconnecting' =
    status.state === 'stopping' || pending === false ? 'disconnecting' : 'connecting'

  const handleClick = async (): Promise<void> => {
    if (loading || disabled) return
    const next = !isSelected
    setPending(next)
    try {
      await onToggle(next)
    } finally {
      setPending(null)
    }
  }

  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!isSelected || !status.startedAt) {
      setElapsed(0)
      return
    }
    const tick = (): void => setElapsed(Math.floor((Date.now() - status.startedAt!) / 1000))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [isSelected, status.startedAt])

  const statusText = loading
    ? loadingDirection === 'connecting'
      ? t('pages.home.connecting', { defaultValue: 'ПОДКЛЮЧЕНИЕ…' })
      : t('pages.home.disconnecting', { defaultValue: 'ОТКЛЮЧЕНИЕ…' })
    : isSelected
      ? t('pages.home.connected', { defaultValue: 'АКТИВЕН' })
      : t('pages.home.disconnected', { defaultValue: 'ОТКЛЮЧЕН' })
  const reserveTexts = [
    t('pages.home.connecting', { defaultValue: 'ПОДКЛЮЧЕНИЕ…' }),
    t('pages.home.disconnecting', { defaultValue: 'ОТКЛЮЧЕНИЕ…' }),
    t('pages.home.connected', { defaultValue: 'АКТИВЕН' }),
    t('pages.home.disconnected', { defaultValue: 'ОТКЛЮЧЕН' })
  ]

  const showTimer = !loading && isSelected
  const h = Math.floor(elapsed / 3600)
  const m = Math.floor((elapsed % 3600) / 60)
  const s = elapsed % 60

  return (
    <div className="relative flex flex-col items-center justify-center p-6 rounded-2xl cyber-card cyber-card-hover min-w-0 transition-all duration-300">
      {/* Top Header info */}
      <div className="w-full flex items-center justify-between mb-4 px-2">
        <div className="flex items-center gap-2">
          <div className={`size-2 rounded-full ${isSelected ? 'bg-emerald-400 shadow-[0_0_8px_#34d399] animate-pulse' : 'bg-zinc-600'}`} />
          <span className="text-xs font-bold uppercase tracking-wider text-foreground/90 font-mono">
            {label}
          </span>
        </div>
        {(version || versionFallback) && (
          <span
            className="text-[11px] font-mono text-muted-foreground bg-foreground/[0.05] px-2 py-0.5 rounded-full border border-border/40"
            title={
              version
                ? undefined
                : 'Ядро из установщика — номер версии появится после первого обновления через LAZEYKA'
            }
          >
            {version ? `v${version}` : versionFallback}
          </span>
        )}
      </div>

      {/* Cybernetic Power Core Button */}
      <div className="relative my-2 flex items-center justify-center">
        {/* Background glow Halo */}
        <div
          className={`absolute inset-0 rounded-full transition-all duration-500 pointer-events-none ${
            isSelected
              ? 'bg-emerald-500/20 blur-2xl scale-125'
              : 'bg-indigo-500/5 blur-xl scale-95'
          }`}
        />

        {/* Outer Orbit Ring */}
        <div
          className={`absolute size-38 rounded-full border border-dashed transition-all duration-700 pointer-events-none ${
            isSelected
              ? 'border-emerald-400/40 animate-[spin_18s_linear_infinite]'
              : 'border-border/40 opacity-40'
          }`}
        />

        <button
          disabled={loading || disabled}
          onClick={handleClick}
          title={disabled ? disabledReason : undefined}
          className={`relative z-10 size-32 rounded-full flex items-center justify-center transition-all duration-300 active:scale-95 cursor-pointer disabled:cursor-not-allowed ${
            disabled ? 'opacity-50' : ''
          }`}
        >
          <div
            className={`size-full rounded-full flex items-center justify-center transition-all duration-300 border-2 backdrop-blur-xl ${
              isSelected
                ? 'bg-gradient-to-br from-emerald-500/20 via-emerald-600/30 to-emerald-950/80 border-emerald-400 cyber-glow-emerald shadow-[0_0_30px_rgba(16,185,129,0.3)]'
                : 'bg-gradient-to-br from-zinc-800/40 via-zinc-900/60 to-black/90 border-border/80 hover:border-foreground/30 shadow-[0_4px_20px_rgba(0,0,0,0.5)]'
            }`}
          >
            <div className="relative size-14 flex items-center justify-center">
              <Spinner
                className={`absolute inset-0 m-auto size-14 text-primary transition-all duration-300 ease-out ${
                  loading ? 'opacity-100 scale-100' : 'opacity-0 scale-75'
                }`}
              />
              <img
                src={Pause}
                alt=""
                className={`absolute inset-0 size-14 transition-all duration-300 ease-out ${
                  !loading && isSelected ? 'opacity-100 scale-100 drop-shadow-[0_0_12px_rgba(16,185,129,0.7)]' : 'opacity-0 scale-75'
                }`}
              />
              <img
                src={Power}
                alt=""
                className={`absolute inset-0 size-14 transition-all duration-300 ease-out ${
                  !loading && !isSelected ? 'opacity-80 scale-100 drop-shadow-[0_0_6px_rgba(255,255,255,0.2)]' : 'opacity-0 scale-75'
                }`}
              />
            </div>
          </div>
        </button>
      </div>

      {/* Dynamic Status Character Morph */}
      <div className="mt-4 flex h-6 items-center justify-center">
        <CharacterMorph
          texts={[statusText]}
          reserveTexts={reserveTexts}
          interval={3000}
          className={`h-6 leading-none font-bold text-xs uppercase tracking-widest ${
            isSelected ? 'text-emerald-700 dark:text-emerald-400 drop-shadow-[0_0_8px_rgba(52,211,153,0.5)]' : 'text-muted-foreground'
          }`}
        />
      </div>

      {/* Animated Uptime / Active State pill */}
      <div className="mt-2 h-7 flex items-center justify-center">
        <div
          aria-hidden={!showTimer}
          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-mono font-semibold bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20 tabular-nums transition-all duration-300 ${
            showTimer ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1'
          }`}
        >
          <NumberFlow value={h} format={{ minimumIntegerDigits: 2, useGrouping: false }} />
          <span>:</span>
          <NumberFlow value={m} format={{ minimumIntegerDigits: 2, useGrouping: false }} />
          <span>:</span>
          <NumberFlow value={s} format={{ minimumIntegerDigits: 2, useGrouping: false }} />
        </div>
      </div>

      {subtitle && (
        <div
          onClick={onSubtitleClick}
          className={`mt-2 text-xs text-muted-foreground text-center truncate max-w-[200px] ${
            onSubtitleClick ? 'cursor-pointer hover:text-primary transition-colors underline underline-offset-4 decoration-border' : ''
          }`}
        >
          {subtitle}
        </div>
      )}

      {disabled && disabledReason && (
        <div className="mt-2 text-[11px] text-amber-700 dark:text-amber-400 text-center leading-tight max-w-[200px]">
          {disabledReason}
        </div>
      )}

      {status.lastError && (
        <div className="mt-2 text-[11px] text-rose-700 dark:text-rose-400 text-center max-w-[220px] truncate" title={status.lastError}>
          {status.lastError}
        </div>
      )}
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
  <div className="relative flex items-center gap-3 rounded-2xl border border-primary/30 bg-primary/10 backdrop-blur-xl px-4 py-2.5 shadow-[0_0_15px_rgba(99,102,241,0.15)]">
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/20 text-primary shadow-[0_0_10px_rgba(99,102,241,0.25)]">
      <Sparkles className="size-4" />
    </div>
    <div className="min-w-0 flex-1">
      <div className="text-sm font-semibold truncate text-foreground">{title}</div>
      <div className="text-xs text-muted-foreground truncate">{subtitle}</div>
    </div>
    <div className="flex shrink-0 items-center gap-1.5">
      <Button size="sm" onClick={onDetails} className="h-7 text-xs rounded-lg">
        Подробнее
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-7 rounded-lg"
        onClick={onDismiss}
        title="Скрыть"
      >
        <X className="size-3.5" />
      </Button>
    </div>
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

  // ---- Update notices (Zapret + TgWsProxy)
  const [zapretUpdate, setZapretUpdate] = useState<ZapretUpdateInfo | null>(null)
  const [tgwsUpdate, setTgwsUpdate] = useState<TgwsUpdateInfo | null>(null)
  const [zapretSessionDismissed, setZapretSessionDismissed] = useState(false)
  const [tgwsSessionDismissed, setTgwsSessionDismissed] = useState(false)
  useEffect(() => {
    zapretCheckUpdate(false).then(setZapretUpdate).catch(() => setZapretUpdate(null))
    tgwsCheckUpdate(false).then(setTgwsUpdate).catch(() => setTgwsUpdate(null))
  }, [])
  const showZapretBanner =
    !!zapretUpdate &&
    zapretUpdate.hasUpdate &&
    !zapretUpdate.dismissed &&
    !!zapretUpdate.assetUrl &&
    !zapretSessionDismissed
  const showTgwsBanner =
    !!tgwsUpdate &&
    tgwsUpdate.hasUpdate &&
    !tgwsUpdate.dismissed &&
    !!tgwsUpdate.assetUrl &&
    !tgwsSessionDismissed

  const toggleTgws = async (next: boolean): Promise<void> => {
    try {
      if (next) await tgwsStart()
      else await tgwsStop()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      toast.error(next ? 'Не удалось запустить Telegram' : 'Не удалось остановить Telegram', {
        description: msg
      })
    }
  }
  const toggleZapret = async (next: boolean): Promise<void> => {
    if (next && !zapretStrategy) {
      navigate('/zapret', { state: { autoStart: true } })
      return
    }
    try {
      if (next) await zapretStart()
      else await zapretStop()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      toast.error(next ? 'Не удалось запустить Zapret' : 'Не удалось остановить Zapret', {
        description: msg
      })
    }
  }

  // App version pulled from main via IPC (electron's app.getVersion()
  const [appVersion, setAppVersion] = useState<string | null>(null)
  useEffect(() => {
    getAppVersion().then(setAppVersion).catch(() => setAppVersion(null))
  }, [])

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
        // Style the toast with the same red radial gradient + power-off
        // border that the big disabled power buttons use, so the visual
        // language stays consistent: red = "nothing is running".
        toast.info('Нет запущенных процессов для перезагрузки', {
          style: {
            background:
              'radial-gradient(at 30% 45%, color-mix(in oklab, var(--gradient-start-power-off) 60%, transparent), color-mix(in oklab, var(--gradient-end-power-off) 60%, transparent))',
            borderColor: 'var(--stroke-power-off)',
            color: 'var(--foreground)'
          }
        })
        return
      }
      await Promise.allSettled(tasks)
      // Mirror the green radial-gradient look of the active power buttons so
      // the success toast reads as "everything is on" at a glance.
      toast.success('Процессы перезагружены', {
        style: POWER_ON_BANNER_STYLE
      })
    } catch (e) {
      toast.error('Не удалось перезагрузить процессы', {
        description: e instanceof Error ? e.message : String(e)
      })
    } finally {
      setReloading(false)
    }
  }

  return (
    <BasePage
      title={
        // Home was the only page with an empty header bar. The wordmark keeps
        // the mono / uppercase / wide-tracking treatment used by the service
        // labels on the power cards, scaled up and lit with the same emerald
        // the logo and every "running" state use — so it reads as brand, not
        // as a stray heading.
        //
        // The colour is paired (600 in light / 300 in dark) on purpose: bare
        // emerald-300 sits at ~1.6:1 against the light card and would be
        // effectively invisible there. At 24px/black the pair clears the 3:1
        // WCAG threshold for large text in both themes.
        <span
          className="
            font-mono text-2xl font-black uppercase tracking-[0.28em] leading-none select-none
            text-emerald-600 dark:text-emerald-300
            drop-shadow-[0_0_10px_rgba(16,185,129,0.35)]
            dark:drop-shadow-[0_0_16px_rgba(52,211,153,0.55)]
          "
        >
          LAZEYKA
        </span>
      }
    >
      <div className="relative flex flex-col h-full">
        {(showZapretBanner || showTgwsBanner) && (
          <div className="px-4 pt-2 space-y-2">
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 px-4 flex-1 items-center max-w-4xl mx-auto w-full">
          <PowerToggle
            label="Telegram Proxy"
            status={tgws}
            onToggle={toggleTgws}
            version={appConfig?.tgws?.installedVersion ?? tgwsUpdate?.installed}
            versionFallback="встроенная"
            subtitle={tgws.state === 'running' ? `MTProto • Порт ${appConfig?.tgws?.port || 1443}` : 'Нажмите для запуска'}
            onSubtitleClick={() => navigate('/telegram')}
          />
          <PowerToggle
            label="Zapret DPI Bypass"
            status={zapret}
            onToggle={toggleZapret}
            version={appConfig?.zapret?.installedVersion ?? zapretUpdate?.installed}
            versionFallback="встроенная"
            subtitle={zapretStrategy ? `Стратегия: ${zapretStrategy}` : 'Стратегия не выбрана'}
            onSubtitleClick={() => navigate('/zapret')}
            disabled={isZapretTesting}
            disabledReason={
              isZapretTesting
                ? 'Идёт тестирование стратегий — переключатель заблокирован'
                : undefined
            }
          />
        </div>

        <div className="px-4 pt-3 max-w-4xl mx-auto w-full">
          <LiveTrafficMonitor />
        </div>

        <div className="flex justify-center pt-4 pb-5">
          <Button
            variant="outline"
            size="sm"
            onClick={handleReloadAll}
            disabled={reloading}
            className="cursor-pointer border-border/80 bg-card/60 backdrop-blur-md hover:bg-card/90 hover:border-primary/50 hover:shadow-[0_0_20px_-3px_rgba(99,102,241,0.25)] transition-all duration-200 rounded-xl font-medium"
            title="Перезагрузить процессы"
          >
            <RotateCw className={`size-3.5 mr-2 ${reloading ? 'animate-spin text-primary' : 'text-muted-foreground'}`} />
            <span>Перезагрузить службы</span>
          </Button>
        </div>
        {/* Версия и связь с поддержкой рядом: угол, куда человек смотрит,
            когда что-то не работает и он хочет об этом сообщить. Название
            приложения здесь не повторяется — оно уже есть в шапке. */}
        <div className="absolute bottom-2 right-4 flex items-center gap-1.5 select-none">
          <button
            type="button"
            onClick={() => openExternalUrl(SUPPORT_TELEGRAM_URL)}
            title="Открыть Telegram-канал поддержки LAZEYKA"
            className="group cursor-pointer inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-md border border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400 hover:border-sky-500/60 hover:bg-sky-500/20 transition-colors backdrop-blur-sm"
          >
            <LifeBuoy className="size-3 group-hover:scale-110 transition-transform" />
            <span>Поддержка</span>
          </button>
          {appVersion && (
            <span className="pointer-events-none text-[11px] font-mono text-muted-foreground/60 bg-background/50 backdrop-blur-sm px-2 py-0.5 rounded-md border border-border/30">
              <span className="text-primary/80">v{appVersion}</span>
            </span>
          )}
        </div>
      </div>
    </BasePage>
  )
}

export default Home
