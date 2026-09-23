import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import BasePage from '@renderer/components/base/base-page'
import { Card, CardHeader, CardTitle, CardContent } from '@renderer/components/ui/card'
import { Button } from '@renderer/components/ui/button'
import { Badge } from '@renderer/components/ui/badge'
import { Input } from '@renderer/components/ui/input'
import { Switch } from '@renderer/components/ui/switch'
import {
  Gamepad2,
  Monitor,
  FolderOpen,
  Plus,
  X,
  Target,
  Copy,
  Zap,
  Play,
  Square,
  ArrowRight,
  RefreshCw,
  SlidersHorizontal
} from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { useIncyStore } from '@renderer/store/incy-store'
import {
  incyGetSettings,
  incyPatchSettings,
  incyGetNodes,
  incyConnect,
  incyDisconnect,
  incySelectNode,
  systemGetRunningProcesses,
  dialogPickExecutable,
  incyPingGameServer,
  type IncySettings,
  type IncyNode,
  type RunningProcessInfo,
  type GamePingResult,
  type RoutePathStats,
  type RouteOptimizerProgress
} from '@renderer/utils/ipc'

const POWER_ON_BANNER_STYLE = {
  background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.25) 0%, rgba(5, 150, 105, 0.1) 100%)',
  border: '1px solid rgba(16, 185, 129, 0.5)',
  color: '#34d399'
}

function cleanServerName(name: string): string {
  return name.replace(/^\[.*?\]\s*/, '').trim() || name
}

/** Пинг · джиттер · потери одной строкой. Потери > 0 и большой джиттер подсвечиваются. */
function StatTriple({
  stats,
  fallbackPing,
  highlight
}: {
  stats?: RoutePathStats
  fallbackPing?: number | null
  highlight?: boolean
}): React.ReactElement {
  const ping = stats?.pingMs ?? fallbackPing ?? null
  if (ping == null) return <span className="font-mono text-sm font-bold text-muted-foreground">—</span>
  const approx = stats?.method === 'estimate' ? '≈' : ''
  return (
    <span className="inline-flex items-baseline gap-2 font-mono">
      <span className={cn('text-base font-black', highlight ? 'text-emerald-500' : 'text-foreground')}>
        {approx}
        {ping} мс
      </span>
      {stats && stats.jitterMs != null && (
        <span className={cn('text-[10px]', stats.jitterMs > 8 ? 'text-amber-500' : 'text-muted-foreground')} title="Джиттер">
          ±{stats.jitterMs}
        </span>
      )}
      {stats && stats.lossPct != null && stats.method !== 'estimate' && (
        <span className={cn('text-[10px]', stats.lossPct > 0 ? 'text-destructive' : 'text-muted-foreground')} title="Потери">
          {stats.lossPct}% потерь
        </span>
      )}
      {stats?.method === 'icmp' && <span className="text-[9px] text-muted-foreground">ICMP</span>}
    </span>
  )
}

