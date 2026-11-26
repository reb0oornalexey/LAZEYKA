import React, { useEffect, useState } from 'react'
import { ArrowLeftRight, Globe, Loader2, MapPinned, Route } from 'lucide-react'
import { Hint } from '@renderer/components/prematch/hint'
import { LiveNumber, LzPanel, Segmented, type LzTone, type SegmentedItem } from '@renderer/components/lz'
import { cn } from '@renderer/lib/utils'
import { platform } from '@renderer/utils/init'
import { ConnectDial } from './connect-dial'
import { ProtocolTag } from './signal'

export type ConnMode = 'tun' | 'system_proxy' | 'only_proxy'
export type RouteMode = 'bypass-ru' | 'global' | 'direct'

const MODE_ITEMS: SegmentedItem<ConnMode>[] = [
  { id: 'tun', label: 'TUN', title: 'TUN: через VPN идёт весь компьютер целиком, включая игры и программы. Основной режим' },
  { id: 'system_proxy', label: 'Системный прокси', title: 'Системный прокси: через VPN идут только браузеры и программы, которые читают системные настройки прокси' },
  { id: 'only_proxy', label: 'Только прокси', title: 'Только прокси: открывается локальный порт, вы сами указываете его в нужной программе. Система не трогается' }
]

const ROUTE_ITEMS: SegmentedItem<RouteMode>[] = [
  { id: 'bypass-ru', label: 'Обход РФ', icon: MapPinned, title: 'Российские сайты идут напрямую, остальное — через VPN' },
  { id: 'global', label: 'Весь трафик', icon: Globe, title: 'Через VPN идут все сайты' }
]
const ROUTE_DIRECT: SegmentedItem<RouteMode> = { id: 'direct', label: 'Напрямую', icon: Route, title: 'VPN поднят, но не используется: всё идёт напрямую' }

/** «1 ч 24 мин», «12 мин», «меньше минуты». */
function uptimeText(ms: number): string {
  const min = Math.floor(ms / 60000)
  if (min < 1) return 'меньше минуты'
  const h = Math.floor(min / 60)
  return h > 0 ? `${h} ч ${min % 60} мин` : `${min} мин`
}

/** Время подключения; свой таймер у маленького компонента, страница не перерисовывается. */
export const Uptime: React.FC<{ since: number; className?: string }> = ({ since, className }) => {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(id)
  }, [since])
  return <LiveNumber value={uptimeText(Math.max(0, now - since))} className={className} />
}

interface Props {
  tone: LzTone
  compact?: boolean
  /** Крупный заголовок состояния. */
  title: React.ReactNode
  /** Строка под заголовком: пояснение, ход подключения или ошибка. */
  text: React.ReactNode
  /** Мелкие действия под текстом. */
  extra?: React.ReactNode
  node: { flag: string; name: string; protocol: string; json?: boolean } | null
  pingMs: number | null
  connectedAt?: number
  dialLabel: string
  onDial: () => void
  dialDisabled?: boolean
  onChangeNode: () => void
  mode: ConnMode
  systemProxyAvailable?: boolean
  tunAvailable?: boolean
  onMode: (m: ConnMode) => void
  route: RouteMode
  onRoute: (r: RouteMode) => void
  footer?: React.ReactNode
}

/**
 * Пульт INCY — главная плашка вкладки «Главная». Слева прибор с клавишей
 * питания (он же шкала силы сигнала), в центре состояние словами и узел с
 * флагом, справа — как подключаться: режим и маршрут. Внизу через черту —
 * живые показатели.
 */
