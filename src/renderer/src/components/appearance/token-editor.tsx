import React, { useState } from 'react'
import { Activity, Check, Layers, Sparkles, Type } from 'lucide-react'
import { InfoTip, ResetButton } from './section'
import { FixBanner } from './fix-banner'
import { SlotPlate } from './slot'
import { PickArea } from './samples'
import { Button } from '@renderer/components/ui/button'
import { Switch } from '@renderer/components/ui/switch'
import { SIMPLE_GROUPS, type SimpleGroup } from '@renderer/lib/appearance/tokens'
import { PAIRS_BY_KEY } from '@renderer/lib/appearance/contrast'
import { useContrastIssues } from '@renderer/lib/appearance/contrast-watch'
import { autoFixAll } from '@renderer/lib/appearance/contrast-state'
import { useAppearanceStore } from '@renderer/lib/appearance/store'
import { accentPresets, harmonizeFromAccent } from '@renderer/lib/appearance/harmony'
import { cn } from '@renderer/lib/utils'

export { AdvancedTab } from './workshop'

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = { base: Layers, text: Type, status: Activity }

const TIPS: Record<string, string> = {
  base: 'Остальные цвета (наведение, рамки полей, значки, уведомления) считаются от этих автоматически.',
  text: 'Цвет текста в разных местах программы.',
  status: 'Цвета состояний: включено, ошибка, предупреждение, сведения.'
}

const slot = (key: string): Record<string, string> => ({ 'data-slot-key': key })

// ---- Живые примеры: где используется цвет. Нажатие на часть выделяет её цвет слева. ----

const BaseExample: React.FC = () => (
  <div {...slot('border')} className="overflow-hidden rounded-xl border border-border shadow-sm">
    <div className="flex h-[148px]">
      <div {...slot('sidebar')} className="w-[92px] shrink-0 space-y-1 border-r border-border bg-sidebar p-2 pl-2.5">
        <div className="px-1 pb-1 text-[9px] font-bold tracking-[0.16em] text-[color:var(--text-header)]">LAZEYKA</div>
        <div className="relative flex h-5 items-center rounded-md bg-sidebar-accent px-1.5 text-[10px] font-medium text-sidebar-accent-foreground">
          <span className="absolute top-1 bottom-1 -left-2 w-[2px] rounded-r-full bg-sidebar-primary" />
          Главная
        </div>
        <div className="flex h-5 items-center px-1.5 text-[10px] text-sidebar-foreground/80">Zapret</div>
        <div className="flex h-5 items-center px-1.5 text-[10px] text-sidebar-foreground/80">Игры</div>
      </div>
      <div {...slot('background')} className="min-w-0 flex-1 bg-background p-2.5">
        <div {...slot('card')} className="space-y-2 rounded-lg border border-border bg-card p-2.5 text-card-foreground">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-[11px] font-semibold text-[color:var(--text-title)]">Подключение</span>
            <span {...slot('primary')}>
              <Switch checked tabIndex={-1} size="sm" />
            </span>
          </div>
          <div className="truncate text-[10px] text-muted-foreground">Профиль «Общий»</div>
          <span {...slot('primary')} className="inline-flex">
            <Button size="xs" tabIndex={-1}>
              Включить
            </Button>
          </span>
        </div>
      </div>
    </div>
  </div>
)

const TextExample: React.FC = () => (
  <div className="overflow-hidden rounded-xl border border-border shadow-sm">
    <div {...slot('text-header')} className="flex h-8 items-center border-b border-border bg-background px-3 text-[13px] font-bold text-[color:var(--text-header)]">
      Оформление
    </div>
    <div className="bg-background p-2.5">
      <div className="space-y-1 rounded-lg border border-border bg-card p-3 text-card-foreground">
        <div {...slot('text-title')} className="text-sm font-semibold text-[color:var(--text-title)]">
          Обход блокировок
        </div>
        <p {...slot('foreground')} className="text-xs leading-snug text-foreground">
          Сайты и игры открываются без VPN.
        </p>
        <p {...slot('muted-foreground')} className="text-[11px] leading-snug text-muted-foreground">
          Профиль можно сменить в любой момент.
        </p>
      </div>
    </div>
  </div>
)

const STATUS_ROWS: [string, string, string][] = [
  ['success', 'Работает', 'включено'],
  ['destructive', 'Нет подключения', 'ошибка'],
  ['warning', 'Низкая скорость', 'внимание'],
  ['info', 'Доступно обновление', 'сведения']
]

const StatusExample: React.FC = () => (
  <div className="space-y-1 rounded-xl border border-border bg-card p-2 text-card-foreground shadow-sm">
    {STATUS_ROWS.map(([k, t, tag]) => (
      <div key={k} {...slot(k)} className="flex items-center gap-2 rounded-lg px-2 py-1.5" style={{ background: `color-mix(in oklab, var(--${k}) 7%, transparent)` }}>
        <span className="size-2 shrink-0 rounded-full" style={{ background: `var(--${k})`, boxShadow: `0 0 0 3px color-mix(in oklab, var(--${k}) 22%, transparent)` }} />
        <span className="min-w-0 flex-1 truncate text-xs font-medium" style={{ color: `var(--${k})` }}>
          {t}
        </span>
        <span
          className="rounded-md px-1.5 py-px text-[10px] font-semibold"
          style={{ color: `var(--${k})`, background: `color-mix(in oklab, var(--${k}) 15%, transparent)` }}
        >
          {tag}
        </span>
      </div>
    ))}
  </div>
)

