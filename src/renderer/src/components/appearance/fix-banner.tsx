import React from 'react'
import { AlertTriangle, CircleCheck, Wand2 } from 'lucide-react'
import { InfoTip } from './section'
import { Button } from '@renderer/components/ui/button'
import type { Failing } from '@renderer/lib/appearance/contrast-state'
import { cn } from '@renderer/lib/utils'

/** Плашка «Плохо читается» с кнопкой исправления. Пары перечислены в подсказке. */
export const FixBanner: React.FC<{ list: Failing[]; onFix: () => void; action: string; tour?: string; compact?: boolean; ok?: string }> = ({
  list,
  onFix,
  action,
  tour,
  compact,
  ok
}) => {
  if (list.length === 0)
    return ok ? (
      <div data-tour={tour} className="lz-control-surface lz-tinted-surface lz-tint-ok flex items-center gap-2 rounded-lg border px-3 py-2 text-xs">
        <CircleCheck className="size-3.5 shrink-0 text-st-ok-text" />
        <span className="min-w-0 flex-1">{ok}</span>
      </div>
    ) : null
  const names = list.map((f) => `${f.pair.label} — ${f.ratio.toFixed(1)}:1`)
  return (
    <div
      data-tour={tour}
      className={cn(
        'lz-control-surface lz-tinted-surface lz-tint-warn flex flex-wrap items-center gap-2 rounded-lg border text-xs',
        compact ? 'px-2.5 py-1.5' : 'px-3 py-2'
      )}
    >
      <AlertTriangle className="size-3.5 shrink-0 text-st-warn-text" />
      <span className="min-w-0 flex-1 truncate" title={names.join('\n')}>
        Плохо читается: {compact ? list.map((f) => f.pair.label).join(', ') : `${list.length} ${plural(list.length)}`}
      </span>
      <InfoTip
        text={
          <>
            Текст сливается с фоном (нужно не меньше 4,5:1).
            <br />
            {names.map((n) => (
              <span key={n} className="block">
                · {n}
              </span>
            ))}
            «{action}» подберёт светлоту цвета, оттенок сохранится. Отменяется кнопкой «Отменить».
          </>
        }
      />
      <Button size="xs" variant="outline" className="shrink-0" onClick={onFix}>
        <Wand2 /> {action}
      </Button>
    </div>
  )
}

const plural = (n: number): string => {
  const a = n % 10
  const b = n % 100
  if (a === 1 && b !== 11) return 'сочетание'
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return 'сочетания'
  return 'сочетаний'
}
