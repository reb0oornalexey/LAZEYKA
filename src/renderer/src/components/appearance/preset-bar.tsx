import React, { useState } from 'react'
import { Check, Copy, Download, Moon, Palette, Pencil, Plus, Save, Sun, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { useShallow } from 'zustand/react/shallow'
import { SectionCard, Segmented } from './section'
import { Button } from '@renderer/components/ui/button'
import { useUiState } from '@renderer/lib/appearance/ui-state'
import { cn } from '@renderer/lib/utils'
import { useAppearanceStore } from '@renderer/lib/appearance/store'
import { BUILTIN_PRESETS } from '@renderer/lib/appearance/presets'
import { baseTokens } from '@renderer/lib/appearance/resolve'
import { appearanceExportTheme, appearanceImportTheme } from '@renderer/utils/ipc'
import { withAlpha } from '@renderer/lib/appearance/color'
import { ThemeBackdrop, themeHasBackdrop } from './theme-backdrop'

/** Крошечный макет окна в цветах темы: меню с активным пунктом, панель с заголовком, текстом, кнопкой и переключателем. */
export const ThemeMini: React.FC<{ t: Record<string, string>; className?: string; settings?: AppearanceSettings }> = ({ t, className, settings }) => {
  const v = (k: string, d = '#888'): string => t[k] ?? d
  // С фоном — как в настоящем окне: под содержимым заливки нет, боковая панель и
  // карточки полупрозрачные («Прозрачность панелей»), картинка видна между ними.
  const backdrop = themeHasBackdrop(settings) ? settings : null
  const op = backdrop ? Math.min(1, Math.max(0.15, backdrop.panelOpacity)) : 1
  const p = (k: string, d?: string): string => (op < 1 ? withAlpha(v(k, d), op) : v(k, d))
  const layout = (
    <div className={cn('flex overflow-hidden', backdrop ? 'absolute inset-0' : className)} style={{ background: backdrop ? undefined : v('background') }} aria-hidden>
      <div className="flex w-[30%] shrink-0 flex-col gap-[3px] p-[5px]" style={{ background: p('sidebar', v('background')), borderRight: `1px solid ${v('sidebar-border', v('border'))}` }}>
        <span className="mb-[2px] h-[3px] w-[70%] rounded-full" style={{ background: v('text-header', v('foreground')), opacity: 0.85 }} />
        <span className="relative h-[7px] rounded-[2px]" style={{ background: v('sidebar-accent', v('accent')) }}>
          <span className="absolute top-[1.5px] bottom-[1.5px] -left-[5px] w-[2px] rounded-r" style={{ background: v('primary') }} />
        </span>
        {[0.55, 0.7, 0.45].map((w, i) => (
          <span key={i} className="mx-[2px] h-[3px] rounded-full" style={{ width: `${w * 100}%`, background: v('sidebar-foreground', v('foreground')), opacity: 0.45 }} />
        ))}
      </div>
      <div className="min-w-0 flex-1 p-[5px]">
        <div className="flex h-full flex-col gap-[4px] rounded-[4px] p-[5px]" style={{ background: p('card'), border: `1px solid ${v('border')}` }}>
          <div className="flex items-center gap-1">
            <span className="h-[4px] w-[45%] rounded-full" style={{ background: v('text-title', v('foreground')) }} />
            <span className="ml-auto flex h-[8px] w-[15px] items-center justify-end rounded-full p-[1.5px]" style={{ background: v('primary') }}>
              <span className="size-[5px] rounded-full" style={{ background: v('primary-foreground', '#fff') }} />
            </span>
          </div>
          <span className="h-[3px] w-[80%] rounded-full" style={{ background: v('foreground'), opacity: 0.6 }} />
          <span className="h-[3px] w-[55%] rounded-full" style={{ background: v('muted-foreground'), opacity: 0.7 }} />
          <div className="mt-auto flex gap-[3px]">
            <span className="h-[8px] w-[34%] rounded-[3px]" style={{ background: v('primary') }} />
            <span className="h-[8px] w-[24%] rounded-[3px]" style={{ border: `1px solid ${v('border')}`, background: p('secondary', v('muted')) }} />
          </div>
        </div>
      </div>
    </div>
  )
  if (!backdrop) return layout
  return (
    <div className={cn('relative isolate overflow-hidden', className)} aria-hidden>
      <ThemeBackdrop settings={backdrop} canvas={v('background')} />
      {layout}
    </div>
  )
}

const Chip = React.memo(function Chip({
  tokens,
  name,
  active,
  onClick,
  actions,
  settings
}: {
  tokens: Record<string, string>
  /** Настройки сохранённой темы: если в них есть фон, он виден под мини-макетом. */
  settings?: AppearanceSettings
  name: string
  active: boolean
  onClick: () => void
  actions?: React.ReactNode
}) {
  return (
    <div className="group/theme relative">
      <button
        type="button"
        onClick={onClick}
        title={name}
        aria-pressed={active}
        className={cn(
          'block w-full cursor-pointer overflow-hidden rounded-xl border text-left transition-[transform,border-color,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-md',
          active ? 'border-primary shadow-[0_0_0_3px_color-mix(in_oklab,var(--primary)_25%,transparent)]' : 'border-border hover:border-primary/50'
        )}
      >
        <ThemeMini t={tokens} settings={settings} className="h-[62px]" />
        <div className="flex items-center gap-1.5 border-t border-border bg-card px-2 py-1.5 text-[11px] font-semibold text-card-foreground">
          <span className="size-2.5 shrink-0 rounded-full" style={{ background: tokens['primary'] }} />
          <span className="min-w-0 flex-1 truncate">{name}</span>
          {active && (
            <span className="flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Check className="size-2.5" />
            </span>
          )}
        </div>
      </button>
      {actions && (
        <div className="absolute top-1 right-1 flex gap-0.5 opacity-0 transition-opacity group-hover/theme:opacity-100 focus-within:opacity-100">{actions}</div>
      )}
    </div>
  )
})

export const ThemeCard: React.FC = () => {
  const { presetId, custom, mode } = useAppearanceStore(useShallow((s) => ({ presetId: s.presetId, custom: s.custom, mode: s.mode })))
  const follow = useAppearanceStore((s) => s.system.follow)
  const dirty = useAppearanceStore((s) => Object.keys(s.tokens).length > 0)
  const saver = useUiState((s) => s.saver)
  const [renaming, setRenaming] = useState<string | null>(null)
  const active = custom.find((c) => c.id === presetId)
  const st = useAppearanceStore.getState

  const doExport = async (): Promise<void> => {
    try {
      const nm = active?.name ?? BUILTIN_PRESETS.find((p) => p.id === presetId)?.name ?? 'theme'
      if (await appearanceExportTheme(st().exportTheme(), nm)) toast.success('Тема сохранена в файл')
    } catch (e) {
      toast.error('Не удалось сохранить тему', { description: e instanceof Error ? e.message : String(e) })
    }
  }
  const doImport = async (): Promise<void> => {
    try {
      const text = await appearanceImportTheme()
      if (text == null) return
      const err = st().importTheme(text)
      if (err) toast.error(err)
      else toast.success('Тема импортирована')
    } catch (e) {
      toast.error('Не удалось импортировать тему', { description: e instanceof Error ? e.message : String(e) })
    }
  }
  // «Светлый / Тёмный»: раньше менялся только класс страницы, а цвета оставались от
  // тёмной темы — получалась смесь. Теперь выбирается тема нужного режима: своя пара
  // из «Как в системе», иначе стандартная «Светлая» / «Тёмная».
  const switchMode = (m: AppearanceMode): void => {
    const s = st()
    if (s.mode === m) return
    const slot = m === 'light' ? s.system.lightPreset : s.system.darkPreset
    const ok = (id: string): boolean => (s.custom.find((c) => c.id === id)?.mode ?? BUILTIN_PRESETS.find((p) => p.id === id)?.mode) === m
    s.selectPreset(ok(slot) ? slot : m)
  }
  const save = (): void => {
    st().saveAsCustom(saver.name || 'Моя тема')
    useUiState.getState().closeSaver()
    toast.success('Тема сохранена')
  }

  return (
    <SectionCard
      icon={Palette}
      title="Тема"
      tip="Готовые темы можно менять на вкладках «Цвета» и «Тонкая настройка»: правки хранятся отдельно, их можно сохранить как свою тему. Переключатель справа переходит на светлую или тёмную тему."
      right={
        <div className={cn(follow && 'pointer-events-none opacity-50')} title={follow ? 'Светлую или тёмную тему сейчас выбирает система (карточка ниже)' : undefined}>
          <Segmented
            value={mode}
            options={[
              { id: 'light', label: <><Sun /> Светлая</>, title: 'Перейти на светлую тему: ту, что выбрана для светлого режима системы, иначе стандартную «Светлую»' },
              { id: 'dark', label: <><Moon /> Тёмная</>, title: 'Перейти на тёмную тему: ту, что выбрана для тёмного режима системы, иначе стандартную «Тёмную»' }
            ]}
            onChange={(m) => switchMode(m)}
          />
        </div>
      }
    >
      <div className="space-y-3">
        {(['dark', 'light'] as const).map((m) => (
          <div key={m}>
            <div className="mb-1.5 text-[11px] font-semibold text-muted-foreground">{m === 'dark' ? 'Тёмные' : 'Светлые'}</div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(118px,1fr))] gap-2">
              {BUILTIN_PRESETS.filter((p) => p.mode === m).map((p) => (
                <Chip key={p.id} tokens={p.tokens} name={p.name} active={presetId === p.id} onClick={() => st().selectPreset(p.id)} />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 border-t border-border pt-3" data-ctl="my-themes" data-tour="appearance-my-themes">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold text-muted-foreground">Мои темы</span>
          {dirty && (
            <span className="flex items-center gap-1 rounded-md bg-st-warn/10 px-1.5 py-0.5 text-[10.5px] text-st-warn-text">
              <span className="size-1.5 rounded-full bg-warning" /> Есть несохранённые правки
            </span>
          )}
          <div className="ml-auto flex items-center gap-1">
            <Button size="xs" variant="ghost" title="Загрузить тему из файла" onClick={doImport}>
              <Upload /> Импорт
            </Button>
            <Button size="xs" variant="ghost" title="Сохранить текущую тему в файл, чтобы перенести или поделиться" onClick={doExport}>
              <Download /> Экспорт
            </Button>
          </div>
        </div>

        {active && dirty && !saver.open && (
          <Button size="sm" variant="outline" className="mb-2 w-full justify-start" onClick={() => { st().updateCustom(); toast.success(`«${active.name}» обновлена`) }}>
            <Save /> <span className="truncate">Записать правки в «{active.name}»</span>
          </Button>
        )}

        {saver.open && (
          <div className="mb-2 flex items-center gap-1.5 rounded-xl border border-primary/50 bg-primary/5 p-1.5">
            <input
              autoFocus
              value={saver.name}
              maxLength={40}
              onChange={(e) => useUiState.getState().setSaverName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') save()
                else if (e.key === 'Escape') useUiState.getState().closeSaver()
              }}
              placeholder="Название темы"
              className="select-text h-8 min-w-0 flex-1 rounded-lg border border-[color:var(--input-border)] bg-[color:var(--input-bg)] px-2.5 text-xs outline-none focus:border-[color:var(--input-focus-border)]"
            />
            <Button size="sm" onClick={save}>
              <Save /> Сохранить
            </Button>
            <Button size="sm" variant="ghost" onClick={() => useUiState.getState().closeSaver()}>
              Отмена
            </Button>
          </div>
        )}

        <div className="grid grid-cols-[repeat(auto-fill,minmax(118px,1fr))] gap-2">
          {custom.map((c) =>
            renaming === c.id ? (
              <div key={c.id} className="flex flex-col justify-end overflow-hidden rounded-xl border border-primary">
                <ThemeMini t={baseTokens(c.id, custom)} settings={c.settings} className="h-[62px] opacity-60" />
                <input
                  autoFocus
                  defaultValue={c.name}
                  maxLength={40}
                  onBlur={() => setRenaming(null)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      st().renameCustom(c.id, e.currentTarget.value)
                      setRenaming(null)
                    } else if (e.key === 'Escape') setRenaming(null)
                  }}
                  className="select-text h-[27px] w-full border-t border-primary bg-background px-2 text-[11px] outline-none"
                />
              </div>
            ) : (
              <Chip
                key={c.id}
                tokens={baseTokens(c.id, custom)}
                settings={c.settings}
                name={c.name}
                active={presetId === c.id}
                onClick={() => st().selectPreset(c.id)}
                actions={
                  <>
                    {(
                      [
                        ['Переименовать', Pencil, () => setRenaming(c.id), ''],
                        ['Дублировать', Copy, () => st().duplicateCustom(c.id), ''],
                        ['Удалить', Trash2, () => st().deleteCustom(c.id), 'hover:bg-destructive hover:text-white']
                      ] as const
                    ).map(([t, I, fn, cls]) => (
                      <button
                        key={t}
                        type="button"
                        title={t}
                        aria-label={t}
                        onClick={fn}
                        className={cn('flex size-5 cursor-pointer items-center justify-center rounded-md bg-black/60 text-white backdrop-blur-sm hover:bg-black/80', cls)}
                      >
                        <I className="size-3" />
                      </button>
                    ))}
                  </>
                }
              />
            )
          )}
          {!saver.open && (
            <button
              type="button"
              title="Сохранить текущее оформление как свою тему"
              onClick={() => useUiState.getState().openSaver('')}
              className="flex min-h-[90px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-border text-[11px] font-semibold text-muted-foreground transition-colors hover:border-primary/60 hover:bg-primary/5 hover:text-primary"
            >
              <Plus className="size-4" />
              Сохранить текущую
            </button>
          )}
        </div>
      </div>
    </SectionCard>
  )
}
