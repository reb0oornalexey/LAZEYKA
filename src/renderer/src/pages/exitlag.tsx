import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import BasePage from '@renderer/components/base/base-page'
import { Button } from '@renderer/components/ui/button'
import { Badge } from '@renderer/components/ui/badge'
import { Input } from '@renderer/components/ui/input'
import { EmptyState, LzHero, LzPanel, LzSectionHead, Segmented, StatChip, type LzTone, type SegmentedItem } from '@renderer/components/lz'
import { ConnectDial } from '@renderer/components/incy/connect-dial'
import SplitLanes from '@renderer/components/exitlag/split-lanes'
import {
  Activity,
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
  ShieldCheck,
  MessageCircle,
  Globe
} from 'lucide-react'
import { cn, POWER_ON_BANNER_STYLE } from '@renderer/lib/utils'
import { useIncyStore } from '@renderer/store/incy-store'
import InstalledGamesModal from '@renderer/components/installed-games-modal'
import ExitLagTrafficCard from '@renderer/components/exitlag-traffic-card'
import { FaceitBrandIcon } from '@renderer/components/service-icons'
import { appLabel, entryMatchesProc, isLinuxPlatform, isMacPlatform, usesExecutablePaths } from '@renderer/utils/per-app'
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

/** Быстрые наборы для macOS: только приложения, которые есть на Mac. Пути — бандлы `.app` (ловят и помощников внутри). */
const MAC_PRESETS = {
  games: [
    // Steam работает из ~/Library/Application Support/Steam/Steam.AppBundle, а не из /Applications/Steam.app.
    'steam_osx',
    'steamwebhelper',
    'Steam Helper',
    '~/Library/Application Support/Steam/Steam.AppBundle',
    // Dota 2 (CS2 на Mac нет).
    'dota2',
    '~/Library/Application Support/Steam/steamapps/common/dota 2 beta',
    '/Applications/League of Legends.app',
    'LeagueClient',
    'RiotClientServices',
    '/Users/Shared/Riot Games',
    '/Applications/Epic Games Launcher.app',
    '/Applications/Battle.net.app',
    '/Users/Shared/Battle.net'
  ],
  chat: ['/Applications/Discord.app', '/Applications/Telegram.app'],
  browsers: [
    // Сеть Safari делает общий процесс WebKit, а не бандл Safari.
    'Safari',
    'com.apple.WebKit.Networking',
    '/Applications/Google Chrome.app',
    '/Applications/Firefox.app',
    '/Applications/Yandex.app',
    '/Applications/Microsoft Edge.app',
    '/Applications/Arc.app'
  ]
}

