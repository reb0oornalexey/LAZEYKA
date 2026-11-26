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
 * Одна строка цвета по сетке: [образец][подпись ……][HEX][!][×].
 * Образец открывает выбор цвета. Значок «плохо читается» — отдельная кнопка рядом
 * (не внутри кнопки строки). Источник правды — только хранилище: локального состояния цвета нет.
 */
export const ColorField = memo(function ColorField({ tokenKey: key, label, hint, advanced, autoOpen }: Props) {
  const override = useAppearanceStore((s) => s.tokens[key])
  useAppearanceStore((s) => s.tick) // после применения темы перечитываем вычисленное значение
  const recent = useAppearanceStore(useShallow((s) => s.recentColors))
  const issue = useIssue(key, advanced)
  const hex = tokenHex(key)
  const value = override ?? hex
  const changed = override !== undefined
  const swatchBg = useMemo(() => `var(--${key})`, [key])

  const commit = (v: string): void => {
    useAppearanceStore.getState().setToken(key, v)
  }

  return (
    <Ctl id={key} className="group/row relative max-w-[20rem]">
      <div className="grid grid-cols-[minmax(0,1fr)_1rem_1.25rem] items-center gap-1">
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
            className="grid min-w-0 cursor-pointer grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-2.5 rounded-lg px-1.5 py-1 text-left hover:bg-accent/60"
          >
            <Swatch color={swatchBg} className="h-5 w-8 rounded-[5px] shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_14%,transparent)]" />
            <span className="min-w-0 truncate text-xs">{label}</span>
            <span className={cn('w-[4.25rem] text-right font-mono text-[10px] text-muted-foreground', advanced && !changed && 'italic')}>
              {advanced && !changed ? 'авто' : shortHex(value)}
            </span>
          </button>
        </ColorPicker>
        {issue ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={`Плохо читается: ${issue.pair.label}. Подобрать цвет`}
                onClick={() => autoFixToken(key, issue.pair)}
                className="flex size-4 cursor-pointer items-center justify-center rounded-full bg-warning text-warning-foreground hover:brightness-110"
              >
                <AlertTriangle className="size-2.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-56 text-xs">
              Плохо читается: {issue.pair.label} — {issue.ratio.toFixed(1)}:1 (нужно {issue.pair.min}:1). Нажмите, чтобы подобрать цвет этой строки.
            </TooltipContent>
          </Tooltip>
        ) : (
          <span />
        )}
        <button
          type="button"
          title={advanced ? 'Вернуть «авто»' : 'Вернуть цвет темы'}
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
