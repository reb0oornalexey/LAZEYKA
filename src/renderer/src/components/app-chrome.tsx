import React from 'react'
import { cn } from '@renderer/lib/utils'

/**
 * Общие куски оболочки приложения: пункт бокового меню, надпись-логотип и
 * заголовок страницы. Используются и настоящим интерфейсом, и предпросмотром
 * на странице «Оформление», поэтому любой цвет влияет на оба одинаково.
 */

export const BrandText: React.FC<{ version?: React.ReactNode }> = ({ version }) => (
  <div className="min-w-0 leading-tight">
    <div className="text-[13px] font-bold tracking-[0.16em] text-[color:var(--text-header)]">LAZEYKA</div>
    {version}
  </div>
)

interface NavItemProps {
  icon: React.ComponentType<{ className?: string }>
  label: string
  active: boolean
  collapsed?: boolean
  running?: boolean
  serviceState?: CoreStatusState
  /** Число на месте точки (например, непрочитанные уведомления). */
  count?: number
  onClick?: () => void
  title?: string
  /** Метка для экскурсии по новым функциям (data-tour). */
  tour?: string
}

export const NavItem: React.FC<NavItemProps> = ({ icon: Icon, label, active, collapsed = false, running = false, serviceState = running ? 'running' : undefined, count = 0, onClick, title, tour }) => (
  <button
    type="button"
    title={title}
    aria-label={title ?? label}
    aria-current={active ? 'page' : undefined}
    data-tour={tour}
    onClick={onClick}
    className={cn(
      'group relative flex w-full cursor-pointer items-center rounded-lg text-[13px] font-medium transition-colors',
      collapsed ? 'h-8 justify-center' : 'h-7 gap-2.5 px-2.5',
      active
        ? 'bg-sidebar-accent text-sidebar-accent-foreground'
        : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground'
    )}
  >
    {active && (
      <span className={cn('absolute top-2 bottom-2 w-[3px] rounded-r-full bg-sidebar-primary shadow-[0_0_8px_var(--sidebar-primary)]', collapsed ? '-left-2' : '-left-2.5')} />
    )}
    <Icon className={cn('size-[18px] shrink-0', active && 'text-sidebar-primary')} />
    {!collapsed && <span className="truncate">{label}</span>}
    {count > 0 ? (
      // Счётчик (непрочитанные уведомления у «Поддержки») — заметнее точки.
      collapsed ? (
        <span className="absolute top-1 right-1 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] leading-4 font-bold text-primary-foreground ring-2 ring-sidebar">
          {count > 9 ? '9+' : count}
        </span>
      ) : (
        <span className="ml-auto min-w-5 shrink-0 rounded-full bg-primary px-1.5 text-center text-[10.5px] leading-[18px] font-bold text-primary-foreground">
          {count > 99 ? '99+' : count}
        </span>
      )
    ) : serviceState && (
      <span
        aria-hidden
        data-state={serviceState}
        className={cn('lz-nav-arc', collapsed ? 'absolute top-1 right-1' : 'ml-auto')}
      />
    )}
  </button>
)

/** Шапка страницы: название раздела слева, элементы справа. */
export const PageHeader: React.FC<{
  title?: React.ReactNode
  back?: React.ReactNode
  right?: React.ReactNode
  signal?: boolean
  className?: string
  /** Только для предпросмотра: метки data-pv для шапки и заголовка. В приложении не задаются. */
  pv?: { bar?: string; title?: string }
}> = ({ title, back, right, signal, className, pv }) => (
  <div data-pv={pv?.bar} data-signal={signal || undefined} className={cn('app-header lz-shell-header z-40 h-14.25 w-full border-b border-border bg-background', className)}>
    <div className="app-drag flex h-14.25 justify-between gap-2 pl-4 pr-2 pt-3 pb-2">
      <div data-pv={pv?.title} className="title flex h-full min-w-0 items-center gap-1.5 text-lg leading-8 font-bold text-[color:var(--text-header)]">
        {back}
        <span className="truncate">{title}</span>
      </div>
      <div className="header app-nodrag flex h-full shrink-0 items-center gap-1.5">{right}</div>
    </div>
  </div>
)
