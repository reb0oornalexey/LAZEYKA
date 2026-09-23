import React, { useMemo, useState } from 'react'
import { Shuffle, ChevronDown, ChevronUp } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Switch } from '@renderer/components/ui/switch'
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
  const anyOn = Boolean(settings?.autoFailover || settings?.routeAutoConnectBest)
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
    <Card className={cn('cyber-card border-primary/30', className)}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <Shuffle className="h-4 w-4 text-primary" />
            Автовыбор узла
            <Badge
              className={cn(
                'text-[9px] px-1.5 py-0 font-mono',
                anyOn
                  ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                  : 'bg-muted text-muted-foreground'
              )}
            >
              {anyOn ? 'ВКЛ' : 'ВЫКЛ'}
            </Badge>
          </CardTitle>
          <span className="text-[10px] text-muted-foreground font-mono">
            разрешено {allowedCount} из {nodes.length}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-2.5">
        <label className="flex items-center justify-between gap-3 cursor-pointer">
          <span className="text-[11px] leading-snug">
            <span className="font-semibold text-foreground block">Автопереключение при сбое узла</span>
            <span className="text-muted-foreground">
              Если узел начал рвать соединения или DNS через него молчит — LAZEYKA сама найдёт рабочий узел и
              переключится.
            </span>
          </span>
          <Switch checked={Boolean(settings?.autoFailover)} onCheckedChange={(v) => void onPatch({ autoFailover: v })} />
        </label>
        <label className="flex items-center justify-between gap-3 cursor-pointer">
          <span className="text-[11px] leading-snug">
            <span className="font-semibold text-foreground block">Подключаться к лучшему после замера</span>
            <span className="text-muted-foreground">Оптимизатор маршрута ExitLag сам переключит на узел с лучшей оценкой.</span>
          </span>
          <Switch
            checked={Boolean(settings?.routeAutoConnectBest)}
            onCheckedChange={(v) => void onPatch({ routeAutoConnectBest: v })}
          />
        </label>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center justify-between text-[11px] font-semibold text-primary pt-1 border-t border-border/40 cursor-pointer"
        >
          <span>Какие узлы можно выбирать автоматически</span>
          {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>

        {open && (
          <div className="space-y-2">
            <div className="space-y-1">
              <span className="text-[10px] text-muted-foreground">
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
                      'flex items-center justify-between gap-2 rounded-md border px-2 py-1 text-[11px]',
                      reason ? 'border-border/40 opacity-60' : 'border-border/60'
                    )}
                  >
                    <span className="truncate">
                      {n.name}
                      {reason && <span className="ml-1.5 text-[9px] text-amber-600">({reason})</span>}
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
      </CardContent>
    </Card>
  )
}
