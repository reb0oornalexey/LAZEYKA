import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Hammer, ListChecks, Loader2, RefreshCw, Settings2, Sparkles, X } from 'lucide-react'
import { useZapretStore } from '@renderer/store/zapret-store'
import { useZapretTestStore } from '@renderer/store/zapret-test-store'
import { attachZapretLab, useZapretLab, type ZapretTab } from '@renderer/store/zapret-lab-store'
import {
  zapretListStrategies,
  zapretStart,
  zapretStop,
  zapretRestart,
  zapretCheckUpdate,
  zapretInstalledVersion,
  zapretInstallUpdate,
  zapretDismissUpdate,
  zapretRunStrategyTest,
  zapretStopStrategyTest,
  zapretClearStrategyTestResults,
  getAppConfig,
  type ZapretUpdateInfo
} from '@renderer/utils/ipc'
import { isAutopickRunning, labAutopickStart } from '@renderer/utils/zapret-lab-api'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { Button } from '@renderer/components/ui/button'
import ZapretIcon from '@renderer/components/zapret-icon'
import { cn, formatInstalledVersion, POWER_ON_BANNER_STYLE } from '@renderer/lib/utils'
import { Segmented } from '@renderer/components/lz'
import { ZapretConsole } from '@renderer/components/zapret/zapret-console'
import { LinuxZapretLists } from '@renderer/components/zapret/linux-lists'
import { LinuxGameFilterCard } from '@renderer/components/zapret/linux-game-filter'
import { LinuxZapretBuilder } from '@renderer/components/zapret/linux-builder'
import { refreshZapretMeta } from '@renderer/components/zapret/zapret-meta'
import { useTourTab } from '@renderer/lib/tour-focus'
import ComponentUpdateDialog from '@renderer/components/component-update-dialog'
import BasePage from '@renderer/components/base/base-page'
import ZapretIpListCard from '@renderer/components/zapret-iplist-card'
import ZapretServiceSettingsCard from '@renderer/components/zapret-service-settings-card'
import ZapretAutopilotCard from '@renderer/components/zapret-autopilot-card'
import ZapretMacServiceCard from '@renderer/components/zapret-mac-service-card'
import ZapretCatalog from '@renderer/components/zapret-catalog'
import ZapretBuilder from '@renderer/components/zapret-builder'
import ZapretAutopickDialog from '@renderer/components/zapret-autopick-dialog'
import { platform } from '@renderer/utils/init'

const isMac = platform === 'darwin'
const isLinux = platform === 'linux'
const hasWindowsBuilder = !isMac && !isLinux

const TABS: { id: ZapretTab; label: string; icon: React.ComponentType<{ className?: string }>; hint: string; win?: boolean }[] = [
  { id: 'strategies', label: 'Стратегии', icon: ZapretIcon, hint: 'Каталог: встроенные и свои стратегии, проверка и автоподбор' },
  { id: 'builder', label: 'Конструктор', icon: Hammer, hint: 'Собрать свою стратегию из понятных блоков', win: true },
  { id: 'lists', label: 'Списки', icon: ListChecks, hint: 'Сайты и IP-адреса, которые обрабатывает Zapret' },
  { id: 'settings', label: 'Настройки', icon: Settings2, hint: 'Служба, Game Filter, IPset, автопилот и игровой режим' }
]

const CUSTOM_PREFIX = 'general (LZ '
const displayName = (file?: string): string | undefined => {
  if (!file) return undefined
  if (file.startsWith(CUSTOM_PREFIX) && file.endsWith(').bat')) return `${file.slice(CUSTOM_PREFIX.length, -').bat'.length)} · своя`
  return file.replace(/\.bat$/i, '')
}