const EXAMPLES: Record<string, React.FC> = { base: BaseExample, text: TextExample, status: StatusExample }

/** Быстрые акценты и «в тон акценту». */
const AccentBar: React.FC = () => {
  const mode = useAppearanceStore((s) => s.mode)
  const cur = useAppearanceStore((s) => s.tokens['primary']?.toLowerCase())
  const pick = (color: string): void => {
    const s = useAppearanceStore.getState()
    // Акцент Windows перекрывает свой цвет — выключаем его, иначе выбор не будет виден.
    if (s.system.accent) s.setSystem({ accent: false })
    useAppearanceStore.getState().setToken('primary', color)
  }
  return (
    <div data-tour="appearance-accent-presets" className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-background/40 px-3 py-2">
      <span className="text-[11px] font-semibold text-muted-foreground">Быстрый акцент</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {accentPresets(mode).map((a) => {
          const on = cur === a.color.toLowerCase()
          return (
            <button
              key={a.name}
              type="button"
              title={a.name}
              aria-label={`Акцент: ${a.name}`}
              aria-pressed={on}
              onClick={() => pick(a.color)}
              className={cn(
                'flex size-6 cursor-pointer items-center justify-center rounded-full transition-transform duration-150 hover:scale-110',
                on && 'ring-2 ring-foreground/70 ring-offset-2 ring-offset-card'
              )}
              style={{ background: a.color }}
            >
              {on && <Check className="size-3.5" style={{ color: mode === 'dark' ? '#0b0d10' : '#ffffff' }} />}
            </button>
          )
        })}
      </div>
      <div className="ml-auto flex items-center gap-1">
        <Button size="xs" variant="outline" onClick={harmonizeFromAccent} data-tour="appearance-harmonize">
          <Sparkles /> Подобрать в тон акценту
        </Button>
        <InfoTip text="Фон, панели, меню, рамки и текст получат лёгкий оттенок акцента; светлота каждого цвета сохранится. Потом читаемость проверится и при необходимости исправится. Отменяется кнопкой «Отменить»." />
      </div>
    </div>
  )
}

const GroupCard: React.FC<{ g: SimpleGroup }> = ({ g }) => {
  const Icon = ICONS[g.id] ?? Layers
  const Example = EXAMPLES[g.id]
  const [sel, setSel] = useState<string | null>(null)
  const keys = g.colors.map((c) => c.key)
  const edits = useAppearanceStore((s) => keys.filter((k) => s.tokens[k] !== undefined).length)
  return (
    <section data-tour={`appearance-colors-${g.id}`} className="ui-glow rounded-xl border border-border bg-card p-4 text-card-foreground">
      <div className="mb-3 flex min-h-6 items-center gap-1.5">
        <span className="flex size-6 items-center justify-center rounded-md bg-primary/12 text-primary">
          <Icon className="size-3.5" />
        </span>
        <h3 className="text-[13px] font-semibold text-[color:var(--text-title)]">{g.title}</h3>
        <InfoTip text={TIPS[g.id]} />
        {edits > 0 && <span className="rounded-md bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">изменено: {edits}</span>}
        <div className="ml-auto">
          {edits > 0 && <ResetButton label="Вернуть цвета темы" onClick={() => useAppearanceStore.getState().resetTokenKeys(keys)} />}
        </div>
      </div>
      {g.id === 'base' && <AccentBar />}
      <div className="@container">
        <div className="grid gap-3 @[640px]:grid-cols-[minmax(0,1fr)_minmax(230px,280px)]">
          <div className="grid content-start gap-2 @[520px]:grid-cols-2 @[640px]:grid-cols-1 @[900px]:grid-cols-2">
            {g.colors.map((c) => (
              <SlotPlate
                key={c.key}
                tokenKey={c.key}
                label={c.label}
                hint={c.hint}
                pairs={PAIRS_BY_KEY.get(c.key)}
                selected={sel === c.key}
                onSelect={() => setSel(c.key)}
              />
            ))}
          </div>
          <div className="order-first @[640px]:order-none">
            <PickArea onPick={(k) => setSel(k)}>
              <Example />
            </PickArea>
            <p className="mt-1.5 px-0.5 text-[10.5px] text-muted-foreground">Где используется. Нажмите на часть примера — выделится её цвет.</p>
          </div>
        </div>
      </div>
    </section>
  )
}

/** Вкладка «Цвета»: 13 смысловых цветов с живыми примерами, остальное считается само. */
export const ColorsTab: React.FC = () => {
  const { list } = useContrastIssues()
  return (
    <div className="space-y-3">
      <FixBanner tour="appearance-colors-fix" ok="Проверка читаемости: всё в порядке" list={list} action="Исправить всё" onFix={() => autoFixAll()} />
      {SIMPLE_GROUPS.map((g) => (
        <GroupCard key={g.id} g={g} />
      ))}
    </div>
  )
}