export default function ExitLagPage(): React.ReactElement {
  const navigate = useNavigate()
  const status = useIncyStore((s) => s.status)
  const isConnected = status.state === 'running'

  const [settings, setSettings] = useState<IncySettings | null>(null)
  const [nodes, setNodes] = useState<IncyNode[]>([])
  const [togglingCore, setTogglingCore] = useState(false)

  // Apps management
  const [newAppInput, setNewAppInput] = useState('')
  const [showProcessPickerModal, setShowProcessPickerModal] = useState(false)
  const [runningProcesses, setRunningProcesses] = useState<RunningProcessInfo[]>([])
  const [loadingProcesses, setLoadingProcesses] = useState(false)
  const [processFilterText, setProcessFilterText] = useState('')

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

  const loadData = async (): Promise<void> => {
    try {
      const [s, n] = await Promise.all([incyGetSettings(), incyGetNodes()])
      setSettings(s)
      setNodes(n)
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    void loadData()
  }, [])

  /**
   * Отправляет в main только изменённые поля (patch), а не весь объект,
   * загруженный при открытии страницы: иначе затирались изменения, сделанные
   * на вкладке INCY или из трея. Если туннель поднят, main переподключит его
   * сам — ручное «переподключите» больше не нужно.
   */
  const handleUpdateSettings = async (patch: Partial<IncySettings>): Promise<boolean> => {
    if (!settings) return false
    setSettings({ ...settings, ...patch })
    try {
      const res = await incyPatchSettings(patch)
      setSettings(res.settings)
      return res.reapplied
    } catch (e: any) {
      toast.error('Не удалось сохранить настройки', { description: e?.message || String(e) })
      return false
    }
  }

  const handleTogglePerAppProxy = async (enabled: boolean): Promise<void> => {
    const reapplied = await handleUpdateSettings(
      enabled ? { perAppProxy: true, perAppMode: 'proxy_only' } : { perAppProxy: false }
    )
    if (reapplied) {
      toast.info(enabled ? 'ExitLag включён' : 'ExitLag выключен', {
        description: enabled
          ? 'Туннель переподключается: через VPN пойдут только приложения из списка.'
          : 'Туннель переподключается: весь трафик снова идёт через VPN.'
      })
    } else {
      toast.success(enabled ? 'Режим ExitLag активирован' : 'Режим ExitLag выключен')
    }
  }

  const handleSetPerAppMode = async (mode: 'proxy_only' | 'bypass_only'): Promise<void> => {
    const reapplied = await handleUpdateSettings({ perAppMode: mode })
    if (reapplied) toast.info('Режим изменён — туннель переподключается')
  }

  const handleAddPerAppProcess = async (processName: string): Promise<void> => {
    // Имя хранится в исходном регистре (Discord.exe, VALORANT-Win64-Shipping.exe):
    // сравнение без учёта регистра делает ядро. Раньше всё приводилось к
    // нижнему регистру, и такие приложения в туннель не попадали.
    const base = processName.trim().split(/[\\/]/).pop()?.trim() ?? ''
    if (!base || !settings) return
    const cleaned = /\.exe$/i.test(base) ? base : `${base}.exe`
    const current = settings.perAppProcesses ?? []
    if (current.some((p) => p.toLowerCase() === cleaned)) {
      toast.info('Это приложение уже в списке')
      return
    }
    await handleUpdateSettings({ perAppProcesses: [...current, cleaned] })
    setNewAppInput('')
    toast.success(`Добавлено: ${cleaned}`)
  }

  const handleRemovePerAppProcess = async (proc: string): Promise<void> => {
    if (!settings) return
    const current = settings.perAppProcesses ?? []
    await handleUpdateSettings({
      perAppProcesses: current.filter((p) => p.toLowerCase() !== proc.toLowerCase())
    })
  }

  const handleClearPerAppProcesses = async (): Promise<void> => {
    if (!settings) return
    await handleUpdateSettings({ perAppProcesses: [] })
    toast.success('Список приложений очищен')
  }

  const handleOpenProcessPicker = async (): Promise<void> => {
    setLoadingProcesses(true)
    setShowProcessPickerModal(true)
    try {
      const list = await systemGetRunningProcesses()
      setRunningProcesses(list)
    } catch (err: any) {
      toast.error('Не удалось получить список процессов', { description: err?.message || String(err) })
    } finally {
      setLoadingProcesses(false)
    }
  }

  const handlePickExeFile = async (): Promise<void> => {
    try {
      const fileName = await dialogPickExecutable()
      if (fileName) {
        await handleAddPerAppProcess(fileName)
      }
    } catch (err: any) {
      toast.error('Ошибка выбора файла', { description: err?.message || String(err) })
    }
  }

  const handleApplyPreset = async (presetApps: string[]): Promise<void> => {
    if (!settings) return
    const list = [...(settings.perAppProcesses ?? [])]
    const seen = new Set(list.map((p) => p.toLowerCase()))
    for (const app of presetApps) {
      if (seen.has(app.toLowerCase())) continue
      seen.add(app.toLowerCase())
      list.push(app)
    }
    await handleUpdateSettings({ perAppProcesses: list })
    toast.success('Пресет применён')
  }

  const handleToggleTunnel = async (): Promise<void> => {
    setTogglingCore(true)
    try {
      if (isConnected) {
        await incyDisconnect()
        toast.info('INCY туннель остановлен')
      } else {
        await incyConnect()
        toast.success('INCY туннель запущен', { style: POWER_ON_BANNER_STYLE })
      }
    } catch (err: any) {
      toast.error('Ошибка переключения туннеля', { description: err?.message || String(err) })
    } finally {
      setTogglingCore(false)
    }
  }

  const handleMeasureGamePing = async (targetOverride?: string): Promise<void> => {
    const targetToMeasure = (targetOverride || gameServerTarget).trim()
    if (!targetToMeasure) {
      toast.error('Введите IP-адрес или строку подключения сервера Faceit / CS2')
      return
    }
    setMeasuringGamePing(true)
    setOptimizerProgress({ done: 0, total: 1, stage: 'Подготовка' })
    try {
      const res = await incyPingGameServer(targetToMeasure)
      setGamePingResult(res)
      const best = res.nodes.find((n) => n.isBest)
      toast.success(
        best
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
        toast.info('Адрес сервера вставлен из буфера')
        void handleMeasureGamePing(val)
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

  const activeNode = nodes.find((n) => n.id === status.selectedNodeId) || nodes[0]
  const isPerAppEnabled = Boolean(settings?.perAppProxy)
  const appCount = settings?.perAppProcesses?.length ?? 0
  // «Работает» — это подтверждение от ядра, а не просто включённый флажок:
  // флажок мог быть включён при остановленном туннеле или с пустым списком.
  const exitLagRunning = isConnected && Boolean(status.exitLagActive)
  const appWord = appCount === 1 ? 'программа' : appCount >= 2 && appCount <= 4 ? 'программы' : 'программ'

  return (
    <BasePage title="ExitLag">
      <div className="px-4 pb-8 space-y-4">
        {/* HERO BANNER / CONTROL CARD */}
        <Card className="cyber-card relative overflow-hidden border-primary/40 bg-gradient-to-br from-card/95 via-card/80 to-primary/10 shadow-lg">
          <div className="absolute right-0 top-0 translate-x-8 -translate-y-8 size-48 rounded-full bg-primary/10 blur-3xl pointer-events-none" />

          <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-3">
            <div className="flex items-start gap-3.5">
              <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-primary/30 to-primary/10 border border-primary/50 flex items-center justify-center shrink-0 shadow-[0_0_20px_rgba(99,102,241,0.25)]">
                <Gamepad2 className="h-5 w-5 text-primary" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <CardTitle className="text-base font-black tracking-tight flex items-center gap-2">
                    ExitLag — Игровой режим
                  </CardTitle>
                  <Badge variant="outline" className="text-[10px] px-2 py-0 border-primary/50 text-primary font-mono font-bold uppercase bg-primary/10">
                    КИЛЛЕР-ФИЧА
                  </Badge>
                  {exitLagRunning && appCount === 0 ? (
                    <Badge className="text-[10px] px-2 py-0 bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 font-semibold">
                      РАБОТАЕТ · СПИСОК ПУСТ — VPN НИГДЕ
                    </Badge>
                  ) : exitLagRunning ? (
                    <Badge className="text-[10px] px-2 py-0 bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 font-semibold">
                      РАБОТАЕТ ({status.exitLagApps?.length ?? appCount} {appWord})
                    </Badge>
                  ) : isPerAppEnabled && appCount === 0 ? (
                    <Badge className="text-[10px] px-2 py-0 bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 font-semibold">
                      ДОБАВЬТЕ ПРИЛОЖЕНИЯ
                    </Badge>
                  ) : isPerAppEnabled ? (
                    <Badge className="text-[10px] px-2 py-0 bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 font-semibold">
                      ВКЛЮЧЁН · ТУННЕЛЬ ОСТАНОВЛЕН
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="text-[10px] px-2 py-0 text-muted-foreground">
                      ВЫКЛЮЧЕН
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed max-w-2xl">
                  Изолируйте игровой трафик от фонового: туннелируйте исключительно указанные игры и приложения, направляя весь остальной трафик Windows напрямую без малейшей потери пинга.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 self-end sm:self-center shrink-0">
              <span className="text-xs font-semibold text-muted-foreground">
                {isPerAppEnabled ? 'Включено' : 'Выключено'}
              </span>
              <Switch
                checked={isPerAppEnabled}
                onCheckedChange={handleTogglePerAppProxy}
                className="scale-110"
              />
            </div>
          </CardHeader>

          {/* Quick Tunnel Controller */}
          <CardContent className="pt-2 border-t border-border/40">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-background/50 p-3 rounded-xl border border-border/40">
              <div className="flex items-center gap-3 min-w-0">
                <div className={cn(
                  'size-3 rounded-full shrink-0 animate-pulse',
                  isConnected ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]' : 'bg-muted-foreground/40'
                )} />
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-foreground flex items-center gap-1.5 truncate">
                    <span>Туннель INCY:</span>
                    <span className={isConnected ? 'text-emerald-500 font-bold' : 'text-muted-foreground'}>
                      {exitLagRunning ? 'Подключен и фильтрует' : isConnected ? 'Подключен (обычный VPN)' : 'Остановлен'}
                    </span>
                    {activeNode && isConnected && (
                      <span className="text-muted-foreground font-normal truncate">
                        • {cleanServerName(activeNode.name)}
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {isConnected
                      ? isPerAppEnabled
                        ? settings?.perAppMode === 'bypass_only'
                          ? 'Весь трафик ПК в VPN, кроме списка исключений'
                          : 'В туннель попадают только приложения из списка ниже'
                        : 'Весь трафик системы проходит через VPN'
                      : 'Запустите туннель для активации правил фильтрации'}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <Button
                  size="sm"
                  variant={isConnected ? 'destructive' : 'default'}
                  onClick={() => { void handleToggleTunnel() }}
                  disabled={togglingCore}
                  className="text-xs h-8 gap-1.5 font-semibold"
                >
                  {togglingCore ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  ) : isConnected ? (
                    <>
                      <Square className="h-3 w-3 fill-current" />
                      Остановить VPN
                    </>
                  ) : (
                    <>
                      <Play className="h-3 w-3 fill-current" />
                      Запустить VPN
                    </>
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => navigate('/incy')}
                  className="text-xs h-8 gap-1 text-muted-foreground hover:text-foreground"
                >
                  В INCY <ArrowRight className="h-3 w-3" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* SETTINGS CARD */}
        {settings && (
          <Card className="cyber-card border-border/60 bg-card/60">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <SlidersHorizontal className="h-4 w-4 text-primary" />
                  <CardTitle className="text-sm font-bold">Режим работы туннелирования</CardTitle>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Mode Selector */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => void handleSetPerAppMode('proxy_only')}
                  className={cn(
                    'p-3.5 rounded-xl border text-left transition-all cursor-pointer relative overflow-hidden',
                    settings.perAppMode !== 'bypass_only'
                      ? 'border-primary bg-primary/15 shadow-[0_0_20px_rgba(99,102,241,0.15)] ring-1 ring-primary/40'
                      : 'border-border/60 bg-card/40 hover:bg-card/80 opacity-70 hover:opacity-100'
                  )}
                >
                  <div className="text-xs font-bold text-foreground flex items-center gap-1.5">
                    🎯 Только выбранные (Режим ExitLag)
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">
                    Через VPN-туннель направляются <b>исключительно</b> указанные игры и программы. Браузеры, Windows, торренты и рабочий софт идут напрямую с нулевым влиянием на сетевой стек.
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => void handleSetPerAppMode('bypass_only')}
                  className={cn(
                    'p-3.5 rounded-xl border text-left transition-all cursor-pointer relative overflow-hidden',
                    settings.perAppMode === 'bypass_only'
                      ? 'border-primary bg-primary/15 shadow-[0_0_20px_rgba(99,102,241,0.15)] ring-1 ring-primary/40'
                      : 'border-border/60 bg-card/40 hover:bg-card/80 opacity-70 hover:opacity-100'
                  )}
                >
                  <div className="text-xs font-bold text-foreground flex items-center gap-1.5">
                    🛡️ Все, кроме выбранных (Исключения)
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">
                    Весь компьютер защищён туннелем VPN, а указанные приложения соединяются напрямую через локального провайдера в обход шифрования.
                  </div>
                </button>
              </div>

              {/* Quick Presets */}
              <div className="space-y-2 pt-2 border-t border-border/40">
                <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                  Быстрые наборы:
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    type="button"
                    onClick={() => void handleApplyPreset([
                      'cs2.exe',
                      'dota2.exe',
                      'steam.exe',
                      'steamwebhelper.exe',
                      'epicgameslauncher.exe',
                      'riotclientservices.exe',
                      'valorant-win64-shipping.exe'
                    ])}
                    className="text-xs h-7 gap-1.5 border-primary/30 hover:bg-primary/15 hover:border-primary"
                  >
                    🎮 Игры (CS2, Dota 2, Steam, Riot, Epic)
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    type="button"
                    onClick={() => void handleApplyPreset(['discord.exe', 'telegram.exe'])}
                    className="text-xs h-7 gap-1.5 border-primary/30 hover:bg-primary/15 hover:border-primary"
                  >
                    💬 Связь (Discord, Telegram)
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    type="button"
                    onClick={() => void handleApplyPreset(['chrome.exe', 'msedge.exe', 'firefox.exe', 'browser.exe'])}
                    className="text-xs h-7 gap-1.5 border-primary/30 hover:bg-primary/15 hover:border-primary"
                  >
                    🌐 Браузеры (Chrome, Edge, Firefox, Yandex)
                  </Button>
                </div>
              </div>

              {/* Add App & Selection Controls */}
              <div className="space-y-3 pt-2 border-t border-border/40">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                    Список приложений ({settings.perAppProcesses?.length ?? 0}):
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      type="button"
                      onClick={() => { void handleOpenProcessPicker() }}
                      className="text-xs h-7 gap-1.5 border-primary/40 hover:bg-primary/15 text-primary"
                    >
                      <Monitor className="h-3.5 w-3.5" /> Из запущенных...
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      type="button"
                      onClick={() => { void handlePickExeFile() }}
                      className="text-xs h-7 gap-1.5 border-primary/40 hover:bg-primary/15"
                    >
                      <FolderOpen className="h-3.5 w-3.5" /> Обзор .exe
                    </Button>
                    {(settings.perAppProcesses?.length ?? 0) > 0 && (
                      <Button
                        size="sm"
                        variant="ghost"
                        type="button"
                        onClick={() => { void handleClearPerAppProcesses() }}
                        className="text-xs h-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                      >
                        Очистить всё
                      </Button>
                    )}
                  </div>
                </div>

                {/* Manual Input */}
                <div className="flex gap-2">
                  <Input
                    value={newAppInput}
                    onChange={(e) => setNewAppInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void handleAddPerAppProcess(newAppInput) }}
                    placeholder="Название процесса, например: cs2.exe или discord.exe"
                    className="text-xs font-mono"
                  />
                  <Button
                    size="sm"
                    type="button"
                    onClick={() => void handleAddPerAppProcess(newAppInput)}
                    disabled={!newAppInput.trim()}
                    className="text-xs h-9 shrink-0 gap-1 font-semibold"
                  >
                    <Plus className="h-3.5 w-3.5" /> Добавить
                  </Button>
                </div>

                {/* Active Apps Badges */}
                {(settings.perAppProcesses?.length ?? 0) > 0 ? (
                  <div className="flex flex-wrap gap-2 p-3 rounded-xl border border-border/50 bg-background/50 max-h-56 overflow-y-auto">
                    {settings.perAppProcesses!.map((proc) => (
                      <div
                        key={proc}
                        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-card/90 border border-primary/30 text-xs font-mono text-foreground shadow-sm hover:border-primary/60 transition-colors"
                      >
                        <span className="font-semibold">{proc}</span>
                        <button
                          type="button"
                          onClick={() => void handleRemovePerAppProcess(proc)}
                          className="text-muted-foreground hover:text-destructive transition-colors ml-0.5 cursor-pointer"
                          title="Удалить"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-6 rounded-xl border border-dashed border-border/60 text-center text-xs text-muted-foreground">
                    Приложения пока не выбраны. Выберите игру из запущенных процессов выше или добавьте вручную.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* FACEIT / CS2 GAME SERVER ROUTE OPTIMIZER */}
        <Card className="cyber-card border-primary/30 bg-gradient-to-br from-card/90 via-card/70 to-primary/5 shadow-md">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="h-8 w-8 rounded-lg bg-primary/20 border border-primary/40 flex items-center justify-center">
                  <Target className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-sm font-bold flex items-center gap-2">
                    Оптимизатор маршрута Faceit / CS2 (Route Optimizer)
                    <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-primary/50 text-primary font-mono uppercase">
                      Game Ping
                    </Badge>
                  </CardTitle>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Реальный пинг, джиттер и потери до игрового сервера — напрямую и через каждый ваш узел
                  </p>
                </div>
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    value={gameServerTarget}
                    onChange={(e) => setGameServerTarget(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleMeasureGamePing()
                    }}
                    placeholder="connect 162.19.141.22:27015 или 162.19.141.22..."
                    className="text-xs font-mono pr-20"
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    type="button"
                    onClick={() => { void handlePasteGameServerFromClipboard() }}
                    className="absolute right-1 top-1 h-7 px-2 text-[11px] text-primary hover:bg-primary/10 gap-1"
                  >
                    <Copy className="h-3 w-3" /> Вставить
                  </Button>
                </div>
                <Button
                  size="sm"
                  type="button"
                  onClick={() => void handleMeasureGamePing()}
                  disabled={measuringGamePing || !gameServerTarget.trim()}
                  className="text-xs h-9 shrink-0 gap-1.5 font-semibold"
                >
                  <Zap className="h-3.5 w-3.5" />
                  {measuringGamePing ? 'Замер...' : 'Замерить пинг'}
                </Button>
              </div>

              <p className="text-[10px] text-muted-foreground leading-relaxed">
                Скопируйте строку <span className="font-mono text-foreground">connect IP:порт</span> из комнаты матча
                Faceit или из консоли CS2. Замер: по 20 игровых запросов (A2S) напрямую и через каждый быстрый узел
                подписки — пинг, джиттер и потери, как у самой игры.
              </p>
              {measuringGamePing && optimizerProgress && (
                <div className="space-y-1">
                  <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
                    <span>{optimizerProgress.stage}</span>
                    <span>
                      {optimizerProgress.done}/{optimizerProgress.total}
                    </span>
                  </div>
                  <div className="h-1 rounded-full bg-border/50 overflow-hidden">
                    <div
                      className="h-full bg-primary transition-all duration-300"
                      style={{
                        width: `${optimizerProgress.total ? Math.round((optimizerProgress.done / optimizerProgress.total) * 100) : 0}%`
                      }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Results */}
            {gamePingResult && (
              <div className="space-y-3 p-3.5 rounded-xl border border-primary/30 bg-primary/5 backdrop-blur-sm animate-in fade-in duration-200">
                {/* Header */}
                <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-border/40 text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-semibold text-foreground truncate">
                      📍 {gamePingResult.geo.city ? `${gamePingResult.geo.city}, ` : ''}
                      {gamePingResult.geo.country || gamePingResult.targetIp}
                    </span>
                    <span className="text-[10px] font-mono text-muted-foreground">
                      {gamePingResult.targetIp}:{gamePingResult.targetPort}
                    </span>
                  </div>
                  <div className="text-[11px] text-muted-foreground flex items-center gap-2 font-mono">
                    <span>Напрямую{gamePingResult.directViaTunnel ? ' (через VPN)' : ''}:</span>
                    <StatTriple stats={gamePingResult.direct} fallbackPing={gamePingResult.directPing} />
                  </div>
                </div>

                {(gamePingResult.warnings ?? []).map((w) => (
                  <div
                    key={w}
                    className="text-[10px] leading-relaxed rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300 px-2.5 py-1.5"
                  >
                    {w}
                  </div>
                ))}

                {typeof gamePingResult.measuredNodes === 'number' && (
                  <div className="text-[10px] text-muted-foreground">
                    Проверено узлов: {gamePingResult.measuredNodes} из {gamePingResult.totalNodes} (самые быстрые до вас).
                    Сортировка по итоговой оценке: пинг + 2×джиттер + 5 мс за каждый % потерь.
                  </div>
                )}

                {/* Node List */}
                <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                  {gamePingResult.nodes.length === 0 ? (
                    <div className="text-center py-6 text-xs text-muted-foreground">
                      Нет доступных узлов для замера — обновите подписку на вкладке INCY.
                    </div>
                  ) : (
                    gamePingResult.nodes.map((n) => {
                      const isCurrentActive = status.state === 'running' && status.activeNodeId === n.nodeId
                      const estimated = n.path?.method === 'estimate'
                      return (
                        <div
                          key={n.nodeId}
                          className={cn(
                            'flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-xl border transition-all text-xs',
                            n.isBest
                              ? 'border-emerald-500/50 bg-emerald-500/10 shadow-[0_0_15px_rgba(16,185,129,0.15)] ring-1 ring-emerald-500/30'
                              : 'border-border/50 bg-card/60 hover:bg-card/90'
                          )}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-semibold text-foreground truncate">{cleanServerName(n.nodeName)}</span>
                              <Badge variant="outline" className="text-[9px] uppercase px-1 py-0">
                                {n.protocol}
                              </Badge>
                              {n.isBest && (
                                <Badge className="text-[9px] px-1.5 py-0 bg-emerald-500 text-white font-bold">🏆 ЛУЧШИЙ</Badge>
                              )}
                              {isCurrentActive && (
                                <Badge className="text-[9px] px-1.5 py-0 bg-primary/20 text-primary border border-primary/40 font-mono">
                                  ТЕКУЩИЙ
                                </Badge>
                              )}
                              {estimated && (
                                <Badge variant="outline" className="text-[9px] px-1 py-0 text-amber-600 border-amber-500/40">
                                  оценка
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-3 text-[10px] text-muted-foreground mt-1.5 font-mono flex-wrap">
                              <span>
                                ПК → узел: <b className="text-foreground">{n.userToNodePing ?? '—'} мс</b>
                              </span>
                              {n.path && n.path.method === 'a2s' && (
                                <span>
                                  ответов: {n.path.received}/{n.path.sent}
                                </span>
                              )}
                              {typeof n.savingMs === 'number' && n.savingMs > 0 && !gamePingResult.directViaTunnel && (
                                <span className="text-emerald-500 font-bold">
                                  ⚡ на {n.savingMs} мс быстрее прямого{estimated ? ' (оценка)' : ''}
                                </span>
                              )}
                              {n.error && <span className="text-destructive">{n.error}</span>}
                              {!n.error && n.path?.method === 'failed' && (
                                <span className="text-destructive">сервер не ответил через этот узел</span>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                            <StatTriple stats={n.path} fallbackPing={n.totalPing} highlight={n.isBest} />
                            <Button
                              size="sm"
                              variant={n.isBest ? 'default' : 'outline'}
                              onClick={() => {
                                void handleSelectNodeAndConnect(n.nodeId)
                              }}
                              disabled={selectingNodeId === n.nodeId || isCurrentActive}
                              className="text-xs h-7 px-2.5 font-semibold"
                            >
                              {selectingNodeId === n.nodeId ? (
                                <RefreshCw className="h-3 w-3 animate-spin" />
                              ) : isCurrentActive ? (
                                'Подключен'
                              ) : (
                                'Подключить'
                              )}
                            </Button>
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* MODAL: PROCESS PICKER */}
        {showProcessPickerModal && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-200"
            onClick={() => setShowProcessPickerModal(false)}
          >
            <div
              className="w-full max-w-lg border border-primary/40 bg-card/95 rounded-2xl shadow-[0_0_50px_rgba(0,0,0,0.8)] overflow-hidden flex flex-col max-h-[85vh] backdrop-blur-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between p-4 border-b border-border/40 bg-card/80">
                <div className="flex items-center gap-2">
                  <Monitor className="h-4 w-4 text-primary" />
                  <div className="text-sm font-bold text-foreground">
                    Выбор из запущенных процессов Windows
                  </div>
                </div>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => setShowProcessPickerModal(false)}
                  className="h-7 w-7"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="p-3 border-b border-border/40 bg-background/40">
                <Input
                  value={processFilterText}
                  onChange={(e) => setProcessFilterText(e.target.value)}
                  placeholder="Поиск процесса или названия окна (Discord, CS2, Chrome)..."
                  className="text-xs"
                  autoFocus
                />
              </div>

              <div className="p-3 flex-1 overflow-y-auto space-y-1.5 min-h-[250px]">
                {loadingProcesses ? (
                  <div className="py-16 text-center text-xs text-muted-foreground animate-pulse">
                    Получение списка процессов Windows...
                  </div>
                ) : runningProcesses.length === 0 ? (
                  <div className="py-16 text-center text-xs text-muted-foreground">
                    Запущенные процессы не найдены
                  </div>
                ) : (
                  runningProcesses
                    .filter((p) => {
                      if (!processFilterText.trim()) return true
                      const q = processFilterText.toLowerCase()
                      return p.name.toLowerCase().includes(q) || (p.title && p.title.toLowerCase().includes(q))
                    })
                    .map((p) => {
                      const isAlreadyAdded = settings?.perAppProcesses?.some((proc) => proc.toLowerCase() === p.name.toLowerCase())
                      return (
                        <div
                          key={p.name}
                          onClick={() => {
                            void handleAddPerAppProcess(p.name)
                            setShowProcessPickerModal(false)
                          }}
                          className={cn(
                            'flex items-center justify-between p-2.5 rounded-xl border transition-all cursor-pointer',
                            isAlreadyAdded
                              ? 'border-emerald-500/40 bg-emerald-500/10'
                              : 'border-border/50 bg-card/40 hover:bg-primary/10 hover:border-primary/50'
                          )}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-mono font-semibold text-foreground flex items-center gap-1.5">
                              {p.name}
                              {isAlreadyAdded && (
                                <Badge variant="secondary" className="text-[9px] px-1 py-0 bg-emerald-500/20 text-emerald-600 dark:text-emerald-400">
                                  в списке
                                </Badge>
                              )}
                            </div>
                            {p.title && (
                              <div className="text-[10px] text-muted-foreground truncate mt-0.5">
                                {p.title}
                              </div>
                            )}
                          </div>
                          <Button size="sm" variant="ghost" className="h-6 text-xs text-primary px-2">
                            {isAlreadyAdded ? 'Добавлено' : 'Выбрать'}
                          </Button>
                        </div>
                      )
                    })
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </BasePage>
  )
}
