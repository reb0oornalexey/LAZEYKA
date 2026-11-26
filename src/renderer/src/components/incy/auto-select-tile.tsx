import React, { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { ListChecks, Search, Shuffle, X } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Switch } from '@renderer/components/ui/switch'
import { Hint } from '@renderer/components/prematch/hint'
import { LzPanel } from '@renderer/components/lz'
import { autoExcludeReason, nodeAutoKey } from '@renderer/components/auto-select-card'
import { cn } from '@renderer/lib/utils'
import type { IncyNode, IncySettings } from '@renderer/utils/ipc'

interface Props {
  settings: IncySettings | null
  nodes: IncyNode[]
  onPatch: (patch: Partial<IncySettings>) => Promise<unknown> | void
  className?: string
}

/**
 * «Автовыбор узла» на Главной INCY — компактно: два переключателя в одной
 * плитке, а правила «какие узлы можно выбирать» — в окне по кнопке.
 * Те же настройки, что у AutoSelectCard (страница ExitLag), меняется только вид.
 */
export const AutoSelectTile: React.FC<Props> = ({ settings, nodes, onPatch, className }) => {
  const [rulesOpen, setRulesOpen] = useState(false)
  const allowedCount = useMemo(() => nodes.filter((n) => !autoExcludeReason(n, settings)).length, [nodes, settings])
  const anyOn = Boolean(settings?.autoFailover || settings?.routeAutoConnectBest)

  const row = (
    label: string,
    hint: string,
    checked: boolean,
    onChange: (v: boolean) => void,
    tour: string
  ): React.ReactElement => (
    <div data-tour={tour} className="flex items-center justify-between gap-3 rounded-xl border border-foreground/[0.07] bg-foreground/[0.03] px-3 py-2">
      <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] font-semibold text-foreground">
        <span className="truncate">{label}</span>
        <Hint text={hint} />
      </span>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </div>
  )

  return (
    <LzPanel tone={anyOn ? 'on' : 'off'} glow={9} data-tour="incy-auto-select" className={cn('flex flex-col gap-2.5 p-4', className)}>
      <div className="flex items-center gap-2.5">
        <span
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-[10px] [&_svg]:size-[17px]',
            anyOn ? 'bg-primary/15 text-primary' : 'bg-foreground/[0.06] text-muted-foreground'
          )}
        >
          <Shuffle />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[14px] font-bold text-[color:var(--text-title)]">
            Автовыбор узла
            <Hint text="LAZEYKA сама меняет узел: если текущий перестал отвечать или после замера нашёлся заметно более быстрый. Какие узлы можно брать, задаётся кнопкой внизу." />
          </div>
          <div className="text-[11.5px] text-muted-foreground">{anyOn ? 'включён' : 'выключен'}</div>
        </div>
      </div>

      {row(
        'Переключать при сбое',
        'Если узел начал рвать соединения или DNS через него молчит — LAZEYKA сама найдёт рабочий узел и переключится.',
        Boolean(settings?.autoFailover),
        (v) => void onPatch({ autoFailover: v }),
        'incy-auto-failover'
      )}
      {row(
        'К лучшему после замера',
        'После замера пинга в INCY или оптимизатора ExitLag — переход на заметно более быстрый узел.',
        Boolean(settings?.routeAutoConnectBest),
        (v) => void onPatch({ routeAutoConnectBest: v }),
        'incy-auto-best'
      )}

      <button
        type="button"
        onClick={() => setRulesOpen(true)}
        title="Какие узлы можно выбирать автоматически"
        className="mt-auto flex cursor-pointer items-center justify-between gap-2 rounded-xl border border-dashed border-foreground/15 px-3 py-2 text-left text-[12px] font-semibold text-muted-foreground transition-colors hover:border-primary/45 hover:text-primary"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <ListChecks className="size-3.5 shrink-0" />
          <span className="truncate">Разрешённые узлы</span>
        </span>
        <span className="shrink-0 tabular-nums">
          {allowedCount} из {nodes.length}
        </span>
      </button>

      {rulesOpen && <AutoRulesDialog settings={settings} nodes={nodes} onPatch={onPatch} onClose={() => setRulesOpen(false)} />}
    </LzPanel>
  )
}

