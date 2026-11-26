import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Compass, Gamepad2, Headphones, Activity, RefreshCw, Loader2 } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Rows, SettingRow, SettingsGroup, SwitchRow } from '@renderer/components/settings/setting-row'
import { useZapretMeta } from '@renderer/components/zapret/zapret-meta'
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

const ZapretAutopilotCard = (): React.JSX.Element => {
  const patchMeta = useZapretMeta((s) => s.patch)
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
      patchMeta({ autopilot: next })
      toast.success(enabled ? 'Автопилот стратегий включен' : 'Автопилот выключен', {
        description: enabled ? 'LAZEYKA будет автоматически мониторить и подбирать рабочие стратегии' : undefined,
        style: POWER_ON_BANNER_STYLE
      })
    } catch (e) {
      toast.error('Ошибка переключения автопилота', { description: e instanceof Error ? e.message : String(e) })
    }
  }

  const handleToggleGameMode = async (enabled: boolean): Promise<void> => {
    try {
      const next = await gameModeSetEnabled(enabled)
      setGameMode(next)
      patchMeta({ gameMode: next })
      toast.success(enabled ? 'Умный игровой режим включен' : 'Игровой режим выключен', {
        description: enabled ? 'Game Filter будет автоматически включаться при запуске игр и Discord' : undefined,
        style: POWER_ON_BANNER_STYLE
      })
    } catch (e) {
      toast.error('Ошибка переключения игрового режима', { description: e instanceof Error ? e.message : String(e) })
    }
  }

  const handleRunAutopilotCheck = async (): Promise<void> => {
    if (checkingAutopilot) return
    setCheckingAutopilot(true)
    try {
      const next = await autopilotRunCycle(true)
      setAutopilot(next)
      patchMeta({ autopilot: next })
      toast.success('Проверка автопилота завершена', { style: POWER_ON_BANNER_STYLE })
    } catch (e) {
      toast.error('Ошибка проверки автопилота', { description: e instanceof Error ? e.message : String(e) })
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

  const apState =
    autopilot?.lastStatus === 'healthy'
      ? { text: 'Последняя проверка: всё открывается', cls: 'text-st-ok-text' }
      : autopilot?.lastStatus === 'degraded'
        ? { text: 'Последняя проверка: сайты открываются плохо, ищет замену', cls: 'text-st-warn-text' }
        : autopilot?.lastStatus === 'switching'
          ? { text: 'Переключает стратегию…', cls: 'text-primary' }
          : { text: 'Ещё не проверял', cls: 'text-muted-foreground' }

  return (
    <SettingsGroup title="Автопилот и игры" hint="Программа сама следит за стратегией и включает Game Filter, когда запускается игра." data-tour="zapret-autopilot">
      <Rows>
        <SwitchRow
          id="zapret-autopilot"
          icon={<Compass />}
          title="Автопилот стратегий"
          desc="Время от времени проверяет YouTube и Discord и при сбое переключает Zapret на лучшую стратегию"
          checked={autopilot?.enabled ?? false}
          onChange={(v) => void handleToggleAutopilot(v)}
          below={
            autopilot && (autopilot.enabled || autopilot.lastStatus !== 'idle') ? (
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
                  <span className={apState.cls}>{apState.text}</span>
                  <button
                    type="button"
                    onClick={() => void handleRunAutopilotCheck()}
                    disabled={checkingAutopilot}
                    className="inline-flex cursor-pointer items-center gap-1 font-semibold text-primary hover:underline disabled:opacity-50"
                  >
                    {checkingAutopilot ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
                    Проверить сейчас
                  </button>
                </div>
                {autopilot?.log && autopilot.log.length > 0 && (
                  <div className="space-y-0.5 rounded-lg bg-foreground/[0.04] px-2.5 py-1.5 text-[11px] text-muted-foreground">
                    {autopilot.log.slice(0, 3).map((line, idx) => (
                      <div key={idx} className="truncate" title={line}>
                        {line}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : undefined
          }
        />
        <SwitchRow
          id="zapret-game-mode"
          icon={<Gamepad2 />}
          title="Игровой режим"
          desc="Включает Game Filter, когда запущены Steam, Discord, CS2, Valorant, Dota 2 или Apex"
          checked={gameMode?.enabled ?? false}
          onChange={(v) => void handleToggleGameMode(v)}
          aside={
            gameMode?.activeGameDetected ? (
              <span className="rounded-md bg-primary/12 px-1.5 py-0.5 text-[11px] font-semibold text-primary">{gameMode.activeGameDetected}</span>
            ) : undefined
          }
        />
        <SettingRow
          id="zapret-discord-rtc"
          icon={<Headphones />}
          title="Голосовые серверы Discord"
          desc="Задержка до ближайших серверов голоса"
          on={discordPings.length > 0}
          control={
            <Button size="sm" variant="outline" onClick={() => void handlePingDiscord()} disabled={pingingDiscord} className="h-8 rounded-lg text-xs">
              {pingingDiscord ? <Loader2 className="size-3.5 animate-spin" /> : <Activity className="size-3.5" />}
              Замерить
            </Button>
          }
          below={
            discordPings.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {discordPings.map((r) => (
                  <span
                    key={r.id}
                    title={r.name}
                    className="inline-flex items-center gap-2 rounded-lg border border-foreground/[0.08] bg-foreground/[0.035] px-2.5 py-1 text-[12px]"
                  >
                    <span className="text-foreground">{r.location}</span>
                    <span
                      className={cn(
                        'font-bold tabular-nums',
                        r.latencyMs === null
                          ? 'text-st-err-text'
                          : r.latencyMs < 65
                            ? 'text-primary'
                            : r.latencyMs < 120
                              ? 'text-st-warn-text'
                              : 'text-st-err-text'
                      )}
                    >
                      {r.latencyMs === null ? 'нет ответа' : `${r.latencyMs} мс`}
                    </span>
                  </span>
                ))}
              </div>
            ) : undefined
          }
        />
      </Rows>
    </SettingsGroup>
  )
}

export default ZapretAutopilotCard
