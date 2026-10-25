import React, { useState } from 'react'
import { Check, Copy, Download, Palette, Pencil, Save, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { useShallow } from 'zustand/react/shallow'
import { SectionCard, Segmented } from './section'
import { Button } from '@renderer/components/ui/button'
import { useUiState } from '@renderer/lib/appearance/ui-state'
import { cn } from '@renderer/lib/utils'
import { useAppearanceStore } from '@renderer/lib/appearance/store'
import { BUILTIN_PRESETS } from '@renderer/lib/appearance/presets'
import { appearanceExportTheme, appearanceImportTheme } from '@renderer/utils/ipc'

const Chip = React.memo(function Chip({
  tokens,
  name,
  active,
  onClick
}: {
  tokens: Record<string, string>
  name: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={name}
      className={cn(
        'group cursor-pointer overflow-hidden rounded-lg border text-left transition-all hover:-translate-y-px',
        active ? 'border-primary ring-2 ring-primary/40' : 'border-border hover:border-primary/50'
      )}
    >
      <div className="flex h-10 shrink-0" style={{ background: tokens['background'] }}>
        <div className="m-1.5 flex-1 rounded" style={{ background: tokens['card'], border: `1px solid ${tokens['border']}` }} />
        <div className="my-1.5 mr-1.5 w-5 rounded" style={{ background: tokens['primary'] }} />
      </div>
      <div className="flex items-center gap-1 bg-card px-1.5 py-1 text-[11px] font-medium text-card-foreground">
        <span className="min-w-0 flex-1 truncate">{name}</span>
        {active && <Check className="size-3 text-primary" />}
      </div>
    </button>
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
  const save = (): void => {
    st().saveAsCustom(saver.name || 'Моя тема')
    useUiState.getState().closeSaver()
    toast.success('Тема сохранена')
  }

  return (
    <SectionCard
      icon={Palette}
      title="Тема"
      tip="Готовые темы можно менять: правки остаются отдельно, их можно сохранить как свою тему."
      right={
        <div className={cn(follow && 'pointer-events-none opacity-50')} title={follow ? 'Режим выбирается системой' : undefined}>
          <Segmented
            value={mode}
            options={[
              { id: 'light', label: 'Светлый' },
              { id: 'dark', label: 'Тёмный' }
            ]}
            onChange={(m) => st().setMode(m)}
          />
        </div>
      }
    >
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
        {BUILTIN_PRESETS.map((p) => (
          <Chip key={p.id} tokens={p.tokens} name={p.name} active={presetId === p.id} onClick={() => st().selectPreset(p.id)} />
        ))}
      </div>

      <div className="mt-3 border-t border-border pt-2.5" data-ctl="my-themes">
        <div className="mb-1.5 flex items-center gap-2">
          <span className="text-[11px] font-semibold text-muted-foreground">Мои темы</span>
          {dirty && (
            <span className="flex items-center gap-1 text-[11px] text-warning">
              <span className="size-1.5 rounded-full bg-warning" /> Есть несохранённые изменения
            </span>
          )}
        </div>
        <div className="mb-2 flex flex-wrap gap-1">
          {custom.length === 0 && <span className="text-[11px] text-muted-foreground">Пока нет сохранённых тем</span>}
          {custom.map((c) =>
            renaming === c.id ? (
              <input
                key={c.id}
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
                className="select-text h-6 w-36 rounded-full border border-primary bg-background px-2 text-[11px] outline-none"
              />
            ) : (
              <span
                key={c.id}
                className={cn(
                  'group/chip flex max-w-52 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors',
                  presetId === c.id ? 'border-primary bg-primary/15' : 'border-border hover:border-primary/50'
                )}
              >
                <button type="button" onClick={() => st().selectPreset(c.id)} className="flex min-w-0 cursor-pointer items-center gap-1">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: c.tokens['primary'] ?? 'var(--primary)' }} />
                  <span className="truncate">{c.name}</span>
                </button>
                <span className="hidden items-center gap-0.5 group-hover/chip:flex">
                  <button type="button" title="Переименовать" onClick={() => setRenaming(c.id)} className="cursor-pointer text-muted-foreground hover:text-foreground">
                    <Pencil className="size-3" />
                  </button>
                  <button type="button" title="Дублировать" onClick={() => st().duplicateCustom(c.id)} className="cursor-pointer text-muted-foreground hover:text-foreground">
                    <Copy className="size-3" />
                  </button>
                  <button type="button" title="Удалить" onClick={() => st().deleteCustom(c.id)} className="cursor-pointer text-muted-foreground hover:text-destructive">
                    <Trash2 className="size-3" />
                  </button>
                </span>
              </span>
            )
          )}
        </div>

        {saver.open ? (
          <div className="flex items-center gap-1.5">
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
              className="select-text h-8 min-w-0 flex-1 rounded-lg border border-primary bg-background px-2 text-xs outline-none"
            />
            <Button size="sm" onClick={save}>
              <Save /> Сохранить
            </Button>
            <Button size="sm" variant="ghost" onClick={() => useUiState.getState().closeSaver()}>
              Отмена
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            <Button size="sm" variant="outline" className="border-primary text-primary hover:bg-primary/10" onClick={() => useUiState.getState().openSaver('')}>
              <Save /> Сохранить текущую тему
            </Button>
            {active && dirty && (
              <Button size="sm" variant="ghost" onClick={() => { st().updateCustom(); toast.success(`«${active.name}» обновлена`) }}>
                Записать в «{active.name}»
              </Button>
            )}
            <Button size="xs" variant="ghost" onClick={doImport}>
              <Upload /> Импорт
            </Button>
            <Button size="xs" variant="ghost" onClick={doExport}>
              <Download /> Экспорт
            </Button>
          </div>
        )}
      </div>
    </SectionCard>
  )
}
