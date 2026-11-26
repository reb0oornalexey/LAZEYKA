import React from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { HandCoins } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { cn } from '@renderer/lib/utils'

/** Якорь блока сбора на странице «Поддержка». */
export const DONATIONS_ANCHOR_ID = 'support-donations'

/**
 * Прокрутить «Поддержку» к блоку сбора. Блок появляется после ответа Hub, поэтому ждём его до ~3 секунд;
 * если активного сбора нет — к карточке «Поддержать развитие проекта».
 */
export function scrollToDonations(): void {
  let tries = 0
  const t = setInterval(() => {
    const el = document.getElementById(DONATIONS_ANCHOR_ID)
    if (el || ++tries > 30) {
      clearInterval(t)
      const target = el ?? document.querySelector<HTMLElement>('[data-tour="support-donate"]')
      target?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }
  }, 100)
}

/** Значок «рука с монетой» рядом с колокольчиком: ведёт к сбору пожертвований в «Поддержке». */
export const DonateShortcut: React.FC = () => {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-tour="hub-donate"
          aria-label="Поддержать проект"
          onClick={() => {
            if (pathname !== '/support') navigate('/support')
            scrollToDonations()
          }}
          className={cn(
            'app-nodrag relative inline-flex size-8 cursor-pointer items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground'
          )}
        >
          <HandCoins className="size-4.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-56 text-left leading-snug">
        Поддержать проект: сбор пожертвований и стена благодарностей
      </TooltipContent>
    </Tooltip>
  )
}
