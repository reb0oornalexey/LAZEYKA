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
  onClick?: () => void
  title?: string
}

export const NavItem: React.FC<NavItemProps> = ({ icon: Icon, label, active, collapsed = false, running = false, onClick, title }) => (
  <button
    type="button"
    title={title}
    onClick={onClick}
    className={cn(
      'group relative flex w-full cursor-pointer items-center rounded-lg text-[13px] font-medium transition-colors',
      collapsed ? 'h-10 justify-center' : 'h-9 gap-2.5 px-2.5',
      active
        ? 'bg-sidebar-accent text-sidebar-accent-foreground'
        : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground'
    )}
  >
    {active && (
      <span className={cn('absolute top-2 bottom-2 w-[3px] rounded-r-full bg-sidebar-primary', collapsed ? '-left-2' : '-left-2.5')} />
    )}
    <Icon className={cn('size-[18px] shrink-0', active && 'text-sidebar-primary')} />
    {!collapsed && <span className="truncate">{label}</span>}
    {running &&
      (collapsed ? (
        <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-primary ring-2 ring-sidebar" />
      ) : (
        <span className="ml-auto size-2 shrink-0 rounded-full bg-primary shadow-[0_0_0_3px_color-mix(in_oklab,var(--primary)_18%,transparent)]" />
      ))}
  </button>
)

/** Шапка страницы: название раздела слева, элементы справа. */
export const PageHeader: React.FC<{
  title?: React.ReactNode
  back?: React.ReactNode
  right?: React.ReactNode
  className?: string
  /** Только для предпросмотра: метки data-pv для шапки и заголовка. В приложении не задаются. */
  pv?: { bar?: string; title?: string }
}> = ({ title, back, right, className, pv }) => (
  <div data-pv={pv?.bar} className={cn('app-header z-40 h-14.25 w-full border-b border-border bg-background', className)}>
    <div className="app-drag flex h-14.25 justify-between pl-6 pr-2 pt-3 pb-2">
      <div data-pv={pv?.title} className="title flex h-full items-center gap-1.5 text-lg leading-8 font-bold text-[color:var(--text-header)]">
        {back}
        {title}
      </div>
      <div className="header app-nodrag flex h-full items-center gap-1.5">{right}</div>
    </div>
  </div>
)