export const IncyConsole: React.FC<Props> = ({
  tone,
  compact,
  title,
  text,
  extra,
  node,
  pingMs,
  connectedAt,
  dialLabel,
  onDial,
  dialDisabled,
  onChangeNode,
  mode,
  systemProxyAvailable,
  tunAvailable,
  onMode,
  route,
  onRoute,
  footer
}) => {
  const modeItems = platform === 'linux'
    ? MODE_ITEMS.filter((item) => item.id === 'only_proxy' ||
      (item.id === 'tun' && tunAvailable) || (item.id === 'system_proxy' && systemProxyAvailable))
    : MODE_ITEMS
  const items = platform === 'linux' && mode !== 'tun'
    ? ROUTE_ITEMS.map((item) => item.id === 'global'
      ? { ...item, label: 'Весь трафик прокси', title: 'Через INCY идут все запросы приложений, настроенных на этот прокси' }
      : item)
    : ROUTE_ITEMS
  const routeItems = route === 'direct' ? [...items, ROUTE_DIRECT] : items
  return (
    <LzPanel hero tone={tone} glow={tone === 'off' ? 0 : 14} data-tour="incy-console" className={cn(tone === 'error' && 'border-st-err/45')}>
      {tone === 'error' && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ background: 'linear-gradient(90deg, color-mix(in oklab, var(--st-err) 12%, transparent), transparent 50%)' }}
        />
      )}
      <div className={cn('flex flex-wrap items-center gap-x-6 gap-y-4 px-6', compact ? 'py-4' : 'py-5')}>
        <ConnectDial tone={tone} pingMs={pingMs} label={dialLabel} onPress={onDial} disabled={dialDisabled} size={compact ? 112 : 148} />

        <div className="min-w-[240px] flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <h2 className="text-[24px] leading-[1.15] font-extrabold tracking-[-0.01em] text-[color:var(--text-title)]">{title}</h2>
            {tone === 'on' && connectedAt && <Uptime since={connectedAt} className="text-[13px] font-semibold text-primary" />}
          </div>

          {/* Узел: флаг, имя, протокол; нажатие — сменить узел. */}
          {node && (
          <button
            type="button"
            onClick={onChangeNode}
            data-tour="incy-node"
            title="Сменить узел"
            className={cn(
              'group mt-2.5 flex max-w-full cursor-pointer items-center gap-2.5 rounded-xl border py-1.5 pr-2.5 pl-1.5 text-left transition-colors',
              tone === 'on' ? 'border-primary/30 bg-primary/[0.08] hover:border-primary/55' : 'border-foreground/[0.09] bg-foreground/[0.04] hover:border-primary/40'
            )}
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.06] text-[20px] leading-none select-none">
              {node.flag || <Globe className="size-4 text-muted-foreground" />}
            </span>
            <span className="min-w-0">
              <span data-sensitive="node" className="block truncate text-[14px] font-bold text-foreground">
                {node.name}
              </span>
              <span className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                <ProtocolTag protocol={node.protocol} json={node.json} />
                <span className="flex items-center gap-1 group-hover:text-primary">
                  <ArrowLeftRight className="size-3" />
                  Сменить узел
                </span>
              </span>
            </span>
          </button>
          )}

          <div className="mt-2.5 max-w-[60ch] text-[13px] leading-relaxed text-muted-foreground">{text}</div>
          {extra && <div className="mt-2 flex flex-wrap items-center gap-2">{extra}</div>}
        </div>

        {/* Как подключаться: режим и маршрут. Меняются и на ходу. */}
        <div className="flex w-full flex-col gap-3 sm:w-[400px]">
          <div data-tour="incy-mode">
            <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-foreground/85">
              Режим
              <Hint text={platform === 'linux' && !tunAvailable
                ? systemProxyAvailable
                  ? 'Системный прокси задаётся в настройках GNOME. В режиме «Только прокси» адрес и порт задаются вручную в нужном приложении.'
                  : 'Укажите адрес локального прокси в приложении, которое хотите подключить.'
                : 'TUN — через VPN идёт весь компьютер, включая игры; начинайте с него. Системный прокси — только браузеры и программы, которые читают настройки прокси системы. Только прокси — открывается локальный порт, его указывают в нужной программе вручную. Режим можно менять и при подключённом VPN.'} />
            </div>
            <Segmented items={modeItems} value={mode} onChange={onMode} aria-label="Режим подключения" />
          </div>
          <div data-tour="incy-route">
            <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-foreground/85">
              Маршрут
              <Hint text="Обход РФ — российские сайты (банки, Госуслуги, маркетплейсы) идут напрямую, остальное через VPN. Весь трафик — через VPN идут все сайты. Подробные правила — на вкладке «Маршрутизация»." />
            </div>
            <Segmented items={routeItems} value={route} onChange={onRoute} aria-label="Маршрут трафика" />
          </div>
        </div>
      </div>
      {footer && <div className="border-t border-foreground/[0.07] px-4 py-3">{footer}</div>}
    </LzPanel>
  )
}

/** Строка «в процессе» для текста пульта. */
export const BusyLine: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="inline-flex items-center gap-1.5 text-primary">
    <Loader2 className="size-3.5 animate-spin" />
    {children}
  </span>
)

export default IncyConsole
