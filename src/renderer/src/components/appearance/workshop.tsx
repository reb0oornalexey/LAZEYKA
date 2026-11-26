import React, { useEffect, useMemo, useState } from 'react'
import { motion } from 'motion/react'
import {
  AlertTriangle,
  ArrowDownUp,
  ArrowLeft,
  BellRing,
  ChevronRight,
  CircleCheck,
  Layers,
  MousePointerClick,
  PanelLeft,
  RectangleHorizontal,
  Tag,
  TextCursorInput,
  ToggleRight,
  Wand2
} from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { Button } from '@renderer/components/ui/button'
import { InfoTip, ResetButton } from './section'
import { FixBanner } from './fix-banner'
import { SlotPlate } from './slot'
import { SAMPLES } from './samples'
import { useAppearanceStore } from '@renderer/lib/appearance/store'
import { useUiState } from '@renderer/lib/appearance/ui-state'
import { useContrastIssues } from '@renderer/lib/appearance/contrast-watch'
import { ADVANCED_PAIRS, autoFixAll, type Failing } from '@renderer/lib/appearance/contrast-state'
import { WS_COMPONENTS, WS_STATE_LABEL, groupOfSlot, ownKeys, wsComponent, type WsComponent, type WsState } from '@renderer/lib/appearance/workshop'
import { cn } from '@renderer/lib/utils'

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  'adv-buttons': RectangleHorizontal,
  'adv-inputs': TextCursorInput,
  'adv-switches': ToggleRight,
  'adv-toasts': BellRing,
  'adv-menu': PanelLeft,
  'adv-badges': Tag,
  'adv-scroll': ArrowDownUp,
  'adv-surfaces': Layers
}

/** Точечная «сцена» под образцами — чтобы живой элемент читался как экспонат. */
const STAGE: React.CSSProperties = {
  backgroundImage: 'radial-gradient(color-mix(in oklab, var(--foreground) 9%, transparent) 1px, transparent 1px)',
  backgroundSize: '14px 14px'
}

const useChanged = (c: WsComponent): number => {
  const keys = useMemo(() => ownKeys(c), [c])
  return useAppearanceStore((s) => keys.reduce((n, k) => n + (s.tokens[k] !== undefined ? 1 : 0), 0))
}

const ChangedChip: React.FC<{ n: number }> = ({ n }) =>
  n > 0 ? (
    <span className="shrink-0 rounded-md bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">изменено: {n}</span>
  ) : (
    <span className="shrink-0 rounded-md bg-foreground/[0.06] px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">всё авто</span>
  )

// ---- Галерея ---------------------------------------------------------------------

const Tile: React.FC<{ c: WsComponent; bad: Failing[] }> = ({ c, bad }) => {
  const n = useChanged(c)
  const Icon = ICONS[c.id] ?? Layers
  const Sample = SAMPLES[c.id]
  const open = (): void => useUiState.getState().openComp(c.id)
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          open()
        }
      }}
      data-tour={`appearance-adv-${c.id.slice(4)}`}
      className="group/tile ui-glow relative flex cursor-pointer flex-col overflow-hidden rounded-xl border border-border bg-card text-left text-card-foreground outline-none transition-[transform,border-color,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-lg focus-visible:ring-2 focus-visible:ring-primary"
    >
      <div className="relative flex h-[96px] items-center justify-center overflow-hidden border-b border-border bg-background/40 px-3" style={STAGE}>
        <div className="transition-transform duration-300 group-hover/tile:scale-[1.04]">
          <Sample />
        </div>
        {n > 0 && (
          <span className="absolute top-2 left-2 rounded-md bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground shadow-sm">изменено: {n}</span>
        )}
        {bad.length > 0 && (
          <span
            title={`Плохо читается: ${bad.map((f) => f.pair.label).join(', ')}`}
            className="absolute top-2 right-2 flex items-center gap-1 rounded-md bg-st-warn/90 px-1.5 py-0.5 text-[10px] font-bold text-warning-foreground shadow-sm"
          >
            <AlertTriangle className="size-3" /> {bad.length}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 px-3 py-2.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary">
          <Icon className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-[color:var(--text-title)]">{c.title}</div>
          <div className="truncate text-[10.5px] text-muted-foreground" title={c.description}>
            {c.description}
          </div>
        </div>
        <ChevronRight className="-ml-1 size-3.5 shrink-0 text-muted-foreground opacity-0 transition-all duration-200 group-hover/tile:translate-x-0.5 group-hover/tile:opacity-100" />
      </div>
    </div>
  )
}

