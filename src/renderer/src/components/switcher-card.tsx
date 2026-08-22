import React from 'react'
import { Switch } from '@renderer/components/ui/switch'
import { cn } from '@renderer/lib/utils'
import { Loader2 } from 'lucide-react'

interface SwitcherCardProps {
  icon: React.ComponentType<{ className?: string }>
  title: string
  subtitle?: React.ReactNode
  status: CoreStatus
  onToggle: (next: boolean) => void | Promise<void>
  footer?: React.ReactNode
  onClick?: () => void
  className?: string
  version?: string
  /**
   * Подпись, когда версия ядра неизвестна. Она записывается в конфиг только
   * после обновления через LAZEYKA, у бинарника из установщика её нет —
   * и пустое место читалось как «версия потерялась».
   */
  versionFallback?: string
  disabled?: boolean
}

const stateText: Record<CoreStatusState, string> = {
  stopped:  'Выключен',
  starting: 'Запуск…',
  running:  'Активен',
  stopping: 'Остановка…',
  error:    'Ошибка'
}

const SwitcherCard: React.FC<SwitcherCardProps> = ({
  icon: Icon,
  title,
  subtitle,
  status,
  onToggle,
  footer,
  onClick,
  className,
  version,
  versionFallback,
  disabled = false
}) => {
  const [pending, setPending] = React.useState<null | boolean>(null)
  const ipcRunning = status.state === 'running'
  const on = pending ?? ipcRunning
  const ipcTransitioning = status.state === 'starting' || status.state === 'stopping'
  const transitioning = ipcTransitioning || pending !== null
  const errored = status.state === 'error'
  const locked = transitioning || disabled

  const handleChange = async (next: boolean): Promise<void> => {
    if (locked) return
    setPending(next)
    try {
      await Promise.resolve(onToggle(next))
    } finally {
      setPending(null)
    }
  }

  return (
    <div
      onClick={onClick}
      className={cn(
        'relative overflow-hidden rounded-2xl border p-4.5 transition-all duration-300',
        'flex flex-col gap-3.5',
        onClick && 'cursor-pointer hover:-translate-y-0.5',
        on &&
          'border-emerald-500/40 bg-gradient-to-br from-emerald-500/15 via-emerald-100/40 to-card/95 dark:via-emerald-950/20 shadow-[0_8px_30px_rgba(0,0,0,0.08),0_0_20px_-3px_rgba(16,185,129,0.2)] dark:shadow-[0_8px_30px_rgba(0,0,0,0.5),0_0_20px_-3px_rgba(16,185,129,0.25)]',
        !on && !errored &&
          'cyber-card cyber-card-hover',
        errored &&
          'border-rose-500/40 bg-gradient-to-br from-rose-500/15 via-rose-100/40 to-card/95 dark:via-rose-950/20 shadow-[0_0_20px_-3px_rgba(244,63,94,0.25)]',
        className
      )}
    >
      <div className="flex items-start gap-3.5">
        <div
          className={cn(
            'size-11 rounded-xl flex items-center justify-center shrink-0 transition-all duration-300',
            on && 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 shadow-[0_0_12px_rgba(16,185,129,0.3)]',
            !on && !errored && 'bg-foreground/[0.06] text-muted-foreground border border-border/60',
            errored && 'bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/30'
          )}
        >
          <Icon className="size-5.5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-base font-bold tracking-tight text-foreground truncate">{title}</div>
          {subtitle && (
            <div className="text-xs truncate mt-0.5 text-muted-foreground">
              {subtitle}
            </div>
          )}
        </div>
        <div className="shrink-0 flex flex-col items-end gap-1.5" onClick={(e) => e.stopPropagation()}>
          <Switch
            checked={on}
            disabled={locked}
            onCheckedChange={handleChange}
          />
          {(version || versionFallback) && (
            <div
              className="text-[10px] font-mono text-muted-foreground/70 tabular-nums"
              title={
                version
                  ? undefined
                  : 'Ядро из установщика — номер появится после первого обновления через LAZEYKA'
              }
            >
              {version ? `v${version}` : versionFallback}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between pt-1 border-t border-border/40">
        <div className="flex items-center gap-1.5 text-xs font-semibold">
          {transitioning && <Loader2 className="size-3 animate-spin text-primary" />}
          <div className={cn(
            'size-2 rounded-full',
            on ? 'bg-emerald-500 dark:bg-emerald-400 shadow-[0_0_8px_#34d399] animate-pulse' : errored ? 'bg-rose-500 dark:bg-rose-400' : 'bg-muted-foreground/40'
          )} />
          <span className={on ? 'text-emerald-600 dark:text-emerald-400' : errored ? 'text-rose-600 dark:text-rose-400' : 'text-muted-foreground'}>
            {stateText[status.state]}
          </span>
        </div>
        {footer && (
          <div className="text-xs text-muted-foreground font-medium">
            {footer}
          </div>
        )}
      </div>

      {errored && status.lastError && (
        <div className="text-[11px] text-rose-300 bg-rose-950/40 border border-rose-500/30 rounded-lg px-2.5 py-1.5 truncate">
          {status.lastError}
        </div>
      )}
    </div>
  )
}

export default SwitcherCard
