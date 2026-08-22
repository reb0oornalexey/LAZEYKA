import React from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTheme } from 'next-themes'
import { Home as HomeIcon, ScrollText, Settings as SettingsIcon, Info as InfoIcon, Globe, LifeBuoy, PanelLeftClose, PanelLeft } from 'lucide-react'
import ZapretIcon from '@renderer/components/zapret-icon'
import TelegramIcon from '@renderer/components/telegram-icon'
import logoDark from '@renderer/assets/logo.png'
import logoLight from '@renderer/assets/logo_white.png'
import { useZapretStore } from '@renderer/store/zapret-store'
import { useTgwsStore } from '@renderer/store/tgws-store'
import { useIncyStore } from '@renderer/store/incy-store'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar
} from '@renderer/components/ui/sidebar'

const nav = [
  { key: 'home',     path: '/home',     icon: HomeIcon,     label: 'Главная',    service: null },
  { key: 'telegram', path: '/telegram', icon: TelegramIcon, label: 'Telegram',   service: 'tgws' },
  { key: 'zapret',   path: '/zapret',   icon: ZapretIcon,   label: 'Zapret',     service: 'zapret' },
  { key: 'incy',     path: '/incy',     icon: Globe,        label: 'INCY Proxy', service: 'incy' },
  { key: 'logs',     path: '/logs',     icon: ScrollText,   label: 'Логи',       service: null },
  { key: 'settings', path: '/settings', icon: SettingsIcon, label: 'Настройки',  service: null },
  { key: 'about',    path: '/about',    icon: InfoIcon,     label: 'Информация', service: null },
  { key: 'support',  path: '/support',  icon: LifeBuoy,     label: 'Поддержка',  service: null }
]

const AppSidebar: React.FC = () => {
  const { t } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()
  const { toggleSidebar, state } = useSidebar()
  const { resolvedTheme } = useTheme()
  const collapsed = state === 'collapsed'
  const logoSrc = resolvedTheme === 'light' ? logoLight : logoDark

  const zapretRunning = useZapretStore((s) => s.status.state === 'running')
  const tgwsRunning = useTgwsStore((s) => s.status.state === 'running')
  const incyRunning = useIncyStore((s) => s.status.state === 'running')

  const getServiceActive = (service: string | null): boolean => {
    if (service === 'zapret') return zapretRunning
    if (service === 'tgws') return tgwsRunning
    if (service === 'incy') return incyRunning
    return false
  }

  return (
    <Sidebar collapsible="icon" side="left" variant="floating" className="border-border/60 bg-sidebar/95 backdrop-blur-xl">
      <SidebarHeader className="h-14.25 p-0 flex items-center justify-center shrink-0 border-b border-border/40">
        <div className="relative group flex items-center justify-center">
          <img
            src={logoSrc}
            alt="LAZEYKA"
            draggable={false}
            className="h-8.5 w-8.5 object-contain select-none pointer-events-none transition-transform duration-300 group-hover:scale-105"
          />
        </div>
      </SidebarHeader>
      <SidebarContent className="py-2">
        {/* В свёрнутом виде горизонтальные отступы убираются, а элементы
            центрируются.
            Причина: рельс шириной 3rem (48px) за вычетом p-2 группы и px-1
            меню оставляет 24px контента, тогда как кнопка в icon-режиме имеет
            жёсткий размер 36px. Она не влезала и прижималась влево, вылезая
            за правый край — отсюда и «кривые» иконки, и индикатор, который
            наезжал на них, потому что был приколот к уехавшему краю кнопки. */}
        <SidebarGroup className="group-data-[collapsible=icon]:p-0">
          <SidebarGroupContent>
            <SidebarMenu className="gap-1 px-1 group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:items-center">
              {nav.map((item) => {
                const Icon = item.icon
                const isActive = location.pathname.startsWith(item.path)
                const isServiceRunning = getServiceActive(item.service)

                return (
                  <SidebarMenuItem key={item.key}>
                    <SidebarMenuButton
                      className={`relative cursor-pointer transition-all duration-200 rounded-xl font-medium overflow-visible ${
                        isActive
                          ? 'bg-primary/15 text-primary border border-primary/40 shadow-[0_0_14px_-2px_rgba(99,102,241,0.3)] font-semibold'
                          : 'text-foreground/75 hover:text-foreground hover:bg-foreground/[0.06]'
                      }`}
                      tooltip={item.label}
                      isActive={isActive}
                      onClick={() => navigate(item.path)}
                    >
                      {isActive && !collapsed && (
                        <span className="absolute left-0 top-2 bottom-2 w-1 rounded-r-md bg-primary shadow-[0_0_8px_currentColor]" />
                      )}
                      {/* Индикатор «сервис работает» в свёрнутом виде.
                          Уменьшен и придвинут вплотную к углу: раньше точка
                          2.5 с отступом 4px попадала прямо на верхний правый
                          угол глифа. Кольцо цветом рельса отделяет её от
                          иконки, а не закрашивает её. */}
                      {isServiceRunning && (
                        <div className={`absolute top-0.5 right-0.5 size-2 pointer-events-none z-30 ${collapsed ? 'flex' : 'hidden group-data-[collapsible=icon]:flex'}`}>
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-80" />
                          <span className="relative inline-flex rounded-full size-2 bg-emerald-400 ring-2 ring-sidebar shadow-[0_0_6px_#34d399]" />
                        </div>
                      )}
                      <div className="flex items-center justify-center size-5 shrink-0">
                        <Icon className="size-4.5" />
                      </div>
                      {!collapsed && (
                        <span className="text-xs tracking-wide truncate group-data-[collapsible=icon]:hidden">
                          {t(`sider.${item.key}`, { defaultValue: item.label })}
                        </span>
                      )}
                      {isServiceRunning && (
                        <div className={`ml-auto items-center gap-1.5 px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 text-[9px] font-mono font-bold shrink-0 ${!collapsed ? 'flex group-data-[collapsible=icon]:hidden' : 'hidden'}`}>
                          <span className="size-1.5 rounded-full bg-emerald-400 shadow-[0_0_4px_#34d399] animate-pulse" />
                          ON
                        </div>
                      )}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t border-border/40 p-2 group-data-[collapsible=icon]:px-0">
        <SidebarMenu className="group-data-[collapsible=icon]:items-center">
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip={collapsed ? 'Развернуть' : 'Свернуть'}
              onClick={toggleSidebar}
              className="cursor-pointer text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06] rounded-xl"
            >
              {collapsed ? <PanelLeft className="size-4" /> : <PanelLeftClose className="size-4" />}
              {!collapsed && (
                <span className="text-xs group-data-[collapsible=icon]:hidden">
                  Свернуть
                </span>
              )}
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}

export default AppSidebar
