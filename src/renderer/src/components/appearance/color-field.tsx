import { memo, useMemo } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { ColorPicker, Swatch } from './color-picker'
import { Ctl } from './section'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { useAppearanceStore } from '@renderer/lib/appearance/store'
import { liveSetToken, clearLive } from '@renderer/lib/appearance/runtime'
import { tokenHex } from '@renderer/lib/appearance/probe'
import { useIssue } from '@renderer/lib/appearance/contrast-watch'
import { autoFixToken } from '@renderer/lib/appearance/contrast-state'
import { rgbaToHex, parseColor } from '@renderer/lib/appearance/color'
import { cn } from '@renderer/lib/utils'

const shortHex = (v: string): string => {
  const c = parseColor(v)
  return c ? rgbaToHex(c).toUpperCase() : '—'
}

interface Props {
  tokenKey: string
  label: string
  hint?: string
  /** В расширенном режиме пока значение не задано, показываем «авто». */
  advanced?: boolean
  autoOpen?: boolean
}

/**
 * Одна строка цвета: образец (открывает выбор) + подпись + маленький HEX.
 * Источник правды — только хранилище: локального состояния цвета здесь нет.
 */
export const ColorField = memo(function ColorField({ tokenKey: key, label, hint, advanced, autoOpen }: Props) {
  const override = useAppearanceStore((s) => s.tokens[key])
  useAppearanceStore((s) => s.tick) // после применения темы перечитываем вычисленное значение
  const recent = useAppearanceStore(useShallow((s) => s.recentColors))
  const issue = useIssue(key)
  const hex = tokenHex(key)
  const value = override ?? hex
  const changed = override !== undefined
  const swatchBg = useMemo(() => `var(--${key})`, [key])

  const commit = (v: string): void => {
    useAppearanceStore.getState().setToken(key, v)
  }

  return (
    <Ctl id={key} className="group/row relative">
      <div className="flex items-center gap-1">
        <ColorPicker
          value={value}
          onLive={(v) => liveSetToken(key, v)}
          onChange={commit}
          onCommit={(v) => useAppearanceStore.getState().pushRecent(v)}
          recent={recent}
          defaultOpen={autoOpen}
          onReset={changed ? () => { useAppearanceStore.getState().resetToken(key); clearLive() } : undefined}
          title={label}
        >
          <button
            type="button"
            title={hint ? `${label}: ${hint}` : label}
            className="flex min-w-0 max-w-[calc(100%-1.5rem)] cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 text-left hover:bg-accent/60"
          >
            <span className="relative shrink-0">
              <Swatch color={swatchBg} className="h-5 w-8 rounded-md border border-border" />
              {issue && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation()
                        autoFixToken(key, issue.pair)
                      }}
                      onKeyDown={(e) => e.key === 'Enter' && autoFixToken(key, issue.pair)}
                      className="absolute -top-1.5 -right-1.5 flex size-3.5 items-center justify-center rounded-full bg-warning text-warning-foreground"
                    >
                      <AlertTriangle className="size-2.5" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-56 text-xs">
                    Плохо читается: {issue.pair.label} — {issue.ratio.toFixed(1)}:1 (нужно {issue.pair.min}:1). Нажмите, чтобы подобрать цвет этой строки.
                  </TooltipContent>
                </Tooltip>
              )}
            </span>
            <span className="min-w-0 truncate text-xs">{label}</span>
            <span className={cn('shrink-0 font-mono text-[10px]', advanced && !changed ? 'text-muted-foreground italic' : 'text-muted-foreground')}>
              {advanced && !changed ? 'авто' : shortHex(value)}
            </span>
          </button>
        </ColorPicker>
        <button
          type="button"
          title="Вернуть авто / значение темы"
          aria-label="Сбросить"
          disabled={!changed}
          onClick={() => {
            useAppearanceStore.getState().resetToken(key)
            clearLive()
          }}
          className={cn(
            'flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground',
            !changed && 'invisible'
          )}
        >
          <X className="size-3" />
        </button>
      </div>
    </Ctl>
  )
})
