import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Binary,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileCode2,
  FlaskConical,
  Gamepad2,
  Globe2,
  Loader2,
  Play,
  RefreshCw,
  Server,
  Settings2,
  ShieldCheck,
  Stethoscope,
  Trash2,
  Wrench
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { Button } from '@renderer/components/ui/button'
import { Switch } from '@renderer/components/ui/switch'
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
}

const GAME_FILTER_OPTIONS: { value: GameFilterMode; label: string; title: string }[] = [
  { value: 'off', label: 'Выкл', title: 'Не расширять диапазон портов 1024-65535' },
  { value: 'all', label: 'TCP + UDP', title: 'Расширить фильтр на TCP и UDP порты 1024-65535' },
  { value: 'tcp', label: 'TCP', title: 'Расширить фильтр только на TCP порты 1024-65535' },
  { value: 'udp', label: 'UDP', title: 'Расширить фильтр только на UDP порты 1024-65535 (голос в играх/Discord)' }
]

const IPSET_FILTER_OPTIONS: { value: IpsetFilterMode; label: string; title: string }[] = [
  { value: 'loaded', label: 'Список', title: 'Фильтр применяется только к загруженным IP из списка' },
  { value: 'none', label: 'Выкл', title: 'Фильтр не применяется — как будто список пуст из заглушки' },
  { value: 'any', label: 'Все IP', title: 'Фильтр применяется ко всем IP без ограничений (самый широкий режим)' }
]

