import React from 'react'
import { Gamepad2, Globe, Monitor, ShieldCheck } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import '@renderer/components/lz/lz.css'

/*
 * Два пути трафика ExitLag в пульте: «программы из списка → VPN» и «всё остальное →
 * напрямую» (в режиме исключений — наоборот). Работает — по линии VPN бегут точки
 * (lz-travel), прямой путь — тихая сплошная линия. Выключено — пунктир без движения.
 * Только отображение: режим, число программ и узел берутся со страницы.
 */

interface Props {
  /** Туннель поднят и ExitLag применён ядром. */
  on: boolean
  busy: boolean
  mode: 'proxy_only' | 'bypass_only'
  appCount: number
  /** Название узла VPN (без префикса подписки) или null. */
  node: string | null
}

const Pill: React.FC<{ icon: React.ReactNode; label: React.ReactNode; lit: boolean; strong?: boolean; sensitive?: string; title?: string; className?: string }> = ({
  icon,
  label,
  lit,
  strong,
  sensitive,
  title,
  className
}) => (
  <span
    title={title}
    className={cn(
      'flex min-w-0 items-center gap-1.5 rounded-lg border px-2 py-1 text-[12px] font-semibold whitespace-nowrap transition-colors duration-300 [&_svg]:size-3.5 [&_svg]:shrink-0',
      lit
        ? strong
          ? 'border-primary/45 bg-primary/15 text-primary'
          : 'border-primary/25 bg-primary/[0.07] text-foreground'
        : 'border-foreground/[0.09] bg-foreground/[0.04] text-muted-foreground',
      className
    )}
  >
    {icon}
    <span data-sensitive={sensitive} className="truncate">
      {label}
    </span>
  </span>
)

const Line: React.FC<{ kind: 'vpn' | 'direct'; on: boolean; busy: boolean }> = ({ kind, on, busy }) => (
  <span
    aria-hidden
    className={cn(
      'h-2 min-w-6 flex-1',
      kind === 'vpn'
        ? on
          ? 'lz-travel text-primary'
          : busy
            ? 'lz-rail-flow mt-[3px] h-[2px] text-primary/50'
            : 'border-t border-dashed border-foreground/20 mt-[3px]'
        : on
          ? 'mt-[3px] h-0 border-t border-foreground/25'
          : 'mt-[3px] h-0 border-t border-dashed border-foreground/15'
    )}
  />
)

export const SplitLanes: React.FC<Props> = ({ on, busy, mode, appCount, node }) => {
  const appsLabel = appCount > 0 ? `Программы из списка · ${appCount}` : 'Программы из списка'
  const vpnSrc = mode === 'proxy_only' ? appsLabel : 'Всё остальное'
  const directSrc = mode === 'proxy_only' ? 'Всё остальное' : appsLabel
  const lanes: { kind: 'vpn' | 'direct'; src: string; srcIcon: React.ReactNode }[] = [
    { kind: 'vpn', src: vpnSrc, srcIcon: mode === 'proxy_only' ? <Gamepad2 /> : <Monitor /> },
    { kind: 'direct', src: directSrc, srcIcon: mode === 'proxy_only' ? <Monitor /> : <Gamepad2 /> }
  ]
  return (
    <div data-tour="exitlag-lanes" className="grid w-full max-w-[560px] grid-cols-[minmax(0,auto)_1fr_minmax(0,auto)] items-center gap-x-2 gap-y-2">
      {lanes.map((l) => (
        <React.Fragment key={l.kind}>
          <Pill icon={l.srcIcon} label={l.src} lit={on && l.kind === 'vpn'} />
          <Line kind={l.kind} on={on} busy={busy} />
          {l.kind === 'vpn' ? (
            <Pill
              icon={<ShieldCheck />}
              label={node ? `VPN, ${node}` : 'VPN INCY'}
              lit={on}
              strong
              sensitive={node ? 'node' : undefined}
              title="Через туннель INCY"
              className="max-w-[230px]"
            />
          ) : (
            <Pill icon={<Globe />} label="Напрямую" lit={false} title="Через вашего провайдера, без VPN" />
          )}
        </React.Fragment>
      ))}
    </div>
  )
}

export default SplitLanes
