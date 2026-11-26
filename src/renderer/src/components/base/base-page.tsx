import { Button } from '@renderer/components/ui/button'
import { platform } from '@renderer/utils/init'
import WindowControls from '@renderer/components/window-controls'
import React, { forwardRef, useImperativeHandle, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { PageHeader } from '@renderer/components/app-chrome'
import { HubBell } from '@renderer/components/hub/hub-bell'
import { DonateShortcut } from '@renderer/components/hub/donate-shortcut'
import { useZapretStore } from '@renderer/store/zapret-store'
import { useTgwsStore } from '@renderer/store/tgws-store'
import { useIncyStore } from '@renderer/store/incy-store'
import { useLanEnabled } from '@renderer/components/lan/use-lan-enabled'
import { WarnBanner } from '@renderer/components/hub/warn-banner'

// Вкладки бокового меню — у них нет стрелки «назад». Раньше здесь был список
// из старой программы (/profiles, /proxies…), и стрелка появлялась у одних
// вкладок меню и пропадала у других.
const sidebarPaths = new Set([
  '/home',
  '/telegram',
  '/zapret',
  '/dns',
  '/scenarios',
  '/incy',
  '/exitlag',
  '/optimizer',
  '/prematch',
  '/tweaks',
  '/streamer',
  '/lan',
  '/diagnostics',
  '/logs',
  '/settings',
  '/appearance',
  '/about',
  '/support',
  '/admin'
])
const isMac = platform === 'darwin'

interface Props {
  title?: React.ReactNode
  header?: React.ReactNode
  children?: React.ReactNode
  contentClassName?: string
  showBackButton?: boolean
}

const BasePage = forwardRef<HTMLDivElement, Props>((props, ref) => {
  const location = useLocation()
  const navigate = useNavigate()
  const zapret = useZapretStore((s) => s.status.state === 'running')
  const telegram = useTgwsStore((s) => s.status.state === 'running')
  const incy = useIncyStore((s) => s.status.state === 'running')
  const lan = useLanEnabled()
  const isSubPage = !sidebarPaths.has(location.pathname)

  const contentRef = useRef<HTMLDivElement>(null)
  useImperativeHandle(ref, () => {
    return contentRef.current as HTMLDivElement
  })

  return (
    <div ref={contentRef} className="flex h-full w-full flex-col">
      <PageHeader
        className="shrink-0"
        back={
          (isSubPage || props.showBackButton) && (
            <Button
              size="icon-sm"
              variant="ghost"
              className="app-nodrag rounded-xl cursor-pointer hover:bg-foreground/[0.06]"
              onClick={() => navigate(-1)}
            >
              <ChevronLeft className="size-4.5" />
            </Button>
          )
        }
        title={props.title}
        signal={zapret || telegram || incy || lan}
        right={
          <>
            {props.header}
            <DonateShortcut />
            <HubBell />
            {!isMac && <WindowControls />}
          </>
        }
      />
      {/* pt-3 — первая карточка не прилипает к шапке; плавное появление при
          переходе между вкладками (tw-animate-css). */}
      <div
        className={cn(
          'content lz-page min-h-0 flex-1 overflow-y-auto custom-scrollbar pt-3 animate-in fade-in slide-in-from-bottom-1 duration-300',
          props.contentClassName
        )}
      >
        {/* Непрочитанное предупреждение автора — поверх любого раздела, пока не нажато «Понятно». */}
        <WarnBanner />
        {props.children}
      </div>
    </div>
  )
})

BasePage.displayName = 'BasePage'
export default BasePage
