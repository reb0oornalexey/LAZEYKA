import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Download, Loader2, Sparkles, FlaskConical, CheckCircle2, XCircle } from 'lucide-react'
import { useZapretStore } from '@renderer/store/zapret-store'
import { useZapretTestStore } from '@renderer/store/zapret-test-store'
import {
  zapretListStrategies,
  zapretStart,
  zapretStop,
  zapretCheckUpdate,
  zapretInstallUpdate,
  zapretDismissUpdate,
  zapretRunStrategyTest,
  type ZapretUpdateInfo
} from '@renderer/utils/ipc'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { Button } from '@renderer/components/ui/button'
import ZapretIcon from '@renderer/components/zapret-icon'
import { cn, formatInstalledVersion, POWER_ON_BANNER_STYLE } from '@renderer/lib/utils'
import BasePage from '@renderer/components/base/base-page'
import SwitcherCard from '@renderer/components/switcher-card'
import ZapretIpListCard from '@renderer/components/zapret-iplist-card'
import ZapretServiceSettingsCard from '@renderer/components/zapret-service-settings-card'
import ZapretAutopilotCard from '@renderer/components/zapret-autopilot-card'
import ZapretStrategyBuilderCard from '@renderer/components/zapret-strategy-builder-card'

const Zapret: React.FC = () => {
  const status = useZapretStore((s) => s.status)
  const { appConfig, patchAppConfig } = useAppConfig()
  const [strategies, setStrategies] = useState<{ file: string; title: string; description: string }[]>([])
  const zapret = appConfig?.zapret
  const active = zapret?.activeStrategy
  const location = useLocation()
  const navigate = useNavigate()
  const autoStartRef = useRef<boolean>(
    Boolean((location.state as { autoStart?: boolean } | null)?.autoStart)
  )

  // ---- Auto-update banner
  const [updateInfo, setUpdateInfo] = useState<ZapretUpdateInfo | null>(null)
  const [installing, setInstalling] = useState(false)
  const installingRef = useRef(false)

  // ---- Strategy test
  const testProgress = useZapretTestStore((s) => s.progress)
  const testReport = useZapretTestStore((s) => s.report)
  const isTestRunning = useZapretTestStore((s) => s.isRunning)
  const autoTestStartedRef = useRef(false)

  // After a test run, show strategies best-to-worst by score (okCount out
  // of 10 targets) instead of file order — untested strategies (shouldn't
  // normally happen once a full run has completed, but defensively
  // handled) sort to the bottom. Before any test has run, keep the plain
  // file-listing order so browsing available strategies isn't reshuffled
  // for no reason.
  const displayedStrategies = useMemo(() => {
    if (!testReport) return strategies
    const scoreOf = (file: string): number => testReport.results[file]?.score ?? -1
    return [...strategies].sort((a, b) => scoreOf(b.file) - scoreOf(a.file))
  }, [strategies, testReport])

  const refreshStrategies = (): void => {
    zapretListStrategies().then(setStrategies).catch(() => setStrategies([]))
  }

  const runCheckUpdate = async (force = false): Promise<void> => {
    // Don't await; banner just stays hidden if the API call fails (rate-
    // limit, offline, etc.) — surfacing a network error here would be
    // noise for users who never asked to check.
    const info = await zapretCheckUpdate(force).catch(() => null)
    setUpdateInfo(info)
    // Manual trigger (the "Проверить сейчас" button) — give explicit
    // feedback either way, since silence would look broken when the
    // user just pressed a button.
    if (force) {
      if (!info) {
        toast.error('Не удалось проверить обновления Zapret')
      } else if (info.hasUpdate) {
        toast.info(`Доступна новая версия Zapret — v${info.latest}`)
      } else {
        toast.success('У вас последняя версия Zapret')
      }
    }
  }

  const startTest = (): void => {
    if (useZapretTestStore.getState().isRunning) return
    // Optimistically flip isRunning so the UI dims immediately — the
    // first 'starting' IPC tick will arrive within ~100ms and reconcile.
    useZapretTestStore.getState().set({
      isRunning: true,
      progress: { phase: 'starting' }
    })
    zapretRunStrategyTest().catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e)
      toast.error('Тест стратегий не выполнен', { description: msg })
      useZapretTestStore.getState().set({
        isRunning: false,
        progress: { phase: 'error', message: msg }
      })
    })
  }

  useEffect(() => {
    refreshStrategies()
    if (zapret?.autoUpdateCheck !== false) {
      void runCheckUpdate(false)
    }

    const t = setTimeout(() => {
      if (autoTestStartedRef.current) return
      const s = useZapretTestStore.getState()
      if (s.report || s.isRunning) return
      autoTestStartedRef.current = true
      zapretListStrategies()
        .then((list) => {
          if (list.length > 0) startTest()
        })
        .catch(() => void 0)
    }, 250)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const showBanner = !!updateInfo && updateInfo.hasUpdate && !updateInfo.dismissed && !!updateInfo.assetUrl

  const installUpdate = async (): Promise<void> => {
    if (installingRef.current || !updateInfo?.assetUrl) return
    installingRef.current = true
    setInstalling(true)
    const tId = toast.loading('Скачиваем сборку Zapret…', {
      description: updateInfo.assetName ?? `v${updateInfo.latest}`
    })
    try {
      const res = await zapretInstallUpdate(updateInfo.assetUrl, updateInfo.latest)
      toast.success('Zapret обновлён', {
        id: tId,
        description: `Версия ${res.installedVersion ?? updateInfo.latest} — стратегий: ${res.strategies}`,
        // Same vivid power-on green as the other success toasts (copy-link,
        // regenerate-key, processes-reloaded) and the active home-page
        // power-on disc, so success feedback across the app is one colour.
        style: POWER_ON_BANNER_STYLE
      })
      // If the active strategy no longer exists in the new bundle, drop it
      // so the user is forced to pick a fresh one before next start.
      refreshStrategies()
      if (zapret && active) {
        const fresh = await zapretListStrategies().catch(() => [])
        if (!fresh.some((s) => s.file === active)) {
          await patchAppConfig({ zapret: { ...zapret, activeStrategy: undefined } })
        }
      }
      // Re-check so the banner disappears immediately.
      const fresh = await zapretCheckUpdate(true).catch(() => null)
      setUpdateInfo(fresh)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      toast.error('Не удалось обновить Zapret', { id: tId, description: msg })
    } finally {
      setInstalling(false)
      installingRef.current = false
    }
  }

  const dismissUpdate = (): void => {
    if (!updateInfo?.latest) return
    void zapretDismissUpdate(updateInfo.latest).catch(() => void 0)
    setUpdateInfo({ ...updateInfo, dismissed: true })
  }

  const pickStrategy = async (file: string): Promise<void> => {
    // Defensive: if the user manages to click a disabled strategy via
    // keyboard or a stale render, drop the request silently.
    const r = testReport?.results[file]
    if (r && r.tested && !r.passed) return
    if (isTestRunning) return
    await patchAppConfig({ zapret: { ...zapret!, activeStrategy: file } })
    if (!autoStartRef.current) return
    // One-shot: drop the flag so re-clicking another strategy on this page
    // doesn't keep auto-starting and ping-ponging back to Home.
    autoStartRef.current = false
    try {
      await zapretStart()
      navigate('/home')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      toast.error('Не удалось запустить Zapret', { description: msg })
    }
  }

  return (
    <BasePage title="Zapret">
      <div className="px-4 pb-6 space-y-4">
        {showBanner && updateInfo && (
          <div className={cn(
            'relative flex items-center gap-3 rounded-2xl border border-primary/30 bg-primary/10 backdrop-blur-xl px-4 py-3 shadow-[0_0_15px_rgba(99,102,241,0.15)] transition',
            installing && 'pointer-events-none opacity-80'
          )}>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/20 text-primary shadow-[0_0_10px_rgba(99,102,241,0.25)]">
              {installing
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <Sparkles className="h-4 w-4" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-foreground">
                {installing
                  ? 'Устанавливаем Zapret…'
                  : `Доступно обновление Zapret — v${updateInfo.latest}`}
              </div>
              <div className="text-xs text-muted-foreground truncate">
                {installing
                  ? 'Останавливаем winws.exe, распаковываем архив…'
                  : formatInstalledVersion(updateInfo.installed)}
              </div>
            </div>
            {!installing && (
              <div className="flex shrink-0 items-center gap-2">
                <Button variant="ghost" size="sm" onClick={dismissUpdate}>
                  Позже
                </Button>
                <Button size="sm" onClick={() => { void installUpdate() }}>
                  <Download className="h-3.5 w-3.5" />
                  Обновить
                </Button>
              </div>
            )}
          </div>
        )}

        <SwitcherCard
          icon={ZapretIcon}
          title="Обход DPI (Zapret)"
          subtitle={active ?? 'Выберите стратегию ниже'}
          version={zapret?.installedVersion ?? updateInfo?.installed}
          status={status}
          disabled={isTestRunning}
          onToggle={(v) => {
            if (v && !active) return
            if (isTestRunning) return
            // Return the promise so SwitcherCard awaits the IPC roundtrip and
            // keeps the switch optimistically flipped/locked until done.
            return (v ? zapretStart() : zapretStop()).catch(() => void 0)
          }}
          footer={
            isTestRunning
              ? 'Идёт тестирование стратегий — переключатель временно недоступен'
              : active
                ? null
                : 'Нужна стратегия'
          }
        />

      <ZapretIpListCard
        disabled={isTestRunning || status.state === 'starting' || status.state === 'stopping'}
        disabledReason={
          isTestRunning
            ? 'Идёт тестирование стратегий — управление списком временно недоступно'
            : 'Подождите завершения переключения Zapret'
        }
      />

      <ZapretServiceSettingsCard
        disabled={isTestRunning || status.state === 'starting' || status.state === 'stopping'}
        disabledReason={
          isTestRunning
            ? 'Идёт тестирование стратегий — настройки временно недоступны'
            : 'Подождите завершения переключения Zapret'
        }
        autoUpdateCheck={zapret?.autoUpdateCheck !== false}
        onAutoUpdateCheckChange={(v) => {
          if (!zapret) return
          void patchAppConfig({ zapret: { ...zapret, autoUpdateCheck: v } })
        }}
        onManualCheckUpdate={() => runCheckUpdate(true)}
      />

      <ZapretAutopilotCard />

      <ZapretStrategyBuilderCard onStrategyCreated={refreshStrategies} />

      <Card className="cyber-card">
        <CardHeader
          className={cn(
            'flex flex-row items-center justify-between gap-3 space-y-0 pb-3',
            isTestRunning && 'flex-col items-stretch gap-3 sm:flex-row sm:items-center'
          )}
        >
          {isTestRunning ? (
            <div className="flex flex-1 min-w-0 items-center gap-3">
              <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold leading-tight text-foreground">
                  Идёт тестирование стратегий под вашу сеть…
                </div>
                <div className="text-xs text-muted-foreground mt-0.5 font-mono">
                  {testProgress && testProgress.total ? (
                    <>
                      Стратегия <span className="text-primary font-bold">{testProgress.current ?? 0}/{testProgress.total}</span>
                      {testProgress.strategy ? ` — ${testProgress.strategy}` : ''}
                    </>
                  ) : 'Инициализация тестирования…'}
                </div>
              </div>
            </div>
          ) : (
            <>
              <div>
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <ZapretIcon className="size-4.5 text-primary" />
                  <span>Каталог стратегий DPI Bypass</span>
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {testReport ? (
                    <span className="text-emerald-700 dark:text-emerald-400 font-semibold font-mono">
                      {Object.values(testReport.results).filter((r) => r.passed).length} / {Object.keys(testReport.results).length} рабочих на вашем провайдере
                    </span>
                  ) : 'Выберите оптимальный пресет для обхода блокировок.'}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={startTest}
                disabled={strategies.length === 0}
                className="shrink-0 h-8 text-xs gap-1.5 rounded-xl cursor-pointer border-border/80 hover:border-primary/50 hover:text-primary transition-all"
              >
                <FlaskConical className="size-3.5" />
                <span>{testReport ? 'Перетестировать' : 'Запустить тест'}</span>
              </Button>
            </>
          )}
        </CardHeader>
        <CardContent className="space-y-2">
          {strategies.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Сборка Zapret не найдена.
            </p>
          )}
          {displayedStrategies.map((s) => {
            const result = testReport?.results[s.file]
            const isFailed = !!result && result.tested && !result.passed
            const isPassed = !!result && result.tested && result.passed
            const isBest = testReport?.bestStrategy === s.file
            const isActive = active === s.file
            const disabled = isFailed || isTestRunning

            return (
              <button
                key={s.file}
                onClick={() => { void pickStrategy(s.file) }}
                disabled={disabled}
                aria-disabled={disabled}
                title={
                  isFailed
                    ? `Не прошла тест (${result?.okCount ?? 0}/${result?.totalCount ?? 0} целей доступны).`
                    : undefined
                }
                className={cn(
                  'group relative w-full text-left p-3.5 rounded-xl border transition-all duration-200 cursor-pointer',
                  isActive
                    ? 'border-primary/60 bg-primary/15 shadow-[0_0_20px_-3px_rgba(99,102,241,0.3)]'
                    : 'border-border/60 bg-card/40 hover:bg-foreground/[0.04] hover:border-border',
                  disabled && 'opacity-40 grayscale cursor-not-allowed pointer-events-none'
                )}
              >
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-sm flex items-center gap-2">
                      <span className={cn('truncate', isActive ? 'text-primary' : 'text-foreground')}>
                        {s.title}
                      </span>
                      {isBest && (
                        <span className="shrink-0 text-[10px] uppercase tracking-wide font-mono font-bold rounded-full px-2 py-0.5 bg-primary/20 text-primary border border-primary/30 shadow-[0_0_8px_rgba(99,102,241,0.3)]">
                          лучшая
                        </span>
                      )}
                      {isActive && (
                        <span className="shrink-0 text-[10px] uppercase tracking-wide font-mono font-bold rounded-full px-2 py-0.5 bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30">
                          активна
                        </span>
                      )}
                    </div>
                    {s.description && (
                      <div className="text-xs text-muted-foreground mt-1 line-clamp-1">{s.description}</div>
                    )}
                  </div>
                  {isFailed ? (
                    <span className="shrink-0 inline-flex items-center gap-1 text-xs font-mono font-semibold px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-700 dark:text-rose-400 border border-rose-500/20">
                      <XCircle className="size-3.5" />
                      {result?.okCount ?? 0}/{result?.totalCount ?? 0}
                    </span>
                  ) : isPassed ? (
                    <span className="shrink-0 inline-flex items-center gap-1 text-xs font-mono font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20">
                      <CheckCircle2 className="size-3.5" />
                      {result?.okCount ?? 0}/{result?.totalCount ?? 0}
                    </span>
                  ) : null}
                </div>
              </button>
            )
          })}
        </CardContent>
      </Card>

      {status.lastError && (
        <Card className="border-rose-500/40 bg-rose-950/20 backdrop-blur-xl">
          <CardContent className="pt-4">
            <p className="text-xs text-rose-700 dark:text-rose-400 font-mono">{status.lastError}</p>
          </CardContent>
        </Card>
      )}
      </div>
    </BasePage>
  )
}

export default Zapret