const Zapret: React.FC = () => {
  const status = useZapretStore((s) => s.status)
  const { appConfig, patchAppConfig } = useAppConfig()
  const [strategies, setStrategies] = useState<{ file: string; title: string; description: string }[]>([])
  const zapret = appConfig?.zapret
  const active = zapret?.activeStrategy
  const location = useLocation()
  const navigate = useNavigate()
  const autoStartRef = useRef<boolean>(Boolean((location.state as { autoStart?: boolean } | null)?.autoStart))
  // Переход из «Регионов Valve»: сразу открыть настройки на Game Filter и IPset.
  const focusFiltersRef = useRef<boolean>(Boolean((location.state as { focusFilters?: boolean } | null)?.focusFilters))

  const tabState = useZapretLab((s) => s.tab)
  const setTab = useZapretLab((s) => s.setTab)
  const autopick = useZapretLab((s) => s.autopick)
  const setAutopickOpen = useZapretLab((s) => s.setAutopickOpen)
  const checking = useZapretLab((s) => s.checking)
  const refreshCustom = useZapretLab((s) => s.refreshCustom)
  const picking = isAutopickRunning(autopick)
  // На macOS конструктора нет — запомненная вкладка «Конструктор» открывает каталог.
  const tab: ZapretTab =
    isMac && tabState === 'builder' ? 'strategies' : tabState
  const [focusSignal, setFocusSignal] = useState(0)

  useTourTab<ZapretTab>('/zapret', setTab)

  useEffect(() => {
    // Флаг одноразовый: убираем его из истории, чтобы подсказка не всплывала снова после перезагрузки окна.
    if (focusFiltersRef.current) {
      setTab('settings')
      navigate(location.pathname, { replace: true, state: null })
    }
    return isLinux ? undefined : attachZapretLab()
  }, [])

  // ---- Обновление сборки
  const [updateInfo, setUpdateInfo] = useState<ZapretUpdateInfo | null>(null)
  // Версия без сети: встроенная сборка показывает свой номер, даже если GitHub недоступен.
  const [localVersion, setLocalVersion] = useState<string | null>(null)
  useEffect(() => {
    void zapretInstalledVersion().then(setLocalVersion).catch(() => void 0)
  }, [updateInfo?.installed])
  const [installing, setInstalling] = useState(false)
  const installingRef = useRef(false)

  // ---- Проверка всех стратегий
  const testProgress = useZapretTestStore((s) => s.progress)
  const testReport = useZapretTestStore((s) => s.report)
  const isTestRunning = useZapretTestStore((s) => s.isRunning)
  const isTestStopping = useZapretTestStore((s) => s.stopping)
  const labBusy = isTestRunning || picking || checking
  const [catalogAutopickRunning, setCatalogAutopickRunning] = useState(false)

  const refreshStrategies = (): void => {
    zapretListStrategies().then(setStrategies).catch(() => setStrategies([]))
  }

  // Своя стратегия сохранена/удалена — список файлов обновляется.
  const customCount = useZapretLab((s) => s.custom.length)
  useEffect(() => {
    refreshStrategies()
  }, [customCount])

  const runCheckUpdate = async (force = false): Promise<void> => {
    // Баннер просто не появится, если запрос не удался (лимит, нет сети).
    const info = await zapretCheckUpdate(force).catch(() => null)
    setUpdateInfo(info)
    if (force) {
      if (!info) toast.error('Не удалось проверить обновления Zapret')
      else if (info.hasUpdate) toast.info(`Доступна новая версия Zapret — v${info.latest}`)
      else toast.success('У вас последняя версия Zapret')
    }
  }

  const startTest = (resume = false, file?: string, autoSelect = false): void => {
    if (useZapretTestStore.getState().isRunning) return
    useZapretTestStore.getState().set({ isRunning: true, progress: { phase: 'starting', strategy: file } })
    if (autoSelect) setCatalogAutopickRunning(true)
    zapretRunStrategyTest({ resume, file, autoSelect }).catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e)
      toast.error('Проверка стратегий не выполнена', { description: msg })
      useZapretTestStore.getState().set({ isRunning: false, progress: { phase: 'error', message: msg } })
    }).finally(() => {
      if (autoSelect) setCatalogAutopickRunning(false)
    })
  }

  useEffect(() => {
    refreshStrategies()
    if (!isLinux && zapret?.autoUpdateCheck !== false) void runCheckUpdate(false)
    // Проверка стратегий и автоподбор не стартуют сами — только по кнопке.
  }, [])

  const stopTest = (): void => {
    if (!isTestRunning || isTestStopping) return
    useZapretTestStore.getState().set({ stopping: true })
    zapretStopStrategyTest().catch(() => useZapretTestStore.getState().set({ stopping: false }))
  }

  const resetTestResults = async (): Promise<void> => {
    try {
      await zapretClearStrategyTestResults()
      useZapretTestStore.getState().set({ report: null, progress: null })
      toast.success('Баллы проверки сброшены', { style: POWER_ON_BANNER_STYLE })
    } catch (e) {
      toast.error('Не удалось сбросить баллы', { description: e instanceof Error ? e.message : String(e) })
    }
  }

  const showBanner = !!updateInfo && updateInfo.hasUpdate && !updateInfo.dismissed && !!updateInfo.assetUrl

  const [updateDialogOpen, setUpdateDialogOpen] = useState(false)
  // «Подробнее» на главной ведёт сюда и сразу открывает окно обновления.
  const openUpdateRef = useRef<boolean>(Boolean((location.state as { openUpdate?: boolean } | null)?.openUpdate))
  useEffect(() => {
    if (openUpdateRef.current && updateInfo?.hasUpdate) {
      openUpdateRef.current = false
      setUpdateDialogOpen(true)
    }
  }, [updateInfo])

  /** Установка из окна обновления: ошибку показывает само окно. */
  const installUpdate = async (target?: { assetUrl: string; version: string }): Promise<void> => {
    const assetUrl = target?.assetUrl ?? updateInfo?.assetUrl
    const version = target?.version ?? updateInfo?.latest
    if (installingRef.current || !assetUrl) return
    installingRef.current = true
    setInstalling(true)
    try {
      const res = await zapretInstallUpdate(assetUrl, version)
      toast.success(target ? 'Версия Zapret установлена' : 'Zapret обновлён', {
        description: `Версия ${res.installedVersion ?? version} — стратегий: ${res.strategies}`,
        style: POWER_ON_BANNER_STYLE
      })
      refreshStrategies()
      void refreshCustom()
      if (zapret && active) {
        const fresh = await zapretListStrategies().catch(() => [])
        if (!fresh.some((s) => s.file === active)) {
          // Свежий конфиг, а не снимок до обновления: иначе откатывалась и версия.
          const cfgNow = await getAppConfig()
          await patchAppConfig({ zapret: { ...(cfgNow.zapret ?? zapret), activeStrategy: undefined } })
        }
      }
      const fresh = await zapretCheckUpdate(true).catch(() => null)
      setUpdateInfo(fresh)
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
    // Стратегию, не прошедшую проверку, всё равно можно выбрать: сеть и провайдер меняются.
    if (labBusy || file === active) return
    try {
      await patchAppConfig({ zapret: { ...zapret!, activeStrategy: file } })
    } catch (e) {
      toast.error('Не удалось выбрать стратегию', { description: e instanceof Error ? e.message : String(e) })
      return
    }
    // Zapret работает — перезапускаем с новой стратегией (macOS — без пароля, перезапуском движка).
    if (status.state === 'running') {
      try {
        await zapretRestart()
        toast.success(`Стратегия «${displayName(file)}» включена`, { style: POWER_ON_BANNER_STYLE })
      } catch (e) {
        if (isLinux) await patchAppConfig({ zapret: { ...zapret!, activeStrategy: active } }).catch(() => void 0)
        toast.error('Не удалось переключить стратегию', { description: e instanceof Error ? e.message : String(e) })
      }
    }
    if (!autoStartRef.current) return
    // Одноразово: повторный выбор на этой странице не запускает и не уводит на главную.
    autoStartRef.current = false
    try {
      await zapretStart()
      navigate('/home')
    } catch (e) {
      toast.error('Не удалось запустить Zapret', { description: e instanceof Error ? e.message : String(e) })
    }
  }

  const startAutopick = (): void => {
    if (isLinux) {
      setTab('strategies')
      startTest(false, undefined, true)
      return
    }
    setAutopickOpen(true)
    if (picking) return
    void labAutopickStart().catch((e) => {
      setAutopickOpen(false)
      toast.error('Автоподбор не запущен', { description: e instanceof Error ? e.message : String(e) })
    })
  }

  const visibleTabs = useMemo(() => TABS
    .filter((t) => !isMac || !t.win)
    .map((t) => isLinux ? {
      ...t,
      hint: t.id === 'settings' ? 'Системная служба Linux и источник сборки'
        : t.id === 'lists' ? 'Домены для обработки и исключения'
        : t.id === 'builder' ? 'Свой вариант на основе профиля Flowseal'
        : 'Стратегии Flowseal для Linux и проверка сайтов'
    } : t), [])

  const busyReason = isTestRunning
    ? 'Идёт проверка стратегий — подождите или остановите её'
    : picking
      ? 'Идёт автоподбор — подождите или остановите его'
      : checking
        ? 'Идёт проверка стратегии из конструктора'
        : 'Подождите завершения переключения Zapret'
  const cardsDisabled = labBusy || status.state === 'starting' || status.state === 'stopping'

  // ---- Клавиша питания
  const [pending, setPending] = useState<boolean | null>(null)
  const toggle = async (): Promise<void> => {
    if (pending !== null || labBusy) return
    const next = !(status.state === 'running' || status.state === 'starting')
    if (next && !active) {
      toast.info('Сначала выберите стратегию', { description: isMac ? 'Каталог — ниже.' : 'Или нажмите «Подобрать автоматически».' })
      setTab('strategies')
      return
    }
    setPending(next)
    try {
      await (next ? zapretStart() : zapretStop())
    } catch {
      /* ошибку показывает пульт (lastError) */
    } finally {
      setPending(null)
    }
  }

  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const manualCheck = async (): Promise<void> => {
    if (checkingUpdate) return
    setCheckingUpdate(true)
    try {
      await runCheckUpdate(true)
    } finally {
      setCheckingUpdate(false)
    }
  }

  useEffect(() => {
    void refreshZapretMeta()
  }, [])

  const ownName = active && active.startsWith(CUSTOM_PREFIX) && active.endsWith(').bat') ? active.slice(CUSTOM_PREFIX.length, -').bat'.length) : null
  const activeScore = (active && testReport?.results?.[active]) || null
  const version = (isLinux ? localVersion : zapret?.installedVersion ?? updateInfo?.installed ?? localVersion) ?? null

  return (
    <BasePage
      title="Zapret"
      header={
        isLinux ? undefined : showBanner && updateInfo ? (
          <div className="mr-1 flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              data-tour="zapret-update"
              disabled={installing}
              onClick={() => setUpdateDialogOpen(true)}
              title={formatInstalledVersion(updateInfo.installed)}
              className="h-8 gap-1.5 rounded-lg border-primary/45 text-xs"
            >
              {installing ? <Loader2 className="size-3.5 animate-spin text-primary" /> : <Sparkles className="size-3.5 text-primary" />}
              {installing ? 'Устанавливаем Zapret…' : 'Обновить Zapret'}
              {!installing && (
                <span className="rounded-md bg-primary px-1.5 py-px text-[10.5px] font-bold text-primary-foreground tabular-nums">v{updateInfo.latest}</span>
              )}
            </Button>
            {!installing && (
              <Button variant="ghost" size="icon" className="size-8 rounded-lg" onClick={dismissUpdate} title="Позже: не напоминать об этой версии" aria-label="Позже">
                <X className="size-3.5" />
              </Button>
            )}
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => void manualCheck()}
            disabled={checkingUpdate || installing}
            title="Проверить, вышла ли новая сборка Zapret"
            className="mr-1 h-8 rounded-lg text-xs"
          >
            <RefreshCw className={cn('size-3.5', checkingUpdate && 'animate-spin')} />
            {checkingUpdate ? 'Проверяем…' : 'Проверить обновления'}
          </Button>
        )
      }
    >
      <ComponentUpdateDialog
        component="zapret"
        open={updateDialogOpen}
        info={updateInfo ?? { installed: zapret?.installedVersion, latest: zapret?.installedVersion, hasUpdate: false }}
        onInstall={installUpdate}
        onLater={dismissUpdate}
        onClose={() => setUpdateDialogOpen(false)}
      />
      {hasWindowsBuilder && <ZapretAutopickDialog />}
      <div className={cn('mx-auto flex w-full max-w-[1080px] flex-col lz-page-gap lz-page-x pb-5', tab === 'strategies' && 'h-full')}>
        <ZapretConsole
          status={status}
          pending={pending}
          isMac={!hasWindowsBuilder}
          strategy={active ? (isLinux ? strategies.find((item) => item.file === active)?.title ?? active : ownName ?? active.replace(/\.bat$/i, '')) : null}
          own={!!ownName}
          score={activeScore}
          labBusy={labBusy}
          busyReason={busyReason}
          picking={picking || catalogAutopickRunning}
          catalogAutopick={isLinux}
          testRunning={isTestRunning}
          checking={checking}
          version={version}
          update={showBanner && updateInfo?.latest ? { latest: updateInfo.latest } : null}
          onToggle={() => void toggle()}
          onChange={() => {
            setTab('strategies')
            setFocusSignal((n) => n + 1)
          }}
          onAutopick={startAutopick}
          onVersions={() => setUpdateDialogOpen(true)}
          onSettings={() => setTab('settings')}
        />

        <div className="flex shrink-0 flex-wrap items-center gap-3">
          <Segmented
            items={visibleTabs.map((t) => ({ id: t.id, label: t.label, icon: t.icon, title: t.hint }))}
            value={tab}
            onChange={setTab}
            aria-label="Разделы Zapret"
            data-tour="zapret-tabs"
            className={isMac ? 'w-[360px] max-w-full' : 'w-[480px] max-w-full'}
          />
          <span className="lz-onwall min-w-0 text-[12px]">{visibleTabs.find((t) => t.id === tab)?.hint}</span>
        </div>

        {tab === 'strategies' && (
          <ZapretCatalog
            strategies={strategies}
            active={active}
            isMac={!hasWindowsBuilder}
            report={testReport}
            progress={testProgress}
            testRunning={isTestRunning}
            testStopping={isTestStopping}
            onPick={(f) => void pickStrategy(f)}
            onStartTest={startTest}
            onStopTest={stopTest}
            onResetTest={() => void resetTestResults()}
            onChanged={refreshStrategies}
            focusSignal={focusSignal}
          />
        )}

        {tab === 'builder' && hasWindowsBuilder && <ZapretBuilder disabled={isTestRunning || picking} disabledReason={busyReason} onSaved={refreshStrategies} />}
        {tab === 'builder' && isLinux &&
          <LinuxZapretBuilder strategies={strategies} disabled={cardsDisabled} onChanged={refreshStrategies} />}

        {tab === 'lists' && (isLinux
          ? <LinuxZapretLists disabled={cardsDisabled} />
          : <ZapretIpListCard disabled={cardsDisabled} disabledReason={busyReason} />)}

        {tab === 'settings' && (
          <div className="grid items-start gap-3 lg:grid-cols-2">
            {isLinux ? (<>
              <section className="rounded-2xl border border-border/70 bg-card p-5">
                <h2 className="text-sm font-semibold">Системная служба Linux</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Zapret обрабатывает исходящий трафик этого компьютера. Для управления службой Linux может запросить подтверждение администратора.
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Служба продолжает работать после закрытия LAZEYKA. Остановите её кнопкой питания в Zapret или в пульте.
                </p>
                <p className="mt-3 text-xs text-muted-foreground">
                  Движок bol-van nfqws{version ? ` ${version}` : ''}. Стратегии адаптированы из Flowseal. Обновление входит в пакет LAZEYKA.
                </p>
              </section>
              <LinuxGameFilterCard disabled={cardsDisabled} />
            </>) : isMac ? (
              <>
                <ZapretMacServiceCard disabled={cardsDisabled} />
                <ZapretAutopilotCard />
              </>
            ) : (
              <ZapretServiceSettingsCard
                focusFilters={focusFiltersRef.current}
                disabled={cardsDisabled}
                disabledReason={busyReason}
                autoUpdateCheck={zapret?.autoUpdateCheck !== false}
                onAutoUpdateCheckChange={(v) => {
                  if (!zapret) return
                  void patchAppConfig({ zapret: { ...zapret, autoUpdateCheck: v } })
                }}
                onManualCheckUpdate={() => runCheckUpdate(true)}
                aside={<ZapretAutopilotCard />}
              />
            )}
          </div>
        )}
      </div>
    </BasePage>
  )
}

export default Zapret
