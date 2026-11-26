import React, { useMemo, useState } from 'react'
import { Shuffle, ChevronDown, ChevronUp, Sparkles } from 'lucide-react'
import { Rows, SettingsGroup, SwitchRow } from '@renderer/components/settings/setting-row'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { cn } from '@renderer/lib/utils'
import type { IncyNode, IncySettings } from '@renderer/utils/ipc'

/** Тот же ключ, что в main: id меняются при обновлении подписки, а этот — нет. */
export function nodeAutoKey(n: Pick<IncyNode, 'name' | 'server' | 'port'>): string {
  return `${n.name}|${n.server}:${n.port}`
}

function keywordsOf(s?: IncySettings | null): string[] {
  return String(s?.autoSelectExcludeKeywords ?? '')
    .split(/[,;\n]+/)
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean)
}

/** Почему узел не участвует в автовыборе (null — участвует). */
export function autoExcludeReason(n: IncyNode, s?: IncySettings | null): string | null {
  if ((s?.autoSelectExcludedKeys ?? []).includes(nodeAutoKey(n))) return 'отключён вручную'
  const hay = `${n.name} ${n.description ?? ''}`.toLowerCase()
  const word = keywordsOf(s).find((w) => hay.includes(w))
  return word ? `содержит «${word}»` : null
}

interface Props {
  settings: IncySettings | null
  nodes: IncyNode[]
  onPatch: (patch: Partial<IncySettings>) => Promise<unknown> | void
  className?: string
}

/**
 * «Автовыбор узла» — один блок на страницах INCY и ExitLag, чтобы переключатели
 * не терялись: автопереключение при сбое, автоподключение к лучшему после
 * замера и правила, какие узлы вообще можно выбирать автоматически (например,
 * не трогать узлы с ограниченным пакетом трафика).
 */
export default function AutoSelectCard({ settings, nodes, onPatch, className }: Props): React.ReactElement {
  const [open, setOpen] = useState(false)
  const [kwDraft, setKwDraft] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

  const allowedCount = useMemo(
    () => nodes.filter((n) => !autoExcludeReason(n, settings)).length,
    [nodes, settings]
  )
  const excluded = new Set(settings?.autoSelectExcludedKeys ?? [])

  const toggleNode = (n: IncyNode, allow: boolean): void => {
    const key = nodeAutoKey(n)
    const next = new Set(excluded)
    if (allow) next.delete(key)
    else next.add(key)
    void onPatch({ autoSelectExcludedKeys: [...next] })
  }

  const visible = nodes.filter((n) => !filter || n.name.toLowerCase().includes(filter.toLowerCase()))

  return (
    <SettingsGroup
      title="Автовыбор узла"
      hint="Какие узлы VPN программа может выбирать сама: при сбое узла и после замера пинга."
      sub={`Разрешено ${allowedCount} из ${nodes.length}`}
      className={className}
    >
      <Rows>
        <SwitchRow
          id="auto-failover"
          icon={<Shuffle />}
          title="Автопереключение при сбое узла"
          desc="Если узел начал рвать соединения или DNS через него молчит, LAZEYKA сама найдёт рабочий узел и переключится."
          checked={Boolean(settings?.autoFailover)}
          onChange={(v) => void onPatch({ autoFailover: v })}
        />
        <SwitchRow
          id="route-autoconnect-best"
          data-tour="optimizer-autoconnect"
          icon={<Sparkles />}
          title="Подключаться к лучшему после замера"
          desc="После замера пинга в INCY или в оптимизаторе — переход на заметно более быстрый узел из разрешённых. Выключено — только подсказка."
          checked={Boolean(settings?.routeAutoConnectBest)}
          onChange={(v) => void onPatch({ routeAutoConnectBest: v })}
        />
      </Rows>
      <div className="px-3 pt-1 pb-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full cursor-pointer items-center justify-between rounded-xl border border-foreground/[0.08] bg-foreground/[0.03] px-3 py-2 text-[12.5px] font-semibold text-foreground transition-colors hover:border-primary/40"
        >
          <span>Какие узлы можно выбирать автоматически</span>
          {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>

        {open && (
          <div className="mt-2 space-y-2">
            <div className="space-y-1">
              <span className="text-[11.5px] text-muted-foreground">
                Не выбирать узлы, в названии или описании которых есть (через запятую):
              </span>
              <div className="flex gap-2">
                <Input
                  value={kwDraft ?? settings?.autoSelectExcludeKeywords ?? ''}
                  onChange={(e) => setKwDraft(e.target.value)}
                  placeholder="например: трафик, GB, premium"
                  className="h-8 text-xs"
                />
                <Button
                  size="sm"
                  className="h-8 text-xs shrink-0"
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
              <Input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Поиск узла…"
                className="h-7 text-[11px]"
              />
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[10px] shrink-0"
                onClick={() => void onPatch({ autoSelectExcludedKeys: [] })}
              >
                Разрешить все
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[10px] shrink-0"
                onClick={() => void onPatch({ autoSelectExcludedKeys: nodes.map(nodeAutoKey) })}
              >
                Запретить все
              </Button>
            </div>

            <div className="max-h-56 overflow-y-auto space-y-1 pr-1">
              {visible.map((n) => {
                const reason = autoExcludeReason(n, settings)
                const byKeyword = reason !== null && !excluded.has(nodeAutoKey(n))
                return (
                  <label
                    key={n.id}
                    className={cn(
                      'flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-[12px]',
                      reason ? 'border-foreground/[0.06] opacity-60' : 'border-foreground/[0.1]'
                    )}
                  >
                    <span data-sensitive="node" className="truncate">
                      {n.name}
                      {reason && <span className="ml-1.5 text-[9px] text-st-warn-text">({reason})</span>}
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
              {visible.length === 0 && (
                <div className="text-[11px] text-muted-foreground text-center py-3">Узлов нет</div>
              )}
            </div>
          </div>
        )}
      </div>
    </SettingsGroup>
  )
}
