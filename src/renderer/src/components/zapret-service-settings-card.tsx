import React, { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Binary,
  CheckCircle2,
  ChevronDown,
  FileCode2,
  FlaskConical,
  Gamepad2,
  Loader2,
  Network,
  Play,
  RefreshCw,
  Server,
  Sparkles,
  Stethoscope,
  Trash2,
  Wrench
} from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import GamePortsEditor from '@renderer/components/game-ports-editor'
import { Segmented } from '@renderer/components/lz'
import { Rows, SettingRow, SettingsGroup, SubHead, SwitchRow } from '@renderer/components/settings/setting-row'
import { useZapretMeta } from '@renderer/components/zapret/zapret-meta'
import { cn, POWER_ON_BANNER_STYLE } from '@renderer/lib/utils'
import {
  zapretGetGameFilter,
  zapretSetGameFilter,
  zapretGetIpsetFilter,
  zapretSetIpsetFilter,
  zapretUpdateIpsetList,
  zapretGetActiveFakes,
  zapretSetActiveFake,
  zapretRunDiagnostics,
  zapretFixDiagnostic,
  zapretGetWindowsServiceStatus,
  zapretInstallWindowsService,
  zapretRemoveWindowsService,
  zapretCheckHostsFile,
  zapretUpdateHostsFile,
  zapretLaunchTestsScript,
  zapretSetCheckUpdatesFlag,
  type GameFilterMode,
  type IpsetFilterMode,
  type IpsetFilterSnapshot,
  type ActiveFakesState,
  type DiagnosticReport,
  type ZapretServiceStatus,
  type HostsCheckResult
} from '@renderer/utils/ipc'

interface Props {
  disabled?: boolean
  disabledReason?: string
  autoUpdateCheck: boolean
  onAutoUpdateCheckChange: (v: boolean) => void
  onManualCheckUpdate: () => Promise<void>
  /** Прокрутить к Game Filter и IPset и подсветить их (переход из «Регионов Valve»). */
  focusFilters?: boolean
  /** Блок под «Играми и IP» в левой колонке (автопилот и игровой режим). */
  aside?: React.ReactNode
}

const GAME_FILTER_OPTIONS: { id: GameFilterMode; label: string; title: string }[] = [
  { id: 'off', label: 'Выкл', title: 'Не расширять фильтр на игровые порты' },
  { id: 'all', label: 'Оба', title: 'Расширить фильтр на игровые TCP и UDP порты' },
  { id: 'tcp', label: 'TCP', title: 'Расширить фильтр только на игровые TCP порты' },
  { id: 'udp', label: 'UDP', title: 'Расширить фильтр только на игровые UDP порты (голос в играх/Discord)' }
]

const IPSET_FILTER_OPTIONS: { id: IpsetFilterMode; label: string; title: string }[] = [
  { id: 'loaded', label: 'Список', title: 'Фильтр применяется только к загруженным IP из списка' },
  { id: 'none', label: 'Выкл', title: 'Фильтр не применяется — как будто список пуст из заглушки' },
  { id: 'any', label: 'Все IP', title: 'Фильтр применяется ко всем IP без ограничений (самый широкий режим)' }
]

const selectCls =
  'h-8 max-w-[190px] cursor-pointer truncate rounded-lg border border-foreground/[0.1] bg-foreground/[0.04] px-2 text-[12px] text-foreground outline-none focus-visible:border-primary/60 disabled:cursor-not-allowed disabled:opacity-50'

