import React from 'react'
import { Info } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { cn } from '@renderer/lib/utils'
import { hintText, useHintMode } from '@renderer/lib/hint-mode'

/** Значок «i» с подсказкой по наведению. В режиме «короткие подсказки» — только первая фраза. */
export const Hint: React.FC<{ text: string; className?: string }> = ({ text, className }) => {
  const mode = useHintMode()
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" aria-label="Подсказка" className={cn('inline-flex cursor-help align-middle text-muted-foreground hover:text-foreground', className)}>
          <Info className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-left leading-snug">
        {hintText(text, mode)}
      </TooltipContent>
    </Tooltip>
  )
}
