import React, { useEffect, useMemo, useState } from 'react'
import { Gamepad2, Loader2, X } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { cn } from '@renderer/lib/utils'
import { systemScanInstalledGames, type InstalledGame } from '@renderer/utils/ipc'

interface Props {
  open: boolean
  onClose: () => void
  /** Уже добавленные процессы (сравнение без учёта регистра). */
  existing: string[]
  onAdd: (exeNames: string[]) => void | Promise<void>
}

/**
 * Найденные игры Steam и Epic. У каждой игры отмечен главный процесс; можно
 * отметить и остальные (лаунчер, отдельный клиент).
 */
const InstalledGamesModal: React.FC<Props> = ({ open, onClose, existing, onAdd }) => {
  const [loading, setLoading] = useState(false)
  const [games, setGames] = useState<InstalledGame[] | null>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')
  const have = useMemo(() => new Set(existing.map((e) => e.toLowerCase())), [existing])

  useEffect(() => {
    if (!open || games) return
    setLoading(true)
    systemScanInstalledGames()
      .then((list) => {
        setGames(list)
        // По умолчанию отмечен главный процесс каждой игры, которой ещё нет в списке.
        const pre = new Set<string>()
        for (const g of list) if (g.exes[0] && !have.has(g.exes[0].toLowerCase())) pre.add(g.exes[0])
        setChecked(pre)
      })
      .catch(() => setGames([]))
      .finally(() => setLoading(false))
  }, [open])

  if (!open) return null

  const toggle = (exe: string): void => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(exe)) next.delete(exe)
      else next.add(exe)
      return next
    })
  }

  const visible = (games ?? []).filter((g) => !filter.trim() || g.name.toLowerCase().includes(filter.trim().toLowerCase()))
  const toAdd = [...checked].filter((e) => !have.has(e.toLowerCase()))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-primary/40 bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border/40 p-4">
          <div className="flex items-center gap-2 text-sm font-bold">
            <Gamepad2 className="h-4 w-4 text-primary" />
            Установленные игры (Steam, Epic)
          </div>
          <Button size="icon-sm" variant="ghost" onClick={onClose} className="h-7 w-7">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="border-b border-border/40 p-3">
          <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Поиск игры…" className="text-xs" />
        </div>

        <div className="min-h-[250px] flex-1 space-y-2 overflow-y-auto p-3">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Ищу игры в библиотеках Steam и Epic…
            </div>
          ) : visible.length === 0 ? (
            <div className="py-16 text-center text-xs text-muted-foreground">
              {games && games.length === 0 ? 'Игры Steam и Epic не найдены' : 'Ничего не найдено'}
            </div>
          ) : (
            visible.map((g) => (
              <div key={`${g.source}:${g.dir}`} className="rounded-xl border border-border/50 bg-background/40 p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 truncate text-xs font-semibold">{g.name}</div>
                  <span className="shrink-0 text-[10px] text-muted-foreground">{g.source}</span>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {g.exes.map((exe, i) => {
                    const added = have.has(exe.toLowerCase())
                    const on = added || checked.has(exe)
                    return (
                      <button
                        key={exe}
                        type="button"
                        disabled={added}
                        onClick={() => toggle(exe)}
                        className={cn(
                          'rounded-lg border px-2 py-1 font-mono text-[11px] transition-colors',
                          on ? 'border-primary/60 bg-primary/15 text-primary' : 'border-border/60 text-muted-foreground hover:border-primary/40',
                          added && 'cursor-default opacity-70'
                        )}
                        title={i === 0 ? 'Главный процесс игры' : 'Дополнительный процесс'}
                      >
                        {exe}
                        {added ? ' · в списке' : ''}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border/40 p-3">
          <span className="text-[11px] text-muted-foreground">Отмечено: {toAdd.length}</span>
          <Button
            size="sm"
            disabled={toAdd.length === 0}
            onClick={async () => {
              await onAdd(toAdd)
              onClose()
            }}
          >
            Добавить в ExitLag
          </Button>
        </div>
      </div>
    </div>
  )
}

export default InstalledGamesModal