const OS_NAME = isLinuxPlatform ? 'Linux' : isMacPlatform ? 'macOS' : 'Windows'

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
  const [showGamesModal, setShowGamesModal] = useState(false)
  const [runningProcesses, setRunningProcesses] = useState<RunningProcessInfo[]>([])
  const [loadingProcesses, setLoadingProcesses] = useState(false)
  const [processFilterText, setProcessFilterText] = useState('')
  const [tab, setTab] = useState<'apps' | 'traffic'>('apps')


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
  /** 'hot' — применено на лету, 'reconnect' — туннель переподключается, null — туннель не поднят. */
  const handleUpdateSettings = async (patch: Partial<IncySettings>): Promise<'hot' | 'reconnect' | null> => {
    if (!settings) return null
    setSettings({ ...settings, ...patch })
    try {
      const res = await incyPatchSettings(patch)
      setSettings(res.settings)
      return res.hotApplied ? 'hot' : res.reapplied ? 'reconnect' : null
    } catch (e: any) {
      toast.error('Не удалось сохранить настройки', { description: e?.message || String(e) })
      return null
    }
  }

  const handleTogglePerAppProxy = async (enabled: boolean): Promise<void> => {
    // Режим, выбранный карточкой («Все, кроме выбранных»), не трогаем —
    // раньше включение всегда сбрасывало его на белый список.
    const mode = settings?.perAppMode ?? 'proxy_only'
    const how = await handleUpdateSettings(enabled ? { perAppProxy: true, perAppMode: mode } : { perAppProxy: false })
    const what = enabled
      ? mode === 'bypass_only'
        ? 'через VPN идёт всё, кроме приложений из списка'
        : 'через VPN идут только приложения из списка'
      : 'весь трафик снова идёт через VPN'
    if (how === 'hot') {
      toast.success(enabled ? 'ExitLag включён' : 'ExitLag выключен', {
        description: `Сразу, без переподключения — ${what}. Уже открытые соединения (TeamSpeak, Discord, игра) не рвутся.`
      })
    } else if (how === 'reconnect') {
      toast.info(enabled ? 'ExitLag включён' : 'ExitLag выключен', {
        description: `Туннель переподключается: ${what}. Голосовые чаты на пару секунд переподключатся.`
      })
    } else {
      toast.success(enabled ? 'Режим ExitLag активирован' : 'Режим ExitLag выключен')
    }
  }

  const handleSetPerAppMode = async (mode: 'proxy_only' | 'bypass_only'): Promise<void> => {
    const how = await handleUpdateSettings({ perAppMode: mode })
    if (how === 'hot') toast.success('Режим изменён — применено сразу, без переподключения')
    else if (how === 'reconnect') toast.info('Режим изменён — туннель переподключается')
  }

  const handleAddPerAppProcess = async (processName: string): Promise<void> => {
    // Имя хранится в исходном регистре (Discord.exe, VALORANT-Win64-Shipping.exe):
    // сравнение без учёта регистра делает ядро. Раньше всё приводилось к
    // нижнему регистру, и такие приложения в туннель не попадали.
    const raw = processName.trim()
    // macOS: путь (бандл .app, каталог) остаётся путём, остальное — имя без .exe.
    const base = usesExecutablePaths
      ? raw.startsWith('/') || raw.startsWith('~/')
        ? raw.replace(/\/+$/, '')
        : (raw.split('/').pop()?.trim() ?? '')
      : (raw.split(/[\\/]/).pop()?.trim() ?? '')
    if (!base || !settings) return
    const cleaned = usesExecutablePaths || /\.exe$/i.test(base) ? base : `${base}.exe`
    const current = settings.perAppProcesses ?? []
    if (current.some((p) => p.toLowerCase() === cleaned.toLowerCase())) {
      toast.info('Это приложение уже в списке')
      return
    }
    await handleUpdateSettings({ perAppProcesses: [...current, cleaned] })
    setNewAppInput('')
    toast.success(`Добавлено: ${appLabel(cleaned)}`)
  }

  const handleRemovePerAppProcess = async (proc: string): Promise<void> => {
    if (!settings) return
    const current = settings.perAppProcesses ?? []
    await handleUpdateSettings({
      perAppProcesses: usesExecutablePaths
        ? current.filter((p) => !entryMatchesProc(p, appLabel(proc), proc))
        : // Запись могла быть сохранена путём или без .exe (сценарии, ссылки) —
          // «Убрать» из таблицы по имени процесса снимает и такую запись.
          current.filter((p) => p.toLowerCase() !== proc.toLowerCase() && !entryMatchesProc(p, proc))
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


  // Подключённый узел, а не выбранный: выбор на вкладке INCY без
  // переподключения не меняет того, через что реально идёт трафик.
  const activeNode = nodes.find((n) => n.id === (status.activeNodeId ?? status.selectedNodeId)) || nodes[0]
  const isPerAppEnabled = Boolean(settings?.perAppProxy)
  const appCount = settings?.perAppProcesses?.length ?? 0
  // «Работает» — это подтверждение от ядра, а не просто включённый флажок:
  // флажок мог быть включён при остановленном туннеле или с пустым списком.
  const exitLagRunning = isConnected && Boolean(status.exitLagActive)
  const appWord = appCount === 1 ? 'программа' : appCount >= 2 && appCount <= 4 ? 'программы' : 'программ'

  const mode = settings?.perAppMode ?? 'proxy_only'
  const connecting = status.state === 'connecting'
  const applying = isPerAppEnabled && (isConnected || connecting) && !exitLagRunning
  const nodeName = activeNode && isConnected ? cleanServerName(activeNode.name) : null
  const heroTone: LzTone = togglingCore || connecting || applying
    ? 'busy'
    : status.state === 'error'
      ? 'error'
      : exitLagRunning
        ? appCount === 0 && mode === 'proxy_only'
          ? 'warn'
          : 'on'
        : 'off'
  const heroTitle = exitLagRunning
    ? appCount === 0 && mode === 'proxy_only'
      ? 'Список пуст'
      : 'ExitLag работает'
    : applying
      ? 'Применяю ExitLag…'
      : isPerAppEnabled
        ? 'ExitLag ждёт VPN'
        : isConnected
          ? 'VPN работает для всего компьютера'
          : 'ExitLag выключен'
  const heroText = exitLagRunning
    ? appCount === 0 && mode === 'proxy_only'
      ? 'В режиме «только выбранные» через VPN сейчас не идёт ничего. Добавьте игры в список ниже.'
      : mode === 'bypass_only'
        ? `Весь компьютер идёт через VPN, кроме ${appCount} ${appWord} из списка.`
        : `Через VPN идут только ${status.exitLagApps?.length ?? appCount} ${appWord} из списка. Остальной трафик идёт напрямую.`
    : applying
      ? 'Туннель переподключается с новыми правилами. Голосовые чаты на пару секунд переподключатся.'
      : isPerAppEnabled
        ? 'Режим включён. Запустите VPN, и правила начнут работать.'
        : isConnected
          ? 'Включите ExitLag кнопкой слева, чтобы через VPN шли только игры, а остальное — напрямую.'
          : `Через VPN пойдут только выбранные игры и программы, всё остальное в ${OS_NAME} — напрямую, без лишнего пути.`
  const modeItems: SegmentedItem<'proxy_only' | 'bypass_only'>[] = [
    { id: 'proxy_only', label: 'Только выбранные', icon: Target, title: 'Через VPN идут только программы из списка' },
    { id: 'bypass_only', label: 'Все, кроме выбранных', icon: ShieldCheck, title: 'Через VPN идёт всё, кроме программ из списка' }
  ]
  const presets: { key: string; icon: React.ReactNode; label: string; apps: string[] }[] = [
    {
      key: 'games',
      icon: <Gamepad2 />,
      label: isLinuxPlatform ? 'Игры: CS2, Dota 2, Steam' : isMacPlatform ? 'Игры: Dota 2, Steam, Riot, Epic, Battle.net' : 'Игры: CS2, Dota 2, Steam, Riot, Epic',
      apps: isLinuxPlatform ? ['cs2', 'dota2', 'steam', 'steamwebhelper'] : isMacPlatform
        ? MAC_PRESETS.games
        : ['cs2.exe', 'dota2.exe', 'steam.exe', 'steamwebhelper.exe', 'epicgameslauncher.exe', 'riotclientservices.exe', 'valorant-win64-shipping.exe']
    },
    { key: 'chat', icon: <MessageCircle />, label: 'Связь: Discord, Telegram', apps: isLinuxPlatform ? ['Discord', 'Telegram', 'telegram-desktop'] : isMacPlatform ? MAC_PRESETS.chat : ['discord.exe', 'telegram.exe'] },
    {
      key: 'browsers',
      icon: <Globe />,
      label: isLinuxPlatform ? 'Браузеры: Chrome, Chromium, Firefox, Edge' : isMacPlatform ? 'Браузеры: Safari, Chrome, Firefox, Yandex, Edge, Arc' : 'Браузеры: Chrome, Edge, Firefox, Yandex',
      apps: isLinuxPlatform ? ['chrome', 'chromium', 'firefox', 'firefox-bin', 'msedge'] : isMacPlatform ? MAC_PRESETS.browsers : ['chrome.exe', 'msedge.exe', 'firefox.exe', 'browser.exe']
    }
  ]
  const apps = settings?.perAppProcesses ?? []

  return (
    <BasePage title="ExitLag">
      <div className="mx-auto flex w-full max-w-[1080px] flex-col lz-page-gap lz-page-x pb-5">
        <LzHero
          data-tour="exitlag-console"
          tone={heroTone}
          className={cn(status.state === 'error' && 'border-st-err/45')}
          visual={
            <ConnectDial
              tone={heroTone === 'warn' ? 'on' : heroTone}
              pingMs={exitLagRunning ? (activeNode?.latencyMs ?? null) : null}
              size={128}
              label={isPerAppEnabled ? 'Выключить ExitLag' : 'Включить ExitLag'}
              onPress={() => void handleTogglePerAppProxy(!isPerAppEnabled)}
              disabled={!settings}
            />
          }
          title={
            <span className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
              {heroTitle}
              {exitLagRunning && appCount > 0 && (
                <span className="text-[13px] font-semibold tracking-normal text-primary">
                  {mode === 'bypass_only' ? 'режим исключений' : `${appCount} ${appWord}`}
                </span>
              )}
            </span>
          }
          text={heroText}
          extra={
            <div className="mt-1 flex w-full flex-col gap-2">
              <SplitLanes on={exitLagRunning} busy={heroTone === 'busy'} mode={mode} appCount={appCount} node={nodeName} />
              {applying && (
                <button
                  type="button"
                  onClick={() => {
                    void incyReapplyTunnel().then((ok) => {
                      if (ok) toast.info('Туннель переподключается в режиме ExitLag')
                    })
                  }}
                  className="w-fit cursor-pointer text-[12px] font-semibold text-st-warn-text underline-offset-2 hover:underline"
                  title="Переподключить туннель в режиме ExitLag"
                >
                  Завис? Переподключить туннель
                </button>
              )}
            </div>
          }
          actions={
            <>
              <Button
                size="lg"
                variant={isConnected ? 'outline' : 'default'}
                onClick={() => void handleToggleTunnel()}
                disabled={togglingCore}
                className="h-11 rounded-xl px-5 text-[14px]"
              >
                {togglingCore ? (
                  <RefreshCw className="size-4 animate-spin" />
                ) : isConnected ? (
                  <Square className="size-3.5 fill-current" />
                ) : (
                  <Play className="size-3.5 fill-current" />
                )}
                {isConnected ? 'Остановить VPN' : 'Запустить VPN'}
              </Button>
              <Button variant="outline" size="lg" onClick={() => navigate('/incy')} className="h-10 rounded-xl px-5 text-[13px]">
                Открыть INCY
                <ArrowRight className="size-4" />
              </Button>
            </>
          }
          footer={
            <div className="flex flex-wrap items-stretch gap-2">
              <StatChip
                icon={mode === 'bypass_only' ? <ShieldCheck /> : <Target />}
                tone={isPerAppEnabled ? 'on' : 'off'}
                label="Режим"
                value={!isPerAppEnabled ? 'выключен' : mode === 'bypass_only' ? 'все, кроме выбранных' : 'только выбранные'}
                title="Сменить режим"
                onClick={() => setTab('apps')}
              />
              <StatChip
                icon={<Gamepad2 />}
                tone={appCount > 0 ? 'on' : isPerAppEnabled ? 'warn' : 'off'}
                label="В списке"
                value={appCount > 0 ? `${appCount} ${appWord}` : 'пусто'}
                title="Открыть список программ"
                onClick={() => setTab('apps')}
              />
              <StatChip
                icon={<ShieldCheck />}
                tone={isConnected ? 'on' : connecting ? 'busy' : status.state === 'error' ? 'error' : 'off'}
                label="Туннель INCY"
                value={exitLagRunning ? 'фильтрует' : isConnected ? 'весь трафик' : connecting ? 'подключается…' : 'остановлен'}
                aside={
                  nodeName ? (
                    <span data-sensitive="node" className="max-w-[140px] shrink truncate rounded-md bg-primary/12 px-1.5 py-0.5 text-[11px] font-semibold text-primary">
                      {nodeName}
                    </span>
                  ) : undefined
                }
                title="Открыть INCY"
                onClick={() => navigate('/incy')}
                className="min-w-[200px] flex-1"
              />
              {!isLinuxPlatform && <StatChip
                icon={<FaceitBrandIcon />}
                label="Оптимизатор маршрута"
                value="пинг до сервера"
                title="Вставьте адрес сервера — покажем пинг, джиттер и потери через каждый узел"
                onClick={() => navigate('/optimizer')}
              />}
            </div>
          }
        />

        <div className="flex shrink-0 flex-wrap items-center gap-3">
          <Segmented
            items={[
              { id: 'apps', label: appCount ? `Программы ${appCount}` : 'Программы', icon: Gamepad2, title: 'Какие программы идут через VPN' },
              { id: 'traffic', label: 'Сеть приложений', icon: Activity, title: 'Кто выходит в сеть и каким путём' }
            ]}
            value={tab}
            onChange={setTab}
            aria-label="Разделы ExitLag"
            data-tour="exitlag-tabs"
            className="w-[340px]"
          />
          <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">
            {tab === 'apps' ? 'Список применяется сразу, переподключать VPN не нужно.' : 'Живые данные ядра VPN и проверка, с какого IP выходят программы.'}
          </span>
        </div>

        {tab === 'apps' && settings && (
          <LzPanel data-tour="exitlag-apps" className="space-y-4 p-4">
            <LzSectionHead
              title="Что идёт через VPN"
              hint="«Только выбранные» — через VPN идут программы из списка, остальное напрямую (так работает ExitLag). «Все, кроме выбранных» — наоборот: VPN для всего компьютера, а программы из списка идут напрямую."
              sub={
                mode === 'bypass_only'
                  ? 'Весь компьютер идёт через VPN, программы из списка — напрямую'
                  : 'Через VPN идут только программы из списка. Остальной трафик идёт напрямую.'
              }
              right={
                <Segmented
                  items={modeItems}
                  value={mode}
                  onChange={(m) => void handleSetPerAppMode(m)}
                  aria-label="Режим ExitLag"
                  data-tour="exitlag-mode"
                  className="w-[380px]"
                />
              }
            />

            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-[260px] flex-1">
                <Input
                  paste
                  value={newAppInput}
                  onChange={(e) => setNewAppInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleAddPerAppProcess(newAppInput)
                  }}
                  placeholder={isLinuxPlatform ? 'Имя или путь, например /usr/bin/curl' : isMacPlatform ? 'Приложение или процесс: /Applications/Discord.app или steam_osx' : 'Имя процесса: cs2.exe или discord.exe'}
                  className="h-9 rounded-xl border-foreground/[0.1] bg-foreground/[0.035] text-[13px]"
                />
              </div>
              <Button
                size="sm"
                type="button"
                onClick={() => void handleAddPerAppProcess(newAppInput)}
                disabled={!newAppInput.trim()}
                className="h-9 shrink-0 gap-1 rounded-xl text-xs font-semibold"
              >
                <Plus className="size-3.5" /> Добавить
              </Button>
              <span aria-hidden className="mx-1 h-6 w-px bg-foreground/[0.08]" />
              <Button size="sm" variant="outline" type="button" onClick={() => setShowGamesModal(true)} className="h-9 gap-1.5 rounded-xl text-xs">
                <Gamepad2 className="size-3.5" /> Найти игры
              </Button>
              <Button size="sm" variant="outline" type="button" onClick={() => void handleOpenProcessPicker()} className="h-9 gap-1.5 rounded-xl text-xs">
                <Monitor className="size-3.5" /> Из запущенных
              </Button>
              <Button size="sm" variant="outline" type="button" onClick={() => void handlePickExeFile()} className="h-9 gap-1.5 rounded-xl text-xs">
                <FolderOpen className="size-3.5" /> {usesExecutablePaths ? 'Обзор…' : 'Обзор .exe'}
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[12px] text-muted-foreground">Добавить набором:</span>
              {presets.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => void handleApplyPreset(p.apps)}
                  title={p.apps.map(appLabel).join(', ')}
                  className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-xl border border-foreground/[0.08] bg-foreground/[0.035] px-3 text-[12px] font-semibold text-foreground transition-colors hover:border-primary/40 hover:bg-foreground/[0.06] [&_svg]:size-3.5 [&_svg]:text-muted-foreground"
                >
                  {p.icon}
                  {p.label}
                </button>
              ))}
            </div>

            <div className="border-t border-foreground/[0.07] pt-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-[13px] font-semibold text-foreground">
                  В списке <span className="tabular-nums text-muted-foreground">{appCount}</span>
                </span>
                {appCount > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    type="button"
                    onClick={() => void handleClearPerAppProcesses()}
                    className="h-7 rounded-lg text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  >
                    Очистить всё
                  </Button>
                )}
              </div>
              {appCount > 0 ? (
                <div className="flex max-h-56 flex-wrap gap-2 overflow-y-auto">
                  {apps.map((proc) => (
                    <span
                      key={proc}
                      className={cn(
                        'group inline-flex items-center gap-2 rounded-xl border py-1.5 pr-1.5 pl-3 text-[12.5px] font-semibold transition-colors',
                        exitLagRunning ? 'border-primary/30 bg-primary/[0.07] text-foreground' : 'border-foreground/[0.08] bg-foreground/[0.035] text-foreground'
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn('size-1.5 shrink-0 rounded-full', exitLagRunning ? 'bg-primary' : 'bg-muted-foreground/45')}
                      />
                      <span title={usesExecutablePaths ? proc : undefined}>{appLabel(proc)}</span>
                      <button
                        type="button"
                        onClick={() => void handleRemovePerAppProcess(proc)}
                        className="flex size-6 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                        title="Убрать из списка"
                        aria-label={`Убрать ${appLabel(proc)}`}
                      >
                        <X className="size-3.5" />
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <EmptyState
                  compact
                  icon={<Gamepad2 />}
                  title="Список пока пуст"
                  text="Найдём установленные игры сами, или выберите программу из запущенных."
                  action={
                    <Button size="sm" className="h-9 gap-1.5 rounded-xl px-4 text-xs" onClick={() => setShowGamesModal(true)}>
                      <Gamepad2 className="size-3.5" />
                      Найти игры
                    </Button>
                  }
                />
              )}
            </div>
          </LzPanel>
        )}
        {tab === 'apps' && !settings && <div className="h-64 animate-pulse rounded-2xl bg-foreground/[0.04]" />}

        {tab === 'traffic' && (
          <ExitLagTrafficCard
            apps={apps}
            active={exitLagRunning}
            mode={mode}
            onAddApp={handleAddPerAppProcess}
            onRemoveApp={handleRemovePerAppProcess}
          />
        )}

        <InstalledGamesModal
          open={showGamesModal}
          onClose={() => setShowGamesModal(false)}
          existing={settings?.perAppProcesses ?? []}
          onAdd={async (names) => {
            const current = settings?.perAppProcesses ?? []
            const have = new Set(current.map((p) => p.toLowerCase()))
            const add = names.filter((n) => !have.has(n.toLowerCase()))
            if (add.length === 0) return
            await handleUpdateSettings({ perAppProcesses: [...current, ...add] })
            toast.success(`Добавлено: ${add.join(', ')}`)
          }}
        />

        {/* MODAL: PROCESS PICKER */}
        {showProcessPickerModal && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-200"
            onClick={() => setShowProcessPickerModal(false)}
          >
            <div
              className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border/70 bg-background shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between p-4 border-b border-border/40 bg-card/80">
                <div className="flex items-center gap-2">
                  <Monitor className="h-4 w-4 text-primary" />
                  <div className="text-sm font-bold text-foreground">
                    Выбор из запущенных процессов {OS_NAME}
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
                    Получение списка процессов {OS_NAME}...
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
                      const isAlreadyAdded = settings?.perAppProcesses?.some((proc) =>
                        usesExecutablePaths ? entryMatchesProc(proc, p.name, p.rule) : proc.toLowerCase() === p.name.toLowerCase()
                      )
                      return (
                        <div
                          key={p.rule ?? p.name}
                          onClick={() => {
                            void handleAddPerAppProcess(p.rule ?? p.name)
                            setShowProcessPickerModal(false)
                          }}
                          className={cn(
                            'flex items-center justify-between p-2.5 rounded-xl border transition-all cursor-pointer',
                            isAlreadyAdded
                              ? 'border-st-ok/40 bg-st-ok/10'
                              : 'border-border/50 bg-card/40 hover:bg-primary/10 hover:border-primary/50'
                          )}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-mono font-semibold text-foreground flex items-center gap-1.5">
                              {p.name}
                              {isAlreadyAdded && (
                                <Badge variant="secondary" className="text-[9px] px-1 py-0 bg-st-ok/20 text-st-ok-text">
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