const Gallery: React.FC<{ list: Failing[] }> = ({ list }) => {
  const tokens = useAppearanceStore(useShallow((s) => Object.keys(s.tokens)))
  const changedComps = WS_COMPONENTS.filter((c) => ownKeys(c).some((k) => tokens.includes(k)))
  const resetAll = (): void => useAppearanceStore.getState().resetTokenKeys(WS_COMPONENTS.flatMap(ownKeys))
  return (
    <div className="space-y-3">
      <div className="lz-control-surface lz-tinted-surface lz-tint-accent flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-3 py-2">
        <MousePointerClick className="size-4 shrink-0 text-primary" />
        <span className="flex min-w-0 flex-1 basis-[220px] items-center gap-1.5 text-xs">
          <span className="min-w-0">Выберите компонент — откроется его мастерская</span>
          <InfoTip text="Цвета отдельных элементов. Пока цвет не задан, он «авто» и считается от основных цветов на вкладке «Цвета». Меняйте здесь, только если нужно поправить что-то точечно. Выбранный цвет применяется ко всей программе." />
        </span>
        <span className="ml-auto flex items-center gap-2">
          <span className="text-[11px] whitespace-nowrap">
            Изменено компонентов: <b className="tabular-nums">{changedComps.length}</b>
          </span>
          <ResetButton label="Сбросить всё" disabled={changedComps.length === 0} onClick={resetAll} />
        </span>
      </div>
      <FixBanner
        tour="appearance-advanced-fix"
        ok="Проверка читаемости кнопок, полей, уведомлений, значков и меню: всё в порядке"
        list={list}
        action="Исправить всё"
        onFix={() => autoFixAll(ADVANCED_PAIRS)}
      />
      <div data-tour="appearance-adv-gallery" className="grid grid-cols-[repeat(auto-fill,minmax(196px,1fr))] gap-2.5">
        {WS_COMPONENTS.map((c) => (
          <Tile key={c.id} c={c} bad={list.filter((f) => f.pair.group === c.id)} />
        ))}
      </div>
    </div>
  )
}

// ---- Мастерская ------------------------------------------------------------------

const Pills = <T extends string>({
  value,
  options,
  onChange,
  label
}: {
  value: T
  options: { id: T; label: string }[]
  onChange: (v: T) => void
  label: string
}): React.JSX.Element => (
  <div role="radiogroup" aria-label={label} className="lz-control-surface inline-flex max-w-full flex-wrap gap-0.5 rounded-lg border p-0.5">
    {options.map((o) => (
      <button
        key={o.id}
        type="button"
        role="radio"
        aria-checked={value === o.id}
        onClick={() => onChange(o.id)}
        className={cn(
          'h-6 cursor-pointer rounded-md px-2 text-[11px] font-semibold whitespace-nowrap transition-colors',
          value === o.id ? 'bg-primary text-primary-foreground shadow-sm' : 'lz-control-option'
        )}
      >
        {o.label}
      </button>
    ))}
  </div>
)

