import React from 'react'
import { LayoutPanelLeft, MousePointerClick, Type } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { useShallow } from 'zustand/react/shallow'
import { Ctl, ResetButton, SectionCard, SelectField, Segmented, SliderRow } from './section'
import { useAppearanceStore } from '@renderer/lib/appearance/store'
import { FONT_OPTIONS } from '@renderer/lib/appearance/presets'


type Opt<T extends string> = { id: T; label: string; sample: React.ReactNode }

/** Плитка выбора стиля с маленьким образцом — сам результат виден в предпросмотре. */
function StylePicker<T extends string>({ title, value, options, onChange }: { title: string; value: T; options: Opt<T>[]; onChange: (v: T) => void }): React.ReactElement {
  return (
    <div className="px-1">
      <div className="mb-1 text-xs">{title}</div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-1.5">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            className={cn(
              'flex cursor-pointer flex-col items-center gap-2 rounded-xl border px-2 py-2.5 text-[11px] font-semibold transition-colors',
              value === o.id ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground'
            )}
          >
            <span className="flex h-8 items-center justify-center">{o.sample}</span>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

const btnBase = 'inline-block h-6 w-14 bg-primary'
const BUTTON_OPTS: Opt<AppearanceButtonStyle>[] = [
  { id: 'classic', label: 'Обычные', sample: <span className={cn(btnBase, 'rounded-md')} /> },
  { id: 'tactile', label: 'Тактильные', sample: <span className={cn(btnBase, 'rounded-md bg-gradient-to-b from-white/30 to-transparent bg-primary shadow-[inset_0_1px_0_rgba(255,255,255,.35),0_4px_10px_color-mix(in_srgb,var(--primary)_35%,transparent)]')} /> },
  { id: 'glass', label: 'Стекло', sample: <span className={cn(btnBase, 'rounded-full shadow-[0_6px_16px_color-mix(in_srgb,var(--primary)_45%,transparent)]')} /> },
  { id: 'keys', label: 'Клавиши', sample: <span className={cn(btnBase, 'rounded-md shadow-[0_3px_0_color-mix(in_srgb,var(--primary)_55%,#000)]')} /> },
  { id: 'pill', label: 'Пилюли', sample: <span className={cn(btnBase, 'rounded-full')} /> }
]
const sw = (track: string, thumb: string): React.ReactNode => (
  <span className={cn('relative inline-block h-5 w-9 bg-primary', track)}>
    <span className={cn('absolute right-0.5 top-0.5 size-4 bg-white', thumb)} />
  </span>
)
const SWITCH_OPTS: Opt<AppearanceSwitchStyle>[] = [
  { id: 'classic', label: 'Обычные', sample: sw('rounded-full', 'rounded-full') },
  { id: 'glow', label: 'Свечение', sample: sw('rounded-full shadow-[0_0_12px_color-mix(in_srgb,var(--primary)_65%,transparent)]', 'rounded-full') },
  { id: 'square', label: 'Квадратные', sample: sw('rounded-md', 'rounded-[3px]') },
  { id: 'rocker', label: 'Тумблер', sample: sw('rounded-lg shadow-[inset_0_1px_3px_rgba(0,0,0,.5)]', 'rounded-md shadow-[0_2px_0_rgba(0,0,0,.35)]') }
]
const card = (cls: string): React.ReactNode => <span className={cn('inline-block h-8 w-14 rounded-lg border border-border', cls)} />
const CARD_OPTS: Opt<AppearanceCardStyle>[] = [
  { id: 'classic', label: 'Обычные', sample: card('bg-card') },
  { id: 'raised', label: 'Объёмные', sample: card('border-transparent bg-card bg-gradient-to-b from-white/10 to-transparent shadow-[0_8px_18px_rgba(0,0,0,.55),inset_0_1px_0_rgba(255,255,255,.12)]') },
  { id: 'glass', label: 'Стекло', sample: card('border-primary/50 bg-card/40 backdrop-blur') },
  { id: 'outline', label: 'Контур', sample: card('border-2 border-foreground/25 bg-transparent') },
  { id: 'neon', label: 'Неон', sample: card('border-primary/60 bg-card shadow-[0_0_16px_color-mix(in_srgb,var(--primary)_40%,transparent)]') },
  { id: 'flat', label: 'Плоские', sample: card('rounded-xl border-transparent bg-foreground/[0.08]') }
]

