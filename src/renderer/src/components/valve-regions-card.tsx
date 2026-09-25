import React, { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Globe2, Loader2, Settings2, ShieldPlus } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@renderer/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { cn } from '@renderer/lib/utils'
import {
  optimizerValveRegions,
  incySelectNode,
  incyConnect,
  zapretAddValveServers,
  zapretGetGameFilter,
  zapretGetIpsetFilter,
  type GameFilterMode,
  type IpsetFilterMode,
  type ValveRegionsReport
} from '@renderer/utils/ipc'

function cleanName(name: string): string {
  return name.replace(/^[\p{Extended_Pictographic}\p{Regional_Indicator}️‍\s]+/u, '').trim()
}

function tone(ms: number | null | undefined): string {
  if (ms == null) return 'text-muted-foreground'
  if (ms < 50) return 'text-emerald-600 dark:text-emerald-400'
  if (ms < 90) return 'text-amber-600 dark:text-amber-400'
  return 'text-rose-600 dark:text-rose-400'
}

/**
 * Регионы Valve для CS2 и Dota 2: прямой пинг до точек Steam Datagram Relay
 * и лучший узел VPN для каждой (оценка по расстоянию).
 */
const ValveRegionsCard: React.FC = () => {
  const [report, setReport] = useState<ValveRegionsReport | null>(null)
  const [running, setRunning] = useState(false)
  const [stage, setStage] = useState<{ done: number; total: number; stage: string } | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [adding, setAdding] = useState(false)
  const navigate = useNavigate()
  // Условия, без которых Zapret не трогает игровой трафик Valve (UDP):
  // Game Filter с UDP и IPset не «Выкл».
  const [filters, setFilters] = useState<{ game: GameFilterMode; ipset: IpsetFilterMode } | null>(null)

  const loadFilters = async (): Promise<void> => {
    try {
      const [game, ip] = await Promise.all([zapretGetGameFilter(), zapretGetIpsetFilter()])
      setFilters({ game, ipset: ip.mode })
    } catch {
      setFilters(null)
    }
  }

  useEffect(() => {
    void loadFilters()
    // Настройки могли поменять, пока окно было неактивно: перечитываем при возврате.
    const onFocus = (): void => void loadFilters()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  const gameOk = filters ? filters.game === 'all' || filters.game === 'udp' : true
  const ipsetOk = filters ? filters.ipset !== 'none' : true
  const GAME_LABEL: Record<GameFilterMode, string> = { off: 'Выкл', all: 'TCP + UDP', tcp: 'TCP', udp: 'UDP' }

  const addToZapret = async (): Promise<void> => {
    if (adding) return
    setAdding(true)
    try {
      const r = await zapretAddValveServers()
      const what =
        r.added > 0 || r.ipsetAdded > 0
          ? `Серверы Valve добавлены в Zapret (${r.subnets} подсетей: вся сеть Valve и ретрансляторы CS2 и Dota 2)`
          : 'Серверы Valve уже есть в списках Zapret'
      const tail = r.restarted
        ? 'Zapret перезапущен, правила уже действуют.'
        : r.running
          ? ''
          : 'Начнут действовать при запуске Zapret.'
      const ready = r.gameFilterUdp && r.ipsetMode !== 'none'
      toast.success(what, {
        description: ready
          ? tail || undefined
          : 'Осталось включить Game Filter и IPset в настройках Zapret — подсказка под кнопкой.'
      })
      void loadFilters()
    } catch (e) {
      toast.error('Не удалось добавить серверы Valve', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setAdding(false)
    }
  }

  useEffect(() => {
    const listener = (_e: unknown, p: { done: number; total: number; stage: string }): void => setStage(p)
    window.electron.ipcRenderer.on('optimizer:valveProgress', listener)
    return () => {
      window.electron.ipcRenderer.removeListener('optimizer:valveProgress', listener)
    }
  }, [])

  const run = async (): Promise<void> => {
    if (running) return
    setRunning(true)
    try {
      setReport(await optimizerValveRegions())
    } catch (e) {
      toast.error('Замер регионов не удался', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setRunning(false)
      setStage(null)
    }
  }

  const connect = async (nodeId: string, nodeName: string): Promise<void> => {
    try {
      await incySelectNode(nodeId)
      await incyConnect(nodeId)
      toast.success(`Подключено через «${cleanName(nodeName)}»`)
    } catch (e) {
      toast.error('Не удалось подключиться', { description: e instanceof Error ? e.message : String(e) })
    }
  }

  const rows = report ? (showAll ? report.regions : report.regions.slice(0, 10)) : []

  return (
    <Card className="cyber-card">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2">
            <Globe2 className="h-4 w-4 text-primary" />
            Регионы Valve (CS2, Dota 2)
          </span>
          <Button size="sm" className="h-8 gap-1.5 text-xs" disabled={running} onClick={() => void run()}>
            {running && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {running ? (stage ? `${stage.stage} ${stage.total > 1 ? `${stage.done}/${stage.total}` : ''}` : 'Замер…') : report ? 'Ещё раз' : 'Замерить регионы'}
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-background/40 px-3 py-2">
          <p className="text-xs text-muted-foreground">
            Одна кнопка, вводить ничего не нужно: в Zapret попадает вся сеть Valve и ретрансляторы
            CS2 и Dota 2 из списков самого Steam. Поле «connect IP» выше нужно только для Faceit.
          </p>
          <Button size="sm" variant="outline" className="h-7 shrink-0 gap-1.5 text-xs" disabled={adding} onClick={() => void addToZapret()}>
            {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldPlus className="h-3.5 w-3.5" />}
            Добавить в Zapret
          </Button>
        </div>

        {filters && (gameOk && ipsetOk ? (
          <p className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            Game Filter ({GAME_LABEL[filters.game]}) и IPset включены: Zapret обрабатывает игровой трафик Valve.
          </p>
        ) : (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2">
            <div className="min-w-0 space-y-1 text-xs">
              <p className="flex items-center gap-1.5 font-semibold text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                Чтобы это работало в игре, включите в настройках Zapret:
              </p>
              {!gameOk && (
                <p className="text-muted-foreground">
                  • Game Filter: <span className="font-semibold text-foreground">TCP + UDP</span> (сейчас «{GAME_LABEL[filters.game]}»)
                </p>
              )}
              {!ipsetOk && (
                <p className="text-muted-foreground">
                  • IPset Filter: <span className="font-semibold text-foreground">Список</span> (сейчас «Выкл»). Если кнопка
                  неактивна, сначала нажмите «Обновить IPSet список».
                </p>
              )}
            </div>
            <Button
              size="sm"
              className="h-7 shrink-0 gap-1.5 text-xs"
              onClick={() => navigate('/zapret', { state: { focusFilters: true } })}
            >
              <Settings2 className="h-3.5 w-3.5" />
              Открыть настройки
            </Button>
          </div>
        ))}

        <p className="text-xs text-muted-foreground">
          Обычный матчмейкинг Valve выбирает сервер по пингу до этих точек. «Напрямую» — настоящий пинг с этого
          ПК мимо VPN. «Через VPN» — оценка: задержка до узла плюс расстояние от узла до точки Valve.
        </p>

        {report && (
          <div className="overflow-hidden rounded-xl border border-border/60">
            <div className="grid grid-cols-[1fr_90px_1.4fr] gap-2 bg-muted/40 px-3 py-2 text-[11px] font-semibold text-muted-foreground">
              <span>Регион</span>
              <span>Напрямую</span>
              <span>Через VPN (оценка)</span>
            </div>
            {rows.map((r) => {
              const better = r.best && (r.directMs == null || r.best.estimateMs < r.directMs)
              return (
                <div key={r.code} className="grid grid-cols-[1fr_90px_1.4fr] items-center gap-2 border-t border-border/40 px-3 py-1.5 text-xs">
                  <span className="truncate font-medium">{r.name}</span>
                  <span className={cn('font-mono font-semibold', tone(r.directMs))}>
                    {r.directMs == null ? '—' : `${r.directMs} мс`}
                  </span>
                  <span className="flex min-w-0 items-center justify-between gap-2">
                    {r.best ? (
                      <>
                        <span className="min-w-0 truncate">
                          <span className={cn('font-mono font-semibold', tone(r.best.estimateMs))}>~{r.best.estimateMs} мс</span>
                          <span className="text-muted-foreground"> · {cleanName(r.best.nodeName)}</span>
                        </span>
                        {better && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 shrink-0 px-2 text-[11px]"
                            onClick={() => void connect(r.best!.nodeId, r.best!.nodeName)}
                          >
                            Подключить
                          </Button>
                        )}
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </span>
                </div>
              )
            })}
          </div>
        )}

        {report && report.regions.length > 10 && (
          <button type="button" className="text-xs font-semibold text-primary" onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'Показать только ближайшие' : `Показать все регионы (${report.regions.length})`}
          </button>
        )}
        {report && report.nodesWithoutGeo > 0 && (
          <p className="text-[11px] text-muted-foreground">
            У {report.nodesWithoutGeo} узлов не удалось определить местоположение — для них оценки нет.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

export default ValveRegionsCard
