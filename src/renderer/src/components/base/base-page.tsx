import { Button } from '@renderer/components/ui/button'
import { platform } from '@renderer/utils/init'
import WindowControls from '@renderer/components/window-controls'
import React, { forwardRef, useImperativeHandle, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { PageHeader } from '@renderer/components/app-chrome'

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
  '/appearance',
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
      <PageHeader
        className="sticky top-0"
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
        right={
          <>
            {props.header}
            {!isMac && <WindowControls />}
          </>
        }
      />
      {/* pt-3 — первая карточка не прилипает к шапке; плавное появление при
          переходе между вкладками (tw-animate-css). */}
      <div
        className={cn(
          'content h-[calc(100vh-(var(--spacing)*14.25))] overflow-y-auto custom-scrollbar pt-3 animate-in fade-in slide-in-from-bottom-1 duration-300',
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