/** Окно правил автовыбора: ключевые слова и ручной список узлов. */
const AutoRulesDialog: React.FC<Props & { onClose: () => void }> = ({ settings, nodes, onPatch, onClose }) => {
  const [kwDraft, setKwDraft] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const excluded = new Set(settings?.autoSelectExcludedKeys ?? [])
  const visible = nodes.filter((n) => !filter || n.name.toLowerCase().includes(filter.toLowerCase()))
  const allowedCount = nodes.filter((n) => !autoExcludeReason(n, settings)).length

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const toggleNode = (n: IncyNode, allow: boolean): void => {
    const key = nodeAutoKey(n)
    const next = new Set(excluded)
    if (allow) next.delete(key)
    else next.add(key)
    void onPatch({ autoSelectExcludedKeys: [...next] })
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-label="Какие узлы можно выбирать автоматически"
        className="flex max-h-[82vh] w-full max-w-lg flex-col gap-3 rounded-2xl border border-border bg-[color:var(--popover)] p-5 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[15px] font-bold text-[color:var(--text-title)]">Какие узлы можно выбирать автоматически</div>
            <div className="mt-0.5 text-[12px] text-muted-foreground">
              Разрешено {allowedCount} из {nodes.length}. Например, можно не трогать узлы с ограниченным пакетом трафика.
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Закрыть" className="cursor-pointer rounded-lg p-1 text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>

        <div className="space-y-1.5">
          <div className="text-[12px] text-muted-foreground">Не выбирать узлы, в названии или описании которых есть (через запятую):</div>
          <div className="flex gap-2">
            <Input
              value={kwDraft ?? settings?.autoSelectExcludeKeywords ?? ''}
              onChange={(e) => setKwDraft(e.target.value)}
              placeholder="например: трафик, GB, premium"
              className="h-9 text-xs"
            />
            <Button
              size="sm"
              className="h-9 shrink-0 text-xs"
              disabled={kwDraft === null}
              onClick={() => {
                void onPatch({ autoSelectExcludeKeywords: (kwDraft ?? '').trim() })
                setKwDraft(null)
              }}
            >
              Сохранить
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Поиск узла…" className="h-8 pl-8 text-xs" />
          </div>
          <Button size="sm" variant="outline" className="h-8 shrink-0 text-xs" onClick={() => void onPatch({ autoSelectExcludedKeys: [] })}>
            Разрешить все
          </Button>
          <Button size="sm" variant="outline" className="h-8 shrink-0 text-xs" onClick={() => void onPatch({ autoSelectExcludedKeys: nodes.map(nodeAutoKey) })}>
            Запретить все
          </Button>
        </div>

        <div className="-mr-1 min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
          {visible.map((n) => {
            const reason = autoExcludeReason(n, settings)
            const byKeyword = reason !== null && !excluded.has(nodeAutoKey(n))
            return (
              <label
                key={n.id}
                className={cn(
                  'flex cursor-pointer items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-[12px]',
                  reason ? 'border-foreground/[0.06] opacity-60' : 'border-foreground/[0.1] bg-foreground/[0.03]'
                )}
              >
                <span data-sensitive="node" className="truncate">
                  {n.name}
                  {reason && <span className="ml-1.5 text-[10.5px] text-st-warn-text">({reason})</span>}
                </span>
                <input
                  type="checkbox"
                  className="accent-primary"
                  checked={!reason}
                  disabled={byKeyword}
                  onChange={(e) => toggleNode(n, e.target.checked)}
                  title={byKeyword ? 'Исключён по ключевому слову' : 'Участвует в автовыборе'}
                />
              </label>
            )
          })}
          {visible.length === 0 && <div className="py-3 text-center text-[12px] text-muted-foreground">Узлов нет</div>}
        </div>
      </div>
    </div>,
    document.body
  )
}

export default AutoSelectTile