const Workshop: React.FC<{ c: WsComponent; bad: Failing[] }> = ({ c, bad }) => {
  const { advVariant, advSlot } = useUiState(useShallow((s) => ({ advVariant: s.advVariant, advSlot: s.advSlot })))
  const variant = c.variants.find((v) => v.id === advVariant) ?? c.variants[0]
  const [state, setState] = useState<WsState>('normal')
  const n = useChanged(c)
  const Icon = ICONS[c.id] ?? Layers
  const Sample = SAMPLES[c.id]
  const ui = useUiState.getState

  // Выделили слот (кликом по образцу или переходом из предпросмотра) — показываем нужное состояние и прокручиваем к нему.
  useEffect(() => {
    if (!advSlot) return
    const g = groupOfSlot(c.id, variant.id, advSlot)
    if (g?.state && c.states.includes(g.state)) setState(g.state)
    else setState((cur) => (cur === 'hover' || cur === 'focus' || cur === 'active' ? 'normal' : cur))
    const t = setTimeout(() => document.querySelector(`[data-ctl="${advSlot}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 80)
    return () => clearTimeout(t)
  }, [advSlot, c, variant.id])

  const pairsOf = (key: string): typeof ADVANCED_PAIRS => ADVANCED_PAIRS.filter((p) => p.group === c.id && (p.fg === key || p.bg === key))

  return (
    <div className="space-y-3" data-tour="appearance-adv-workshop">
      <div className="lz-control-surface flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2">
        <Button size="sm" variant="ghost" className="h-8 gap-1 rounded-lg px-2 text-xs" onClick={() => ui().openComp(null)}>
          <ArrowLeft className="size-3.5" /> Все компоненты
        </Button>
        <span className="h-5 w-px bg-border" />
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary">
          <Icon className="size-3.5" />
        </span>
        <h3 className="text-sm font-bold">{c.title}</h3>
        <ChangedChip n={n} />
        <div className="ml-auto flex items-center gap-1.5">
          {bad.length > 0 ? (
            <Button
              size="xs"
              variant="outline"
              className="border-st-warn/50 text-st-warn-text hover:bg-st-warn/10"
              title={bad.map((f) => `${f.pair.label} — ${f.ratio.toFixed(1)}:1`).join('\n')}
              onClick={() => autoFixAll(bad.map((f) => f.pair))}
            >
              <Wand2 /> Исправить читаемость
            </Button>
          ) : ADVANCED_PAIRS.some((p) => p.group === c.id) ? (
            <span className="flex items-center gap-1 rounded-md bg-st-ok/10 px-2 py-1 text-[11px] font-medium text-st-ok-text">
              <CircleCheck className="size-3" /> Читается
            </span>
          ) : null}
          <ResetButton label="Сбросить компонент" disabled={n === 0} onClick={() => useAppearanceStore.getState().resetTokenKeys(ownKeys(c))} />
        </div>
      </div>

      <section className="ui-glow overflow-hidden rounded-2xl border border-border bg-card text-card-foreground">
        {(c.variants.length > 1 || c.states.length > 1) && (
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
            {c.variants.length > 1 && (
              <Pills
                label="Вариант"
                value={variant.id}
                options={c.variants.map((v) => ({ id: v.id, label: v.label }))}
                onChange={(v) => ui().selectSlot(null, v)}
              />
            )}
            {c.states.length > 1 && (
              <div className="ml-auto">
                <Pills label="Состояние" value={state} options={c.states.map((s) => ({ id: s, label: WS_STATE_LABEL[s] }))} onChange={setState} />
              </div>
            )}
          </div>
        )}
        <div className="@container px-4 py-6" style={STAGE}>
          <Sample big state={state} variant={c.variants.length > 1 ? variant.id : null} onPick={(key, v) => ui().selectSlot(key, v ?? variant.id)} />
        </div>
        <div className="lz-control-surface flex items-center gap-1.5 border-t px-3 py-1.5 text-[10.5px]">
          <MousePointerClick className="size-3" /> Нажмите на часть образца — ниже выделится её цвет
        </div>
      </section>

      <motion.div key={variant.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }} className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-x-2.5 gap-y-3">
        {variant.groups.map((g) => (
          <section key={g.title}>
            <div className="mb-1.5 flex items-center gap-2 px-0.5">
              <span className="text-[10px] font-bold tracking-[0.12em] text-muted-foreground uppercase">{g.title}</span>
              <span className="h-px flex-1 bg-border/70" />
            </div>
            <div className="grid gap-1.5">
              {g.slots.map((sl) => (
                <SlotPlate
                  key={sl.key}
                  tokenKey={sl.key}
                  label={sl.label}
                  hint={sl.hint}
                  shared={sl.shared}
                  auto
                  pairs={pairsOf(sl.key)}
                  selected={advSlot === sl.key}
                  onSelect={() => ui().selectSlot(sl.key)}
                />
              ))}
            </div>
          </section>
        ))}
      </motion.div>
    </div>
  )
}

/** Вкладка «Тонкая настройка»: галерея компонентов → мастерская выбранного. */
export const AdvancedTab: React.FC = () => {
  const comp = useUiState((s) => s.advComp)
  const { list } = useContrastIssues(true)
  const c = wsComponent(comp)
  return (
    <motion.div key={c?.id ?? 'gallery'} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: 'easeOut' }}>
      {c ? <Workshop c={c} bad={list.filter((f) => f.pair.group === c.id)} /> : <Gallery list={list} />}
    </motion.div>
  )
}
