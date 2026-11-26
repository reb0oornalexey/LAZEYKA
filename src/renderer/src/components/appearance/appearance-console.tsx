import React from 'react'
import { Images, RotateCcw, Save } from 'lucide-react'
import { LzPanel } from '@renderer/components/lz'
import { Button } from '@renderer/components/ui/button'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { BUILTIN_PRESETS } from '@renderer/lib/appearance/presets'
import { useAppearanceStore } from '@renderer/lib/appearance/store'
import { useUiState, type AppearanceTab } from '@renderer/lib/appearance/ui-state'

const cardStyles: Record<AppearanceCardStyle, string> = {
  classic: 'Классика', raised: 'Объём', glass: 'Стекло', outline: 'Контур', neon: 'Неон', flat: 'Плоский'
}

export function AppearanceConsole({ onGallery }: { onGallery: () => void }): React.ReactElement {
  const presetId = useAppearanceStore((s) => s.presetId)
  const custom = useAppearanceStore((s) => s.custom.find((theme) => theme.id === s.presetId))
  const dirty = useAppearanceStore((s) => Object.keys(s.tokens).length > 0)
  const settings = useAppearanceStore((s) => s.settings)
  const { appConfig } = useAppConfig()
  const name = custom?.name ?? BUILTIN_PRESETS.find((theme) => theme.id === presetId)?.name ?? 'Своя тема'
  const ui = useUiState.getState()
  const chips: { label: string; value: string; tab?: AppearanceTab; control?: string }[] = [
    { label: 'Тема', value: name, tab: 'themes' },
    { label: 'Фон', value: settings.bgImage ? 'Обои' : settings.bgGradient ? 'Градиент' : 'Без обоев', tab: 'themes', control: 'setting:wallpaper' },
    { label: 'Элементы', value: cardStyles[settings.cardStyle], tab: 'interface' },
    { label: 'Шрифт', value: settings.fontFamily === 'custom' ? settings.fontCustom : settings.fontFamily === 'onest' ? 'Onest' : settings.fontFamily, control: 'setting:fontFamily' },
    { label: 'Масштаб', value: `${Math.round((Number(appConfig?.windowZoom) || 1) * 100)} %`, control: 'setting:windowZoom' }
  ]

  return (
    <LzPanel hero className="lz-panel-pad mb-3 shrink-0">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="relative size-10 cursor-pointer rounded-full bg-[conic-gradient(var(--primary)_0_32%,var(--accent)_32%_65%,var(--foreground)_65%)]"
          aria-label="Настроить цвета"
          title="Настроить цвета"
          onClick={() => ui.setTab('colors')}
        >
          <span className="absolute inset-1.5 rounded-full border border-border bg-card" />
        </button>
        <div className="min-w-0 flex-1 text-sm font-bold break-words">
          {dirty ? custom ? 'Тема изменена' : 'Своя тема, не сохранена' : `Тема «${name}»`}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="outline" title="Галерея тем" aria-label="Галерея тем" onClick={onGallery}>
            <Images /><span className="@max-[485px]:hidden">Галерея тем</span>
          </Button>
          <Button size="sm" title="Сохранить тему" aria-label="Сохранить тему" onClick={() => { ui.setTab('themes'); ui.openSaver(`${name} (своя)`) }}>
            <Save /><span className="@max-[485px]:hidden">Сохранить тему</span>
          </Button>
          {dirty && (
            <Button size="icon-sm" variant="ghost" title="Сбросить правки цветов" aria-label="Сбросить правки цветов" onClick={() => useAppearanceStore.getState().resetTokens()}>
              <RotateCcw />
            </Button>
          )}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {chips.map(({ label, value, tab, control }) => (
          <button
            key={label}
            type="button"
            onClick={() => {
              if (control) ui.focusControl(control)
              else if (tab) ui.setTab(tab)
            }}
            className="min-w-0 cursor-pointer rounded-lg border border-border bg-background/45 px-2 py-1 text-left text-xs break-words hover:border-primary/60"
          >
            <span className="text-muted-foreground">{label} </span>
            <span className="font-semibold">{value}</span>
          </button>
        ))}
      </div>
    </LzPanel>
  )
}
