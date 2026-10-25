import React from 'react'
import { LayoutPanelLeft, Type } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { Ctl, ResetButton, SectionCard, SelectField, Segmented, SliderRow } from './section'
import { useAppearanceStore } from '@renderer/lib/appearance/store'
import { FONT_OPTIONS } from '@renderer/lib/appearance/presets'


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