const ZapretServiceSettingsCard: React.FC<Props> = ({
  disabled = false,
  disabledReason,
  autoUpdateCheck,
  onAutoUpdateCheckChange,
  onManualCheckUpdate,
  focusFilters = false,
  aside
}) => {
  const patchMeta = useZapretMeta((s) => s.patch)
  const [portsOpen, setPortsOpen] = useState(false)
  // Режим подсказки (переход из «Регионов Valve»): подсвечиваем только то, что
  // ещё не включено, и выключаем подсветку, как только всё выставлено.
  const [guide, setGuide] = useState(focusFilters)
  const filtersRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!focusFilters) return
    // Ждём отрисовки вкладки, потом прокручиваем к фильтрам.
    const t = setTimeout(() => {
      filtersRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 150)
    return () => clearTimeout(t)
  }, [focusFilters])
  const [gameFilter, setGameFilterState] = useState<GameFilterMode | null>(null)
  const [ipset, setIpset] = useState<IpsetFilterSnapshot | null>(null)
  const [fakes, setFakes] = useState<ActiveFakesState | null>(null)
  const [serviceStatus, setServiceStatus] = useState<ZapretServiceStatus | null>(null)
  const [hostsResult, setHostsResult] = useState<HostsCheckResult | null>(null)
  const [diagnostics, setDiagnostics] = useState<DiagnosticReport | null>(null)

  const [busyGame, setBusyGame] = useState(false)
  const [busyIpset, setBusyIpset] = useState<IpsetFilterMode | 'update' | null>(null)
  const [busyFake, setBusyFake] = useState<'discord' | 'game' | null>(null)
  const [busyService, setBusyService] = useState<'install' | 'remove' | null>(null)
  const [busyHosts, setBusyHosts] = useState<'check' | 'update' | null>(null)
  const [busyDiag, setBusyDiag] = useState(false)
  const [busyFix, setBusyFix] = useState<string | null>(null)
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const loadedRef = useRef(false)

  const gameNeedsUdp = gameFilter !== null && gameFilter !== 'all' && gameFilter !== 'udp'
  const ipsetOff = ipset !== null && ipset.mode === 'none'
  const highlightGame = guide && gameNeedsUdp
  const highlightIpset = guide && ipsetOff

  useEffect(() => {
    // Оба условия выполнены — подсказка больше не нужна, даже если потом
    // пользователь сам переключит что-то обратно.
    if (guide && gameFilter !== null && ipset !== null && !gameNeedsUdp && !ipsetOff) setGuide(false)
  }, [guide, gameFilter, ipset, gameNeedsUdp, ipsetOff])

  const refresh = async (): Promise<void> => {
    try {
      const [gf, ip, fk, svc, hst] = await Promise.all([
        zapretGetGameFilter(),
        zapretGetIpsetFilter(),
        zapretGetActiveFakes(),
        zapretGetWindowsServiceStatus(),
        zapretCheckHostsFile()
      ])
      setGameFilterState(gf)
      setIpset(ip)
      setFakes(fk)
      setServiceStatus(svc)
      setHostsResult(hst)
    } catch {
      setGameFilterState(null)
      setIpset(null)
      setFakes(null)
      setServiceStatus(null)
      setHostsResult(null)
    }
  }

  useEffect(() => {
    if (loadedRef.current) return
    loadedRef.current = true
    void refresh()
  }, [])

  const pickGameFilter = async (mode: GameFilterMode): Promise<void> => {
    if (busyGame || mode === gameFilter) return
    setBusyGame(true)
    try {
      const next = await zapretSetGameFilter(mode)
      setGameFilterState(next)
      patchMeta({ gameFilter: next })
      toast.success('Game Filter обновлён', {
        description: 'Если Zapret включён, он перезапущен — изменения уже действуют',
        style: POWER_ON_BANNER_STYLE
      })
    } catch (e) {
      toast.error('Не удалось изменить Game Filter', {
        description: e instanceof Error ? e.message : String(e)
      })
    } finally {
      setBusyGame(false)
    }
  }

  const pickIpsetFilter = async (mode: IpsetFilterMode): Promise<void> => {
    if (busyIpset || mode === ipset?.mode) return
    setBusyIpset(mode)
    try {
      const next = await zapretSetIpsetFilter(mode)
      setIpset(next)
      patchMeta({ ipset: next })
      toast.success('IPset Filter обновлён', {
        description: 'Если Zapret включён, он перезапущен — изменения уже действуют',
        style: POWER_ON_BANNER_STYLE
      })
    } catch (e) {
      toast.error('Не удалось изменить IPset Filter', {
        description: e instanceof Error ? e.message : String(e)
      })
    } finally {
      setBusyIpset(null)
    }
  }

  const updateList = async (): Promise<void> => {
    if (busyIpset) return
    setBusyIpset('update')
    const tId = toast.loading('Скачиваем ipset-список…')
    try {
      const next = await zapretUpdateIpsetList()
      setIpset(next)
      patchMeta({ ipset: next })
      toast.success(`Список обновлён — ${next.lines} записей`, { id: tId, style: POWER_ON_BANNER_STYLE })
    } catch (e) {
      toast.error('Не удалось обновить ipset-список', {
        id: tId,
        description: e instanceof Error ? e.message : String(e)
      })
    } finally {
      setBusyIpset(null)
    }
  }

  const handleSelectFake = async (target: 'discord' | 'game', fakeName: string): Promise<void> => {
    if (busyFake) return
    setBusyFake(target)
    const label = target === 'discord' ? 'Discord UDP Fake' : 'Game UDP Fake'
    try {
      const next = await zapretSetActiveFake(target, fakeName)
      setFakes(next)
      toast.success(`${label} заменён на ${fakeName}`, {
        description: 'Перезапустите Zapret для применения нового фейка',
        style: POWER_ON_BANNER_STYLE
      })
    } catch (e) {
      toast.error(`Не удалось заменить ${label}`, {
        description: e instanceof Error ? e.message : String(e)
      })
    } finally {
      setBusyFake(null)
    }
  }

  const installService = async (): Promise<void> => {
    if (busyService) return
    setBusyService('install')
    const tId = toast.loading('Устанавливаем Windows-службу Zapret…')
    try {
      const next = await zapretInstallWindowsService()
      setServiceStatus(next)
      patchMeta({ service: next })
      toast.success('Служба Zapret успешно установлена и запущена', {
        id: tId,
        description: 'Zapret теперь автоматически работает как системная служба Windows',
        style: POWER_ON_BANNER_STYLE
      })
    } catch (e) {
      toast.error('Не удалось установить службу Zapret', {
        id: tId,
        description: e instanceof Error ? e.message : String(e)
      })
    } finally {
      setBusyService(null)
    }
  }

  const removeService = async (): Promise<void> => {
    if (busyService) return
    setBusyService('remove')
    const tId = toast.loading('Удаляем службы Zapret и WinDivert…')
    try {
      const next = await zapretRemoveWindowsService()
      setServiceStatus(next)
      patchMeta({ service: next })
      if (next.installed) throw new Error('Служба осталась в системе. Перезагрузите компьютер и попробуйте снова.')
      toast.success('Службы успешно удалены', {
        id: tId,
        description: 'Службы Zapret и WinDivert остановлены и очищены',
        style: POWER_ON_BANNER_STYLE
      })
    } catch (e) {
      toast.error('Не удалось удалить службы', {
        id: tId,
        description: e instanceof Error ? e.message : String(e)
      })
    } finally {
      setBusyService(null)
    }
  }

  const updateHosts = async (): Promise<void> => {
    if (busyHosts) return
    setBusyHosts('update')
    const tId = toast.loading('Синхронизируем файл hosts с Flowseal…')
    try {
      const res = await zapretUpdateHostsFile()
      toast.success(res.message, { id: tId, style: POWER_ON_BANNER_STYLE })
      const next = await zapretCheckHostsFile()
      setHostsResult(next)
    } catch (e) {
      toast.error('Не удалось обновить файл hosts', {
        id: tId,
        description: e instanceof Error ? e.message : String(e)
      })
    } finally {
      setBusyHosts(null)
    }
  }

  const runTests = async (): Promise<void> => {
    try {
      await zapretLaunchTestsScript()
      toast.success('Запущено тестирование в окне PowerShell', {
        style: POWER_ON_BANNER_STYLE
      })
    } catch (e) {
      toast.error('Не удалось запустить тест', {
        description: e instanceof Error ? e.message : String(e)
      })
    }
  }

  const runDiagnostics = async (): Promise<void> => {
    if (busyDiag) return
    setBusyDiag(true)
    try {
      const rep = await zapretRunDiagnostics()
      setDiagnostics(rep)
      if (rep.hasIssues) {
        toast.warning('Диагностика завершена', {
          description: 'Обнаружены потенциальные проблемы или предупреждения'
        })
      } else {
        toast.success('Диагностика пройдена без ошибок', {
          description: 'Все системные службы и настройки в порядке',
          style: POWER_ON_BANNER_STYLE
        })
      }
    } catch (e) {
      toast.error('Ошибка при запуске диагностики', {
        description: e instanceof Error ? e.message : String(e)
      })
    } finally {
      setBusyDiag(false)
    }
  }

  const applyFix = async (action: string, label: string): Promise<void> => {
    if (busyFix) return
    setBusyFix(action)
    const tId = toast.loading(`Выполняем: ${label}…`)
    try {
      const res = await zapretFixDiagnostic(action)
      toast.success(res.message, { id: tId, style: POWER_ON_BANNER_STYLE })
      const rep = await zapretRunDiagnostics()
      setDiagnostics(rep)
      const hst = await zapretCheckHostsFile()
      setHostsResult(hst)
    } catch (e) {
      toast.error('Не удалось выполнить действие', {
        id: tId,
        description: e instanceof Error ? e.message : String(e)
      })
    } finally {
      setBusyFix(null)
    }
  }

  const handleAutoUpdateToggle = (checked: boolean): void => {
    onAutoUpdateCheckChange(checked)
    void zapretSetCheckUpdatesFlag(checked)
  }

  const runManualCheck = async (): Promise<void> => {
    if (checkingUpdate) return
    setCheckingUpdate(true)
    try {
      await onManualCheckUpdate()
    } finally {
      setCheckingUpdate(false)
    }
  }

  const ipsetLoadedLocked = !!ipset && ipset.mode !== 'loaded' && !ipset.hasBackup
  const svcText = serviceStatus?.installed
    ? serviceStatus.running
      ? `Работает и запускается вместе с Windows${serviceStatus.strategyName ? ` · стратегия ${serviceStatus.strategyName}` : ''}`
      : 'Установлена, но остановлена'
    : 'Не установлена. Обход будет работать в фоне, даже когда LAZEYKA закрыта.'

  return (
    <>
      <div className="flex min-w-0 flex-col gap-3">
        <SettingsGroup
          title="Игры и IP-адреса"
          hint="Что ещё, кроме сайтов из списков, обрабатывает Zapret: игровые порты и адреса из IPset."
          data-tour="zapret-game-filter"
        >
          <Rows>
            <div ref={filtersRef} className={cn('-mx-1 rounded-xl px-1 transition-shadow duration-300', highlightGame && 'ring-2 ring-primary/70')}>
              <SettingRow
                id="zapret-game-filter"
                icon={<Gamepad2 />}
                title="Game Filter"
                desc="Игровые порты: игры и голос Discord"
                hint="Расширяет фильтрацию на игровые порты (по умолчанию все 1024–65535). Нужен играм и голосу в Discord, которые используют случайные порты. Ниже можно оставить только порты своих игр."
                on={gameFilter !== null && gameFilter !== 'off'}
                control={
                  gameFilter === null ? (
                    <span className="text-[12px] text-muted-foreground">не прочитан</span>
                  ) : (
                    <Segmented
                      size="sm"
                      items={GAME_FILTER_OPTIONS}
                      value={gameFilter}
                      onChange={(v) => {
                        if (!(disabled || busyGame)) void pickGameFilter(v)
                      }}
                      aria-label="Game Filter"
                      className={cn('w-[210px]', (disabled || busyGame) && 'pointer-events-none opacity-60')}
                    />
                  )
                }
                below={
                  gameFilter !== null ? (
                    <div>
                      <button
                        type="button"
                        onClick={() => setPortsOpen((v) => !v)}
                        className="inline-flex cursor-pointer items-center gap-1 text-[12px] font-semibold text-primary hover:underline"
                        aria-expanded={portsOpen}
                      >
                        <ChevronDown className={cn('size-3.5 transition-transform', !portsOpen && '-rotate-90')} />
                        Только порты своих игр
                      </button>
                      {portsOpen && (
                        <GamePortsEditor
                          disabled={disabled}
                          mode={gameFilter}
                          onModeChange={(m) => {
                            setGameFilterState(m)
                            patchMeta({ gameFilter: m })
                          }}
                        />
                      )}
                    </div>
                  ) : undefined
                }
              />
            </div>
            <div className={cn('-mx-1 rounded-xl px-1 transition-shadow duration-300', highlightIpset && 'ring-2 ring-primary/70')}>
              <SettingRow
                id="zapret-ipset"
                icon={<Network />}
                title="IPset"
                desc={ipset ? `В списке ${ipset.lines.toLocaleString('ru-RU')} IP` : 'Не удалось прочитать lists/ipset-all.txt'}
                hint="Определяет, к каким IP применяется game-фильтр: только к списку, ни к одному или ко всем. «Список» станет доступен после «Обновить список»."
                on={!!ipset && ipset.mode !== 'none'}
                control={
                  ipset ? (
                    <Segmented
                      size="sm"
                      items={IPSET_FILTER_OPTIONS.map((o) =>
                        o.id === 'loaded' && ipsetLoadedLocked ? { ...o, title: 'Сначала загрузите список кнопкой «Обновить список»' } : o
                      )}
                      value={ipset.mode}
                      onChange={(v) => {
                        if (disabled || busyIpset) return
                        if (v === 'loaded' && ipsetLoadedLocked) {
                          toast.info('Сначала загрузите список', { description: 'Кнопка «Обновить список» ниже скачает его у Flowseal.' })
                          return
                        }
                        void pickIpsetFilter(v)
                      }}
                      aria-label="IPset"
                      className={cn('w-[210px]', (disabled || !!busyIpset) && 'pointer-events-none opacity-60')}
                    />
                  ) : undefined
                }
              />
            </div>
            <SettingRow
              id="zapret-ipset-update"
              icon={<RefreshCw />}
              title="Список IP от Flowseal"
              desc="Скачать свежий список и включить его"
              control={
                <Button size="sm" variant="outline" onClick={() => void updateList()} disabled={disabled || !!busyIpset} className="h-8 rounded-lg text-xs">
                  {busyIpset === 'update' ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                  Обновить список
                </Button>
              }
            />
          </Rows>
        </SettingsGroup>
        {aside}
      </div>

      <SettingsGroup
        title="Служба и обслуживание"
        hint="Служба Windows, обновления сборки, файл hosts и проверка системы."
        sub={disabled ? disabledReason : undefined}
        data-tour="zapret-settings"
      >
        <Rows>
          <SettingRow
            id="zapret-service"
            icon={<Server />}
            title="Служба Windows"
            desc={svcText}
            hint="Установка Zapret системной службой Windows: обход работает всегда, в фоне, даже при закрытой LAZEYKA."
            on={!!serviceStatus?.running}
            control={
              <>
                {serviceStatus?.installed && !serviceStatus.running && <AlertTriangle className="size-4 text-st-warn-text" aria-label="Служба остановлена" />}
                <Button
                  size="sm"
                  variant={serviceStatus?.installed ? 'outline' : 'default'}
                  onClick={() => void installService()}
                  disabled={disabled || !!busyService}
                  className="h-8 rounded-lg text-xs"
                >
                  {busyService === 'install' ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
                  {serviceStatus?.installed ? 'Переустановить' : 'Установить'}
                </Button>
                {serviceStatus?.installed && (
                  <Button
                    size="icon-sm"
                    variant="outline"
                    onClick={() => void removeService()}
                    disabled={disabled || !!busyService}
                    title="Удалить службы Zapret и WinDivert"
                    aria-label="Удалить службу"
                    className="size-8 rounded-lg text-st-err-text hover:border-st-err/40 hover:text-st-err-text"
                  >
                    {busyService === 'remove' ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                  </Button>
                )}
              </>
            }
          />
          <SwitchRow
            id="zapret-auto-update"
            icon={<Sparkles />}
            title="Проверять обновления сборки"
            desc="Когда вы открываете этот раздел"
            checked={autoUpdateCheck}
            disabled={disabled}
            onChange={handleAutoUpdateToggle}
            aside={
              <Button size="sm" variant="outline" onClick={() => void runManualCheck()} disabled={disabled || checkingUpdate} className="h-8 rounded-lg text-xs">
                {checkingUpdate ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                Проверить
              </Button>
            }
          />
          <SettingRow
            id="zapret-hosts"
            icon={<FileCode2 />}
            title="Файл hosts"
            desc={
              hostsResult?.needsUpdate ? (
                <span className="text-st-warn-text">
                  Нужно обновить{hostsResult.hasYoutubeEntries ? ': есть старые записи youtube.com' : ''}
                </span>
              ) : hostsResult ? (
                'Записи Flowseal на месте'
              ) : (
                'Сверка с записями Flowseal'
              )
            }
            hint="Сверка и дополнение системного файла C:\Windows\System32\drivers\etc\hosts записями Flowseal."
            on={!!hostsResult && !hostsResult.needsUpdate}
            control={
              <Button size="sm" variant="outline" onClick={() => void updateHosts()} disabled={disabled || !!busyHosts} className="h-8 rounded-lg text-xs">
                {busyHosts === 'update' ? <Loader2 className="size-3.5 animate-spin" /> : <FileCode2 className="size-3.5" />}
                Обновить
              </Button>
            }
          />
          <SettingRow
            id="zapret-diagnostics"
            icon={<Stethoscope />}
            title="Диагностика"
            desc={
              diagnostics
                ? diagnostics.hasIssues
                  ? `Есть что поправить: ${diagnostics.items.filter((i) => i.status !== 'ok').length}`
                  : 'Всё в порядке'
                : 'Службы Windows, сеть, TCP Timestamps, прокси и мешающие программы'
            }
            on={!!diagnostics && !diagnostics.hasIssues}
            control={
              <Button size="sm" variant="outline" onClick={() => void runDiagnostics()} disabled={disabled || busyDiag} className="h-8 rounded-lg text-xs">
                {busyDiag ? <Loader2 className="size-3.5 animate-spin" /> : <Activity className="size-3.5" />}
                Проверить
              </Button>
            }
            below={
              diagnostics ? (
                <ul className="divide-y divide-foreground/[0.06] rounded-xl border border-foreground/[0.08] bg-foreground/[0.03]">
                  {diagnostics.items.map((item) => (
                    <li key={item.id} className="flex items-center gap-2.5 px-3 py-2">
                      {item.status === 'ok' ? (
                        <CheckCircle2 className="size-4 shrink-0 text-st-ok-text" />
                      ) : item.status === 'warn' ? (
                        <AlertTriangle className="size-4 shrink-0 text-st-warn-text" />
                      ) : (
                        <AlertCircle className="size-4 shrink-0 text-st-err-text" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="text-[12.5px] font-semibold text-foreground">{item.title}</div>
                        <div className="text-[11.5px] text-muted-foreground">{item.message}</div>
                      </div>
                      {item.fixAction && item.fixLabel && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void applyFix(item.fixAction!, item.fixLabel!)}
                          disabled={disabled || !!busyFix}
                          className="h-7 shrink-0 rounded-lg text-[11px]"
                        >
                          {busyFix === item.fixAction ? <Loader2 className="size-3 animate-spin" /> : <Wrench className="size-3" />}
                          {item.fixLabel}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              ) : undefined
            }
          />
          <SettingRow
            id="zapret-ps-tests"
            icon={<FlaskConical />}
            title="Тест Flowseal в PowerShell"
            desc="Скрипт test zapret.ps1 в отдельном окне — для подробного разбора"
            control={
              <Button size="sm" variant="outline" onClick={() => void runTests()} disabled={disabled} className="h-8 rounded-lg text-xs">
                <FlaskConical className="size-3.5" />
                Запустить
              </Button>
            }
          />
        </Rows>
        <SubHead>Подделки UDP</SubHead>
        {fakes && fakes.available.length > 0 ? (
          <Rows>
            {(
              [
                ['discord', 'Голос Discord', fakes.discordActive, 'bin/ACTIVE_DISCORD_UDP.bin'],
                ['game', 'Игры (Game Filter)', fakes.gameActive, 'bin/ACTIVE_GAME_UDP.bin']
              ] as const
            ).map(([target, label, value, file]) => (
              <SettingRow
                key={target}
                id={`zapret-fake-${target}`}
                icon={<Binary />}
                title={label}
                desc={`Шаблон поддельного пакета · ${file}`}
                control={
                  <select
                    className={selectCls}
                    value={value || ''}
                    disabled={disabled || busyFake === target}
                    title={value || 'Не выбран'}
                    aria-label={`Подделка: ${label}`}
                    onChange={(e) => {
                      if (e.target.value) void handleSelectFake(target, e.target.value)
                    }}
                  >
                    <option value="" disabled>
                      Выберите…
                    </option>
                    {fakes.available.map((f) => (
                      <option key={f.name} value={f.name}>
                        {f.name} ({f.size} Б)
                      </option>
                    ))}
                  </select>
                }
              />
            ))}
          </Rows>
        ) : (
          <p className="px-3 pb-2 text-[12px] text-muted-foreground">Шаблоны подделок не найдены в папке bin.</p>
        )}
      </SettingsGroup>
    </>
  )
}

export default ZapretServiceSettingsCard
