import React from 'react'
import { Check, Loader2, Minus, X } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import type { CheckProgress, CheckStep } from '@renderer/utils/prematch-api'
import '@renderer/components/lz/lz.css'

/*
 * Ход проверки перед каткой: четыре шага по порядку (это и правда шаги, поэтому
 * номера уместны). Между шагами — полоса: пройдено — горит, идёт — бежит пунктир.
 * Только отображение состояния из стора.
 */

export const STEP_LABEL: Record<CheckStep, string> = {
  link: 'Подключение и Wi-Fi',
  gateway: 'Пинг до роутера',
  target: 'Пинг до сервера',
  load: 'Пинг под нагрузкой'
}
export const STEP_ORDER: CheckStep[] = ['link', 'gateway', 'target', 'load']

export const CheckSteps: React.FC<{ steps: Partial<Record<CheckStep, CheckProgress>>; withLoad: boolean }> = ({ steps, withLoad }) => {
  const order = STEP_ORDER.filter((k) => k !== 'load' || withLoad || steps.load)
  return (
    <ol className="flex w-full items-start gap-2">
      {order.map((k, i) => {
        const p = steps[k]
        const st = p?.state
        const done = st === 'done'
        const run = st === 'run'
        return (
          <li key={k} className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'flex size-7 shrink-0 items-center justify-center rounded-full border text-[11.5px] font-bold tabular-nums transition-colors duration-300 [&_svg]:size-3.5',
                  done && 'border-primary bg-primary text-primary-foreground',
                  run && 'border-primary text-primary',
                  st === 'fail' && 'border-st-err bg-st-err/12 text-st-err-text',
                  st === 'skip' && 'border-foreground/15 text-muted-foreground',
                  !st && 'border-foreground/15 text-muted-foreground'
                )}
              >
                {done ? <Check /> : run ? <Loader2 className="animate-spin" /> : st === 'fail' ? <X /> : st === 'skip' ? <Minus /> : i + 1}
              </span>
              {i < order.length - 1 && (
                <span
                  aria-hidden
                  className={cn(
                    'h-[2px] flex-1 rounded-full',
                    done ? 'bg-primary' : run ? 'lz-rail-flow text-primary/60' : 'bg-foreground/10'
                  )}
                />
              )}
            </div>
            <div className="min-w-0 pr-2">
              <div className={cn('truncate text-[12.5px] font-semibold', st ? 'text-foreground' : 'text-muted-foreground')}>{STEP_LABEL[k]}</div>
              <div className={cn('line-clamp-2 text-[11.5px] leading-snug', st === 'fail' ? 'text-st-err-text' : 'text-muted-foreground')}>
                {p?.detail ?? (st === 'skip' ? 'пропущено' : run ? 'идёт…' : 'ждёт')}
              </div>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

export default CheckSteps
