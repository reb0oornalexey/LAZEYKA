import React from 'react'
import { Hint } from '@renderer/components/prematch/hint'
import { cn } from '@renderer/lib/utils'
import { EXTRA_ROWS, type ExtraKey, type FullScenario } from '@renderer/lib/scenario-extra'

/**
 * Строки редактора сценария для действий версии 1.3.0. У каждой есть подсказка.
 * Старые сценарии без этих полей показываются как «Не трогать».
 */
export function ExtraActions({ value, onChange }: { value: FullScenario; onChange: (key: ExtraKey, v: string) => void }): React.ReactElement {
  return (
    <div data-tour="scenario-extra" className="space-y-3 border-t border-border pt-3">
      {EXTRA_ROWS.map((row) => {
        const cur = (value[row.key] as string | undefined) ?? 'keep'
        return (
          <div key={row.key} className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-1 text-xs font-semibold text-foreground">
              {row.title}
              <Hint text={row.hint} />
            </span>
            <div className="inline-flex rounded-lg border border-border bg-card/40 p-0.5">
              {row.options.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => onChange(row.key, o.value)}
                  className={cn(
                    'cursor-pointer rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors',
                    cur === o.value
                      ? o.tone === 'on'
                        ? 'bg-st-ok/20 text-st-ok-text'
                        : o.tone === 'off'
                          ? 'bg-st-err/15 text-st-err-text'
                          : 'bg-foreground/[0.08] text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
