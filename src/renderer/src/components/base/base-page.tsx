import { Button } from '@renderer/components/ui/button'
import { platform } from '@renderer/utils/init'
import WindowControls from '@renderer/components/window-controls'
import React, { forwardRef, useImperativeHandle, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { cn } from '@renderer/lib/utils'

// Вкладки бокового меню — у них нет стрелки «назад». Раньше здесь был список
// из старой программы (/profiles, /proxies…), и стрелка появлялась у одних
// вкладок меню и пропадала у других.
const sidebarPaths = new Set([
  '/home',
  '/telegram',
  '/zapret',
  '/incy',
  '/exitlag',
  '/optimizer',
  '/logs',
  '/settings',
  '/about',
  '/support'
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
  const isSubPage = !sidebarPaths.has(location.pathname)

  const contentRef = useRef<HTMLDivElement>(null)
  useImperativeHandle(ref, () => {
    return contentRef.current as HTMLDivElement
  })

  return (
    <div ref={contentRef} className="w-full h-full">
      <div className="sticky top-0 z-40 h-14.25 w-full bg-background border-b border-border">
        <div className="app-drag pl-6 pr-2 pt-3 pb-2 flex justify-between h-14.25">
          <div className="title h-full text-lg font-bold leading-8 flex items-center gap-1.5 text-foreground">
            {(isSubPage || props.showBackButton) && (
              <Button
                size="icon-sm"
                variant="ghost"
                className="app-nodrag rounded-xl cursor-pointer hover:bg-foreground/[0.06]"
                onClick={() => navigate(-1)}
              >
                <ChevronLeft className="size-4.5" />
              </Button>
            )}
            {props.title}
          </div>
          <div className="header flex gap-1.5 h-full items-center app-nodrag">
            {props.header}
            {!isMac && <WindowControls />}
          </div>
        </div>
      </div>
      {/* pt-3 — первая карточка не прилипает к шапке; плавное появление при
          переходе между вкладками (tw-animate-css). */}
      <div
        className={cn(
          'content h-[calc(100vh-57px)] overflow-y-auto custom-scrollbar pt-3 animate-in fade-in slide-in-from-bottom-1 duration-300',
          props.contentClassName
        )}
      >
        {props.children}
      </div>
    </div>
  )
})

BasePage.displayName = 'BasePage'
export default BasePage
