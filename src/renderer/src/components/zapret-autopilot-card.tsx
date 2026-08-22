import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  Compass,
  Gamepad2,
  Headphones,
  Activity,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Loader2,
  ChevronDown,
  ChevronRight,
  Sparkles
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { Button } from '@renderer/components/ui/button'
import { Switch } from '@renderer/components/ui/switch'
import { cn, POWER_ON_BANNER_STYLE } from '@renderer/lib/utils'
import {
  autopilotGetStatus,
  autopilotSetEnabled,
  autopilotRunCycle,
  gameModeGetStatus,
  gameModeSetEnabled,
  discordPingRegions,
  type AutopilotStatus,
  type GameModeStatus,
  type DiscordRegionPing
} from '@renderer/utils/ipc'

const ZapretAutopilotCard: React.FC = () => {
  const [open, setOpen] = useState(false)
  const [autopilot, setAutopilot] = useState<AutopilotStatus | null>(null)
  const [gameMode, setGameMode] = useState<GameModeStatus | null>(null)
  const [discordPings, setDiscordPings] = useState<DiscordRegionPing[]>([])
  const [checkingAutopilot, setCheckingAutopilot] = useState(false)
  const [pingingDiscord, setPingingDiscord] = useState(false)

  const refresh = async (): Promise<void> => {
    try {
      const [ap, gm] = await Promise.all([autopilotGetStatus(), gameModeGetStatus()])
      setAutopilot(ap)
      setGameMode(gm)
    } catch { /* ignore */ }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const handleToggleAutopilot = async (enabled: boolean): Promise<void> => {
    try {
      const next = await autopilotSetEnabled(enabled)
      setAutopilot(next)
      toast.success(enabled ? 'Автопилот стратегий включен' : 'Автопилот выключен', {
        description: enabled ? 'LAZEYKA будет автоматически мониторить и подбирать рабочие стратегии' : undefined,
        style: POWER_ON_BANNER_STYLE
      })
    } catch (e: any) {
      toast.error('Ошибка переключения автопилота', { description: e?.message || String(e) })
    }
  }

  const handleToggleGameMode = async (enabled: boolean): Promise<void> => {
    try {
      const next = await gameModeSetEnabled(enabled)
      setGameMode(next)
      toast.success(enabled ? 'Умный игровой режим включен' : 'Игровой режим выключен', {
        description: enabled ? 'Game Filter будет автоматически включаться при запуске игр и Discord' : undefined,
        style: POWER_ON_BANNER_STYLE
      })
    } catch (e: any) {
      toast.error('Ошибка переключения игрового режима', { description: e?.message || String(e) })
    }
  }

  const handleRunAutopilotCheck = async (): Promise<void> => {
    if (checkingAutopilot) return
    setCheckingAutopilot(true)
    try {
      const next = await autopilotRunCycle(true)
      setAutopilot(next)
      toast.success('Проверка автопилота завершена', { style: POWER_ON_BANNER_STYLE })
    } catch (e: any) {
      toast.error('Ошибка проверки автопилота', { description: e?.message || String(e) })
    } finally {
      setCheckingAutopilot(false)
    }
  }

  const handlePingDiscord = async (): Promise<void> => {
    if (pingingDiscord) return
    setPingingDiscord(true)
    try {
      const results = await discordPingRegions()
      setDiscordPings(results)
    } catch {
      toast.error('Не удалось замерить пинг серверов Discord')
    } finally {
      setPingingDiscord(false)
    }
  }

  return (
    <Card className="cyber-card">
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <div className="min-w-0 flex-1">
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Автопилот & Игровой режим
          </CardTitle>
        </div>
        <Button
          variant={open ? 'secondary' : 'outline'}
          size="sm"
          onClick={() => setOpen((v) => !v)}
          className="shrink-0"
        >
          {open ? <><ChevronDown className="h-3.5 w-3.5" /> Свернуть</> : <><ChevronRight className="h-3.5 w-3.5" /> Открыть</>}
        </Button>
      </CardHeader>

      {open && (
        <CardContent className="space-y-5 pt-0">
          {/* 1. Autopilot */}
          <div className="rounded-lg border border-border bg-card/40 p-3.5 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-semibold uppercase tracking-wide text-foreground flex items-center gap-1.5">
                  <Compass className="h-3.5 w-3.5 text-primary" />
                  Автопилот стратегий (Smart Auto-Switch)
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Фоновый мониторинг доступности YouTube/Discord. При сбоях автоматически переключает Zapret на лучшую стратегию.
                </div>
              </div>
              <Switch
                checked={autopilot?.enabled ?? false}
                onCheckedChange={(v) => { void handleToggleAutopilot(v) }}
              />
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pt-1 border-t border-border/50 text-xs">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Статус соединения:</span>
                {autopilot?.lastStatus === 'healthy' ? (
                  <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-500 font-medium">
                    <CheckCircle2 className="h-3 w-3" /> Стабильно
                  </span>
                ) : autopilot?.lastStatus === 'degraded' ? (
                  <span className="inline-flex items-center gap-1 text-yellow-500 font-medium">
                    <AlertTriangle className="h-3 w-3" /> Деградация (подбор стратегии)
                  </span>
                ) : (
                  <span className="text-muted-foreground">Ожидание проверки</span>
                )}
              </div>

              <Button
                size="sm"
                variant="ghost"
                onClick={() => { void handleRunAutopilotCheck() }}
                disabled={checkingAutopilot}
                className="h-6 px-2 text-[11px] gap-1 self-start sm:self-center"
              >
                {checkingAutopilot ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                Проверить сейчас
              </Button>
            </div>

            {autopilot?.log && autopilot.log.length > 0 && (
              <div className="bg-background/80 rounded p-2 text-[10px] font-mono text-muted-foreground max-h-20 overflow-y-auto space-y-0.5">
                {autopilot.log.slice(0, 4).map((line, idx) => (
                  <div key={idx} className="truncate">{line}</div>
                ))}
              </div>
            )}
          </div>

          {/* 2. Smart Game Mode */}
          <div className="rounded-lg border border-border bg-card/40 p-3.5 space-y-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-semibold uppercase tracking-wide text-foreground flex items-center gap-1.5">
                  <Gamepad2 className="h-3.5 w-3.5 text-primary" />
                  Умный игровой режим (Smart Game Mode)
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Автоматически включает Game Filter (порты 1024-65535) при запуске Steam, Discord, CS2, Valorant, Dota 2, Apex.
                </div>
              </div>
              <Switch
                checked={gameMode?.enabled ?? false}
                onCheckedChange={(v) => { void handleToggleGameMode(v) }}
              />
            </div>

            {gameMode?.activeGameDetected && (
              <div className="inline-flex items-center gap-1.5 text-xs text-primary bg-primary/10 px-2 py-0.5 rounded">
                <Gamepad2 className="h-3.5 w-3.5" /> Обнаружена игра: <span className="font-semibold">{gameMode.activeGameDetected}</span>
              </div>
            )}
          </div>

          {/* 3. Discord Voice RTC Ping */}
          <div className="rounded-lg border border-border bg-card/40 p-3.5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wide text-foreground flex items-center gap-1.5">
                <Headphones className="h-3.5 w-3.5 text-primary" />
                Discord Voice RTC (Замер задержки голосовых серверов)
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => { void handlePingDiscord() }}
                disabled={pingingDiscord}
                className="h-6 px-2 text-[11px] gap-1"
              >
                {pingingDiscord ? <Loader2 className="h-3 w-3 animate-spin" /> : <Activity className="h-3 w-3" />}
                Замерить пинг
              </Button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {(discordPings.length > 0 ? discordPings : [
                { id: '1', name: 'Stockholm (Near RU)', location: 'Стокгольм', latencyMs: null, status: 'optimal' as const, endpoint: '' },
                { id: '2', name: 'Frankfurt (EU Central)', location: 'Франкфурт', latencyMs: null, status: 'optimal' as const, endpoint: '' },
                { id: '3', name: 'Rotterdam / Amsterdam', location: 'Роттердам', latencyMs: null, status: 'optimal' as const, endpoint: '' }
              ]).map((r) => (
                <div key={r.id} className="rounded border border-border/60 bg-background/50 p-2 flex items-center justify-between">
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-foreground truncate">{r.name}</div>
                    <div className="text-[10px] text-muted-foreground">{r.location}</div>
                  </div>
                  {r.latencyMs !== null ? (
                    <span className={cn(
                      'rounded px-1.5 py-0.5 text-[10px] font-mono font-medium',
                      r.latencyMs < 65 && 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-500',
                      r.latencyMs >= 65 && r.latencyMs < 120 && 'bg-yellow-500/15 text-yellow-500',
                      r.latencyMs >= 120 && 'bg-red-500/15 text-red-500'
                    )}>
                      {r.latencyMs} мс
                    </span>
                  ) : (
                    <span className="text-[10px] text-muted-foreground font-mono">-- мс</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  )
}

export default ZapretAutopilotCard
