import React, { useEffect } from 'react'
import { AlertTriangle, ChevronDown, Sparkles } from 'lucide-react'
import { ColorField } from './color-field'
import { ResetButton, SectionCard } from './section'
import { Button } from '@renderer/components/ui/button'
import { ADVANCED_GROUPS, SIMPLE_GROUPS } from '@renderer/lib/appearance/tokens'
import { useIssueTotal } from '@renderer/lib/appearance/contrast-watch'
import { autoFixAll } from '@renderer/lib/appearance/contrast-state'
import { useAppearanceStore } from '@renderer/lib/appearance/store'
import { useUiState } from '@renderer/lib/appearance/ui-state'
import { cn } from '@renderer/lib/utils'

const ICONS = { base: Sparkles, text: Sparkles, status: Sparkles } as const

/** Вкладка «Цвета»: 13 смысловых цветов, остальное считается само. */
export const ColorsTab: React.FC = () => {
  const total = useIssueTotal()
  const edits = useAppearanceStore((s) => Object.keys(s.tokens).length)
  return (
    <div className="space-y-2.5">
      {total > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-2.5 py-1.5 text-xs text-warning">
          <AlertTriangle className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1">Плохо читается: {total}</span>
          <Button size="xs" variant="outline" onClick={autoFixAll}>
            Исправить всё
          </Button>
        </div>
      )}
      {SIMPLE_GROUPS.map((g) => (
        <SectionCard
          key={g.id}
          icon={ICONS[g.id as keyof typeof ICONS] ?? Sparkles}
          title={g.title}
          tip={g.id === 'base' ? 'Остальные цвета (наведение, рамки полей, значки) считаются от этих автоматически.' : undefined}
          right={
            g.id === 'base' && edits > 0 ? (
              <ResetButton label="Сбросить правки" onClick={() => useAppearanceStore.getState().resetTokens()} />
            ) : undefined
          }
        >
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-x-3 gap-y-0.5">
            {g.colors.map((c) => (
              <ColorField key={c.key} tokenKey={c.key} label={c.label} hint={c.hint} />
            ))}
          </div>
        </SectionCard>
      ))}
    </div>
  )
}

/** Вкладка «Расширенные»: переопределения по компонентам; пока не задано — «авто». */
export const AdvancedTab: React.FC = () => {
  const open = useUiState((s) => s.openAdv)
  const toggle = useUiState((s) => s.toggleAdv)
  // Группы свёрнуты при каждом заходе на вкладку: сбрасываем при уходе, а не при входе (переход из предпросмотра открывает нужную).
  useEffect(() => () => useUiState.setState({ openAdv: [] }), [])
  return (
    <div className="space-y-2">
      <p className="px-1 text-[11px] text-muted-foreground">Пока цвет не задан, он «авто» — считается от основных цветов. Задайте свой, только если нужно точечно.</p>
      {ADVANCED_GROUPS.map((g) => {
        const isOpen = open.includes(g.id)
        return (
          <section key={g.id} className="rounded-xl border border-border bg-card text-card-foreground">
            <button
              type="button"
              onClick={() => toggle(g.id)}
              aria-expanded={isOpen}
              className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left"
            >
              <span className="flex-1 text-[13px] font-semibold text-[color:var(--text-title)]">{g.title}</span>
              <span className="text-[11px] text-muted-foreground">{g.description}</span>
              <ChevronDown className={cn('size-4 text-muted-foreground transition-transform', isOpen && 'rotate-180')} />
            </button>
            {isOpen && (
              <div className="space-y-2 border-t border-border px-3 py-2">
                {g.blocks.map((b, i) => (
                  <div key={i}>
                    {b.title && <div className="mb-0.5 text-[11px] font-semibold text-muted-foreground">{b.title}</div>}
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-x-3 gap-y-0.5">
                      {b.tokens.map((t) => (
                        <ColorField key={t.key} tokenKey={t.key} label={t.label} advanced />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}
