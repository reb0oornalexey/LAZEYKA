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
  incyReapplyTunnel,
  systemGetRunningProcesses,
  dialogPickExecutable,
  type IncySettings,
  type IncyNode,
  type RunningProcessInfo
} from '@renderer/utils/ipc'

const POWER_ON_BANNER_STYLE = {
  background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.25) 0%, rgba(5, 150, 105, 0.1) 100%)',
  border: '1px solid rgba(16, 185, 129, 0.5)',
  color: '#34d399'
}

function cleanServerName(name: string): string {
  return name.replace(/^\[.*?\]\s*/, '').trim() || name
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

  // Настройки могли поменяться на вкладке INCY, в трее или при
  // переподключении — перечитываем их при каждой смене состояния туннеля,
  // иначе переключатель показывал устаревшее «выключено/включено».
  useEffect(() => {
    void loadData()
  }, [status.state, status.exitLagActive])

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
                  ) : isPerAppEnabled && settings?.perAppMode === 'bypass_only' ? (
                    <Badge className="text-[10px] px-2 py-0 bg-sky-500/15 text-sky-600 dark:text-sky-400 border border-sky-500/30 font-semibold">
                      РЕЖИМ ИСКЛЮЧЕНИЙ
                    </Badge>
                  ) : isPerAppEnabled && (isConnected || status.state === 'connecting') ? (
                    // Туннель поднят со старыми настройками (или ещё
                    // подключается) — main переподключит его сам; кнопка на
                    // случай, если этого не произошло.
                    <button
                      type="button"
                      onClick={() => {
                        void incyReapplyTunnel().then((ok) => {
                          if (ok) toast.info('Туннель переподключается в режиме ExitLag')
                        })
                      }}
                      className="cursor-pointer"
                      title="Переподключить туннель в режиме ExitLag"
                    >
                      <Badge className="text-[10px] px-2 py-0 bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 font-semibold">
                        ВКЛЮЧЁН · ПРИМЕНЯЕТСЯ… (нажмите, если завис)
                      </Badge>
                    </button>
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

        {/* Оптимизатор маршрута вынесен на отдельную вкладку. */}
        <button
          type="button"
          onClick={() => navigate('/optimizer')}
          className="w-full flex items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-left hover:bg-primary/10 transition-colors cursor-pointer"
        >
          <span className="flex items-center gap-2.5">
            <Target className="h-4 w-4 text-primary" />
            <span>
              <span className="block text-sm font-bold text-foreground">Оптимизатор маршрута Faceit / CS2</span>
              <span className="block text-[11px] text-muted-foreground">
                Вставьте адрес сервера — покажем пинг, джиттер и потери через каждый узел
              </span>
            </span>
          </span>
          <ArrowRight className="h-4 w-4 text-primary shrink-0" />
        </button>

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
