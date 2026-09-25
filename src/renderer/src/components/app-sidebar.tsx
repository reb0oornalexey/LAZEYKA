import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTheme } from 'next-themes'
import {
  Home as HomeIcon,
  ScrollText,
  Settings as SettingsIcon,
  Info as InfoIcon,
  Globe,
  LifeBuoy,
  PanelLeftClose,
  PanelLeftOpen,
  Gamepad2,
  Target
} from 'lucide-react'
import ZapretIcon from '@renderer/components/zapret-icon'
import TelegramIcon from '@renderer/components/telegram-icon'
import logoDark from '@renderer/assets/logo.png'
import logoLight from '@renderer/assets/logo_white.png'
import { useZapretStore } from '@renderer/store/zapret-store'
import { useTgwsStore } from '@renderer/store/tgws-store'
import { useIncyStore } from '@renderer/store/incy-store'
import { version } from '@renderer/utils/init'
import { cn } from '@renderer/lib/utils'

type Service = 'zapret' | 'tgws' | 'incy' | 'exitlag' | null

interface NavItem {
  key: string
  path: string
  icon: React.ComponentType<{ className?: string }>
  label: string
  service: Service
}

/** Меню по группам — как в концепции «Графит». */
const groups: { title: string | null; items: NavItem[] }[] = [
  { title: null, items: [{ key: 'home', path: '/home', icon: HomeIcon, label: 'Главная', service: null }] },
  {
    title: 'Обход блокировок',
    items: [
      { key: 'zapret', path: '/zapret', icon: ZapretIcon, label: 'Zapret', service: 'zapret' },
      { key: 'telegram', path: '/telegram', icon: TelegramIcon, label: 'Telegram', service: 'tgws' }
    ]
  },
  {
    title: 'VPN',
    items: [
      { key: 'incy', path: '/incy', icon: Globe, label: 'INCY Proxy', service: 'incy' },
      { key: 'exitlag', path: '/exitlag', icon: Gamepad2, label: 'ExitLag', service: 'exitlag' },
      { key: 'optimizer', path: '/optimizer', icon: Target, label: 'Оптимизатор', service: null }
    ]
  },
  {
    title: 'Система',
    items: [
      { key: 'logs', path: '/logs', icon: ScrollText, label: 'Логи', service: null },
      { key: 'settings', path: '/settings', icon: SettingsIcon, label: 'Настройки', service: null },
      { key: 'about', path: '/about', icon: InfoIcon, label: 'Информация', service: null },
      { key: 'support', path: '/support', icon: LifeBuoy, label: 'Поддержка', service: null }
    ]
  }
]

const STORAGE_KEY = 'lazeyka.sidebarCollapsed'

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * Боковое меню «Графит»: панель во всю высоту с подписями и группами,
 * сворачивается в полоску иконок (состояние запоминается). Индикаторы
 * работающих сервисов — статичные точки: бесконечные анимации заставляли
 * окно перерисовываться 60 раз в секунду даже в покое.
 */
const AppSidebar: React.FC = () => {
  const { t } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()
  const { resolvedTheme } = useTheme()
  const logoSrc = resolvedTheme === 'light' ? logoLight : logoDark
  const [collapsed, setCollapsed] = useState(readCollapsed)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0')
    } catch {
      /* noop */
    }
  }, [collapsed])

  const zapretRunning = useZapretStore((s) => s.status.state === 'running')
  const tgwsRunning = useTgwsStore((s) => s.status.state === 'running')
  const incyRunning = useIncyStore((s) => s.status.state === 'running')
  // ExitLag «работает», только когда ядро подтвердило сессию с белым списком.
  const exitLagRunning = useIncyStore((s) => s.status.state === 'running' && Boolean(s.status.exitLagActive))

  const isRunning = (service: Service): boolean =>
    service === 'zapret'
      ? zapretRunning
      : service === 'tgws'
        ? tgwsRunning
        : service === 'incy'
          ? incyRunning
          : service === 'exitlag'
            ? exitLagRunning
            : false

  return (
    <aside
      className={cn(
        'relative z-20 flex h-full shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-out',
        collapsed ? 'w-[60px]' : 'w-[212px]'
      )}
    >
      {/* Логотип + версия; зона перетаскивания окна. */}
      <div className={cn('app-drag flex h-[57px] shrink-0 items-center gap-2.5', collapsed ? 'justify-center' : 'px-4')}>
        <img
          src={logoSrc}
          alt="LAZEYKA"
          draggable={false}
          className="size-8 shrink-0 select-none rounded-lg object-cover"
        />
        {!collapsed && (
          <div className="min-w-0 leading-tight">
            <div className="text-[13px] font-bold tracking-[0.16em] text-foreground">LAZEYKA</div>
            {version && <div className="text-[10.5px] font-medium text-muted-foreground">v{version}</div>}
          </div>
        )}
      </div>

      <nav className={cn('flex-1 overflow-y-auto overflow-x-hidden pb-2 no-scrollbar', collapsed ? 'px-2' : 'px-2.5')}>
        {groups.map((g, gi) => (
          <div key={gi} className={gi === 0 ? 'pt-1' : 'pt-3'}>
            {g.title &&
              (collapsed ? (
                <div className="mx-2 mb-2 h-px bg-sidebar-border" />
              ) : (
                <div className="mb-1 px-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
                  {g.title}
                </div>
              ))}
            <div className="space-y-0.5">
              {g.items.map((item) => {
                const Icon = item.icon
                const active = location.pathname.startsWith(item.path)
                const running = isRunning(item.service)
                const label = t(`sider.${item.key}`, { defaultValue: item.label })
                return (
                  <button
                    key={item.key}
                    type="button"
                    title={collapsed ? label : undefined}
                    onClick={() => navigate(item.path)}
                    className={cn(
                      'group relative flex w-full cursor-pointer items-center rounded-lg text-[13px] font-medium transition-colors',
                      collapsed ? 'h-10 justify-center' : 'h-9 gap-2.5 px-2.5',
                      active
                        ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                        : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground'
                    )}
                  >
                    {active && (
                      <span
                        className={cn(
                          'absolute top-2 bottom-2 w-[3px] rounded-r-full bg-primary',
                          collapsed ? '-left-2' : '-left-2.5'
                        )}
                      />
                    )}
                    <Icon className={cn('size-[18px] shrink-0', active && 'text-primary')} />
                    {!collapsed && <span className="truncate">{label}</span>}
                    {running &&
                      (collapsed ? (
                        <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-primary ring-2 ring-sidebar" />
                      ) : (
                        <span className="ml-auto size-2 shrink-0 rounded-full bg-primary shadow-[0_0_0_3px_color-mix(in_oklab,var(--primary)_18%,transparent)]" />
                      ))}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className={cn('shrink-0 border-t border-sidebar-border p-2', collapsed && 'flex justify-center')}>
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          title={collapsed ? 'Развернуть меню' : 'Свернуть меню'}
          className={cn(
            'flex cursor-pointer items-center rounded-lg text-xs text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-foreground',
            collapsed ? 'size-9 justify-center' : 'h-8 w-full gap-2 px-2.5'
          )}
        >
          {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          {!collapsed && <span>Свернуть меню</span>}
        </button>
      </div>
    </aside>
  )
}

export default AppSidebar
