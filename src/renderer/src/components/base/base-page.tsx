import { Button } from '@renderer/components/ui/button'
import { platform } from '@renderer/utils/init'
import WindowControls from '@renderer/components/window-controls'
import React, { forwardRef, useImperativeHandle, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { cn } from '@renderer/lib/utils'

const sidebarPaths = new Set(['/home', '/profiles', '/proxies', '/connections', '/rules', '/logs', '/settings', '/about'])
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
      <div className="sticky top-0 z-40 h-14.25 w-full bg-background/60 backdrop-blur-xl border-b border-border/30">
        <div className="app-drag px-3 pt-3 pb-2 flex justify-between h-14.25">
          <div className="title h-full text-base font-bold leading-8 flex items-center gap-1.5 text-foreground">
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
      <div className={cn("content h-[calc(100vh-57px)] overflow-y-auto custom-scrollbar", props.contentClassName)}>
        {props.children}
      </div>
    </div>
  )
})

BasePage.displayName = 'BasePage'
export default BasePage
