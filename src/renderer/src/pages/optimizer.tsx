import React, { useState, useEffect } from 'react'
import { toast } from 'sonner'
import BasePage from '@renderer/components/base/base-page'
import AutoSelectCard from '@renderer/components/auto-select-card'
import { Card, CardHeader, CardTitle, CardContent } from '@renderer/components/ui/card'
import { Button } from '@renderer/components/ui/button'
import { Badge } from '@renderer/components/ui/badge'
import { Input } from '@renderer/components/ui/input'
import { Switch } from '@renderer/components/ui/switch'
import { Target, Copy, Zap, RefreshCw } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { useIncyStore } from '@renderer/store/incy-store'
import {
  incyGetSettings,
  incyPatchSettings,
  incyGetNodes,
  incyConnect,
  incyDisconnect,
  incySelectNode,
  incyPingGameServer,
  zapretAddGameServerIp,
  type IncySettings,
  type IncyNode,
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

/**
 * Оптимизатор маршрута Faceit / CS2 — отдельная вкладка (раньше жил внутри
 * ExitLag). Замер: A2S-запросы к игровому серверу напрямую и через каждый
 * быстрый узел подписки; лучший узел — по пингу, джиттеру и потерям.
 */
export default function OptimizerPage(): React.ReactElement {
  const status = useIncyStore((s) => s.status)
  const isConnected = status.state === 'running'

  const [settings, setSettings] = useState<IncySettings | null>(null)
  const [nodes, setNodes] = useState<IncyNode[]>([])

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

  useEffect(() => {
    void Promise.all([incyGetSettings(), incyGetNodes()])
      .then(([s, n]) => {
        setSettings(s)
        setNodes(n)
      })
      .catch(() => void 0)
  }, [])

  const handleUpdateSettings = async (patch: Partial<IncySettings>): Promise<void> => {
    if (!settings) return
    setSettings({ ...settings, ...patch })
    try {
      const res = await incyPatchSettings(patch)
      setSettings(res.settings)
    } catch (e: any) {
      toast.error('Не удалось сохранить настройки', { description: e?.message || String(e) })
    }
  }

  /** IP сервера (без connect и порта) → наш список на вкладке Zapret. */
  const addTargetToZapret = async (target: string): Promise<void> => {
    try {
      setOptimizerProgress({ done: 0, total: 1, stage: 'Добавляю IP в список Zapret' })
      const r = await zapretAddGameServerIp(target)
      if (!r.ip) return
      if (r.added) {
        toast.success(`IP ${r.ip} добавлен в список Zapret`, {
          description: r.restarted
            ? 'Zapret перезапущен, чтобы применить список.'
            : r.running
              ? undefined
              : 'Список применится при следующем запуске Zapret.'
        })
      }
    } catch (e: any) {
      toast.error('Не удалось добавить IP в список Zapret', { description: e?.message || String(e) })
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
      // Сначала IP сервера — в список Zapret: если Zapret при этом
      // перезапускается, прямой замер должен идти уже с новыми правилами.
      if (settings?.optimizerAddToZapret !== false) await addTargetToZapret(targetToMeasure)
      const res = await incyPingGameServer(targetToMeasure)
      setGamePingResult(res)
      const best = res.nodes.find((n) => n.isBest)
      // Автоподключение выбирает лучший из РАЗРЕШЁННЫХ узлов — он может не
      // совпадать с общим лучшим, если тот исключён правилами автовыбора.
      const connected = res.autoConnectedNodeId
        ? res.nodes.find((n) => n.nodeId === res.autoConnectedNodeId)
        : undefined
      toast.success(
        connected
          ? `Подключено: ${cleanServerName(connected.nodeName)} — ${connected.totalPing} мс`
          : best
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

  return (
    <BasePage title="Оптимизатор маршрута">
      <div className="px-4 pb-8 space-y-4">
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

              <label className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-card/50 px-3 py-2 cursor-pointer">
                <span className="text-[11px] leading-snug">
                  <span className="font-semibold text-foreground">Автоподключение к лучшему узлу</span>
                  <span className="block text-muted-foreground">
                    После замера сразу переключиться на лучший узел из разрешённых для автовыбора (см. «Автовыбор узла»).
                    Выключено — только подсказка.
                  </span>
                </span>
                <Switch
                  checked={Boolean(settings?.routeAutoConnectBest)}
                  onCheckedChange={(v) => void handleUpdateSettings({ routeAutoConnectBest: v })}
                />
              </label>
              <label className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-card/50 px-3 py-2 cursor-pointer">
                <span className="text-[11px] leading-snug">
                  <span className="font-semibold text-foreground">Добавлять IP сервера в список Zapret</span>
                  <span className="block text-muted-foreground">
                    Только IP, без connect и порта — в наш список на вкладке Zapret (там же, где сайты). Иногда
                    это само по себе убирает потери и лаги. Работающий Zapret перезапустится на пару секунд.
                  </span>
                </span>
                <Switch
                  checked={settings?.optimizerAddToZapret !== false}
                  onCheckedChange={(v) => void handleUpdateSettings({ optimizerAddToZapret: v })}
                />
              </label>
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
                              {n.autoAllowed === false && (
                                <Badge
                                  variant="outline"
                                  className="text-[9px] px-1 py-0 text-muted-foreground"
                                  title="Узел исключён из автовыбора — вручную подключиться можно"
                                >
                                  не для автовыбора
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

        <AutoSelectCard settings={settings} nodes={nodes} onPatch={handleUpdateSettings} />
      </div>
    </BasePage>
  )
}
