import React, { useState } from 'react'
import { Check, ChevronDown, LayoutPanelLeft, MousePointerClick, Type } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { useShallow } from 'zustand/react/shallow'
import { Ctl, ResetButton, SectionCard, Segmented, SliderRow } from './section'
import { useAppearanceStore } from '@renderer/lib/appearance/store'
import { useUiState } from '@renderer/lib/appearance/ui-state'
import { DEFAULT_SETTINGS, FONT_OPTIONS } from '@renderer/lib/appearance/presets'
import { WindowZoomCtl } from './window-zoom'

type Opt<T extends string> = { id: T; label: string; sample: React.ReactNode }

const STAGE: React.CSSProperties = {
  backgroundImage:
    'radial-gradient(color-mix(in oklab, var(--foreground) 8%, transparent) 1px, transparent 1px)',
  backgroundSize: '12px 12px'
}

/** Плитки выбора стиля с живым образцом в цветах темы; результат сразу виден во всей программе. */
function StylePicker<T extends string>({
  title,
  value,
  options,
  onChange,
  tour,
  min = 104
}: {
  title: string
  value: T
  options: Opt<T>[]
  onChange: (v: T) => void
  tour?: string
  min?: number
}): React.ReactElement {
  return (
    <div data-tour={tour}>
      <div className="mb-1.5 px-0.5 text-[10px] font-bold tracking-[0.12em] text-muted-foreground uppercase">
        {title}
      </div>
      <div
        className="grid gap-1.5"
        style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))` }}
      >
        {options.map((o) => {
          const on = value === o.id
          return (
            <button
              key={o.id}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(o.id)}
              className={cn(
                'group/opt relative flex cursor-pointer flex-col overflow-hidden rounded-xl border text-[11px] font-semibold transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5',
                on
                  ? 'border-primary text-foreground shadow-[0_0_0_3px_color-mix(in_oklab,var(--primary)_22%,transparent)]'
                  : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground'
              )}
            >
              <span
                className="flex h-14 items-center justify-center bg-background/40"
                style={STAGE}
              >
                {o.sample}
              </span>
              <span
                className={cn(
                  'flex items-center justify-center gap-1 border-t px-1 py-1.5',
                  on ? 'border-primary/40 bg-primary/10' : 'border-border bg-card'
                )}
              >
                {on && <Check className="size-3 text-primary" />}
                <span className="truncate">{o.label}</span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Ползунок с живым образцом справа. */
const WithSample: React.FC<{ sample: React.ReactNode; children: React.ReactNode }> = ({
  sample,
  children
}) => (
  <div className="grid grid-cols-[minmax(0,1fr)_64px] items-center gap-3 rounded-xl border border-border bg-background/30 py-1.5 pr-1.5 pl-2">
    <div className="min-w-0">{children}</div>
    <div
      className="flex h-12 items-center justify-center overflow-hidden rounded-lg bg-background/60"
      style={STAGE}
    >
      {sample}
    </div>
  </div>
)

const btnBase =
  'inline-flex h-7 items-center px-3 text-[11px] font-semibold text-primary-foreground bg-primary'
const BUTTON_OPTS: Opt<AppearanceButtonStyle>[] = [
  {
    id: 'classic',
    label: 'Обычные',
    sample: <span className={cn(btnBase, 'rounded-md')}>Кнопка</span>
  },
  {
    id: 'tactile',
    label: 'Тактильные',
    sample: (
      <span
        className={cn(
          btnBase,
          'rounded-md bg-gradient-to-b from-white/30 to-transparent bg-primary shadow-[inset_0_1px_0_rgba(255,255,255,.35),0_4px_10px_color-mix(in_srgb,var(--primary)_35%,transparent)]'
        )}
      >
        Кнопка
      </span>
    )
  },
  {
    id: 'glass',
    label: 'Стекло',
    sample: (
      <span
        className={cn(
          btnBase,
          'rounded-full shadow-[0_6px_16px_color-mix(in_srgb,var(--primary)_45%,transparent)]'
        )}
      >
        Кнопка
      </span>
    )
  },
  {
    id: 'keys',
    label: 'Клавиши',
    sample: (
      <span
        className={cn(
          btnBase,
          'rounded-md shadow-[0_3px_0_color-mix(in_srgb,var(--primary)_55%,#000)]'
        )}
      >
        Кнопка
      </span>
    )
  },
  {
    id: 'pill',
    label: 'Пилюли',
    sample: <span className={cn(btnBase, 'rounded-full')}>Кнопка</span>
  }
]
const sw = (track: string, thumb: string): React.ReactNode => (
  <span className={cn('relative inline-block h-5 w-9 bg-primary', track)}>
    <span className={cn('absolute right-0.5 top-0.5 size-4 bg-white', thumb)} />
  </span>
)
const SWITCH_OPTS: Opt<AppearanceSwitchStyle>[] = [
  { id: 'classic', label: 'Обычные', sample: sw('rounded-full', 'rounded-full') },
  {
    id: 'glow',
    label: 'Свечение',
    sample: sw(
      'rounded-full shadow-[0_0_12px_color-mix(in_srgb,var(--primary)_65%,transparent)]',
      'rounded-full'
    )
  },
  { id: 'square', label: 'Квадратные', sample: sw('rounded-md', 'rounded-[3px]') },
  {
    id: 'rocker',
    label: 'Тумблер',
    sample: sw(
      'rounded-lg shadow-[inset_0_1px_3px_rgba(0,0,0,.5)]',
      'rounded-md shadow-[0_2px_0_rgba(0,0,0,.35)]'
    )
  }
]
const card = (cls: string): React.ReactNode => (
  <span
    className={cn(
      'flex h-9 w-16 flex-col justify-center gap-1 rounded-lg border border-border px-2',
      cls
    )}
  >
    <span className="h-[3px] w-[70%] rounded-full bg-[color:var(--text-title)] opacity-80" />
    <span className="h-[3px] w-[45%] rounded-full bg-muted-foreground opacity-60" />
  </span>
)
const CARD_OPTS: Opt<AppearanceCardStyle>[] = [
  { id: 'classic', label: 'Обычные', sample: card('bg-card') },
  {
    id: 'raised',
    label: 'Объёмные',
    sample: card(
      'border-transparent bg-card bg-gradient-to-b from-white/10 to-transparent shadow-[0_8px_18px_rgba(0,0,0,.55),inset_0_1px_0_rgba(255,255,255,.12)]'
    )
  },
  { id: 'glass', label: 'Стекло', sample: card('border-primary/50 bg-card/40 backdrop-blur') },
  { id: 'outline', label: 'Контур', sample: card('border-2 border-foreground/25 bg-transparent') },
  {
    id: 'neon',
    label: 'Неон',
    sample: card(
      'border-primary/60 bg-card shadow-[0_0_16px_color-mix(in_srgb,var(--primary)_40%,transparent)]'
    )
  },
  {
    id: 'flat',
    label: 'Плоские',
    sample: card('rounded-xl border-transparent bg-foreground/[0.08]')
  }
]

/** Раскрывающийся блок второстепенных настроек. */
const More: React.FC<{ title: string; keys: string[]; children: React.ReactNode }> = ({
  title,
  keys,
  children
}) => {
  const [open, setOpen] = useState(false)
  // Переход к настройке из предпросмотра или экскурсии раскрывает блок.
  const focused = useUiState((s) => s.focusKey !== null && keys.includes(s.focusKey))
  if (focused && !open) setOpen(true)
  return (
    <div className="border-t border-border pt-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex cursor-pointer items-center gap-1 px-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
      >
        <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} />
        {title}
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  )
}

/** Вкладка «Элементы» (ключ interface): шрифт, вид элементов, компоновка. */
export const InterfaceTab: React.FC = () => {
  const st = useAppearanceStore(useShallow((s) => s.settings))
  const setSettings = useAppearanceStore((s) => s.setSettings)
  // Сброс только того, что на этой вкладке: раньше кнопка сбрасывала все настройки,
  // включая обои и их размытие на вкладке «Темы и фон».
  const resetInterface = (): void =>
    setSettings({
      fontScale: DEFAULT_SETTINGS.fontScale,
      fontFamily: DEFAULT_SETTINGS.fontFamily,
      fontCustom: DEFAULT_SETTINGS.fontCustom,
      radius: DEFAULT_SETTINGS.radius,
      density: DEFAULT_SETTINGS.density,
      animations: DEFAULT_SETTINGS.animations,
      sidebarWidth: DEFAULT_SETTINGS.sidebarWidth,
      buttonStyle: DEFAULT_SETTINGS.buttonStyle,
      switchStyle: DEFAULT_SETTINGS.switchStyle,
      cardStyle: DEFAULT_SETTINGS.cardStyle,
      uiShadow: DEFAULT_SETTINGS.uiShadow,
      uiBorder: DEFAULT_SETTINGS.uiBorder,
      buttonSize: DEFAULT_SETTINGS.buttonSize
    })
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="lz-onwall min-w-0 flex-[1_1_240px] text-[11px]">
          Шрифт, размеры и вид кнопок, переключателей и карточек во всей программе.
        </span>
        <ResetButton label="Сбросить вкладку" onClick={resetInterface} />
      </div>
      <SectionCard
        icon={Type}
        title="Шрифт и размер"
        tip="Свой шрифт должен быть установлен в системе. Если такого шрифта нет, останется стандартный."
      >
        <Ctl id="setting:fontFamily">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-1.5">
            {FONT_OPTIONS.map((f) => {
              const on = st.fontFamily === f.id
              const family =
                f.id === 'onest'
                  ? 'Onest, var(--font-sans)'
                  : f.id === 'custom'
                    ? st.fontCustom || 'inherit'
                    : (f.stack ?? 'inherit')
              return (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={on}
                  title={f.label}
                  onClick={() => setSettings({ fontFamily: f.id })}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-xl border px-2 py-1.5 text-left transition-[border-color,box-shadow] duration-200',
                    on
                      ? 'border-primary bg-primary/10 shadow-[0_0_0_3px_color-mix(in_oklab,var(--primary)_18%,transparent)]'
                      : 'border-border hover:border-primary/40'
                  )}
                >
                  <span
                    className="w-7 shrink-0 text-center text-lg leading-none text-[color:var(--text-title)]"
                    style={{ fontFamily: family }}
                  >
                    {f.id === 'custom' ? '…' : 'Аа'}
                  </span>
                  <span
                    className={cn(
                      'min-w-0 truncate text-[11px] font-semibold',
                      on ? 'text-foreground' : 'text-muted-foreground'
                    )}
                  >
                    {f.label
                      .replace(' (по умолчанию)', '')
                      .replace(' (с засечками)', '')
                      .replace(' (моноширинный)', '')
                      .replace('…', '')}
                  </span>
                </button>
              )
            })}
          </div>
          {st.fontFamily === 'custom' && (
            <input
              value={st.fontCustom}
              onChange={(e) => setSettings({ fontCustom: e.target.value })}
              placeholder="Название установленного шрифта"
              className="select-text mt-1.5 h-8 w-full rounded-lg border border-[color:var(--input-border)] bg-[color:var(--input-bg)] px-2 text-xs outline-none focus:border-[color:var(--input-focus-border)]"
            />
          )}
        </Ctl>
        <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-2">
          <WithSample
            sample={
              <span
                className="font-semibold text-[color:var(--text-title)]"
                style={{ fontSize: `${Math.round(14 * st.fontScale)}px` }}
              >
                Аа
              </span>
            }
          >
            <SliderRow
              id="setting:fontScale"
              label="Размер текста"
              value={st.fontScale}
              min={0.85}
              max={1.3}
              step={0.05}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(v) => setSettings({ fontScale: v })}
            />
          </WithSample>
          <WithSample
            sample={
              <span
                className="block size-9 border-2 border-primary bg-primary/20"
                style={{ borderRadius: `${st.radius}rem` }}
              />
            }
          >
            <SliderRow
              id="setting:radius"
              label="Скругление"
              value={st.radius}
              min={0}
              max={1.5}
              step={0.05}
              format={(v) => `${v.toFixed(2)} rem`}
              onChange={(v) => setSettings({ radius: v })}
            />
          </WithSample>
        </div>
        {/* Е6: масштаб всего окна — рядом с размером текста. */}
        <WindowZoomCtl />
      </SectionCard>

      <SectionCard
        icon={MousePointerClick}
        title="Вид элементов"
        tip="Как выглядят кнопки, переключатели и карточки во всей программе. Результат виден в предпросмотре."
      >
        <div className="space-y-3">
          <StylePicker
            title="Кнопки"
            tour="appearance-button-style"
            value={st.buttonStyle ?? 'classic'}
            options={BUTTON_OPTS}
            onChange={(v) => setSettings({ buttonStyle: v })}
          />
          <StylePicker
            title="Переключатели"
            tour="appearance-switch-style"
            value={st.switchStyle ?? 'classic'}
            options={SWITCH_OPTS}
            onChange={(v) => setSettings({ switchStyle: v })}
          />
          <StylePicker
            title="Карточки"
            tour="appearance-card-style"
            value={st.cardStyle ?? 'classic'}
            options={CARD_OPTS}
            onChange={(v) => setSettings({ cardStyle: v })}
          />
          <Ctl id="setting:buttonSize" className="px-1">
            <div className="mb-1 text-xs">Размер кнопок</div>
            <Segmented
              value={st.buttonSize ?? 'normal'}
              options={[
                { id: 'compact', label: 'Компактные' },
                { id: 'normal', label: 'Обычные' },
                { id: 'large', label: 'Крупные' }
              ]}
              onChange={(v) => setSettings({ buttonSize: v })}
            />
          </Ctl>
          <More title="Тени и рамки" keys={['setting:uiShadow', 'setting:uiBorder']}>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-2">
              <WithSample
                sample={
                  <span
                    className="block h-7 w-10 rounded-md bg-card"
                    style={{
                      boxShadow: `0 ${Math.round(2 + 8 * (st.uiShadow ?? 0.6))}px ${Math.round(4 + 16 * (st.uiShadow ?? 0.6))}px rgba(0,0,0,${(0.15 + 0.45 * (st.uiShadow ?? 0.6)).toFixed(2)})`
                    }}
                  />
                }
              >
                <SliderRow
                  id="setting:uiShadow"
                  label="Глубина теней"
                  value={st.uiShadow ?? 0.6}
                  min={0}
                  max={1}
                  step={0.05}
                  format={(v) => `${Math.round(v * 100)}%`}
                  onChange={(v) => setSettings({ uiShadow: v })}
                />
              </WithSample>
              <WithSample
                sample={
                  <span
                    className="block h-7 w-10 rounded-md bg-card"
                    style={{ border: `${st.uiBorder ?? 1}px solid var(--border)` }}
                  />
                }
              >
                <SliderRow
                  id="setting:uiBorder"
                  label="Толщина рамок"
                  value={st.uiBorder ?? 1}
                  min={0}
                  max={3}
                  step={0.5}
                  format={(v) => `${v} px`}
                  onChange={(v) => setSettings({ uiBorder: v })}
                />
              </WithSample>
            </div>
          </More>
        </div>
      </SectionCard>

      <SectionCard
        icon={LayoutPanelLeft}
        title="Компоновка"
        tip="Ширина бокового меню, расстояния между элементами и анимации."
      >
        <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-x-3 gap-y-3">
          <WithSample
            sample={
              <span className="flex h-8 w-12 overflow-hidden rounded-md border border-border bg-background">
                <span
                  className="h-full border-r border-border bg-sidebar"
                  style={{ width: `${Math.round(((st.sidebarWidth - 120) / 220) * 100)}%` }}
                />
              </span>
            }
          >
            <SliderRow
              id="setting:sidebarWidth"
              label="Ширина меню"
              value={st.sidebarWidth}
              min={180}
              max={300}
              step={4}
              format={(v) => `${v} px`}
              onChange={(v) => setSettings({ sidebarWidth: v })}
            />
          </WithSample>
          <Ctl id="setting:density" className="px-1">
            <div className="mb-1 text-xs">Плотность</div>
            <Segmented
              value={st.density}
              options={[
                { id: 'compact', label: 'Компактная' },
                { id: 'normal', label: 'Обычная' },
                { id: 'comfortable', label: 'Просторная' }
              ]}
              onChange={(v) => setSettings({ density: v })}
            />
          </Ctl>
          <Ctl id="setting:animations" className="px-1">
            <div className="mb-1 text-xs">Анимации</div>
            <Segmented
              value={st.animations}
              options={[
                { id: 'on', label: 'Вкл' },
                { id: 'auto', label: 'Как в системе' },
                { id: 'off', label: 'Выкл' }
              ]}
              onChange={(v) => setSettings({ animations: v })}
            />
          </Ctl>
        </div>
      </SectionCard>
    </div>
  )
}
