import React from 'react'
import { MonitorCog } from 'lucide-react'
import { toast } from 'sonner'
import { useShallow } from 'zustand/react/shallow'
import { Switch } from '@renderer/components/ui/switch'
import { SectionCard, InfoTip, SelectField } from './section'
import { useAppearanceStore } from '@renderer/lib/appearance/store'
import { BUILTIN_PRESETS } from '@renderer/lib/appearance/presets'
import { appearanceGetSystem, setNativeTheme } from '@renderer/utils/ipc'


/** Windows: два переключателя — тема системы и акцентный цвет. Работает по событиям, без опроса. */
export const SystemCard: React.FC = () => {
  const system = useAppearanceStore(useShallow((s) => s.system))
  const custom = useAppearanceStore((s) => s.custom)
  const accentAvailable = useAppearanceStore((s) => s.systemAccent !== null)
  const setSystem = useAppearanceStore((s) => s.setSystem)

  const options = (mode: AppearanceMode): { id: string; name: string }[] => [
    ...BUILTIN_PRESETS.filter((p) => p.mode === mode).map((p) => ({ id: p.id, name: p.name })),
    ...custom.filter((c) => c.mode === mode).map((c) => ({ id: c.id, name: c.name }))
  ]

  const toggleFollow = async (on: boolean): Promise<void> => {
    try {
      if (on) await setNativeTheme('system')
      const info = await appearanceGetSystem()
      setSystem({ follow: on })
      useAppearanceStore.getState().setSystemInfo(info)
    } catch (e) {
      toast.error('Не удалось определить тему системы', { description: e instanceof Error ? e.message : String(e) })
    }
  }

  return (
    <SectionCard icon={MonitorCog} title="Windows">
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 text-xs">
          <span>Как в системе</span>
          <InfoTip text="Светлая или тёмная тема Windows сама выбирает пресет." />
          <Switch size="sm" className="ml-auto" checked={system.follow} onCheckedChange={toggleFollow} />
        </div>
        {system.follow && (
          <div className="grid grid-cols-2 gap-2">
            <SelectField value={system.lightPreset} onChange={(e) => setSystem({ lightPreset: e.target.value })} title="Светлая тема Windows">
              {options('light').map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </SelectField>
            <SelectField value={system.darkPreset} onChange={(e) => setSystem({ darkPreset: e.target.value })} title="Тёмная тема Windows">
              {options('dark').map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </SelectField>
          </div>
        )}
        <div className="flex items-center gap-2 text-xs">
          <span>Акцент из Windows</span>
          <InfoTip text={accentAvailable ? 'Цвет акцента берётся из персонализации Windows. Ваши правки цветов важнее.' : 'Система не отдаёт акцентный цвет.'} />
          <Switch size="sm" className="ml-auto" checked={system.accent} disabled={!accentAvailable} onCheckedChange={(v) => setSystem({ accent: v })} />
        </div>
      </div>
    </SectionCard>
  )
}
