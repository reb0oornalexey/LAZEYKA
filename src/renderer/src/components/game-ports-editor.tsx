import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Check, Loader2, RotateCcw } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { cn, POWER_ON_BANNER_STYLE } from '@renderer/lib/utils'
import {
  zapretGetGameFilterSettings,
  zapretSetGameFilterSettings,
  type GameFilterMode,
  type GameFilterSettings
} from '@renderer/utils/ipc'
import {
  combinePresets,
  DEFAULT_GAME_PORTS,
  GAME_PORT_PRESETS,
  parsePorts,
  portsCovered
} from '@renderer/lib/game-port-presets'

interface Props {
  disabled?: boolean
  /** Текущий режим из родительской карточки — при смене перечитываем порты. */
  mode: GameFilterMode | null
  onModeChange: (mode: GameFilterMode) => void
}

/**
 * Свои порты для Game Filter (Flowseal 1.10.3+: utils/game_filter.enabled
 * в формате mode=/tcp=/udp=). Пресеты можно выбирать по несколько — порты
 * объединяются, режим (TCP/UDP/оба) подбирается сам.
 */
const GamePortsEditor: React.FC<Props> = ({ disabled = false, mode, onModeChange }) => {
  const [settings, setSettings] = useState<GameFilterSettings | null>(null)
  const [tcp, setTcp] = useState('')
  const [udp, setUdp] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState<'apply' | 'reset' | null>(null)

  const load = async (): Promise<void> => {
    try {
      const s = await zapretGetGameFilterSettings()
      setSettings(s)
      setTcp(s.tcp)
      setUdp(s.udp)
      // Подсвечиваем пресеты, которые уже целиком входят в свои порты.
      const custom = s.tcp !== DEFAULT_GAME_PORTS || s.udp !== DEFAULT_GAME_PORTS
      setSelected(custom
        ? GAME_PORT_PRESETS.filter((p) =>
            (!p.tcp || s.tcp !== DEFAULT_GAME_PORTS) && (!p.udp || s.udp !== DEFAULT_GAME_PORTS) &&
            portsCovered(p.tcp, s.tcp) && portsCovered(p.udp, s.udp)).map((p) => p.id)
        : [])
    } catch {
      setSettings(null)
    }
  }

  useEffect(() => { void load() }, [mode])

  const togglePreset = (id: string): void => {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]
    setSelected(next)
    if (!next.length) {
      setTcp(DEFAULT_GAME_PORTS)
      setUdp(DEFAULT_GAME_PORTS)
      return
    }
    const combined = combinePresets(GAME_PORT_PRESETS.filter((p) => next.includes(p.id)))
    setTcp(combined.tcp || DEFAULT_GAME_PORTS)
    setUdp(combined.udp || DEFAULT_GAME_PORTS)
  }

  /** Какой режим получится из выбранных пресетов. */
  const presetMode = useMemo<GameFilterMode | null>(() => {
    if (!selected.length) return null
    const chosen = GAME_PORT_PRESETS.filter((p) => selected.includes(p.id))
    const hasTcp = chosen.some((p) => p.tcp)
    const hasUdp = chosen.some((p) => p.udp)
    return hasTcp && hasUdp ? 'all' : hasTcp ? 'tcp' : 'udp'
  }, [selected])

  const tcpValid = !tcp.trim() || parsePorts(tcp) !== null
  const udpValid = !udp.trim() || parsePorts(udp) !== null
  const dirty = !!settings && (tcp.replace(/\s+/g, '') !== settings.tcp || udp.replace(/\s+/g, '') !== settings.udp ||
    (presetMode !== null && presetMode !== settings.mode))
  const custom = !!settings && (settings.tcp !== DEFAULT_GAME_PORTS || settings.udp !== DEFAULT_GAME_PORTS)

  const apply = async (reset = false): Promise<void> => {
    if (busy || !settings) return
    setBusy(reset ? 'reset' : 'apply')
    try {
      let nextMode: GameFilterMode = settings.mode
      if (!reset) {
        if (presetMode) nextMode = presetMode
        else if (nextMode === 'off') nextMode = 'all'
      }
      const res = await zapretSetGameFilterSettings({
        mode: nextMode,
        tcp: reset ? DEFAULT_GAME_PORTS : tcp,
        udp: reset ? DEFAULT_GAME_PORTS : udp
      })
      setSettings(res)
      setTcp(res.tcp)
      setUdp(res.udp)
      if (reset) setSelected([])
      onModeChange(res.mode)
      toast.success(reset ? 'Порты сброшены на 1024-65535' : 'Порты Game Filter сохранены', {
        description: 'Если Zapret включён, он перезапущен — изменения уже действуют',
        style: POWER_ON_BANNER_STYLE
      })
    } catch (e) {
      toast.error('Не удалось сохранить порты', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(null)
    }
  }

  if (!settings) return null

  if (!settings.rangesSupported) {
    return (
      <p className="mt-2 text-xs text-muted-foreground">
        Свои порты и пресеты игр доступны в Zapret 1.10.3 и новее
        {settings.bundleVersion ? ` (сейчас ${settings.bundleVersion})` : ''} — обновите Zapret.
      </p>
    )
  }

  const off = disabled || !!busy

  return (
    <div className="mt-3 space-y-2.5 rounded-xl border border-border/60 bg-background/30 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-foreground">Только для своих игр</span>
        <span className="text-[11px] text-muted-foreground">
          {custom ? 'Сейчас: свои порты' : 'Сейчас: все порты 1024-65535'}
        </span>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Вместо всех портов Zapret будет трогать только порты выбранных игр — меньше шанс сломать
        другие программы (банк-клиенты, торренты, TeamSpeak). Можно выбрать несколько игр — порты сложатся.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {GAME_PORT_PRESETS.map((p) => {
          const active = selected.includes(p.id)
          return (
            <button
              key={p.id}
              type="button"
              disabled={off}
              onClick={() => togglePreset(p.id)}
              title={`${p.hint ?? ''}${p.tcp ? `\nTCP: ${p.tcp}` : ''}${p.udp ? `\nUDP: ${p.udp}` : ''}`}
              className={cn(
                'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium transition',
                active ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:bg-accent/30',
                off && 'pointer-events-none opacity-50'
              )}
            >
              {active && <Check className="size-3" />}
              {p.name}
            </button>
          )
        })}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="text-[11px] text-muted-foreground">TCP-порты</span>
          <Input
            paste
            value={tcp}
            disabled={off}
            aria-invalid={!tcpValid}
            onChange={(e) => { setTcp(e.target.value); setSelected([]) }}
            placeholder={DEFAULT_GAME_PORTS}
            className="h-8 font-mono text-xs"
          />
        </label>
        <label className="space-y-1">
          <span className="text-[11px] text-muted-foreground">UDP-порты</span>
          <Input
            paste
            value={udp}
            disabled={off}
            aria-invalid={!udpValid}
            onChange={(e) => { setUdp(e.target.value); setSelected([]) }}
            placeholder={DEFAULT_GAME_PORTS}
            className="h-8 font-mono text-xs"
          />
        </label>
      </div>
      {(!tcpValid || !udpValid) && (
        <p className="text-[11px] text-rose-600 dark:text-rose-400">
          Формат: 27015 или 27015-27050, через запятую, числа до 65535.
        </p>
      )}
      {presetMode && presetMode !== mode && (
        <p className="text-[11px] text-muted-foreground">
          Режим переключится на {presetMode === 'all' ? 'TCP + UDP' : presetMode.toUpperCase()} — так нужно выбранным играм.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          className="h-8 rounded-xl text-xs gap-1.5"
          disabled={off || !dirty || !tcpValid || !udpValid}
          onClick={() => { void apply(false) }}
        >
          {busy === 'apply' ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
          Применить
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-8 rounded-xl text-xs gap-1.5"
          disabled={off || (!custom && !dirty)}
          onClick={() => { void apply(true) }}
        >
          {busy === 'reset' ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
          Все порты (по умолчанию)
        </Button>
      </div>
    </div>
  )
}

export default GamePortsEditor
