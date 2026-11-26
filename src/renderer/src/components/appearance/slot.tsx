import React, { memo } from 'react'
import { AlertTriangle, Check, RotateCcw } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { ColorPicker, Swatch } from './color-picker'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { useAppearanceStore } from '@renderer/lib/appearance/store'
import { liveSetToken, clearLive } from '@renderer/lib/appearance/runtime'
import { tokenHex } from '@renderer/lib/appearance/probe'
import { autoFixToken, pairRatioShown } from '@renderer/lib/appearance/contrast-state'
import { useUiState } from '@renderer/lib/appearance/ui-state'
import { rgbaToHex, parseColor } from '@renderer/lib/appearance/color'
import type { ContrastPair } from '@renderer/lib/appearance/contrast'
import { cn } from '@renderer/lib/utils'

const shortHex = (v: string): string => {
  const c = parseColor(v)
  return c ? rgbaToHex(c).toUpperCase() : '—'
}

/** Пересчёт при любой правке оформления (а не только своего цвета): контраст зависит и от пары. */
const useAppearanceVersion = (): unknown =>
  useAppearanceStore(useShallow((s) => [s.tokens, s.presetId, s.mode, s.settings, s.custom, s.tick, s.system.accent]))

/**
 * Бейдж контраста слота: худшая из его пар. «4.8 ✓» — читается, «2.1 ⚠» — нет (нажатие подбирает цвет слота).
 * В подсказке — с чем сравнивается и какой нужен минимум.
 */
export const ContrastBadge: React.FC<{ slotKey: string; pairs: ContrastPair[]; className?: string }> = ({ slotKey, pairs, className }) => {
  useAppearanceVersion()
  const ratios = pairRatioShown(pairs)
  const rows = pairs.map((p, i) => ({ p, r: ratios[i] })).filter((x): x is { p: ContrastPair; r: number } => x.r != null)
  if (rows.length === 0) return null
  const worst = rows.reduce((a, b) => (b.r / b.p.min < a.r / a.p.min ? b : a))
  const bad = worst.r < worst.p.min
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            if (bad) autoFixToken(slotKey, worst.p)
          }}
          aria-label={bad ? `Плохо читается: ${worst.r.toFixed(1)} к 1. Подобрать цвет` : `Читается: ${worst.r.toFixed(1)} к 1`}
          className={cn(
            'inline-flex h-5 shrink-0 items-center gap-0.5 rounded-md px-1.5 font-mono text-[10px] font-semibold tabular-nums transition-colors',
            bad ? 'cursor-pointer bg-st-warn/15 text-st-warn-text hover:bg-st-warn/25' : 'cursor-help bg-st-ok/12 text-st-ok-text',
            className
          )}
        >
          {worst.r.toFixed(1)}
          {bad ? <AlertTriangle className="size-2.5" /> : <Check className="size-2.5" />}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-64 text-xs">
        <div className="mb-1 font-semibold">{bad ? 'Плохо читается' : 'Читается'}</div>
        {rows.map(({ p, r }) => (
          <div key={p.label} className="flex justify-between gap-3">
            <span>{p.label}</span>
            <span className="font-mono tabular-nums">
              {r.toFixed(1)}:1 <span className="opacity-70">/ {p.min}</span>
            </span>
          </div>
        ))}
        <div className="mt-1 opacity-80">Справа — нужный минимум. {bad ? 'Нажмите, чтобы подобрать светлоту этого цвета.' : ''}</div>
      </TooltipContent>
    </Tooltip>
  )
}

interface SlotProps {
  tokenKey: string
  label: string
  hint?: string
  /** Пока цвет не задан — «авто» (считается от основных цветов). */
  auto?: boolean
  pairs?: ContrastPair[]
  selected?: boolean
  onSelect?: () => void
  /** Подпись к «общему» цвету (используется и в других местах). */
  shared?: boolean
}

/**
 * Плашка слота цвета: образец (открывает выбор цвета), название, «авто»/свой цвет, бейдж контраста,
 * «сбросить». Источник правды — хранилище; при перетаскивании цвет меняется вживую во всей программе.
 */
export const SlotPlate = memo(function SlotPlate({ tokenKey: key, label, hint, auto, pairs, selected, onSelect, shared }: SlotProps) {
  const override = useAppearanceStore((s) => s.tokens[key])
  useAppearanceStore((s) => s.tick)
  const recent = useAppearanceStore(useShallow((s) => s.recentColors))
  const hot = useUiState((s) => s.focusKey === key)
  const value = override ?? tokenHex(key)
  const changed = override !== undefined
  const isAuto = auto && !changed
  const reset = (): void => {
    useAppearanceStore.getState().resetToken(key)
    clearLive()
  }
  return (
    <div
      data-ctl={key}
      onPointerDown={onSelect}
      className={cn(
        'group/slot relative flex min-w-0 items-center gap-2.5 rounded-xl border bg-card/60 p-2 pr-2.5 transition-[border-color,box-shadow,background-color] duration-200',
        selected || hot
          ? 'border-primary/70 bg-primary/[0.06] shadow-[0_0_0_3px_color-mix(in_oklab,var(--primary)_18%,transparent)]'
          : 'border-border hover:border-foreground/20'
      )}
    >
      <ColorPicker
        value={value}
        onLive={(v) => liveSetToken(key, v)}
        onChange={(v) => useAppearanceStore.getState().setToken(key, v)}
        onCommit={(v) => useAppearanceStore.getState().pushRecent(v)}
        recent={recent}
        onReset={changed ? reset : undefined}
        title={label}
      >
        <button
          type="button"
          title={hint ? `${label}: ${hint}` : `Выбрать цвет: ${label}`}
          className="relative size-9 shrink-0 cursor-pointer rounded-lg transition-transform hover:scale-105"
        >
          <Swatch
            color={`var(--${key})`}
            className={cn(
              'size-full rounded-lg shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_16%,transparent)]',
              isAuto && 'opacity-55'
            )}
          />
          {isAuto && (
            <span className="absolute -right-1 -bottom-1 rounded-[4px] border border-border bg-popover px-[3px] text-[8px] leading-[12px] font-bold text-muted-foreground">
              A
            </span>
          )}
        </button>
      </ColorPicker>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1">
          <span className="truncate text-xs font-semibold" title={hint ? `${label}: ${hint}` : label}>
            {label}
          </span>
          {shared && <span className="shrink-0 rounded bg-foreground/[0.06] px-1 text-[9px] font-medium text-muted-foreground">общий</span>}
          {changed && (
            <button
              type="button"
              title={auto ? 'Сбросить к «авто»' : 'Вернуть цвет темы'}
              aria-label={auto ? 'Сбросить к авто' : 'Вернуть цвет темы'}
              onClick={(e) => {
                e.stopPropagation()
                reset()
              }}
              className="ml-auto flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <RotateCcw className="size-3" />
            </button>
          )}
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
          <span className={cn('min-w-0 truncate font-mono text-[10px] whitespace-nowrap text-muted-foreground', isAuto && 'italic opacity-80')}>
            {isAuto ? (
              <>
                <span className="font-sans not-italic">авто</span> · {shortHex(value)}
              </>
            ) : (
              <>
                {changed && auto && <span className="mr-1 inline-block size-1.5 rounded-full bg-primary align-middle" />}
                {shortHex(value)}
              </>
            )}
          </span>
          {pairs && pairs.length > 0 && <ContrastBadge slotKey={key} pairs={pairs} className="ml-auto" />}
        </div>
      </div>
    </div>
  )
})