const ZapretServiceSettingsCard: React.FC<Props> = ({
  disabled = false,
  disabledReason,
  autoUpdateCheck,
  onAutoUpdateCheckChange,
  onManualCheckUpdate
}) => {
  const [open, setOpen] = useState(false)
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
      toast.success('Game Filter обновлён', {
        description: 'Изменения применятся после перезапуска Zapret',
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
      toast.success('IPset Filter обновлён', {
        description: 'Изменения применятся после перезапуска Zapret',
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

  return (
    <Card className="cyber-card">
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <div className="min-w-0 flex-1">
          <CardTitle className="flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-muted-foreground" />
            Настройки Zapret (Service Manager)
          </CardTitle>
        </div>
        <Button
          variant={open ? 'secondary' : 'outline'}
          size="sm"
          disabled={disabled}
          title={disabled ? disabledReason : undefined}
          onClick={() => setOpen((v) => !v)}
          className="shrink-0"
        >
          {open
            ? <><ChevronDown className="h-3.5 w-3.5" /> Свернуть</>
            : <><ChevronRight className="h-3.5 w-3.5" /> Открыть</>}
        </Button>
      </CardHeader>

      {open && (
        <CardContent className="space-y-6 pt-0">
          {/* ================================================================ */}
          {/* 1. SERVICE: Windows Service Management                          */}
          {/* ================================================================ */}
          <div>
            <div className="mb-2 flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
              <Server className="h-3.5 w-3.5" />
              Служба Windows (Автозапуск в фоне)
            </div>
            <p className="mb-2.5 text-xs text-muted-foreground">
              Установка Zapret в качестве системной службы Windows — обход будет работать всегда в фоновом режиме даже при закрытом LAZEYKA.
            </p>

            <div className="flex flex-col gap-3 rounded-xl border border-border/80 bg-card/50 backdrop-blur-md p-3.5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-foreground">Статус службы:</span>
                  {serviceStatus?.installed ? (
                    serviceStatus.running ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                        <CheckCircle2 className="size-3" /> Работает (автозапуск)
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-yellow-500/15 border border-yellow-500/30 px-2.5 py-0.5 text-xs font-semibold text-yellow-400">
                        <AlertTriangle className="size-3" /> Установлена (остановлена)
                      </span>
                    )
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-foreground/[0.06] border border-border/50 px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
                      Не установлена
                    </span>
                  )}
                </div>
                {serviceStatus?.strategyName && (
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    Стратегия службы: <span className="font-mono text-primary font-bold">{serviceStatus.strategyName}</span>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant={serviceStatus?.installed ? 'secondary' : 'default'}
                  onClick={() => { void installService() }}
                  disabled={disabled || !!busyService}
                  className="h-8 text-xs gap-1.5 rounded-xl"
                >
                  {busyService === 'install' ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
                  {serviceStatus?.installed ? 'Переустановить службу' : 'Установить службу'}
                </Button>
                {serviceStatus?.installed && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => { void removeService() }}
                    disabled={disabled || !!busyService}
                    className="h-8 text-xs text-rose-700 dark:text-rose-400 hover:text-rose-300 hover:border-rose-500/40 rounded-xl gap-1.5"
                  >
                    {busyService === 'remove' ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                    Удалить службу
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* ================================================================ */}
          {/* 2. SETTINGS: Game Filter & IPSet Filter                          */}
          {/* ================================================================ */}
          <div>
            <div className="mb-2 flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
              <Gamepad2 className="h-3.5 w-3.5" />
              Game Filter
            </div>
            <p className="mb-2 text-xs text-muted-foreground">
              Расширяет фильтрацию на порты 1024-65535 — помогает с играми и голосом в Discord,
              которые используют случайные порты.
            </p>
            {gameFilter === null ? (
              <p className="text-sm text-muted-foreground">Не удалось прочитать настройку.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {GAME_FILTER_OPTIONS.map((opt) => {
                  const active = gameFilter === opt.value
                  return (
                    <button
                      key={opt.value}
                      onClick={() => { void pickGameFilter(opt.value) }}
                      disabled={disabled || busyGame}
                      title={opt.title}
                      className={cn(
                        'rounded-md border px-2.5 py-1 text-xs font-medium transition',
                        active ? 'border-primary bg-primary/10 text-foreground' : 'border-border hover:bg-accent/30 text-muted-foreground',
                        (disabled || busyGame) && 'pointer-events-none opacity-50'
                      )}
                    >
                      {busyGame && active ? <Loader2 className="h-3 w-3 animate-spin inline" /> : opt.label}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          <div>
            <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
              IPset Filter
              {ipset && (
                <span className="ml-1.5 normal-case font-normal">
                  ({ipset.lines} IP в списке)
                </span>
              )}
            </div>
            <p className="mb-2 text-xs text-muted-foreground">
              Определяет, к каким IP применяется game-фильтр: только к списку ниже, ни к одному, или ко всем.
            </p>
            {ipset === null ? (
              <p className="text-sm text-muted-foreground">Не удалось прочитать lists/ipset-all.txt.</p>
            ) : (
              <div className="flex flex-wrap items-center gap-1.5">
                {IPSET_FILTER_OPTIONS.map((opt) => {
                  const active = ipset.mode === opt.value
                  const busy = busyIpset === opt.value
                  return (
                    <button
                      key={opt.value}
                      onClick={() => { void pickIpsetFilter(opt.value) }}
                      disabled={disabled || !!busyIpset || (opt.value === 'loaded' && !ipset.hasBackup && ipset.mode !== 'loaded')}
                      title={
                        opt.value === 'loaded' && !ipset.hasBackup && ipset.mode !== 'loaded'
                          ? 'Сначала загрузите список кнопкой «Обновить список»'
                          : opt.title
                      }
                      className={cn(
                        'rounded-md border px-2.5 py-1 text-xs font-medium transition',
                        active ? 'border-primary bg-primary/10 text-foreground' : 'border-border hover:bg-accent/30 text-muted-foreground',
                        (disabled || !!busyIpset) && 'pointer-events-none opacity-50'
                      )}
                    >
                      {busy ? <Loader2 className="h-3 w-3 animate-spin inline" /> : opt.label}
                    </button>
                  )
                })}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => { void updateList() }}
                  disabled={disabled || !!busyIpset}
                  className="ml-1"
                  title="Скачать свежий ipset-список у Flowseal и сделать его активным"
                >
                  {busyIpset === 'update' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  Обновить IPSet список
                </Button>
              </div>
            )}
          </div>

          {/* ================================================================ */}
          {/* 3. SETTINGS: Replace Active Fakes                               */}
          {/* ================================================================ */}
          <div>
            <div className="mb-2 flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
              <Binary className="h-3.5 w-3.5" />
              Активные фейки (UDP Fakes)
            </div>
            <p className="mb-3 text-xs text-muted-foreground">
              Выбор шаблонов поддельных UDP пакетов для обхода блокировок Discord и игровых сервисов.
            </p>

            {fakes && fakes.available.length > 0 ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-border bg-card/50 p-3">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-xs font-medium text-foreground">Discord UDP Fake</span>
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-mono text-primary truncate max-w-[140px]" title={fakes.discordActive || 'Не выбран'}>
                      {fakes.discordActive || 'Не выбран'}
                    </span>
                  </div>
                  <p className="mb-2 text-[11px] text-muted-foreground">
                    Файл: <code className="text-[10px]">bin/ACTIVE_DISCORD_UDP.bin</code>
                  </p>
                  <select
                    className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-primary"
                    value={fakes.discordActive || ''}
                    disabled={disabled || busyFake === 'discord'}
                    onChange={(e) => {
                      if (e.target.value) void handleSelectFake('discord', e.target.value)
                    }}
                  >
                    <option value="" disabled>Выберите фейк...</option>
                    {fakes.available.map((f) => (
                      <option key={f.name} value={f.name}>
                        {f.name} ({f.size} Б)
                      </option>
                    ))}
                  </select>
                </div>

                <div className="rounded-lg border border-border bg-card/50 p-3">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-xs font-medium text-foreground">Game Filter UDP Fake</span>
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-mono text-primary truncate max-w-[140px]" title={fakes.gameActive || 'Не выбран'}>
                      {fakes.gameActive || 'Не выбран'}
                    </span>
                  </div>
                  <p className="mb-2 text-[11px] text-muted-foreground">
                    Файл: <code className="text-[10px]">bin/ACTIVE_GAME_UDP.bin</code>
                  </p>
                  <select
                    className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-primary"
                    value={fakes.gameActive || ''}
                    disabled={disabled || busyFake === 'game'}
                    onChange={(e) => {
                      if (e.target.value) void handleSelectFake('game', e.target.value)
                    }}
                  >
                    <option value="" disabled>Выберите фейк...</option>
                    {fakes.available.map((f) => (
                      <option key={f.name} value={f.name}>
                        {f.name} ({f.size} Б)
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Шаблоны фейков не найдены в папке bin.</p>
            )}
          </div>

          {/* ================================================================ */}
          {/* 4. UPDATES: Hosts File Synchronization                           */}
          {/* ================================================================ */}
          <div>
            <div className="mb-2 flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
              <Globe2 className="h-3.5 w-3.5" />
              Синхронизация Hosts файла (Update Hosts File)
            </div>
            <p className="mb-2.5 text-xs text-muted-foreground">
              Сверка и дополнение системного файла <code className="text-[10px]">C:\Windows\System32\drivers\etc\hosts</code> эталонными записями Flowseal.
            </p>

            <div className="flex flex-col gap-3 rounded-lg border border-border bg-card/40 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium">Статус hosts:</span>
                  {hostsResult?.needsUpdate ? (
                    <span className="inline-flex items-center gap-1 rounded bg-yellow-500/10 px-2 py-0.5 text-xs font-medium text-yellow-500">
                      <AlertTriangle className="h-3 w-3" /> Требуется обновление
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-500">
                      <ShieldCheck className="h-3 w-3" /> Актуален
                    </span>
                  )}
                </div>
                {hostsResult?.hasYoutubeEntries && (
                  <div className="mt-1 text-[11px] text-yellow-500">
                    Найдены старые записи youtube.com (рекомендуется обновить).
                  </div>
                )}
              </div>

              <Button
                size="sm"
                variant="outline"
                onClick={() => { void updateHosts() }}
                disabled={disabled || !!busyHosts}
                className="h-7 text-xs gap-1.5 self-start sm:self-center"
              >
                {busyHosts === 'update' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileCode2 className="h-3.5 w-3.5" />}
                Обновить файл Hosts
              </Button>
            </div>
          </div>

          {/* ================================================================ */}
          {/* 5. TOOLS: Diagnostics & Tests                                    */}
          {/* ================================================================ */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
                <Stethoscope className="h-3.5 w-3.5" />
                Диагностика и инструменты (Tools)
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => { void runTests() }}
                  disabled={disabled}
                  className="h-7 px-2.5 text-xs gap-1.5"
                  title="Запустить тестирование стратегий через test zapret.ps1"
                >
                  <FlaskConical className="h-3.5 w-3.5" />
                  Запустить тесты (PowerShell)
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => { void runDiagnostics() }}
                  disabled={disabled || busyDiag}
                  className="h-7 px-2.5 text-xs gap-1.5"
                >
                  {busyDiag ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Activity className="h-3.5 w-3.5" />}
                  Запустить диагностику
                </Button>
              </div>
            </div>
            <p className="mb-3 text-xs text-muted-foreground">
              Проверка системных служб Windows, сетевых настроек, TCP Timestamps, прокси и сторонних конфликтующих программ.
            </p>

            {diagnostics && (
              <div className="space-y-2 rounded-lg border border-border bg-card/40 p-3">
                {diagnostics.items.map((item) => {
                  const isOk = item.status === 'ok'
                  const isWarn = item.status === 'warn'
                  const isError = item.status === 'error'

                  return (
                    <div
                      key={item.id}
                      className={cn(
                        'flex flex-col gap-2 rounded-md border p-2.5 sm:flex-row sm:items-center sm:justify-between',
                        isOk && 'border-border/50 bg-background/50',
                        isWarn && 'border-yellow-500/30 bg-yellow-500/5',
                        isError && 'border-destructive/30 bg-destructive/5'
                      )}
                    >
                      <div className="flex items-start gap-2.5 min-w-0">
                        {isOk && <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-500 mt-0.5" />}
                        {isWarn && <AlertTriangle className="h-4 w-4 shrink-0 text-yellow-500 mt-0.5" />}
                        {isError && <AlertCircle className="h-4 w-4 shrink-0 text-destructive mt-0.5" />}
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-foreground">{item.title}</div>
                          <div className="text-[11px] text-muted-foreground">{item.message}</div>
                        </div>
                      </div>

                      {item.fixAction && item.fixLabel && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => { void applyFix(item.fixAction!, item.fixLabel!) }}
                          disabled={disabled || !!busyFix}
                          className="h-7 shrink-0 text-[11px] gap-1.5 self-end sm:self-center"
                        >
                          {busyFix === item.fixAction ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Wrench className="h-3 w-3" />
                          )}
                          {item.fixLabel}
                        </Button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* ================================================================ */}
          {/* 6. UPDATES: Auto-Update Check & Manual Check                     */}
          {/* ================================================================ */}
          <div>
            <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
              Проверка обновлений Zapret (Auto-Update Check)
            </div>
            <div className="flex items-center justify-between gap-3 rounded-md border border-border p-2.5">
              <div className="min-w-0">
                <div className="text-sm font-medium">Проверять автоматически</div>
                <div className="text-xs text-muted-foreground">
                  При открытии этой страницы LAZEYKA сам проверит, вышла ли новая версия Zapret
                </div>
              </div>
              <Switch
                checked={autoUpdateCheck}
                disabled={disabled}
                onCheckedChange={handleAutoUpdateToggle}
              />
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => { void runManualCheck() }}
              disabled={disabled || checkingUpdate}
              className="mt-2"
            >
              {checkingUpdate ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Проверить сейчас
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  )
}

export default ZapretServiceSettingsCard