/** Вкладка «Интерфейс»: шрифт, размеры, плотность, анимации. */
export const InterfaceTab: React.FC = () => {
  const st = useAppearanceStore(useShallow((s) => s.settings))
  const setSettings = useAppearanceStore((s) => s.setSettings)
  const resetSettings = useAppearanceStore((s) => s.resetSettings)
  return (
    <div className="space-y-2.5">
      <SectionCard icon={Type} title="Шрифт" tip="Свой шрифт должен быть установлен в Windows.">
        <Ctl id="setting:fontFamily">
          <SelectField value={st.fontFamily} onChange={(e) => setSettings({ fontFamily: e.target.value })}>
            {FONT_OPTIONS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </SelectField>
          {st.fontFamily === 'custom' && (
            <input
              value={st.fontCustom}
              onChange={(e) => setSettings({ fontCustom: e.target.value })}
              placeholder="Название установленного шрифта"
              className="select-text mt-1.5 h-8 w-full rounded-lg border border-border bg-background px-2 text-xs outline-none focus:border-primary"
            />
          )}
        </Ctl>
        <div className="mt-1.5 grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-x-3">
          <SliderRow id="setting:fontScale" label="Размер текста" value={st.fontScale} min={0.85} max={1.3} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setSettings({ fontScale: v })} />
          <SliderRow id="setting:radius" label="Скругление" value={st.radius} min={0} max={1.5} step={0.05} format={(v) => `${v.toFixed(2)} rem`} onChange={(v) => setSettings({ radius: v })} />
        </div>
      </SectionCard>

      <SectionCard icon={MousePointerClick} title="Элементы управления" tip="Как выглядят кнопки, переключатели и карточки во всём приложении. Результат сразу виден в предпросмотре.">
        <div className="space-y-3">
          <StylePicker title="Кнопки" value={st.buttonStyle ?? 'classic'} options={BUTTON_OPTS} onChange={(v) => setSettings({ buttonStyle: v })} />
          <StylePicker title="Переключатели" value={st.switchStyle ?? 'classic'} options={SWITCH_OPTS} onChange={(v) => setSettings({ switchStyle: v })} />
          <StylePicker title="Карточки" value={st.cardStyle ?? 'classic'} options={CARD_OPTS} onChange={(v) => setSettings({ cardStyle: v })} />
          <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-x-3 gap-y-1.5">
            <SliderRow id="setting:uiShadow" label="Глубина теней" value={st.uiShadow ?? 0.6} min={0} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setSettings({ uiShadow: v })} />
            <SliderRow id="setting:uiBorder" label="Толщина рамок" value={st.uiBorder ?? 1} min={0} max={3} step={0.5} format={(v) => `${v} px`} onChange={(v) => setSettings({ uiBorder: v })} />
            <Ctl id="setting:buttonSize" className="px-1">
              <div className="mb-0.5 text-xs">Размер кнопок</div>
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
          </div>
        </div>
      </SectionCard>

      <SectionCard icon={LayoutPanelLeft} title="Компоновка" right={<ResetButton label="Сбросить настройки" onClick={resetSettings} />}>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-x-3 gap-y-1.5">
          <SliderRow id="setting:sidebarWidth" label="Ширина меню" value={st.sidebarWidth} min={180} max={300} step={4} format={(v) => `${v} px`} onChange={(v) => setSettings({ sidebarWidth: v })} />
          <Ctl id="setting:density" className="px-1">
            <div className="mb-0.5 text-xs">Плотность</div>
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
            <div className="mb-0.5 text-xs">Анимации</div>
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
